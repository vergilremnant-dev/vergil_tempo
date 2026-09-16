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
    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      timeZone: settings.timezone,
      weekday: "long",
    }).format(new Date());

    const weekendDays = settings.weekend_configuration.split(",").map((d) => d.trim());
    if (weekendDays.includes(dayOfWeek)) {
      return NextResponse.json(
        { error: `Today is a weekend (${dayOfWeek}). Clock-in is disabled.` },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { browser, operatingSystem, deviceType, screenResolution } = body;

    // Use absolute current server time projected into Asia/Kolkata timezone
    const { eventDate, eventTime: eventClockIn } = getCurrentISTTime();

    // Reject clock-in on company holidays
    const holiday = await prisma.holidays.findFirst({
      where: {
        holiday_date: eventDate,
        is_active: true,
      },
    });
    if (holiday) {
      return NextResponse.json(
        { error: "Today is a company holiday. Clock-in is disabled." },
        { status: 403 }
      );
    }

    // Check if user is on approved leave today
    const leave = await prisma.leaves.findFirst({
      where: {
        user_id: user.id,
        start_date: { lte: eventDate },
        end_date: { gte: eventDate },
      },
    });

    let halfDayShiftTag: string | undefined = undefined;
    if (leave) {
      const typeLower = leave.leave_type.toLowerCase();
      const isHalfDayMorning = typeLower.includes("morning") || typeLower.includes("half_day_morning");
      const isHalfDayAfternoon = typeLower.includes("afternoon") || typeLower.includes("half_day_afternoon");
      const clockInHour = eventClockIn.getUTCHours();

      if (isHalfDayMorning) {
        if (clockInHour < 12) {
          return NextResponse.json(
            { error: "Today you are on approved Half-Day Morning leave. Morning clock-in is disabled." },
            { status: 403 }
          );
        }
        halfDayShiftTag = "[Shift: Half-Day Afternoon]";
      } else if (isHalfDayAfternoon) {
        if (clockInHour >= 13) {
          return NextResponse.json(
            { error: "Today you are on approved Half-Day Afternoon leave. Afternoon clock-in is disabled." },
            { status: 403 }
          );
        }
        halfDayShiftTag = "[Shift: Half-Day Morning]";
      } else {
        return NextResponse.json(
          { error: `Today you are on approved leave (${leave.leave_type}). Clock-in is disabled.` },
          { status: 403 }
        );
      }
    }

    const dbUser = await prisma.users.findUnique({
      where: { id: user.id },
    });
    if (!dbUser || !dbUser.client_id) {
      return NextResponse.json(
        { error: "User is not assigned to any client company" },
        { status: 403 }
      );
    }

    // Check if there is an active timesheet
    const activeTimesheet = await prisma.timesheets.findFirst({
      where: {
        user_id: user.id,
        clock_out: null,
      },
      orderBy: { date: "desc" },
      include: {
        attendance_sessions: { orderBy: { clock_in: "asc" } },
      },
    });
    if (activeTimesheet) {
      const activeSession = activeTimesheet.attendance_sessions.find((s) => s.clock_out === null);
      if (activeSession) {
        const { hour, minute, second } = getCurrentISTTime();
        const startLdt = new Date(activeTimesheet.date);
        startLdt.setUTCHours(
          activeSession.clock_in.getUTCHours(),
          activeSession.clock_in.getUTCMinutes(),
          activeSession.clock_in.getUTCSeconds(),
          0
        );
        const currentLdt = new Date(eventDate);
        currentLdt.setUTCHours(hour, minute, second, 0);

        const elapsedHours = (currentLdt.getTime() - startLdt.getTime()) / (1000 * 60 * 60);
        const maxHours = (settings as any).max_shift_hours || 14;

        if (elapsedHours > maxHours) {
          const shiftDateStr = activeTimesheet.date.toISOString().split("T")[0];
          return NextResponse.json(
            {
              error: `Your shift from ${shiftDateStr} exceeded the maximum limit of ${maxHours} hours. Please use Attendance Recovery to clock out first.`,
            },
            { status: 400 }
          );
        }
      }
      return NextResponse.json({ error: "Active shift already exists" }, { status: 400 });
    }

    // Check if a timesheet for today already exists
    const existingTimesheet = await prisma.timesheets.findFirst({
      where: {
        user_id: user.id,
        date: eventDate,
      },
      include: {
        attendance_sessions: true,
      },
    });

    let timesheetId = "";
    if (existingTimesheet) {
      timesheetId = existingTimesheet.id;

      const hasActiveSession = existingTimesheet.attendance_sessions.some(
        (s) => s.clock_out === null
      );
      if (hasActiveSession) {
        return NextResponse.json({ error: "Active shift already exists" }, { status: 400 });
      }

      // Validate 2-minute cooldown buffer after recent clock-out
      const completedSessions = existingTimesheet.attendance_sessions.filter(
        (s) => s.clock_out !== null
      );
      if (completedSessions.length > 0) {
        const lastClockOutMs = Math.max(
          ...completedSessions.map((s) => s.clock_out!.getTime())
        );
        const cooldownBufferMs = 2 * 60 * 1000; // 2 minutes
        if (eventClockIn.getTime() - lastClockOutMs < cooldownBufferMs) {
          return NextResponse.json(
            { error: "Please wait at least 2 minutes after clocking out before starting a new session." },
            { status: 400 }
          );
        }
      }

      // Validate overlapping sessions
      const overlaps = existingTimesheet.attendance_sessions.some((s) => {
        if (s.clock_out === null) return false;
        return eventClockIn >= s.clock_in && eventClockIn <= s.clock_out;
      });
      if (overlaps) {
        return NextResponse.json(
          { error: "Clock in time overlaps with an existing session" },
          { status: 400 }
        );
      }

      // Reactivate parent timesheet
      await prisma.timesheets.update({
        where: { id: timesheetId },
        data: {
          clock_out: null,
          browser: browser || undefined,
          operating_system: operatingSystem || undefined,
          device_type: deviceType || undefined,
          screen_resolution: screenResolution || undefined,
          ip_address: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1",
          user_agent: req.headers.get("user-agent") || undefined,
        },
      });
    } else {
      timesheetId = crypto.randomUUID();

      // Calculate Punctuality for first clock-in of the day
      let initialNotes: string | undefined = undefined;
      if (settings.office_start_time) {
        const [startHour, startMin] = settings.office_start_time.split(":").map(Number);
        const graceMin = settings.clock_in_grace_period || 0;
        const startLimitMin = startHour * 60 + startMin + graceMin;

        const clockInHour = eventClockIn.getUTCHours();
        const clockInMin = eventClockIn.getUTCMinutes();
        const clockInTotalMin = clockInHour * 60 + clockInMin;

        if (clockInTotalMin > startLimitMin) {
          const lateMins = clockInTotalMin - (startHour * 60 + startMin);
          initialNotes = `[Status: LATE (${lateMins} mins late)]`;
        }
      }

      if (halfDayShiftTag) {
        initialNotes = initialNotes ? `${initialNotes} ${halfDayShiftTag}` : halfDayShiftTag;
      }

      await prisma.timesheets.create({
        data: {
          id: timesheetId,
          user_id: user.id,
          client_id: dbUser.client_id,
          date: eventDate,
          clock_in: eventClockIn,
          clock_out: null,
          notes: initialNotes,
          browser: browser || undefined,
          operating_system: operatingSystem || undefined,
          device_type: deviceType || undefined,
          screen_resolution: screenResolution || undefined,
          ip_address: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1",
          user_agent: req.headers.get("user-agent") || undefined,
        },
      });
    }

    // Create new attendance session
    const sessionId = crypto.randomUUID();
    await prisma.attendance_sessions.create({
      data: {
        id: sessionId,
        timesheet_id: timesheetId,
        clock_in: eventClockIn,
        clock_out: null,
      },
    });

    await recalculateTimesheetAggregates(timesheetId);

    const savedTimesheet = await prisma.timesheets.findUnique({
      where: { id: timesheetId },
      include: {
        users: { include: { clients: true } },
        clients: true,
        attendance_sessions: true,
      },
    });

    if (!savedTimesheet) {
      throw new Error("Failed to save timesheet");
    }

    const formatTime = (d: Date | null) => (d ? d.toISOString().split("T")[1].slice(0, 8) : null);

    const logDto = {
      id: savedTimesheet.id,
      userId: savedTimesheet.user_id,
      date: savedTimesheet.date.toISOString().split("T")[0],
      clockIn: formatTime(savedTimesheet.clock_in),
      clockOut: formatTime(savedTimesheet.clock_out),
      hours: savedTimesheet.hours ? Number(savedTimesheet.hours) : null,
      notes: savedTimesheet.notes,
      clientCompany: savedTimesheet.clients.name,
      status: "ACTIVE",
      browser: savedTimesheet.browser,
      operatingSystem: savedTimesheet.operating_system,
      deviceType: savedTimesheet.device_type,
      screenResolution: savedTimesheet.screen_resolution,
      ipAddress: savedTimesheet.ip_address,
      userAgent: savedTimesheet.user_agent,
      sessions: savedTimesheet.attendance_sessions.map((s) => ({
        id: s.id,
        clockIn: formatTime(s.clock_in),
        clockOut: formatTime(s.clock_out),
        hours: s.hours ? Number(s.hours) : null,
      })),
    };

    return NextResponse.json(
      {
        message: "Clocked in successfully",
        log: logDto,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
