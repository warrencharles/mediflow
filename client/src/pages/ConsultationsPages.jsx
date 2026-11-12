import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Printer, Plus, XCircle, RotateCcw } from 'lucide-react';
import { api, fmtDateTime, fmtDate, calcAge } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, BackButton } from '../context/UIContext.jsx';

export function ConsultationsListPage() {
  const { can } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [data, setData] = useState({ items: [], total: 0 });
  const [patients, setPatients] = useState([]);
  const [newPatientId, setNewPatientId] = useState('');

  const load = async () => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    setParams(next, { replace: true });
    const r = await api(`/consultations?q=${encodeURIComponent(q)}`);
    setData(r);
  };

  useEffect(() => {
    load();
    api('/patients?pageSize=100').then((r) => {
      setPatients(r.items);
      if (r.items[0]) setNewPatientId(r.items[0].id);
    });
  }, []);

  const startDirect = async () => {
    if (!newPatientId) return;
    const c = await api('/consultations', { method: 'POST', body: { patientId: Number(newPatientId) } });
    toast('New consultation started.');
    navigate(`/consultations/${c.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Medical Consultations</h1>
          <p className="text-xs text-slate-500">Clinical history, diagnoses, prescriptions and laboratory orders</p>
        </div>
        {can('consultations.write') && (
          <div className="flex items-center gap-2 text-xs">
            <select
              value={newPatientId}
              onChange={(e) => setNewPatientId(e.target.value)}
              className="px-2.5 py-2 border rounded-lg bg-white"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.patientNumber} · {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
            <button onClick={startDirect} className="px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold">
              + New Consultation
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="flex gap-2 bg-white p-3 rounded-xl border text-xs"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by patient name, ID or diagnosis…"
          className="flex-1 px-3 py-1.5 border rounded-lg"
        />
        <button className="px-4 py-1.5 bg-slate-900 text-white rounded-lg font-semibold">Search</button>
      </form>

      <div className="bg-white rounded-xl border overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b text-slate-500 uppercase">
            <tr>
              <th className="py-3 px-4">Date / Time</th>
              <th className="py-3 px-4">Patient</th>
              <th className="py-3 px-4">Doctor</th>
              <th className="py-3 px-4">Diagnosis</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="py-3 px-4">{fmtDateTime(c.startedAt)}</td>
                <td className="py-3 px-4 font-semibold">
                  {c.patient.firstName} {c.patient.lastName}{' '}
                  <span className="font-mono text-slate-400">({c.patient.patientNumber})</span>
                </td>
                <td className="py-3 px-4">{c.doctor.fullName}</td>
                <td className="py-3 px-4 text-teal-800 font-semibold">{c.diagnosis || 'In progress…'}</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 font-bold text-[10px]">{c.status}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <Link
                    to={`/consultations/${c.id}`}
                    className="px-3 py-1 rounded bg-teal-50 text-teal-700 font-semibold"
                  >
                    Open Record →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ConsultationDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const [c, setC] = useState(null);
  const [history, setHistory] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [labTests, setLabTests] = useState([]);
  const [form, setForm] = useState({
    symptoms: '',
    examination: '',
    diagnosis: '',
    treatmentPlan: '',
    notes: '',
    followUpDate: '',
    amendmentReason: '',
  });
  const [rxItems, setRxItems] = useState([
    { medicineId: '', dosage: '1 tab', frequency: 'TDS', durationDays: 5, quantity: 15, instructions: 'After meals' },
  ]);
  const [selectedLabs, setSelectedLabs] = useState([]);
  const [labPriority, setLabPriority] = useState('ROUTINE');

  const load = async () => {
    const r = await api(`/consultations/${id}`);
    setC(r);
    setForm({
      symptoms: r.symptoms || '',
      examination: r.examination || '',
      diagnosis: r.diagnosis || '',
      treatmentPlan: r.treatmentPlan || '',
      notes: r.notes || '',
      followUpDate: r.followUpDate ? fmtDate(r.followUpDate) : '',
      amendmentReason: '',
    });
    const hist = await api(`/patients/${r.patientId}/consultations`);
    setHistory(hist.filter((h) => h.id !== r.id));
  };

  useEffect(() => {
    load();
    api('/pharmacy/medicines').then((m) => {
      setMedicines(m);
      if (m[0]) setRxItems((items) => items.map((x, idx) => (idx === 0 ? { ...x, medicineId: m[0].id } : x)));
    });
    api('/lab/tests').then(setLabTests);
  }, [id]);

  if (!c) return <div className="text-sm text-slate-500">Loading consultation…</div>;

  const saveNotes = async (e) => {
    e.preventDefault();
    try {
      await api(`/consultations/${id}`, { method: 'PUT', body: form });
      toast('Consultation clinical notes saved.');
      load();
    } catch (e2) {
      toast(e2.details ? Object.values(e2.details).join(' · ') : e2.message, 'error');
    }
  };

  const completeConsultation = async () => {
    const ok = await confirm({
      title: 'Complete Medical Consultation?',
      message:
        'Saves the clinical record, marks this consultation and patient queue visit as COMPLETED, and locks the notes against un-audited changes.',
      confirmText: 'Save & Complete',
    });
    if (!ok) return;
    try {
      await api(`/consultations/${id}`, { method: 'PUT', body: form });
      await api(`/consultations/${id}/complete`, { method: 'POST' });
      toast('Consultation completed and patient queue updated.');
      load();
    } catch (e2) {
      toast(e2.details ? Object.values(e2.details).join(' · ') : e2.message, 'error');
    }
  };

  const reopenConsultation = async () => {
    const reason = await confirm({
      title: 'Reopen Completed Consultation?',
      message: 'Moves this consultation back to IN_PROGRESS so you can continue clinical work. Logged in the audit trail.',
      confirmText: 'Reopen Consultation',
      requireInput: true,
      inputLabel: 'Reason for reopening consultation *',
      defaultValue: 'Additional clinical findings / follow-up orders',
    });
    if (!reason) return;
    try {
      await api(`/consultations/${id}/reopen`, { method: 'POST', body: { reason } });
      toast('Consultation reopened to IN_PROGRESS.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reopenPrescription = async (rx) => {
    const ok = await confirm({
      title: `Reopen Cancelled Prescription ${rx.prescriptionNumber}?`,
      message: 'Restores this prescription to PENDING so the Pharmacist can dispense it.',
      confirmText: 'Reopen Prescription',
    });
    if (!ok) return;
    try {
      await api(`/consultations/prescriptions/${rx.id}/reopen`, { method: 'POST' });
      toast(`Prescription ${rx.prescriptionNumber} reopened.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reopenLab = async (l) => {
    const ok = await confirm({
      title: `Reopen Lab Request ${l.requestNumber} (${l.labTest.name})?`,
      message: 'Restores this lab investigation to PENDING and reinstates its charge on the visit invoice.',
      confirmText: 'Reopen Lab Request',
    });
    if (!ok) return;
    try {
      await api(`/lab/requests/${l.id}/reopen`, { method: 'POST', body: { reason: 'Reopened from consultation' } });
      toast(`Lab request ${l.requestNumber} reopened.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const createPrescription = async (e) => {
    e.preventDefault();
    try {
      await api(`/consultations/${id}/prescriptions`, {
        method: 'POST',
        body: {
          items: rxItems.map((i) => ({
            ...i,
            medicineId: Number(i.medicineId),
            durationDays: Number(i.durationDays) || null,
            quantity: Number(i.quantity),
          })),
        },
      });
      toast('Prescription issued and sent to Pharmacy queue.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const cancelPrescription = async (rx) => {
    const reason = await confirm({
      title: `Cancel Prescription ${rx.prescriptionNumber}?`,
      message: 'Only undispensed prescriptions can be cancelled. The record will remain in the audit trail.',
      confirmText: 'Cancel Prescription',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for cancelling prescription *',
      inputPlaceholder: 'e.g. Changed regimen after lab result',
    });
    if (!reason) return;
    try {
      await api(`/consultations/prescriptions/${rx.id}/cancel`, { method: 'POST', body: { reason } });
      toast(`Prescription ${rx.prescriptionNumber} cancelled.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const requestLabs = async (e) => {
    e.preventDefault();
    if (selectedLabs.length === 0) return;
    try {
      await api(`/consultations/${id}/lab-requests`, {
        method: 'POST',
        body: { labTestIds: selectedLabs.map(Number), priority: labPriority },
      });
      setSelectedLabs([]);
      toast('Laboratory investigation(s) ordered.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const cancelLab = async (l) => {
    const reason = await confirm({
      title: `Cancel Lab Request ${l.requestNumber} (${l.labTest.name})?`,
      message: 'Cancels the unperformed test and voids its charge from the patient invoice.',
      confirmText: 'Cancel Lab Test',
      danger: true,
      requireInput: true,
      inputLabel: 'Cancellation Reason *',
    });
    if (!reason) return;
    try {
      await api(`/lab/requests/${l.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Lab request cancelled.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const latestVitals = c.visit?.vitals?.[0];

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between">
        <BackButton fallback="/consultations" label="Back" />
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 shadow-xs"
        >
          <Printer className="w-4 h-4" /> Print Official Consultation Summary
        </button>
      </div>

      {/* Interactive workspace (hidden on print) */}
      <div className="no-print space-y-6">
        <div className="bg-white rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-teal-50 text-teal-700">
                {c.patient.patientNumber}
              </span>
              <Link to={`/patients/${c.patient.id}`} className="text-lg font-bold hover:underline">
                {c.patient.firstName} {c.patient.lastName}
              </Link>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100">{c.status}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {c.patient.gender} · {calcAge(c.patient.dateOfBirth)} · Attending Doctor: <b>{c.doctor.fullName}</b> ·
              Started: {fmtDateTime(c.startedAt)}
            </div>
            {c.patient.allergies && (
              <div className="mt-1.5 inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs font-bold">
                Allergies: {c.patient.allergies}
              </div>
            )}
          </div>
          {latestVitals && (
            <div className="text-xs bg-slate-50 p-3 rounded-xl border space-y-0.5">
              <div className="font-bold text-slate-700">Triage Vital Signs</div>
              <div>
                Temp: <b>{latestVitals.temperature}°C</b> · BP:{' '}
                <b>
                  {latestVitals.systolic}/{latestVitals.diastolic}
                </b>{' '}
                · Pulse: <b>{latestVitals.pulse} bpm</b> · SpO2: <b>{latestVitals.spo2}%</b> · Wt:{' '}
                <b>{latestVitals.weightKg} kg</b>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={saveNotes} className="bg-white rounded-xl border p-5 space-y-4 text-xs">
              <h2 className="font-bold text-sm text-slate-900">Clinical Notes & Diagnosis</h2>
              <div>
                <label className="font-semibold block mb-1">Presenting Symptoms & History of Presenting Illness</label>
                <textarea
                  rows={2}
                  value={form.symptoms}
                  onChange={(e) => setForm({ ...form, symptoms: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Physical Examination Findings</label>
                <textarea
                  rows={2}
                  value={form.examination}
                  onChange={(e) => setForm({ ...form, examination: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Working / Final Diagnosis *</label>
                <input
                  value={form.diagnosis}
                  onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
                  placeholder="e.g. Uncomplicated Plasmodium falciparum Malaria"
                  className="w-full px-3 py-2 border rounded-lg font-semibold"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Treatment Plan</label>
                <textarea
                  rows={2}
                  value={form.treatmentPlan}
                  onChange={(e) => setForm({ ...form, treatmentPlan: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Additional Consultation Notes</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Follow-up Date (optional)</label>
                  <input
                    type="date"
                    value={form.followUpDate}
                    onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              {c.status === 'COMPLETED' && (
                <div>
                  <label className="font-semibold block mb-1 text-amber-800">
                    Reason for Amending Completed Record *
                  </label>
                  <input
                    value={form.amendmentReason}
                    onChange={(e) => setForm({ ...form, amendmentReason: e.target.value })}
                    placeholder="Explain clinical addendum or correction…"
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg"
                  />
                </div>
              )}
              {can('consultations.write') && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button type="submit" className="px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold">
                    {c.status === 'COMPLETED' ? 'Save Clinical Amendment' : 'Save Record'}
                  </button>
                  {c.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      onClick={completeConsultation}
                      className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                    >
                      Save & Complete Consultation
                    </button>
                  )}
                  {c.status === 'COMPLETED' && (
                    <button
                      type="button"
                      onClick={reopenConsultation}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 font-semibold"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reopen Consultation
                    </button>
                  )}
                </div>
              )}
            </form>

            {/* Prescriptions */}
            <div className="bg-white rounded-xl border p-5 space-y-4 text-xs">
              <h2 className="font-bold text-sm text-slate-900">Prescriptions</h2>
              {c.prescriptions.map((rx) => (
                <div key={rx.id} className="p-3 rounded-lg bg-slate-50 border space-y-1">
                  <div className="flex items-center justify-between font-bold">
                    <span>{rx.prescriptionNumber}</span>
                    <div className="flex items-center gap-2">
                      <span className={rx.status === 'CANCELLED' ? 'text-rose-600' : 'text-teal-700'}>{rx.status}</span>
                      {rx.status === 'PENDING' && can('consultations.write') && (
                        <button
                          type="button"
                          onClick={() => cancelPrescription(rx)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[11px]"
                        >
                          <XCircle className="w-3 h-3" /> Cancel Rx
                        </button>
                      )}
                      {rx.status === 'CANCELLED' && can('consultations.write') && (
                        <button
                          type="button"
                          onClick={() => reopenPrescription(rx)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold text-[11px]"
                        >
                          <RotateCcw className="w-3 h-3" /> Reopen Rx
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="list-disc list-inside">
                    {rx.items.map((it) => (
                      <li key={it.id}>
                        <b>{it.medicine.name}</b> — {it.dosage}, {it.frequency} × {it.durationDays || '—'} days (Qty:{' '}
                        {it.quantity} {it.medicine.unit}, Dispensed: {it.quantityDispensed})
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {can('consultations.write') && (
                <form onSubmit={createPrescription} className="space-y-2 pt-2 border-t">
                  <div className="font-semibold text-slate-700">Issue New Prescription</div>
                  {rxItems.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                      <select
                        value={it.medicineId}
                        onChange={(e) =>
                          setRxItems(rxItems.map((x, i) => (i === idx ? { ...x, medicineId: e.target.value } : x)))
                        }
                        className="sm:col-span-2 px-2 py-1.5 border rounded"
                      >
                        {medicines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (Stock: {m.stock})
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Dosage"
                        value={it.dosage}
                        onChange={(e) =>
                          setRxItems(rxItems.map((x, i) => (i === idx ? { ...x, dosage: e.target.value } : x)))
                        }
                        className="px-2 py-1.5 border rounded"
                      />
                      <input
                        placeholder="Freq (e.g. BD)"
                        value={it.frequency}
                        onChange={(e) =>
                          setRxItems(rxItems.map((x, i) => (i === idx ? { ...x, frequency: e.target.value } : x)))
                        }
                        className="px-2 py-1.5 border rounded"
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={it.quantity}
                        onChange={(e) =>
                          setRxItems(rxItems.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                        }
                        className="px-2 py-1.5 border rounded"
                      />
                      <button
                        type="button"
                        onClick={() => setRxItems(rxItems.filter((_, i) => i !== idx))}
                        disabled={rxItems.length === 1}
                        className="text-rose-600 text-xs disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setRxItems([
                          ...rxItems,
                          {
                            medicineId: medicines[0]?.id || '',
                            dosage: '1 tab',
                            frequency: 'BD',
                            durationDays: 5,
                            quantity: 10,
                            instructions: '',
                          },
                        ])
                      }
                      className="px-3 py-1.5 border rounded-lg inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Medicine Line
                    </button>
                    <button className="px-4 py-1.5 bg-teal-600 text-white rounded-lg font-semibold">
                      Send Prescription to Pharmacy
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div className="space-y-6 text-xs">
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <h2 className="font-bold text-sm text-slate-900">Laboratory Investigations</h2>
              {c.labRequests.map((l) => (
                <div key={l.id} className="p-2.5 rounded border bg-slate-50 space-y-1">
                  <div className="flex items-center justify-between font-bold">
                    <span>{l.labTest.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={l.status === 'COMPLETED' ? 'text-emerald-700' : 'text-amber-700'}>
                        {l.status}
                      </span>
                      {l.status === 'PENDING' && can('lab.request') && (
                        <button
                          type="button"
                          onClick={() => cancelLab(l)}
                          className="text-rose-600 hover:underline text-[11px]"
                        >
                          Cancel
                        </button>
                      )}
                      {l.status === 'CANCELLED' && can('lab.request') && (
                        <button
                          type="button"
                          onClick={() => reopenLab(l)}
                          className="text-teal-700 hover:underline text-[11px] font-semibold"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                  {l.result && (
                    <div className={l.isAbnormal ? 'text-rose-700 font-bold' : 'text-slate-700'}>
                      Result: {l.resultValue ? `${l.resultValue} — ` : ''}
                      {l.result}
                    </div>
                  )}
                </div>
              ))}

              {can('lab.request') && (
                <form onSubmit={requestLabs} className="space-y-2 pt-2 border-t">
                  <div className="font-semibold text-slate-700">Order Lab Tests</div>
                  <div className="max-h-36 overflow-y-auto space-y-1 border rounded p-2">
                    {labTests.map((t) => (
                      <label key={t.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedLabs.includes(t.id)}
                          onChange={(e) =>
                            setSelectedLabs(
                              e.target.checked ? [...selectedLabs, t.id] : selectedLabs.filter((x) => x !== t.id),
                            )
                          }
                        />
                        <span>
                          {t.name} <span className="text-slate-400">({t.code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={labPriority}
                      onChange={(e) => setLabPriority(e.target.value)}
                      className="px-2 py-1.5 border rounded"
                    >
                      <option value="ROUTINE">Routine</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                    <button className="flex-1 py-1.5 bg-indigo-600 text-white rounded font-semibold">
                      Order Selected Tests
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="bg-white rounded-xl border p-5 space-y-3">
              <h2 className="font-bold text-sm text-slate-900">Previous Consultations ({history.length})</h2>
              {history.map((h) => (
                <div key={h.id} className="p-2.5 rounded border space-y-1">
                  <div className="font-semibold text-slate-700">
                    {fmtDate(h.startedAt)} · {h.doctor?.fullName}
                  </div>
                  <div className="text-teal-800 font-bold">{h.diagnosis || '—'}</div>
                  <div className="text-slate-500">{h.treatmentPlan || ''}</div>
                </div>
              ))}
              {history.length === 0 && <div className="text-slate-400">No earlier consultations for this patient.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Printable Consultation Summary Sheet (ONLY this prints!) */}
      <div className="hidden print-only print-sheet text-xs space-y-4">
        <div className="border-b-2 border-slate-900 pb-3 flex justify-between items-start">
          <div>
            <h1 className="text-lg font-bold">MediFlow Healthcare Group — Dar es Salaam</h1>
            <p className="text-slate-600">Official Medical Consultation & Prescription Summary</p>
          </div>
          <div className="text-right">
            <div>Date: <b>{fmtDateTime(c.startedAt)}</b></div>
            <div>Attending Doctor: <b>{c.doctor.fullName}</b></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 border rounded">
          <div>Patient Name: <b>{c.patient.firstName} {c.patient.lastName}</b></div>
          <div>Patient ID: <b>{c.patient.patientNumber}</b></div>
          <div>Gender / Age: <b>{c.patient.gender} · {calcAge(c.patient.dateOfBirth)}</b></div>
          <div>Known Allergies: <b>{c.patient.allergies || 'None reported'}</b></div>
        </div>

        {latestVitals && (
          <div className="p-3 border rounded">
            <div className="font-bold mb-1">Vital Signs</div>
            <div>
              Temp: {latestVitals.temperature}°C · BP: {latestVitals.systolic}/{latestVitals.diastolic} mmHg · Pulse:{' '}
              {latestVitals.pulse} bpm · SpO2: {latestVitals.spo2}% · Weight: {latestVitals.weightKg} kg
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500">Presenting Symptoms</div>
            <div className="p-2 border rounded">{c.symptoms || '—'}</div>
          </div>
          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500">Examination Findings</div>
            <div className="p-2 border rounded">{c.examination || '—'}</div>
          </div>
          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500">Diagnosis</div>
            <div className="p-2 border rounded font-bold">{c.diagnosis || '—'}</div>
          </div>
          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500">Treatment Plan & Advice</div>
            <div className="p-2 border rounded">{c.treatmentPlan || '—'}</div>
          </div>
        </div>

        {c.prescriptions.length > 0 && (
          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500 mb-1">Prescribed Medications</div>
            <table className="w-full border-collapse border">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border p-1.5 text-left">Medicine</th>
                  <th className="border p-1.5 text-left">Dosage & Frequency</th>
                  <th className="border p-1.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {c.prescriptions.flatMap((rx) =>
                  rx.items.map((it) => (
                    <tr key={it.id}>
                      <td className="border p-1.5 font-semibold">{it.medicine.name}</td>
                      <td className="border p-1.5">
                        {it.dosage} · {it.frequency} {it.durationDays ? `× ${it.durationDays} days` : ''}
                      </td>
                      <td className="border p-1.5 text-right">
                        {it.quantity} {it.medicine.unit}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-8 flex justify-between text-xs">
          <div>Follow-up Date: <b>{c.followUpDate ? fmtDate(c.followUpDate) : 'As needed'}</b></div>
          <div>Doctor Signature: ___________________________</div>
        </div>
      </div>
    </div>
  );
}
