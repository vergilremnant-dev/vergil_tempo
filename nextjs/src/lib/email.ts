import nodemailer from "nodemailer";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || '"Vergil Tempo" <no-reply@vergiltempo.com>';

  // If SMTP is configured, send via nodemailer transporter
  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to,
        subject,
        html,
      });

      console.log(`[Email Delivered] To: ${to} | Subject: "${subject}"`);
      return true;
    } catch (error) {
      console.error("[Email Delivery Error]", error);
      return false;
    }
  }

  // Console Fallback when SMTP is not configured in local environment
  console.log("==========================================");
  console.log(`[Email Dispatch Simulation]`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Content:\n${html.replace(/<[^>]*>?/gm, "")}`);
  console.log("==========================================");
  return true;
}

export function generateTimesheetOverrideEmail(
  employeeName: string,
  dateStr: string,
  adminName: string,
  action: string,
  reason?: string
) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #111; color: #fff; border-radius: 8px;">
      <h2 style="color: #FF7A00; margin-bottom: 10px;">Vergil Tempo - Timesheet Audit Alert</h2>
      <p>Hello <strong>${employeeName}</strong>,</p>
      <p>Your timesheet record for <strong>${dateStr}</strong> has been updated by administrator <strong>${adminName}</strong>.</p>
      <div style="background: #222; padding: 15px; border-left: 4px solid #FF7A00; margin: 20px 0;">
        <p style="margin: 0 0 5px 0;"><strong>Action:</strong> ${action}</p>
        ${reason ? `<p style="margin: 0;"><strong>Reason/Notes:</strong> ${reason}</p>` : ""}
      </div>
      <p style="font-size: 12px; color: #aaa;">If you have any questions regarding this adjustment, please contact your administrative manager.</p>
    </div>
  `;
}

export function generateLeaveStatusEmail(
  employeeName: string,
  leaveType: string,
  startDateStr: string,
  endDateStr: string,
  status: "APPROVED" | "REJECTED",
  reason?: string
) {
  const statusColor = status === "APPROVED" ? "#10B981" : "#EF4444";
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #111; color: #fff; border-radius: 8px;">
      <h2 style="color: #FF7A00; margin-bottom: 10px;">Vergil Tempo - Leave Request Update</h2>
      <p>Hello <strong>${employeeName}</strong>,</p>
      <p>Your leave request for <strong>${leaveType}</strong> (${startDateStr} to ${endDateStr}) has been updated.</p>
      <div style="background: #222; padding: 15px; border-left: 4px solid ${statusColor}; margin: 20px 0;">
        <p style="margin: 0 0 5px 0;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${status}</span></p>
        ${reason ? `<p style="margin: 0;"><strong>Notes:</strong> ${reason}</p>` : ""}
      </div>
      <p style="font-size: 12px; color: #aaa;">Please log in to your Vergil Tempo portal to review your leave calendar.</p>
    </div>
  `;
}
