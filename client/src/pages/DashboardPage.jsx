import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  Calendar,
  Clock,
  Wallet,
  AlertTriangle,
  Pill,
  FlaskConical,
  ArrowRight,
  Stethoscope,
  Receipt,
  PackagePlus,
  Edit3,
  Sliders,
} from 'lucide-react';
import { api, fmtTSh, fmtDate } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal } from '../context/UIContext.jsx';

export default function DashboardPage() {
  const { user, can } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Quick interactive modals directly from Dashboard alerts
  const [editMed, setEditMed] = useState(null);
  const [medForm, setMedForm] = useState({
    name: '',
    genericName: '',
    brandName: '',
    category: '',
    form: '',
    unit: 'tablet',
    sellingPrice: 500,
    reorderLevel: 30,
  });

  const [restockMed, setRestockMed] = useState(null);
  const [stockForm, setStockForm] = useState({
    batchNumber: '',
    expiryDate: '2028-06-30',
    quantity: 100,
    purchasePrice: 200,
    reference: '',
  });

  const [editBatch, setEditBatch] = useState(null);
  const [batchForm, setBatchForm] = useState({
    batchNumber: '',
    expiryDate: '',
    purchasePrice: 0,
  });

  const [adjustBatch, setAdjustBatch] = useState(null);
  const [adjustForm, setAdjustForm] = useState({
    type: 'EXPIRED_WRITE_OFF',
    quantity: 1,
    reason: '',
  });

  const load = () => {
    api('/dashboard')
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div className="text-sm text-slate-500">Loading clinic dashboard…</div>;
  if (!data) return null;

  const openEditMedicine = (m) => {
    setEditMed(m);
    setMedForm({
      name: m.name || '',
      genericName: m.genericName || '',
      brandName: m.brandName || '',
      category: m.category || 'General',
      form: m.form || '',
      unit: m.unit || 'tablet',
      sellingPrice: m.sellingPrice ?? 500,
      reorderLevel: m.reorderLevel ?? 30,
    });
  };

  const saveEditMedicine = async (e) => {
    e.preventDefault();
    try {
      await api(`/pharmacy/medicines/${editMed.id}`, {
        method: 'PUT',
        body: {
          ...medForm,
          sellingPrice: Number(medForm.sellingPrice),
          reorderLevel: Number(medForm.reorderLevel),
        },
      });
      toast(`Updated ${medForm.name}.`);
      setEditMed(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openRestock = (m) => {
    setRestockMed(m);
    setStockForm({
      batchNumber: `B-${new Date().getFullYear()}-${String(Math.floor(100 + Math.random() * 900))}`,
      expiryDate: '2028-06-30',
      quantity: Math.max(50, (m.reorderLevel || 30) * 2),
      purchasePrice: Math.max(50, Math.round((m.sellingPrice || 500) * 0.5)),
      reference: '',
    });
  };

  const saveRestock = async (e) => {
    e.preventDefault();
    try {
      await api('/pharmacy/stock-in', {
        method: 'POST',
        body: {
          medicineId: restockMed.id,
          batchNumber: stockForm.batchNumber,
          expiryDate: stockForm.expiryDate,
          quantity: Number(stockForm.quantity),
          purchasePrice: Number(stockForm.purchasePrice),
          reference: stockForm.reference || undefined,
        },
      });
      toast(`Received ${stockForm.quantity} ${restockMed.unit} of ${restockMed.name}.`);
      setRestockMed(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openBatchEditor = (b) => {
    setEditBatch(b);
    setBatchForm({
      batchNumber: b.batchNumber,
      expiryDate: fmtDate(b.expiryDate),
      purchasePrice: b.purchasePrice ?? 200,
    });
  };

  const saveBatchEdit = async (e) => {
    e.preventDefault();
    try {
      await api(`/pharmacy/batches/${editBatch.id}`, {
        method: 'PUT',
        body: {
          batchNumber: batchForm.batchNumber,
          expiryDate: batchForm.expiryDate,
          purchasePrice: Number(batchForm.purchasePrice),
          supplierId: editBatch.supplierId || null,
        },
      });
      toast(`Batch ${batchForm.batchNumber} updated.`);
      setEditBatch(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openBatchAdjust = (b) => {
    setAdjustBatch(b);
    setAdjustForm({
      type: b.expired ? 'EXPIRED_WRITE_OFF' : 'ADJUSTMENT_OUT',
      quantity: b.quantity,
      reason: b.expired ? 'Expired batch write-off from active stock' : 'Damaged / quarantined stock adjustment',
    });
  };

  const saveBatchAdjust = async (e) => {
    e.preventDefault();
    try {
      await api('/pharmacy/adjustments', {
        method: 'POST',
        body: {
          batchId: adjustBatch.id,
          type: adjustForm.type,
          quantity: Number(adjustForm.quantity),
          reason: adjustForm.reason,
        },
      });
      toast(`Adjusted batch ${adjustBatch.batchNumber}.`);
      setAdjustBatch(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const linkFor = (target, perm) => (can(perm) ? target : null);

  const cards = [];
  if (data.patients && can('patients.view')) {
    cards.push({
      label: 'Total Registered Patients',
      value: data.patients.total.toLocaleString(),
      sub: `+${data.patients.newToday} registered today`,
      icon: Users,
      color: 'bg-teal-50 text-teal-700',
      to: linkFor('/patients', 'patients.view'),
    });
  }
  if (data.queue && can('queue.view')) {
    cards.push({
      label: 'Patients Attended Today',
      value: data.queue.attendedToday,
      sub: `${data.queue.pendingConsultations} currently in queue`,
      icon: UserCheck,
      color: 'bg-emerald-50 text-emerald-700',
      to: linkFor('/queue', 'queue.view'),
    });
    cards.push({
      label: 'Active Patient Queue',
      value: data.queue.pendingConsultations,
      sub: `Waiting: ${data.queue.waiting} · Vitals: ${data.queue.vitals} · Doctor: ${data.queue.awaitingDoctor}`,
      icon: Clock,
      color: 'bg-amber-50 text-amber-700',
      to: linkFor('/queue', 'queue.view'),
    });
  }
  if (data.appointments && can('appointments.view')) {
    cards.push({
      label: 'Appointments Today',
      value: data.appointments.total,
      sub: `Confirmed: ${data.appointments.CONFIRMED || 0} · Checked in: ${data.appointments.CHECKED_IN || 0}`,
      icon: Calendar,
      color: 'bg-indigo-50 text-indigo-700',
      to: linkFor('/appointments', 'appointments.view'),
    });
  }
  if (data.finance && can('reports.financial')) {
    cards.push({
      label: 'Total Revenue Today',
      value: fmtTSh(data.finance.revenueToday),
      sub: `${data.finance.paymentsToday} payment(s) · Invoiced: ${fmtTSh(data.finance.invoicedToday)}`,
      icon: Wallet,
      color: 'bg-teal-50 text-teal-800',
      to: linkFor('/billing', 'billing.view'),
    });
    cards.push({
      label: 'Outstanding Balances',
      value: fmtTSh(data.finance.outstandingBalance),
      sub: `${data.finance.outstandingInvoices} unpaid / partially paid invoice(s)`,
      icon: Receipt,
      color: 'bg-rose-50 text-rose-700',
      to: linkFor('/billing?status=OUTSTANDING', 'billing.view'),
    });
  }
  if (data.pharmacy && can('medicines.view')) {
    if (data.pharmacy.pendingPrescriptions != null) {
      cards.push({
        label: 'Pending Prescriptions',
        value: data.pharmacy.pendingPrescriptions,
        sub: `${data.pharmacy.pendingPrescriptionsList?.length || 0} prescription(s) awaiting dispense`,
        icon: Stethoscope,
        color: 'bg-teal-50 text-teal-700',
        to: linkFor('/pharmacy?tab=prescriptions', 'prescriptions.view'),
      });
    }
    cards.push({
      label: 'Low-Stock Medicines',
      value: data.pharmacy.lowStockCount,
      sub: data.pharmacy.lowStockCount > 0 ? 'At or below reorder threshold' : 'All medicines well stocked',
      icon: Pill,
      color: 'bg-orange-50 text-orange-700',
      to: linkFor('/pharmacy?tab=alerts', 'medicines.view'),
    });
    cards.push({
      label: 'Expiring / Expired Batches',
      value: data.pharmacy.expiringCount + data.pharmacy.expiredCount,
      sub: `${data.pharmacy.expiringCount} expiring ≤90d · ${data.pharmacy.expiredCount} expired`,
      icon: AlertTriangle,
      color: 'bg-amber-50 text-amber-800',
      to: linkFor('/pharmacy?tab=alerts', 'medicines.view'),
    });
    cards.push({
      label: 'Total Formulary Stock',
      value: data.pharmacy.totalMedicines || 12,
      sub: `${data.pharmacy.supplierCount || 3} registered suppliers`,
      icon: PackagePlus,
      color: 'bg-emerald-50 text-emerald-800',
      to: linkFor('/pharmacy?tab=inventory', 'medicines.view'),
    });
  }
  if (data.lab && can('lab.view')) {
    cards.push({
      label: 'Pending Lab Tests',
      value: data.lab.pending,
      sub: 'Awaiting sample / result entry',
      icon: FlaskConical,
      color: 'bg-purple-50 text-purple-700',
      to: linkFor('/lab', 'lab.view'),
    });
  }
  if (data.doctor) {
    cards.push({
      label: 'My Consultations Today',
      value: data.doctor.consultationsToday,
      sub: `${data.doctor.myQueue} patient(s) waiting for you right now`,
      icon: Stethoscope,
      color: 'bg-teal-50 text-teal-700',
      to: '/consultations',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Karibu, {user.fullName}</h1>
          <p className="text-xs text-slate-500">
            Date: <span className="font-semibold text-slate-700">{data.date}</span> · Active Role:{' '}
            <span className="font-semibold text-teal-700">{user.role.replace('_', ' ')}</span>
          </p>
        </div>
        {data.doctor?.ongoing && (
          <Link
            to={`/consultations/${data.doctor.ongoing.id}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700"
          >
            Resume Consultation ({data.doctor.ongoing.patient.firstName} {data.doctor.ongoing.patient.lastName})
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Dynamic Responsive Balanced KPI Grid */}
      <div
        className={`grid gap-4 ${
          cards.length === 1
            ? 'grid-cols-1 max-w-lg mx-auto'
            : cards.length === 2
            ? 'grid-cols-1 sm:grid-cols-2'
            : cards.length === 3
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        }`}
      >
        {cards.map((c) => {
          const Icon = c.icon;
          const Inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-slate-500">{c.label}</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">{c.value}</div>
                </div>
                <div className={`p-2.5 rounded-lg ${c.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100">{c.sub}</div>
            </>
          );
          return c.to ? (
            <Link
              key={c.label}
              to={c.to}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-teal-500 hover:shadow-md transition flex flex-col justify-between"
            >
              {Inner}
            </Link>
          ) : (
            <div
              key={c.label}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between"
            >
              {Inner}
            </div>
          );
        })}
      </div>

      {/* Actionable Operational Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Actionable Pharmacy Low-Stock & Expiring Batches */}
        {data.pharmacy && can('medicines.view') && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm text-slate-800">Pharmacy Low-Stock & Expiry Alerts</h2>
                <p className="text-[11px] text-slate-500">
                  Manage reorder levels, receive new stock batches, edit batch details, or write off expired stock
                </p>
              </div>
              <Link to="/pharmacy?tab=alerts" className="text-xs text-teal-600 hover:underline font-semibold">
                Full Pharmacy →
              </Link>
            </div>

            {data.pharmacy.lowStock.length === 0 && data.pharmacy.expiring.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                All medicines are well stocked and within shelf life.
              </p>
            ) : (
              <div className="space-y-2.5 text-xs">
                {data.pharmacy.lowStock.map((m) => (
                  <div
                    key={`low-${m.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-orange-50/70 border border-orange-200"
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        {m.name}{' '}
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-orange-200/80 text-orange-950 text-[10px] font-bold">
                          LOW STOCK: {m.stock} / {m.reorderLevel} {m.unit}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Selling Price: {fmtTSh(m.sellingPrice || 0)} · Reorder threshold: {m.reorderLevel} {m.unit}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {can('pharmacy.manage') ? (
                        <>
                          <button
                            onClick={() => openRestock(m)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                          >
                            <PackagePlus className="w-3.5 h-3.5" /> Restock
                          </button>
                          <button
                            onClick={() => openEditMedicine(m)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                        </>
                      ) : (
                        <Link
                          to="/pharmacy?tab=alerts"
                          className="px-2.5 py-1.5 rounded-lg bg-white border font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          View in Pharmacy →
                        </Link>
                      )}
                    </div>
                  </div>
                ))}

                {data.pharmacy.expiring.map((b) => (
                  <div
                    key={`exp-${b.id}`}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border ${b.expired
                        ? 'bg-rose-50/80 border-rose-200 text-rose-900'
                        : 'bg-amber-50/80 border-amber-200 text-amber-950'
                      }`}
                  >
                    <div>
                      <div className="font-bold">
                        {b.medicine} · <span className="font-mono">Batch {b.batchNumber}</span>
                        <span
                          className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${b.expired ? 'bg-rose-600 text-white' : 'bg-amber-200 text-amber-950'
                            }`}
                        >
                          {b.expired ? 'EXPIRED' : 'EXPIRING'} {fmtDate(b.expiryDate)}
                        </span>
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5">
                        Remaining in batch: <b>{b.quantity}</b> {b.unit || 'units'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {can('pharmacy.manage') ? (
                        <>
                          <button
                            onClick={() => openBatchEditor(b)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-800"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit Batch
                          </button>
                          <button
                            onClick={() => openBatchAdjust(b)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold text-white ${b.expired ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-700 hover:bg-amber-800'
                              }`}
                          >
                            <Sliders className="w-3.5 h-3.5" /> {b.expired ? 'Write Off' : 'Adjust'}
                          </button>
                        </>
                      ) : (
                        <Link
                          to="/pharmacy?tab=alerts"
                          className="px-2.5 py-1.5 rounded-lg bg-white border font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          View Batch →
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 1b. Pharmacy Pending Prescriptions Queue (balances Pharmacist / Manager Dashboard) */}
        {data.pharmacy && can('prescriptions.view') && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm text-slate-800">Pending Prescriptions Queue</h2>
                <p className="text-[11px] text-slate-500">
                  Doctor prescriptions awaiting verification and stock dispensing
                </p>
              </div>
              <Link to="/pharmacy?tab=prescriptions" className="text-xs text-teal-600 hover:underline font-semibold">
                View All Rx ({data.pharmacy.pendingPrescriptions || 0}) →
              </Link>
            </div>

            {(!data.pharmacy.pendingPrescriptionsList || data.pharmacy.pendingPrescriptionsList.length === 0) ? (
              <div className="p-6 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 space-y-3">
                <p className="text-xs text-slate-500">
                  All prescriptions have been dispensed! No patients currently waiting for medicines.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Link
                    to="/pharmacy?tab=inventory"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
                  >
                    <PackagePlus className="w-3.5 h-3.5" /> Receive Stock
                  </Link>
                  <Link
                    to="/pharmacy?tab=suppliers"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                  >
                    Suppliers Directory
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                {data.pharmacy.pendingPrescriptionsList.map((rx) => (
                  <div
                    key={rx.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 flex items-center justify-between gap-3 transition"
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        <span className="font-mono text-teal-700">{rx.prescriptionNumber}</span> · {rx.patient?.firstName} {rx.patient?.lastName}{' '}
                        <span className="text-slate-400 font-mono">({rx.patient?.patientNumber})</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Dr. {rx.doctor?.fullName} · {rx.items?.length || 0} item(s) prescribed
                      </div>
                    </div>
                    <Link
                      to={`/pharmacy?tab=prescriptions&rx=${rx.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold shrink-0 shadow-xs"
                    >
                      <Pill className="w-3.5 h-3.5" /> Dispense →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. Actionable Live Patient Queue (for Receptionist, Nurse, Doctor, Manager, Admin) */}
        {data.queue?.activeList && can('queue.view') && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm text-slate-800">Active Patient Queue Today</h2>
                <p className="text-[11px] text-slate-500">
                  Direct actions for patients currently waiting for vitals or doctor consultation
                </p>
              </div>
              <Link to="/queue" className="text-xs text-teal-600 hover:underline font-semibold">
                Open Queue Board →
              </Link>
            </div>

            {data.queue.activeList.length === 0 ? (
              <div className="text-xs text-slate-400 py-4 text-center">
                No patients currently waiting in the active queue.
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {data.queue.activeList.map((v) => (
                  <div
                    key={v.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        <span className="font-mono text-teal-700">#{v.queueNumber}</span> · {v.patient.firstName}{' '}
                        {v.patient.lastName}{' '}
                        <span className="text-slate-400 font-mono">({v.patient.patientNumber})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Stage: <b>{v.status}</b> · Doctor: <b>{v.assignedDoctor?.fullName || 'Any available'}</b>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {v.consultation?.id && can('consultations.view') ? (
                        <Link
                          to={`/consultations/${v.consultation.id}`}
                          className="px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold"
                        >
                          Open Consultation →
                        </Link>
                      ) : (
                        <Link
                          to="/queue"
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold"
                        >
                          {can('vitals.write') && ['WAITING', 'VITALS'].includes(v.status)
                            ? 'Record Vitals →'
                            : can('queue.call') && v.status === 'AWAITING_DOCTOR'
                              ? 'Call Patient →'
                              : 'Manage in Queue →'}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. Actionable Collections & Outstanding Invoices */}
        {data.finance && can('reports.financial') && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm text-slate-800">Collections & Unpaid Invoices</h2>
                <p className="text-[11px] text-slate-500">
                  Today's verified revenue by payment channel & invoices awaiting cashier payment
                </p>
              </div>
              <Link to="/billing" className="text-xs text-teal-600 hover:underline font-semibold">
                Open Cashier →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              {[
                ['CASH', 'Cash'],
                ['MPESA', 'M-Pesa'],
                ['TIGO_PESA', 'Tigo Pesa'],
                ['AIRTEL_MONEY', 'Airtel Money'],
                ['BANK_TRANSFER', 'Bank Transfer'],
              ].map(([k, label]) => (
                <Link
                  key={k}
                  to="/reports"
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-500 transition"
                >
                  <div className="text-slate-500">{label}</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">
                    {fmtTSh(data.finance.byMethod?.[k] || 0)}
                  </div>
                </Link>
              ))}
            </div>

            {data.pendingDiscounts > 0 && can('billing.discount.approve') && (
              <Link
                to="/billing"
                className="block p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold hover:bg-amber-100"
              >
                {data.pendingDiscounts} discount request(s) awaiting Manager approval — Click to review →
              </Link>
            )}

            {data.finance.outstandingList?.length > 0 && can('billing.view') && (
              <div className="space-y-2 pt-2 border-t text-xs">
                <div className="font-semibold text-slate-700">Recent Unpaid / Partially Paid Invoices</div>
                {data.finance.outstandingList.slice(0, 4).map((inv) => (
                  <div
                    key={inv.id}
                    className="p-2.5 rounded-lg border bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-mono font-bold text-teal-800">{inv.invoiceNumber}</span> ·{' '}
                      <b>
                        {inv.patient.firstName} {inv.patient.lastName}
                      </b>
                      <span className="text-rose-700 font-bold ml-2">Balance: {fmtTSh(inv.balance)}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/billing?invoice=${inv.id}`)}
                      className="px-2.5 py-1 rounded-lg bg-teal-600 text-white font-semibold"
                    >
                      Collect Payment →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal 1: Edit Medicine & Reorder Level */}
      <Modal
        open={!!editMed}
        onClose={() => setEditMed(null)}
        title={editMed ? `Edit Medicine — ${editMed.name}` : ''}
        subtitle="Update selling price, unit or low-stock reorder alert threshold"
      >
        <form onSubmit={saveEditMedicine} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Medicine Name *</label>
            <input
              required
              value={medForm.name}
              onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Brand Name</label>
              <input
                value={medForm.brandName}
                onChange={(e) => setMedForm({ ...medForm, brandName: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Category *</label>
              <input
                required
                value={medForm.category}
                onChange={(e) => setMedForm({ ...medForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold block mb-1">Unit *</label>
              <input
                required
                value={medForm.unit}
                onChange={(e) => setMedForm({ ...medForm, unit: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Selling Price (TSh) *</label>
              <input
                type="number"
                required
                value={medForm.sellingPrice}
                onChange={(e) => setMedForm({ ...medForm, sellingPrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Reorder Level *</label>
              <input
                type="number"
                required
                value={medForm.reorderLevel}
                onChange={(e) => setMedForm({ ...medForm, reorderLevel: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setEditMed(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Changes</button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Restock Low-Stock Medicine */}
      <Modal
        open={!!restockMed}
        onClose={() => setRestockMed(null)}
        title={restockMed ? `Restock ${restockMed.name}` : ''}
        subtitle="Receive a new batch into inventory to resolve the low-stock alert"
      >
        <form onSubmit={saveRestock} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Batch Number *</label>
              <input
                required
                value={stockForm.batchNumber}
                onChange={(e) => setStockForm({ ...stockForm, batchNumber: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Expiry Date *</label>
              <input
                type="date"
                required
                value={stockForm.expiryDate}
                onChange={(e) => setStockForm({ ...stockForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Quantity Received *</label>
              <input
                type="number"
                min="1"
                required
                value={stockForm.quantity}
                onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Unit Purchase Price (TSh) *</label>
              <input
                type="number"
                min="0"
                required
                value={stockForm.purchasePrice}
                onChange={(e) => setStockForm({ ...stockForm, purchasePrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setRestockMed(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Receive Stock Batch</button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Edit Expiring / Expired Batch */}
      <Modal
        open={!!editBatch}
        onClose={() => setEditBatch(null)}
        title={editBatch ? `Edit Batch ${editBatch.batchNumber} (${editBatch.medicine})` : ''}
        subtitle="Correct batch number, expiration date or unit purchase cost"
      >
        <form onSubmit={saveBatchEdit} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Batch Number *</label>
            <input
              required
              value={batchForm.batchNumber}
              onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Expiry Date *</label>
              <input
                type="date"
                required
                value={batchForm.expiryDate}
                onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Purchase Price (TSh) *</label>
              <input
                type="number"
                min="0"
                required
                value={batchForm.purchasePrice}
                onChange={(e) => setBatchForm({ ...batchForm, purchasePrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setEditBatch(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Batch</button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Write Off / Adjust Expiring or Expired Batch */}
      <Modal
        open={!!adjustBatch}
        onClose={() => setAdjustBatch(null)}
        title={adjustBatch ? `Write Off / Adjust Batch ${adjustBatch.batchNumber}` : ''}
        subtitle={adjustBatch ? `${adjustBatch.medicine} · ${adjustBatch.quantity} units remaining` : ''}
      >
        <form onSubmit={saveBatchAdjust} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Adjustment Type</label>
              <select
                value={adjustForm.type}
                onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="EXPIRED_WRITE_OFF">Expired Stock Write-Off (−)</option>
                <option value="ADJUSTMENT_OUT">Damaged / Quarantine Out (−)</option>
                <option value="ADJUSTMENT_IN">Stock Count Gain (+)</option>
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">Quantity *</label>
              <input
                type="number"
                min="1"
                required
                value={adjustForm.quantity}
                onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Audit Reason *</label>
            <input
              required
              value={adjustForm.reason}
              onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setAdjustBatch(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold">
              Confirm Stock Adjustment
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
