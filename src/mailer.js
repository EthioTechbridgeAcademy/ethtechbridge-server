import nodemailer from "nodemailer";
import "dotenv/config";

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendEmail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) return { status: "skipped", error: "SMTP is not configured" };
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, text, html
    });
    return { status: "sent", error: null };
  } catch (error) {
    console.error("Email send failed:", error.message);
    return { status: "failed", error: error.message };
  }
}
