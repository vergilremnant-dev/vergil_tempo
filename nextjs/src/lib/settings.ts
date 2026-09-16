import { prisma } from "./prisma";

export const DEFAULT_SETTINGS = {
  id: "active",
  office_start_time: "09:30",
  office_end_time: "18:30",
  clock_in_grace_period: 30,
  clock_out_grace_period: 0,
  clock_in_reminder_offset: 5,
  clock_out_reminder_offset: 10,
  attendance_recovery_enabled: true,
  recovery_deadline: "23:59",
  weekend_configuration: "Saturday,Sunday",
  timezone: "Asia/Kolkata",
  max_shift_hours: 14,
};

export async function getCompanySettings() {
  try {
    let settings = await prisma.company_settings.findUnique({
      where: { id: "active" },
    });
    if (!settings) {
      settings = await prisma.company_settings.create({
        data: DEFAULT_SETTINGS,
      });
    }
    return settings;
  } catch (err) {
    console.error("Error fetching company settings from database, using defaults:", err);
    return { ...DEFAULT_SETTINGS, updated_at: new Date() };
  }
}
