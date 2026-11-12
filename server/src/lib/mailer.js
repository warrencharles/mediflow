import nodemailer from 'nodemailer';
import { config } from '../config.js';

/** In tests, sent mail is captured here instead of being delivered. */
export const outbox = [];

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    outbox.push({ to, subject, text });
    return;
  }
  if (!transporter) {
    // No SMTP configured: print to server log so an administrator can relay it.
    console.log(`[mail] (SMTP not configured) To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text });
}

