import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth";
import { recalculateTimesheetAggregates } from "@/lib/attendance";


// PUT /api/admin/timesheets/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await checkAuth(req, ["ADMIN"]);
  if (response) return response;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json();
    const { date, clockIn, clockOut, notes, clientCompany } = body;

    const timesheet = await prisma.timesheets.findUnique({
      where: { id },
      include: { attendance_sessions: true },
    });
    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet entry not found" }, { status: 404 });
    }

    // Deterministically parse date in UTC to prevent local timezone shifts
    let dateVal = timesheet.date;
    if (date) {
      const dateParts = date.split("-");
      if (dateParts.length < 3) {
        return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD" }, { status: 400 });
      }
      dateVal = new Date(
        Date.UTC(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2]),
          0, 0, 0, 0
        )
      );
    }

    const parseTime = (timeStr: string) => {
      const parts = timeStr.split(":");
      if (parts.length < 2) return null;
      const h = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const s = parts[2] ? parseInt(parts[2]) : 0;
      if (isNaN(h) || isNaN(m) || isNaN(s) || h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
        return null;
      }
      return new Date(
        Date.UTC(
          1970,
          0,
          1,
          h,
          m,
          s,
          0
        )
      );
    };

    if (clockIn === null || clockIn === "") {
      return NextResponse.json({ error: "Clock In time is required for updating timesheet records" }, { status: 400 });
    }

    let inTime = timesheet.clock_in;
    if (clockIn) {
      const parsedIn = parseTime(clockIn);
      if (!parsedIn) {
        return NextResponse.json({ error: "Invalid Clock In time format. Expected HH:MM or HH:MM:SS" }, { status: 400 });
      }
      inTime = parsedIn;
    }

    let outTime = timesheet.clock_out;
    if (clockOut !== undefined) {
      if (clockOut === null || clockOut === "") {
        outTime = null;
      } else {
        const parsedOut = parseTime(clockOut);
        if (!parsedOut) {
          return NextResponse.json({ error: "Invalid Clock Out time format. Expected HH:MM or HH:MM:SS" }, { status: 400 });
        }
        outTime = parsedOut;
      }
    }

    let hours = null;
    if (outTime) {
      const minutes = Math.floor((outTime.getTime() - inTime.getTime()) / 60000);
      if (minutes < 0) {
        return NextResponse.json({ error: "Clock Out time cannot be earlier than Clock In time" }, { status: 400 });
      }
      hours = Number((minutes / 60).toFixed(2));
    }

    // Active duplicate check if updating to be an active session
    if (outTime === null) {
      const activeDuplicate = await prisma.timesheets.findFirst({
        where: {
          user_id: timesheet.user_id,
          date: dateVal,
          clock_out: null,
          id: { not: id } // Exclude current record
        },
      });
      if (activeDuplicate) {
        return NextResponse.json(
          { error: "A duplicate active clock-in session already exists for this candidate on this date." },
          { status: 400 }
        );
      }
    }

    // Overlap validation check
    const existingTimesheets = await prisma.timesheets.findMany({
      where: {
        user_id: timesheet.user_id,
        date: dateVal,
        id: { not: id } // Exclude the current record being updated
      },
    });

    const timesOverlap = (in1: Date, out1: Date | null, in2: Date, out2: Date | null) => {
      const t1_start = in1.getTime();
      const t1_end = out1 ? out1.getTime() : Infinity;
      const t2_start = in2.getTime();
      const t2_end = out2 ? out2.getTime() : Infinity;
      return t1_start < t2_end && t2_start < t1_end;
    };

    for (const ext of existingTimesheets) {
      if (timesOverlap(inTime, outTime, ext.clock_in, ext.clock_out)) {
        return NextResponse.json(
          { error: "This time range overlaps with an existing attendance record for this candidate on this date." },
          { status: 400 }
        );
      }
    }

    let clientId = timesheet.client_id;
    if (clientCompany) {
      const clientObj = await prisma.clients.findFirst({
        where: { name: clientCompany },
      });
      if (clientObj) {
        clientId = clientObj.id;
      }
    }

    // Update timesheet
    await prisma.timesheets.update({
      where: { id },
      data: {
        date: dateVal,
        clock_in: inTime,
        clock_out: outTime,
        hours: hours,
        notes: notes !== undefined ? notes : timesheet.notes,
        client_id: clientId,
      },
    });

    // Also update the attendance session
    if (timesheet.attendance_sessions.length > 0) {
      const firstSession = timesheet.attendance_sessions[0];
      await prisma.attendance_sessions.update({
        where: { id: firstSession.id },
        data: {
          clock_in: inTime,
          clock_out: outTime,
          hours: hours,
        },
      });
    }

    await recalculateTimesheetAggregates(id);

    // Feature #4: Log Audit History Entry
    await (prisma as any).timesheet_audit_logs.create({
      data: {
        id: crypto.randomUUID(),
        timesheet_id: id,
        user_id: timesheet.user_id,
        modified_by: user.id,
        action_type: "UPDATE",
        old_clock_in: timesheet.clock_in,
        old_clock_out: timesheet.clock_out,
        old_hours: timesheet.hours,
        new_clock_in: inTime,
        new_clock_out: outTime,
        new_hours: hours,
        reason: notes || "Admin timesheet override",
      },
    });

    // Feature #5: Dispatch Email Notification Alert
    const targetUser = await prisma.users.findUnique({
      where: { id: timesheet.user_id },
    });
    if (targetUser && targetUser.username.includes("@")) {
      const { sendEmail, generateTimesheetOverrideEmail } = await import("@/lib/email");
      const dateStr = dateVal.toISOString().split("T")[0];
      const emailHtml = generateTimesheetOverrideEmail(
        targetUser.name,
        dateStr,
        user.username || "Administrator",
        "Updated timesheet clock times / hours",
        notes || "Manual Admin Adjustment"
      );
      sendEmail({
        to: targetUser.username,
        subject: `Timesheet Update Alert (${dateStr})`,
        html: emailHtml,
      }).catch((e) => console.error("Async email error:", e));
    }

    return NextResponse.json({ message: "Timesheet record updated" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin/timesheets/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await checkAuth(req, ["ADMIN"]);
  if (response) return response;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;

    const existingTimesheet = await prisma.timesheets.findUnique({
      where: { id },
    });

    if (existingTimesheet) {
      // Feature #4: Log Audit Entry
      await (prisma as any).timesheet_audit_logs.create({
        data: {
          id: crypto.randomUUID(),
          timesheet_id: id,
          user_id: existingTimesheet.user_id,
          modified_by: user.id,
          action_type: "DELETE",
          old_clock_in: existingTimesheet.clock_in,
          old_clock_out: existingTimesheet.clock_out,
          old_hours: existingTimesheet.hours,
          reason: "Timesheet record removed by administrator",
        },
      });

      // Feature #5: Dispatch Email Notification Alert
      const targetUser = await prisma.users.findUnique({
        where: { id: existingTimesheet.user_id },
      });
      if (targetUser && targetUser.username.includes("@")) {
        const { sendEmail, generateTimesheetOverrideEmail } = await import("@/lib/email");
        const dateStr = existingTimesheet.date.toISOString().split("T")[0];
        const emailHtml = generateTimesheetOverrideEmail(
          targetUser.name,
          dateStr,
          user.username || "Administrator",
          "Deleted timesheet entry",
          "Timesheet entry was removed by administrator"
        );
        sendEmail({
          to: targetUser.username,
          subject: `Timesheet Record Removed (${dateStr})`,
          html: emailHtml,
        }).catch((e) => console.error("Async email error:", e));
      }
    }
    
    // Clean up associated attendance sessions first to prevent foreign key constraint violations
    await prisma.attendance_sessions.deleteMany({
      where: { timesheet_id: id },
    });

    await prisma.timesheets.delete({
      where: { id },
    });
    return NextResponse.json({ message: "Timesheet record deleted" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
