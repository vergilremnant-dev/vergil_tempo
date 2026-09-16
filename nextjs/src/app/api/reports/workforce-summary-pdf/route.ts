import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth";
import PDFDocument from "pdfkit";
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

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));
    const totalDaysInMonth = endDate.getUTCDate();

    // Fetch active holidays
    const holidays = await prisma.holidays.findMany({
      where: {
        is_active: true,
        holiday_date: { gte: startDate, lte: endDate },
      },
    });
    const holidayDatesSet = new Set(
      holidays.map((h) => h.holiday_date.toISOString().split("T")[0])
    );

    // Calculate Uniform Working Days
    let totalWorkingDays = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const curDate = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeekName = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.timezone || "Asia/Kolkata",
        weekday: "long",
      }).format(curDate).toLowerCase();

      const curDateStr = curDate.toISOString().split("T")[0];
      if (!weekendNames.includes(dayOfWeekName) && !holidayDatesSet.has(curDateStr)) {
        totalWorkingDays++;
      }
    }

    // Filter employees
    const userWhere: any = { role: { not: "ADMIN" } };
    if (clientIdParam && clientIdParam !== "ALL") {
      userWhere.client_id = parseInt(clientIdParam);
    }

    const employees = await prisma.users.findMany({
      where: userWhere,
      include: { clients: true },
      orderBy: { name: "asc" },
    });

    const timesheets = await prisma.timesheets.findMany({
      where: { date: { gte: startDate, lte: endDate } },
    });

    const leaves = await prisma.leaves.findMany({
      where: { start_date: { lte: endDate }, end_date: { gte: startDate } },
    });

    // Build PDF document using pdfkit
    const doc = new PDFDocument({ size: "A4", margin: 30, layout: "landscape" });
    const chunks: any[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));

    const pdfPromise = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Header Branding
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("Vergil Remnant Consultant Services Pvt Ltd", 30, 25);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#777777")
      .text("Vergil Tempo Workforce Time & Attendance System", 30, 45);

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("#FF7A00")
      .text("MASTER WORKFORCE ATTENDANCE AUDIT REPORT", 30, 65);

    const monthLabel = startDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    // Metadata Bar
    doc.rect(30, 85, 782, 30).fill("#F8F9FA");
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#111111");

    doc.text(`Period: `, 40, 95, { continued: true }).font("Helvetica").text(monthLabel);
    doc.font("Helvetica-Bold").text(`Total Staff: `, 200, 95, { continued: true }).font("Helvetica").text(`${employees.length} Employees`);
    doc.font("Helvetica-Bold").text(`Uniform Working Days: `, 400, 95, { continued: true }).font("Helvetica").text(`${totalWorkingDays} Days`);
    doc.font("Helvetica-Bold").text(`Generated Date: `, 630, 95, { continued: true }).font("Helvetica").text(new Date().toISOString().split("T")[0]);

    // Table Column Headers
    let currentY = 125;
    const columns = [
      { label: "Employee Name", width: 140, align: "left" },
      { label: "Client MNC", width: 110, align: "left" },
      { label: "Working Days", width: 80, align: "center" },
      { label: "Present", width: 65, align: "center" },
      { label: "Leave", width: 65, align: "center" },
      { label: "Absent", width: 65, align: "center" },
      { label: "Total Hours", width: 80, align: "right" },
      { label: "Billable Total", width: 95, align: "right" },
      { label: "Score", width: 80, align: "center" },
    ];

    doc.rect(30, currentY, 782, 22).fill("#111111");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);

    let currentX = 30;
    columns.forEach((col) => {
      doc.text(col.label, currentX + 5, currentY + 7, { width: col.width - 10, align: col.align as any });
      currentX += col.width;
    });

    currentY += 22;

    let totalWorkforceHours = 0;
    let totalWorkforceBillable = 0;

    employees.forEach((emp, index) => {
      const empTimesheets = timesheets.filter((t) => t.user_id === emp.id);
      const presentDates = new Set(
        empTimesheets.map((t) => t.date.toISOString().split("T")[0])
      );
      const presentDays = presentDates.size;

      const empLeaves = leaves.filter((l) => l.user_id === emp.id);
      let leaveDays = 0;
      empLeaves.forEach((l) => {
        const typeLower = l.leave_type.toLowerCase();
        if (typeLower.includes("half")) {
          leaveDays += 0.5;
        } else {
          const lStart = l.start_date < startDate ? startDate : l.start_date;
          const lEnd = l.end_date > endDate ? endDate : l.end_date;
          const diffMs = lEnd.getTime() - lStart.getTime();
          const count = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
          leaveDays += Math.max(1, count);
        }
      });

      const totalHours = empTimesheets.reduce((sum, t) => sum + Number(t.hours || 0), 0);
      const absentDays = Math.max(0, totalWorkingDays - (presentDays + leaveDays));
      const hourlyRate = Number(emp.hourly_rate || 0);
      const billableAmount = totalHours * hourlyRate;
      const attendanceScore = Math.min(100, Math.round(((presentDays + leaveDays) / Math.max(1, totalWorkingDays)) * 100));

      totalWorkforceHours += totalHours;
      totalWorkforceBillable += billableAmount;

      // Alternating row background
      if (index % 2 === 1) {
        doc.rect(30, currentY, 782, 20).fill("#F9FAFB");
      }

      // Border line
      doc.strokeColor("#E5E7EB").lineWidth(0.5).moveTo(30, currentY + 20).lineTo(812, currentY + 20).stroke();

      let rowX = 30;
      const rowValues = [
        emp.name,
        emp.clients ? emp.clients.name : "Unassigned",
        `${totalWorkingDays} Days`,
        `${presentDays}`,
        `${leaveDays}`,
        `${absentDays}`,
        `${totalHours.toFixed(1)} hrs`,
        `$${billableAmount.toFixed(2)}`,
        `${attendanceScore}%`,
      ];

      rowValues.forEach((val, colIdx) => {
        const col = columns[colIdx];
        let textColor = "#374151";
        let textFont = "Helvetica";

        if (colIdx === 3) textColor = "#059669"; // Present (Green)
        if (colIdx === 4) textColor = "#2563EB"; // Leave (Blue)
        if (colIdx === 5 && absentDays > 0) textColor = "#DC2626"; // Absent (Red)
        if (colIdx === 7) textFont = "Helvetica-Bold"; // Billable
        if (colIdx === 8) {
          textFont = "Helvetica-Bold";
          textColor = attendanceScore >= 95 ? "#059669" : attendanceScore >= 85 ? "#D97706" : "#DC2626";
        }

        doc
          .font(textFont)
          .fontSize(8)
          .fillColor(textColor)
          .text(val, rowX + 5, currentY + 6, { width: col.width - 10, align: col.align as any });
        rowX += col.width;
      });

      currentY += 20;

      // New page if height limit reached
      if (currentY > 520 && index < employees.length - 1) {
        doc.addPage({ size: "A4", margin: 30, layout: "landscape" });
        currentY = 30;

        doc.rect(30, currentY, 782, 22).fill("#111111");
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
        let headerX = 30;
        columns.forEach((col) => {
          doc.text(col.label, headerX + 5, currentY + 7, { width: col.width - 10, align: col.align as any });
          headerX += col.width;
        });
        currentY += 22;
      }
    });

    // Summary Footer Row
    currentY += 5;
    doc.rect(30, currentY, 782, 22).fill("#F3F4F6");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111");
    doc.text("WORKFORCE TOTALS", 40, currentY + 7);

    doc.text(`${totalWorkforceHours.toFixed(1)} hrs`, 555, currentY + 7, { width: 80, align: "right" });
    doc.fillColor("#059669").text(`$${totalWorkforceBillable.toFixed(2)}`, 650, currentY + 7, { width: 95, align: "right" });

    doc.end();

    const pdfBuffer = await pdfPromise;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=Vergil_Tempo_Workforce_Audit_${year}-${String(month).padStart(2, "0")}.pdf`,
      },
    });
  } catch (error: any) {
    console.error("GET /api/reports/workforce-summary-pdf error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
