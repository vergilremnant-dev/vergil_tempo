import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth";
import { recalculateTimesheetAggregates, getCurrentISTTime } from "@/lib/attendance";
import { getCompanySettings } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const { user, response } = await checkAuth(req, ["EMPLOYEE", "ADMIN"]);
  if (response) return response;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const settings = await getCompanySettings();
    const body = await req.json();
    const { notes, browser, operatingSystem, deviceType, screenResolution, recoveryClockOut, recoveryClockOutDate } = body;

    const timesheet = await prisma.timesheets.findFirst({
      where: {
        user_id: user.id,
        clock_out: null,
      },
      orderBy: { date: "desc" },
      include: {
        attendance_sessions: {
          orderBy: { clock_in: "asc" },
        },
      },
    });

    if (!timesheet) {
      return NextResponse.json({ error: "No active shift found" }, { status: 404 });
    }

    // Use absolute current server time projected into Asia/Kolkata timezone
    const { eventDate, eventTime: serverClockOutTime, hour, minute, second } = getCurrentISTTime();

    const serverDateStr = eventDate.toISOString().split("T")[0];
    const timesheetDateStr = timesheet.date.toISOString().split("T")[0];

    const activeSession = timesheet.attendance_sessions.find((s) => s.clock_out === null);
    if (!activeSession) {
      return NextResponse.json({ error: "No active session found" }, { status: 404 });
    }

    // Check for Night Shift Crossover (shift started PM previous day, ends AM today within 14 hrs)
    let isNightShift = false;
    if (timesheetDateStr !== serverDateStr) {
      const startLdt = new Date(timesheet.date);
      startLdt.setUTCHours(
        activeSession.clock_in.getUTCHours(),
        activeSession.clock_in.getUTCMinutes(),
        activeSession.clock_in.getUTCSeconds(),
        0
      );
      const currentLdt = new Date(eventDate);
      currentLdt.setUTCHours(hour, minute, second, 0);

      const elapsedHours = (currentLdt.getTime() - startLdt.getTime()) / (1000 * 60 * 60);

      if (elapsedHours > 0 && elapsedHours <= 14) {
        isNightShift = true;
      } else if (!recoveryClockOut) {
        return NextResponse.json({
          error: "Your active shift is from a past date. Please use Attendance Recovery to clock out."
        }, { status: 400 });
      }
    }

    let clockOutTime = serverClockOutTime;
    let hourVal = hour;
    let minuteVal = minute;
    let secondVal = second;
    let finalNotes = notes || null;

    if (isNightShift) {
      const nightFlag = "[Type: NIGHT_SHIFT_CROSSOVER]";
      finalNotes = finalNotes ? `${finalNotes} ${nightFlag}` : nightFlag;
    }

    if (recoveryClockOut) {
      if (!settings.attendance_recovery_enabled) {
        return NextResponse.json({ error: "Attendance recovery is currently disabled" }, { status: 400 });
      }

      const isPastShift = timesheetDateStr < serverDateStr;

      // Enforce recovery start and deadline only for today's recovery
      if (!isPastShift) {
        // 1. Validate that current server time is after office end time + 2 hours (120 min)
        const [endHour, endMin] = settings.office_end_time.split(":").map(Number);
        const recoveryStartMin = endHour * 60 + endMin + 120;
        const currentMin = hour * 60 + minute;

        if (currentMin < recoveryStartMin) {
          const startH = Math.floor(recoveryStartMin / 60) % 24;
          const startM = recoveryStartMin % 60;
          const formattedStart = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
          return NextResponse.json({ error: `Attendance recovery is only available after ${formattedStart}` }, { status: 400 });
        }

        // Validate recovery deadline (e.g. 23:59)
        const [deadlineHour, deadlineMin] = settings.recovery_deadline.split(":").map(Number);
        const deadlineTotalMin = deadlineHour * 60 + deadlineMin;
        if (currentMin > deadlineTotalMin) {
          return NextResponse.json({ error: `Attendance recovery deadline (${settings.recovery_deadline}) has passed` }, { status: 400 });
        }
      }

      // 2. Validate that timesheet date is not in the future
      if (timesheetDateStr > serverDateStr) {
        return NextResponse.json({ error: "Cannot recover future attendance" }, { status: 400 });
      }

      // 3. Parse recoveryClockOut
      const parts = recoveryClockOut.split(":");
      hourVal = parseInt(parts[0]);
      minuteVal = parseInt(parts[1]);
      secondVal = parts[2] ? parseInt(parts[2]) : 0;

      if (isNaN(hourVal) || isNaN(minuteVal) || hourVal < 0 || hourVal > 23 || minuteVal < 0 || minuteVal > 59) {
        return NextResponse.json({ error: "Invalid recovery clock out time format" }, { status: 400 });
      }

      clockOutTime = new Date(Date.UTC(1970, 0, 1, hourVal, minuteVal, secondVal, 0));

      // 4. Validate that recovery time is not in the future relative to now
      const testEnd = new Date(timesheet.date);
      testEnd.setUTCHours(hourVal, minuteVal, secondVal, 0);
      if (testEnd.getTime() > Date.now()) {
        return NextResponse.json({ error: "Actual Clock Out Time cannot be in the future" }, { status: 400 });
      }

      // 5. Append audit notes
      const auditStr = `[Recovery Submitted At: ${new Date().toISOString()}]`;
      finalNotes = finalNotes ? `${finalNotes} ${auditStr}` : auditStr;
    }

    // Calculate working minutes and hours
    const startLdt = new Date(timesheet.date);
    startLdt.setUTCHours(
      activeSession.clock_in.getUTCHours(),
      activeSession.clock_in.getUTCMinutes(),
      activeSession.clock_in.getUTCSeconds(),
      0
    );

    const endLdt = new Date(recoveryClockOutDate || eventDate);
    endLdt.setUTCHours(hourVal, minuteVal, secondVal, 0);

    const minutes = Math.floor((endLdt.getTime() - startLdt.getTime()) / 60000);
    if (minutes < 0) {
      return NextResponse.json({ error: "Working hours cannot be negative" }, { status: 400 });
    }

    const decimalHours = Number((minutes / 60).toFixed(2));

    // Update active session
    await prisma.attendance_sessions.update({
      where: { id: activeSession.id },
      data: {
        clock_out: clockOutTime,
        hours: decimalHours,
      },
    });

    // Calculate total hours sum of all completed sessions
    const completedSessionsHours =
      timesheet.attendance_sessions
        .filter((s) => s.id !== activeSession.id && s.clock_out !== null)
        .reduce((sum, s) => sum + Number(s.hours || 0), 0) + decimalHours;

    const maxShiftLimit = (settings as any).max_shift_hours || 14;
    if (decimalHours > maxShiftLimit) {
      const maxShiftFlag = `[Flagged: Shift Duration (${decimalHours} hrs) Exceeded Max ${maxShiftLimit} hrs Cap]`;
      finalNotes = finalNotes ? `${finalNotes} ${maxShiftFlag}` : maxShiftFlag;
    }

    // Use Case 4: Early Departure Tagging
    if (settings.office_end_time && !recoveryClockOut) {
      const [endHour, endMin] = settings.office_end_time.split(":").map(Number);
      const graceMin = settings.clock_out_grace_period || 0;
      const endLimitMin = endHour * 60 + endMin - graceMin;
      const clockOutTotalMin = hourVal * 60 + minuteVal;

      if (clockOutTotalMin < endLimitMin) {
        const earlyMins = (endHour * 60 + endMin) - clockOutTotalMin;
        const earlyFlag = `[Status: EARLY_LEAVE (${earlyMins} mins early)]`;
        finalNotes = finalNotes ? `${finalNotes} ${earlyFlag}` : earlyFlag;
      }
    }

    let updatedNotes = timesheet.notes;
    if (finalNotes && finalNotes.trim() !== "") {
      if (!updatedNotes || updatedNotes.trim() === "") {
        updatedNotes = finalNotes.trim();
      } else {
        updatedNotes = updatedNotes + " | " + finalNotes.trim();
      }
    }

    await prisma.timesheets.update({
      where: { id: timesheet.id },
      data: {
        clock_out: clockOutTime,
        hours: completedSessionsHours,
        notes: updatedNotes,
        browser: browser || undefined,
        operating_system: operatingSystem || undefined,
        device_type: deviceType || undefined,
        screen_resolution: screenResolution || undefined,
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1",
        user_agent: req.headers.get("user-agent") || undefined,
      },
    });

    await recalculateTimesheetAggregates(timesheet.id);

    const savedTimesheet = await prisma.timesheets.findUnique({
      where: { id: timesheet.id },
    });

    if (!savedTimesheet) {
      throw new Error("Failed to load saved timesheet");
    }

    const formatTime = (d: Date | null) => (d ? d.toISOString().split("T")[1].slice(0, 8) : null);

    return NextResponse.json({
      message: "Clocked out successfully",
      log: {
        id: savedTimesheet.id,
        clockOut: formatTime(savedTimesheet.clock_out),
        hours: savedTimesheet.hours ? Number(savedTimesheet.hours) : null,
        notes: savedTimesheet.notes,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
