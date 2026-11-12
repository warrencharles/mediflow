import { Router } from 'express';
import { prisma } from '../db.js';
import { ah } from '../lib/errors.js';
import { localDateStr, localRange, localDayStart, addDays } from '../lib/time.js';
import { hasPerm } from '../middleware/auth.js';
import { stockMap } from './pharmacy.js';

const r = Router();

/**
 * Role-aware dashboard: each block is included only if the user's role may
 * see it. All figures are computed from recorded transactions.
 */
r.get(
  '/',
  ah(async (req, res) => {
    const today = localDateStr();
    const { start, end } = localRange(today);
    const out = { date: today };

    if (hasPerm(req, 'patients.view') || hasPerm(req, 'dashboard.view')) {
      const [totalPatients, newToday] = await Promise.all([
        prisma.patient.count(),
        prisma.patient.count({ where: { createdAt: { gte: start, lt: end } } }),
      ]);
      out.patients = { total: totalPatients, newToday };
    }
    if (hasPerm(req, 'queue.view') || hasPerm(req, 'dashboard.view')) {
      const visits = await prisma.visit.groupBy({ by: ['status'], where: { queueDate: today }, _count: true });
      const c = Object.fromEntries(visits.map((v) => [v.status, v._count]));
      const activeWhere = {
        queueDate: today,
        status: { in: ['WAITING', 'VITALS', 'AWAITING_DOCTOR', 'IN_CONSULTATION'] },
      };
      if (req.user.role === 'DOCTOR') {
        activeWhere.OR = [{ assignedDoctorId: req.user.id }, { assignedDoctorId: null }];
      }
      const activeList = await prisma.visit.findMany({
        where: activeWhere,
        orderBy: [{ priority: 'desc' }, { queueNumber: 'asc' }],
        take: 6,
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
          assignedDoctor: { select: { id: true, fullName: true } },
          consultation: { select: { id: true } },
        },
      });
      out.queue = {
        waiting: c.WAITING || 0,
        vitals: c.VITALS || 0,
        awaitingDoctor: c.AWAITING_DOCTOR || 0,
        inConsultation: c.IN_CONSULTATION || 0,
        completed: c.COMPLETED || 0,
        cancelled: c.CANCELLED || 0,
        attendedToday: c.COMPLETED || 0,
        pendingConsultations: (c.WAITING || 0) + (c.VITALS || 0) + (c.AWAITING_DOCTOR || 0) + (c.IN_CONSULTATION || 0),
        activeList,
      };
    }
    if (hasPerm(req, 'appointments.view') || hasPerm(req, 'dashboard.view')) {
      const where = { startAt: { gte: start, lt: end } };
      if (req.user.role === 'DOCTOR') where.doctorId = req.user.id;
      const appts = await prisma.appointment.groupBy({ by: ['status'], where, _count: true });
      const c = Object.fromEntries(appts.map((v) => [v.status, v._count]));
      out.appointments = { total: appts.reduce((s, a) => s + a._count, 0), ...c };
    }
    if (hasPerm(req, 'reports.financial')) {
      const [paid, outstanding, byMethod, invoicedToday, outstandingList] = await Promise.all([
        prisma.payment.aggregate({ where: { status: 'VALID', paidAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
        prisma.invoice.aggregate({ where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, _sum: { balance: true }, _count: true }),
        prisma.payment.groupBy({ by: ['method'], where: { status: 'VALID', paidAt: { gte: start, lt: end } }, _sum: { amount: true } }),
        prisma.invoice.aggregate({ where: { status: { not: 'CANCELLED' }, createdAt: { gte: start, lt: end } }, _sum: { total: true } }),
        prisma.invoice.findMany({
          where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: { patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } } },
        }),
      ]);
      // Last 14 days revenue trend
      const fromDay = addDays(today, -13);
      const trendRows = await prisma.$queryRaw`
        SELECT to_char("paidAt" + interval '3 hours', 'YYYY-MM-DD') AS day, SUM(amount)::int AS total
        FROM "Payment" WHERE status = 'VALID' AND "paidAt" >= ${localDayStart(fromDay)} AND "paidAt" < ${end}
        GROUP BY 1 ORDER BY 1`;
      const trend = [];
      for (let i = 0; i < 14; i++) {
        const d = addDays(fromDay, i);
        trend.push({ day: d, total: trendRows.find((x) => x.day === d)?.total || 0 });
      }
      out.finance = {
        revenueToday: paid._sum.amount || 0,
        paymentsToday: paid._count,
        invoicedToday: invoicedToday._sum.total || 0,
        outstandingBalance: outstanding._sum.balance || 0,
        outstandingInvoices: outstanding._count,
        byMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amount || 0])),
        trend,
        outstandingList,
      };
      out.pendingDiscounts = await prisma.discount.count({ where: { status: 'PENDING' } });
    }
    if (hasPerm(req, 'medicines.view') || hasPerm(req, 'dashboard.view')) {
      const meds = await prisma.medicine.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          genericName: true,
          brandName: true,
          category: true,
          form: true,
          sellingPrice: true,
          reorderLevel: true,
          unit: true,
        },
      });
      const sm = await stockMap();
      const low = meds
        .map((m) => ({ ...m, stock: sm.get(m.id)?.available || 0 }))
        .filter((m) => m.stock <= m.reorderLevel)
        .sort((a, b) => a.stock - b.stock);
      const t0 = localDayStart(today);
      const soon = localDayStart(addDays(today, 90));
      const expiring = await prisma.medicineBatch.findMany({
        where: { quantityRemaining: { gt: 0 }, expiryDate: { lt: soon } },
        orderBy: { expiryDate: 'asc' },
        take: 20,
        include: { medicine: { select: { id: true, name: true, unit: true } } },
      });
      out.pharmacy = {
        lowStockCount: low.length,
        lowStock: low.slice(0, 10),
        expiringCount: expiring.filter((b) => b.expiryDate >= t0).length,
        expiredCount: expiring.filter((b) => b.expiryDate < t0).length,
        expiring: expiring.map((b) => ({
          id: b.id,
          medicineId: b.medicineId,
          medicine: b.medicine.name,
          unit: b.medicine.unit,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          purchasePrice: b.purchasePrice,
          supplierId: b.supplierId,
          quantity: b.quantityRemaining,
          expired: b.expiryDate < t0,
        })),
      };
      if (hasPerm(req, 'prescriptions.view')) {
        out.pharmacy.pendingPrescriptions = await prisma.prescription.count({ where: { status: { in: ['PENDING', 'PARTIALLY_DISPENSED'] } } });
      }
    }
    if (hasPerm(req, 'lab.view')) {
      const where = { status: { in: ['PENDING', 'IN_PROGRESS'] } };
      if (req.user.role === 'DOCTOR') where.doctorId = req.user.id;
      out.lab = { pending: await prisma.labRequest.count({ where }) };
    }
    if (req.user.role === 'DOCTOR') {
      out.doctor = {
        consultationsToday: await prisma.consultation.count({ where: { doctorId: req.user.id, startedAt: { gte: start, lt: end } } }),
        myQueue: await prisma.visit.count({ where: { queueDate: today, status: 'AWAITING_DOCTOR', OR: [{ assignedDoctorId: req.user.id }, { assignedDoctorId: null }] } }),
        ongoing: await prisma.consultation.findFirst({ where: { doctorId: req.user.id, status: 'IN_PROGRESS', visitId: { not: null } }, select: { id: true, patient: { select: { firstName: true, lastName: true } } } }),
      };
    }
    res.json(out);
  }),
);

export default r;

