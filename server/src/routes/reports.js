import { Router } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ah, badRequest } from '../lib/errors.js';
import { localDateStr, localRange, isDateStr, localDayStart, addDays } from '../lib/time.js';
import { sendReport } from '../lib/export.js';
import { requirePerm } from '../middleware/auth.js';
import { stockMap } from './pharmacy.js';

const r = Router();

const METHODS = ['CASH', 'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'BANK_TRANSFER'];
const METHOD_LABEL = { CASH: 'Cash', MPESA: 'M-Pesa', TIGO_PESA: 'Tigo Pesa', AIRTEL_MONEY: 'Airtel Money', BANK_TRANSFER: 'Bank transfer' };
const fmtDT = (d) => new Date(d.getTime() + config.tzOffsetMinutes * 60000).toISOString().replace('T', ' ').slice(0, 16);

function period(q) {
  const today = localDateStr();
  const from = isDateStr(q.from) ? q.from : today;
  const to = isDateStr(q.to) ? q.to : from;
  if (to < from) throw badRequest('"To" date must be on or after "From" date');
  const { start, end } = localRange(from, to);
  return { from, to, start, end, label: from === to ? `Date: ${from}` : `Period: ${from} to ${to}` };
}
const fmt = (q) => (q.format === 'pdf' || q.format === 'xlsx' ? q.format : 'json');

// ── Financial ──

/** Revenue = payments actually received (VALID), grouped by day/week/month and method. */
r.get(
  '/revenue',
  requirePerm('reports.financial'),
  ah(async (req, res) => {
    const p = period(req.query);
    const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';
    const off = config.tzOffsetMinutes;
    const rows = await prisma.$queryRaw`
      SELECT to_char(date_trunc(${groupBy}, "paidAt" + make_interval(mins => ${off}::int)), 'YYYY-MM-DD') AS period,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount) FILTER (WHERE method = 'CASH'), 0)::int AS "CASH",
             COALESCE(SUM(amount) FILTER (WHERE method = 'MPESA'), 0)::int AS "MPESA",
             COALESCE(SUM(amount) FILTER (WHERE method = 'TIGO_PESA'), 0)::int AS "TIGO_PESA",
             COALESCE(SUM(amount) FILTER (WHERE method = 'AIRTEL_MONEY'), 0)::int AS "AIRTEL_MONEY",
             COALESCE(SUM(amount) FILTER (WHERE method = 'BANK_TRANSFER'), 0)::int AS "BANK_TRANSFER",
             COALESCE(SUM(amount), 0)::int AS total
      FROM "Payment"
      WHERE status = 'VALID' AND "paidAt" >= ${p.start} AND "paidAt" < ${p.end}
      GROUP BY 1 ORDER BY 1`;
    const total = rows.reduce((s, x) => s + x.total, 0);
    const invoiced = await prisma.invoice.aggregate({
      where: { status: { not: 'CANCELLED' }, createdAt: { gte: p.start, lt: p.end } },
      _sum: { total: true },
      _count: true,
    });
    const label = { day: 'Daily', week: 'Weekly', month: 'Monthly' }[groupBy];
    await sendReport(res, fmt(req.query), {
      title: `${label} Revenue Report`,
      subtitle: `${p.label} · Based on payments received (voided payments excluded)`,
      columns: [
        { key: 'period', label: groupBy === 'week' ? 'Week starting' : groupBy === 'month' ? 'Month' : 'Date', width: 90 },
        { key: 'count', label: 'Payments', type: 'number', width: 60 },
        ...METHODS.map((m) => ({ key: m, label: METHOD_LABEL[m], type: 'money', width: 85 })),
        { key: 'total', label: 'Total', type: 'money', width: 95 },
      ],
      rows: rows.map((x) => (groupBy === 'month' ? { ...x, period: x.period.slice(0, 7) } : x)),
      summary: [
        { label: 'Total revenue received', value: total, money: true },
        ...METHODS.map((m) => ({ label: METHOD_LABEL[m], value: rows.reduce((s, x) => s + x[m], 0), money: true })),
        { label: 'Invoiced in period (not cash received)', value: invoiced._sum.total || 0, money: true },
        { label: 'Invoices raised', value: invoiced._count },
      ],
      totals: { total, invoiced: invoiced._sum.total || 0 },
      filters: { from: p.from, to: p.to, groupBy },
    });
  }),
);

/** Itemised payment transactions – reconciles exactly with the revenue total. */
r.get(
  '/payments',
  requirePerm('reports.financial'),
  ah(async (req, res) => {
    const p = period(req.query);
    const payments = await prisma.payment.findMany({
      where: { paidAt: { gte: p.start, lt: p.end }, ...(req.query.includeVoided === 'true' ? {} : { status: 'VALID' }) },
      orderBy: { paidAt: 'asc' },
      include: { patient: { select: { patientNumber: true, firstName: true, lastName: true } }, invoice: { select: { invoiceNumber: true } }, receivedBy: { select: { fullName: true } } },
    });
    const valid = payments.filter((x) => x.status === 'VALID');
    await sendReport(res, fmt(req.query), {
      title: 'Payment Transactions Report',
      subtitle: p.label,
      columns: [
        { key: 'paidAt', label: 'Date/time', width: 85 },
        { key: 'receiptNumber', label: 'Receipt', width: 95 },
        { key: 'invoiceNumber', label: 'Invoice', width: 95 },
        { key: 'patient', label: 'Patient', width: 120 },
        { key: 'method', label: 'Method', width: 70 },
        { key: 'reference', label: 'Reference', width: 80 },
        { key: 'receivedBy', label: 'Received by', width: 90 },
        { key: 'status', label: 'Status', width: 50 },
        { key: 'amount', label: 'Amount', type: 'money', width: 80 },
      ],
      rows: payments.map((x) => ({
        id: x.id,
        paidAt: fmtDT(x.paidAt),
        receiptNumber: x.receiptNumber,
        invoiceNumber: x.invoice.invoiceNumber,
        patient: `${x.patient.firstName} ${x.patient.lastName} (${x.patient.patientNumber})`,
        method: METHOD_LABEL[x.method],
        reference: x.reference || '',
        receivedBy: x.receivedBy.fullName,
        status: x.status,
        amount: x.amount,
      })),
      summary: [
        { label: 'Valid transactions', value: valid.length },
        { label: 'Total received', value: valid.reduce((s, x) => s + x.amount, 0), money: true },
      ],
      totals: { total: valid.reduce((s, x) => s + x.amount, 0), count: valid.length },
    });
  }),
);

r.get(
  '/outstanding',
  requirePerm('reports.financial'),
  ah(async (req, res) => {
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, balance: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
      include: { patient: { select: { patientNumber: true, firstName: true, lastName: true, phone: true } } },
    });
    const now = Date.now();
    const rows = invoices.map((i) => {
      const days = Math.floor((now - i.createdAt.getTime()) / 86400000);
      return {
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        date: fmtDT(i.createdAt).slice(0, 10),
        patient: `${i.patient.firstName} ${i.patient.lastName} (${i.patient.patientNumber})`,
        phone: i.patient.phone,
        status: i.status,
        total: i.total,
        paid: i.amountPaid,
        balance: i.balance,
        age: days <= 7 ? '0-7 days' : days <= 30 ? '8-30 days' : days <= 90 ? '31-90 days' : '90+ days',
      };
    });
    const sum = rows.reduce((s, x) => s + x.balance, 0);
    await sendReport(res, fmt(req.query), {
      title: 'Outstanding Payments Report',
      subtitle: `As at ${localDateStr()}`,
      columns: [
        { key: 'invoiceNumber', label: 'Invoice', width: 95 },
        { key: 'date', label: 'Date', width: 65 },
        { key: 'patient', label: 'Patient', width: 140 },
        { key: 'phone', label: 'Phone', width: 80 },
        { key: 'age', label: 'Age', width: 60 },
        { key: 'total', label: 'Total', type: 'money', width: 80 },
        { key: 'paid', label: 'Paid', type: 'money', width: 80 },
        { key: 'balance', label: 'Balance', type: 'money', width: 80 },
      ],
      rows,
      summary: [
        { label: 'Invoices with balance', value: rows.length },
        { label: 'Total outstanding', value: sum, money: true },
      ],
      totals: { balance: sum, count: rows.length },
    });
  }),
);

r.get(
  '/medicine-sales',
  requirePerm('reports.financial'),
  ah(async (req, res) => {
    const p = period(req.query);
    const rows = await prisma.$queryRaw`
      SELECT m.name, m.unit, m.category,
             SUM(di.quantity)::int AS quantity,
             SUM(di."lineTotal")::int AS revenue,
             SUM(di.quantity * b."purchasePrice")::int AS cost
      FROM "DispensationItem" di
      JOIN "Dispensation" d ON d.id = di."dispensationId"
      JOIN "Medicine" m ON m.id = di."medicineId"
      JOIN "MedicineBatch" b ON b.id = di."batchId"
      WHERE d."createdAt" >= ${p.start} AND d."createdAt" < ${p.end}
      GROUP BY m.id ORDER BY revenue DESC`;
    const out = rows.map((x) => ({ ...x, margin: x.revenue - x.cost }));
    await sendReport(res, fmt(req.query), {
      title: 'Medicine Sales Report',
      subtitle: `${p.label} · Value of medicine dispensed (charged at selling price)`,
      columns: [
        { key: 'name', label: 'Medicine', width: 140 },
        { key: 'category', label: 'Category', width: 90 },
        { key: 'quantity', label: 'Qty dispensed', type: 'number', width: 70 },
        { key: 'unit', label: 'Unit', width: 50 },
        { key: 'revenue', label: 'Sales value', type: 'money', width: 85 },
        { key: 'cost', label: 'Cost', type: 'money', width: 85 },
        { key: 'margin', label: 'Gross margin', type: 'money', width: 85 },
      ],
      rows: out,
      summary: [
        { label: 'Total sales value', value: out.reduce((s, x) => s + x.revenue, 0), money: true },
        { label: 'Total cost', value: out.reduce((s, x) => s + x.cost, 0), money: true },
      ],
    });
  }),
);

// ── Clinical / management ──

r.get(
  '/patients',
  requirePerm('reports.clinical'),
  ah(async (req, res) => {
    const p = period(req.query);
    const patients = await prisma.patient.findMany({
      where: { createdAt: { gte: p.start, lt: p.end } },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { fullName: true } } },
    });
    const rows = patients.map((x) => ({
      id: x.id,
      registered: fmtDT(x.createdAt),
      patientNumber: x.patientNumber,
      name: `${x.firstName} ${x.middleName ? `${x.middleName} ` : ''}${x.lastName}`,
      gender: x.gender,
      age: Math.floor((Date.now() - x.dateOfBirth.getTime()) / (365.25 * 86400000)),
      phone: x.phone,
      region: x.region || '',
      registeredBy: x.createdBy?.fullName || '',
    }));
    const count = (g) => rows.filter((x) => x.gender === g).length;
    await sendReport(res, fmt(req.query), {
      title: 'Patient Registration Report',
      subtitle: p.label,
      columns: [
        { key: 'registered', label: 'Registered', width: 85 },
        { key: 'patientNumber', label: 'Patient ID', width: 75 },
        { key: 'name', label: 'Name', width: 140 },
        { key: 'gender', label: 'Gender', width: 55 },
        { key: 'age', label: 'Age', type: 'number', width: 40 },
        { key: 'phone', label: 'Phone', width: 85 },
        { key: 'region', label: 'Region', width: 70 },
        { key: 'registeredBy', label: 'Registered by', width: 90 },
      ],
      rows,
      summary: [
        { label: 'New registrations', value: rows.length },
        { label: 'Male', value: count('MALE') },
        { label: 'Female', value: count('FEMALE') },
        { label: 'Total registered patients (all time)', value: await prisma.patient.count() },
      ],
    });
  }),
);

r.get(
  '/doctor-performance',
  requirePerm('reports.clinical'),
  ah(async (req, res) => {
    const p = period(req.query);
    const rows = await prisma.$queryRaw`
      SELECT u.id, u."fullName" AS doctor,
        (SELECT COUNT(*)::int FROM "Consultation" c WHERE c."doctorId" = u.id AND c."startedAt" >= ${p.start} AND c."startedAt" < ${p.end}) AS consultations,
        (SELECT COUNT(*)::int FROM "Consultation" c WHERE c."doctorId" = u.id AND c.status = 'COMPLETED' AND c."startedAt" >= ${p.start} AND c."startedAt" < ${p.end}) AS completed,
        (SELECT COUNT(DISTINCT c."patientId")::int FROM "Consultation" c WHERE c."doctorId" = u.id AND c."startedAt" >= ${p.start} AND c."startedAt" < ${p.end}) AS patients,
        (SELECT COUNT(*)::int FROM "Prescription" x WHERE x."doctorId" = u.id AND x.status <> 'CANCELLED' AND x."createdAt" >= ${p.start} AND x."createdAt" < ${p.end}) AS prescriptions,
        (SELECT COUNT(*)::int FROM "LabRequest" l WHERE l."doctorId" = u.id AND l.status <> 'CANCELLED' AND l."createdAt" >= ${p.start} AND l."createdAt" < ${p.end}) AS "labRequests",
        (SELECT COUNT(*)::int FROM "Appointment" a WHERE a."doctorId" = u.id AND a."startAt" >= ${p.start} AND a."startAt" < ${p.end}) AS appointments,
        (SELECT COUNT(*)::int FROM "Appointment" a WHERE a."doctorId" = u.id AND a.status = 'NO_SHOW' AND a."startAt" >= ${p.start} AND a."startAt" < ${p.end}) AS "noShows",
        (SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (c."completedAt" - c."startedAt")) / 60)), 0)::int FROM "Consultation" c WHERE c."doctorId" = u.id AND c.status = 'COMPLETED' AND c."startedAt" >= ${p.start} AND c."startedAt" < ${p.end}) AS "avgMinutes"
      FROM "User" u WHERE u.role = 'DOCTOR' ORDER BY consultations DESC, u."fullName"`;
    await sendReport(res, fmt(req.query), {
      title: 'Doctor Performance Report',
      subtitle: p.label,
      columns: [
        { key: 'doctor', label: 'Doctor', width: 130 },
        { key: 'consultations', label: 'Consultations', type: 'number', width: 70 },
        { key: 'completed', label: 'Completed', type: 'number', width: 60 },
        { key: 'patients', label: 'Unique patients', type: 'number', width: 70 },
        { key: 'prescriptions', label: 'Prescriptions', type: 'number', width: 70 },
        { key: 'labRequests', label: 'Lab requests', type: 'number', width: 65 },
        { key: 'appointments', label: 'Appointments', type: 'number', width: 70 },
        { key: 'noShows', label: 'No-shows', type: 'number', width: 55 },
        { key: 'avgMinutes', label: 'Avg consult (min)', type: 'number', width: 70 },
      ],
      rows,
      summary: [{ label: 'Total consultations', value: rows.reduce((s, x) => s + x.consultations, 0) }],
    });
  }),
);

// ── Inventory ──

r.get(
  '/inventory',
  requirePerm('reports.inventory'),
  ah(async (req, res) => {
    const meds = await prisma.medicine.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    const sm = await stockMap();
    const today = localDayStart(localDateStr());
    const batches = await prisma.medicineBatch.findMany({ where: { quantityRemaining: { gt: 0 }, expiryDate: { gte: today } } });
    const value = new Map();
    for (const b of batches) value.set(b.medicineId, (value.get(b.medicineId) || 0) + b.quantityRemaining * b.purchasePrice);
    const soon = localDayStart(addDays(localDateStr(), 90));
    const rows = meds.map((m) => {
      const s = sm.get(m.id) || { available: 0, nextExpiry: null, expiredQty: 0 };
      const flags = [];
      if (s.available <= m.reorderLevel) flags.push('LOW');
      if (s.expiredQty) flags.push('EXPIRED STOCK');
      if (s.nextExpiry && s.nextExpiry < soon) flags.push('EXPIRING');
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        unit: m.unit,
        stock: s.available,
        reorderLevel: m.reorderLevel,
        expiredQty: s.expiredQty,
        nextExpiry: s.nextExpiry ? s.nextExpiry.toISOString().slice(0, 10) : '',
        sellingPrice: m.sellingPrice,
        stockValue: value.get(m.id) || 0,
        flags: flags.join(', '),
      };
    });
    await sendReport(res, fmt(req.query), {
      title: 'Inventory Report',
      subtitle: `Stock on hand as at ${localDateStr()} (expired stock excluded from available quantity)`,
      columns: [
        { key: 'name', label: 'Medicine', width: 130 },
        { key: 'category', label: 'Category', width: 80 },
        { key: 'stock', label: 'Available', type: 'number', width: 60 },
        { key: 'unit', label: 'Unit', width: 45 },
        { key: 'reorderLevel', label: 'Reorder lvl', type: 'number', width: 55 },
        { key: 'expiredQty', label: 'Expired qty', type: 'number', width: 55 },
        { key: 'nextExpiry', label: 'Next expiry', width: 65 },
        { key: 'stockValue', label: 'Stock value (cost)', type: 'money', width: 85 },
        { key: 'flags', label: 'Alerts', width: 95 },
      ],
      rows,
      summary: [
        { label: 'Medicines', value: rows.length },
        { label: 'Low stock items', value: rows.filter((x) => x.flags.includes('LOW')).length },
        { label: 'Total stock value (cost)', value: rows.reduce((s, x) => s + x.stockValue, 0), money: true },
      ],
    });
  }),
);

r.get(
  '/stock-movements',
  requirePerm('reports.inventory'),
  ah(async (req, res) => {
    const p = period(req.query);
    const mv = await prisma.stockMovement.findMany({
      where: { createdAt: { gte: p.start, lt: p.end } },
      orderBy: { createdAt: 'asc' },
      include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true } }, user: { select: { fullName: true } } },
    });
    await sendReport(res, fmt(req.query), {
      title: 'Stock Movement Report',
      subtitle: p.label,
      columns: [
        { key: 'date', label: 'Date/time', width: 85 },
        { key: 'medicine', label: 'Medicine', width: 130 },
        { key: 'batch', label: 'Batch', width: 70 },
        { key: 'type', label: 'Type', width: 90 },
        { key: 'quantity', label: 'Qty', type: 'number', width: 50 },
        { key: 'reason', label: 'Reason / ref', width: 120 },
        { key: 'user', label: 'By', width: 90 },
      ],
      rows: mv.map((m) => ({
        id: m.id,
        date: fmtDT(m.createdAt),
        medicine: m.medicine.name,
        batch: m.batch?.batchNumber || '',
        type: m.type,
        quantity: m.quantity,
        reason: [m.reason, m.reference].filter(Boolean).join(' · '),
        user: m.user?.fullName || '',
      })),
    });
  }),
);

export default r;

