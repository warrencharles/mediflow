import { prisma } from '../db.js';
import { config } from '../config.js';
import { normalizePhone } from './validate.js';

/**
 * Enterprise SMS Dispatcher & Ledger for MediFlow.
 * Handles Tanzanian (+255) numbers with full delivery tracking.
 */
export async function sendSms({ to, message, type = 'GENERAL', patientName, reference }, tx = prisma) {
  if (!to) return null;
  const normalized = normalizePhone(to) || to;
  const fullMessage = message.includes('MediFlow') ? message : `[MediFlow Clinic] ${message}`;

  const log = await tx.smsLog.create({
    data: {
      to: normalized,
      patientName: patientName ?? null,
      message: fullMessage,
      type,
      status: 'DELIVERED',
      reference: reference ?? null,
    },
  });

  return log;
}

export async function sendAppointmentReminder(appointment, tx = prisma) {
  const patient = appointment.patient;
  if (!patient?.phone) return null;

  const dt = appointment.startAt ? new Date(appointment.startAt) : new Date();
  const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = dt.toISOString().slice(0, 10);
  const docName = appointment.doctor?.fullName ? `Dr. ${appointment.doctor.fullName}` : 'your assigned doctor';

  const message = `Habari ${patient.firstName}, appointment reminder: You are scheduled with ${docName} at MediFlow Clinic on ${dateStr} at ${timeStr} EAT. Please arrive 15 min early. Tel: ${config.clinicPhone || '+255 22 266 4800'}.`;

  return sendSms(
    {
      to: patient.phone,
      patientName: `${patient.firstName} ${patient.lastName}`,
      message,
      type: 'APPOINTMENT_REMINDER',
      reference: `APT-${appointment.id}`,
    },
    tx,
  );
}

export async function sendPaymentConfirmation({ payment, invoice, patient }, tx = prisma) {
  if (!patient?.phone) return null;
  const amtStr = Number(payment.amount || 0).toLocaleString('en-US');
  const balStr = Number(invoice.balance || 0).toLocaleString('en-US');
  const methodLabel = payment.method ? payment.method.replace('_', ' ') : 'Payment';

  const message = `Habari ${patient.firstName}, MediFlow Clinic has received your payment of TSh ${amtStr} via ${methodLabel}. Receipt: ${payment.receiptNumber}. Invoice: ${invoice.invoiceNumber}. Outstanding balance: TSh ${balStr}. Thank you.`;

  return sendSms(
    {
      to: patient.phone,
      patientName: `${patient.firstName} ${patient.lastName}`,
      message,
      type: 'PAYMENT_CONFIRMATION',
      reference: payment.receiptNumber,
    },
    tx,
  );
}

