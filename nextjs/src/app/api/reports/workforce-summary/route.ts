import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth";
import { getCompanySettings } from "@/lib/settings";

export async function GET(req: NextRequest) {
  const { user, response } = await checkAuth(req, ["ADMIN", "MANAGER"]);
  if (response) return response;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
    const clientIdParam = searchParams.get("clientId");

    const settings = await getCompanySettings();
    const weekendNames = settings.weekend_configuration.split(",").map((d) => d.trim().toLowerCase());

    // Calculate start and end date for month in UTC
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0)); // Last day of month
    const totalDaysInMonth = endDate.getUTCDate();

    // Fetch holidays in this month
    const holidays = await prisma.holidays.findMany({
      where: {
        is_active: true,
        holiday_date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
    const holidayDatesSet = new Set(
      holidays.map((h) => h.holiday_date.toISOString().split("T")[0])
    );

    // Calculate Uniform Total Working Days for the month
    let totalWorkingDays = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const curDate = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeekName = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.timezone || "Asia/Kolkata",
        weekday: "long",
      }).format(curDate).toLowerCase();

      const curDateStr = curDate.toISOString().split("T")[0];

      // If not weekend and not active holiday
      if (!weekendNames.includes(dayOfWeekName) && !holidayDatesSet.has(curDateStr)) {
        totalWorkingDays++;
      }
    }

    // Filter users by client if clientId specified
    const userWhere: any = { role: { not: "ADMIN" } };
    if (clientIdParam && clientIdParam !== "ALL") {
      userWhere.client_id = parseInt(clientIdParam);
    }

    const employees = await prisma.users.findMany({
      where: userWhere,
      include: {
        clients: true,
      },
      orderBy: { name: "asc" },
    });

    // Aggregate timesheets for the month
    const timesheets = await prisma.timesheets.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Aggregate leaves for the month
    const leaves = await prisma.leaves.findMany({
      where: {
        start_date: { lte: endDate },
        end_date: { gte: startDate },
      },
    });

    const employeeSummaries = employees.map((emp) => {
      const empTimesheets = timesheets.filter((t) => t.user_id === emp.id);
      
      // Present Days (unique dates with timesheet entries)
      const presentDates = new Set(
        empTimesheets.map((t) => t.date.toISOString().split("T")[0])
      );
      const presentDays = presentDates.size;

      // Approved Leaves for this employee
      const empLeaves = leaves.filter((l) => l.user_id === emp.id);
      let leaveDays = 0;
      empLeaves.forEach((l) => {
        const typeLower = l.leave_type.toLowerCase();
        if (typeLower.includes("half") || typeLower.includes("half-day")) {
          leaveDays += 0.5;
        } else {
          // Calculate overlap days with the current month
          const lStart = l.start_date < startDate ? startDate : l.start_date;
          const lEnd = l.end_date > endDate ? endDate : l.end_date;
          const diffMs = lEnd.getTime() - lStart.getTime();
          const count = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
          leaveDays += Math.max(1, count);
        }
      });

      // Total Working Hours
      const totalHours = empTimesheets.reduce(
        (sum, t) => sum + Number(t.hours || 0),
        0
      );

      // Late In and Early Out counts from notes/status
      let lateCount = 0;
      let earlyLeaveCount = 0;
      empTimesheets.forEach((t) => {
        if (t.notes?.includes("[Status: LATE")) lateCount++;
        if (t.notes?.includes("[Status: EARLY_LEAVE")) earlyLeaveCount++;
      });

      // Absent Days calculation
      const effectiveAccountedDays = presentDays + leaveDays;
      const absentDays = Math.max(0, totalWorkingDays - effectiveAccountedDays);

      // Hourly Rate & Billable Amount
      const hourlyRate = Number(emp.hourly_rate || 0);
      const billableAmount = Number((totalHours * hourlyRate).toFixed(2));

      // Attendance Rating Percentage Score
      const attendanceScore = Math.min(
        100,
        Math.round((effectiveAccountedDays / Math.max(1, totalWorkingDays)) * 100)
      );

      return {
        userId: emp.id,
        name: emp.name,
        username: emp.username,
        clientCompany: emp.clients?.name || "Unassigned",
        hourlyRate,
        totalWorkingDays,
        presentDays,
        leaveDays,
        absentDays,
        totalHours: Number(totalHours.toFixed(2)),
        billableAmount,
        lateCount,
        earlyLeaveCount,
        attendanceScore,
      };
    });

    return NextResponse.json({
      year,
      month,
      totalWorkingDays,
      totalEmployees: employeeSummaries.length,
      summaries: employeeSummaries,
    });
  } catch (error: any) {
    console.error("GET /api/reports/workforce-summary error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
