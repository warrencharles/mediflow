import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { UserCheck, Activity, Stethoscope, XCircle, UserCog, RotateCcw, Trash2 } from 'lucide-react';
import { api, todayStr, calcAge } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal } from '../context/UIContext.jsx';

const STAGES = [
  ['WAITING', '1. Waiting for Vitals', 'bg-slate-100 text-slate-800'],
  ['VITALS', '2. Recording Vitals', 'bg-amber-100 text-amber-900'],
  ['AWAITING_DOCTOR', '3. Awaiting Doctor', 'bg-indigo-100 text-indigo-900'],
  ['IN_CONSULTATION', '4. In Consultation', 'bg-teal-100 text-teal-900'],
  ['COMPLETED', '5. Completed Today', 'bg-emerald-100 text-emerald-900'],
];

export default function QueuePage() {
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || todayStr());
  const [showCancelled, setShowCancelled] = useState(false);
  const [visits, setVisits] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [checkInForm, setCheckInForm] = useState({ patientId: '', doctorId: '', reason: '', priority: 'NORMAL' });
  const [vitalsVisit, setVitalsVisit] = useState(null);
  const [vitalsForm, setVitalsForm] = useState({
    temperature: '36.8',
    systolic: '120',
    diastolic: '80',
    pulse: '76',
    respRate: '16',
    spo2: '99',
    weightKg: '68',
    heightCm: '170',
    notes: '',
    doctorId: '',
  });
  const [err, setErr] = useState('');

  const load = async () => {
    const r = await api(`/queue?date=${date}`);
    setVisits(r.items);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [date]);

  useEffect(() => {
    if (can('patients.view')) {
      api('/patients?pageSize=100').then((r) => {
        setPatients(r.items);
        if (r.items[0]) setCheckInForm((f) => ({ ...f, patientId: r.items[0].id }));
      });
    }
    api('/users/directory?role=DOCTOR').then(setDoctors);
  }, []);

  const submitCheckIn = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const v = await api('/queue/check-in', {
        method: 'POST',
        body: {
          patientId: Number(checkInForm.patientId),
          doctorId: checkInForm.doctorId ? Number(checkInForm.doctorId) : null,
          reason: checkInForm.reason,
          priority: checkInForm.priority,
        },
      });
      setShowCheckIn(false);
      toast(`Patient checked in as Queue #${v.queueNumber}.`);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const openVitalsModal = async (v) => {
    if (v.status === 'WAITING') {
      await api(`/queue/${v.id}/start-vitals`, { method: 'POST' });
    }
    const prev = v.vitals?.[0];
    setVitalsForm({
      temperature: prev?.temperature ?? '36.8',
      systolic: prev?.systolic ?? '120',
      diastolic: prev?.diastolic ?? '80',
      pulse: prev?.pulse ?? '76',
      respRate: prev?.respRate ?? '16',
      spo2: prev?.spo2 ?? '99',
      weightKg: prev?.weightKg ?? '68',
      heightCm: prev?.heightCm ?? '170',
      notes: prev?.notes ?? '',
      doctorId: v.assignedDoctor?.id || '',
    });
    setVitalsVisit(v);
    load();
  };

  const submitVitals = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api(`/queue/${vitalsVisit.id}/vitals`, {
        method: 'POST',
        body: {
          ...vitalsForm,
          doctorId: vitalsForm.doctorId ? Number(vitalsForm.doctorId) : null,
        },
      });
      setVitalsVisit(null);
      toast('Vital signs recorded! Patient moved to Awaiting Doctor.');
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const callNext = async (visitId) => {
    try {
      const r = await api('/queue/call-next', { method: 'POST', body: visitId ? { visitId } : {} });
      toast(`Called Queue #${r.visit.queueNumber} (${r.visit.patient.firstName} ${r.visit.patient.lastName}).`);
      navigate(`/consultations/${r.consultation.id}`);
    } catch (e2) {
      if (e2.details?.consultationId) {
        navigate(`/consultations/${e2.details.consultationId}`);
      } else {
        toast(e2.message, 'error');
      }
    }
  };

  const cancelVisit = async (v) => {
    const reason = await confirm({
      title: `Cancel Queue Visit #${v.queueNumber} (${v.patient.firstName} ${v.patient.lastName})?`,
      message: 'Removes the patient from the active queue and voids any unpaid consultation check-in charge.',
      confirmText: 'Cancel Visit',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for cancelling visit *',
      inputPlaceholder: 'e.g. Patient left clinic before consultation',
    });
    if (!reason) return;
    try {
      await api(`/queue/${v.id}/cancel`, { method: 'POST', body: { reason } });
      toast(`Queue #${v.queueNumber} cancelled.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reassignDoctor = async (v, doctorId) => {
    try {
      await api(`/queue/${v.id}/assign`, {
        method: 'POST',
        body: { doctorId: doctorId ? Number(doctorId) : null },
      });
      toast('Assigned doctor updated.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reopenOrStepBack = async (v, targetStatus, label) => {
    const ok = await confirm({
      title: `${label} — Queue #${v.queueNumber} (${v.patient.firstName} ${v.patient.lastName})?`,
      message: `Moves this visit from ${v.status} to ${targetStatus} and logs the action in the audit trail.`,
      confirmText: label,
    });
    if (!ok) return;
    try {
      await api(`/queue/${v.id}/reopen`, {
        method: 'POST',
        body: { targetStatus, reason: label },
      });
      toast(`Queue #${v.queueNumber} moved to ${targetStatus}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteVisit = async (v) => {
    const ok = await confirm({
      title: `Delete Accidental Check-in #${v.queueNumber}?`,
      message:
        'Only check-ins with no consultation, lab requests, or paid invoices can be permanently deleted. Visits with clinical activity should be Cancelled instead.',
      confirmText: 'Delete Check-in',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/queue/${v.id}`, { method: 'DELETE' });
      toast(`Deleted accidental check-in #${v.queueNumber}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const cancelledVisits = visits.filter((v) => v.status === 'CANCELLED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Patient Queue & Vital Signs</h1>
          <p className="text-xs text-slate-500">
            {user.role === 'DOCTOR'
              ? 'Showing patients assigned to you or unassigned (ready to be called)'
              : 'Live clinic flow: Waiting → Vitals → Awaiting Doctor → In Consultation → Completed'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setParams({ date: e.target.value }, { replace: true });
            }}
            className="px-3 py-1.5 border rounded-lg text-xs"
          />
          {cancelledVisits.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCancelled((s) => !s)}
              className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold"
            >
              {showCancelled ? 'Hide' : 'Show'} Cancelled ({cancelledVisits.length})
            </button>
          )}
          {can('queue.checkin') && (
            <button
              onClick={() => {
                setErr('');
                setShowCheckIn(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs"
            >
              <UserCheck className="w-4 h-4" /> Check In Patient
            </button>
          )}
          {can('queue.call') && (
            <button
              onClick={() => callNext(null)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs"
            >
              <Stethoscope className="w-4 h-4" /> Call Next Patient
            </button>
          )}
        </div>
      </div>

      {/* Stage columns */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {STAGES.map(([code, title, badge]) => {
          const list = visits.filter((v) => v.status === code);
          return (
            <div key={code} className="bg-white rounded-xl border border-slate-200 flex flex-col">
              <div
                className={`px-3.5 py-2.5 border-b flex items-center justify-between text-xs font-bold rounded-t-xl ${badge}`}
              >
                <span>{title}</span>
                <span>{list.length}</span>
              </div>
              <div className="p-3 space-y-2.5 flex-1">
                {list.map((v) => {
                  const canCallThis =
                    can('queue.call') &&
                    (!v.assignedDoctor || v.assignedDoctor.id === user.id || user.role === 'SUPER_ADMIN');
                  return (
                    <div key={v.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-teal-800">#{v.queueNumber}</span>
                        {v.priority === 'URGENT' && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                            URGENT
                          </span>
                        )}
                      </div>
                      <div>
                        <Link
                          to={`/patients/${v.patient.id}`}
                          className="font-bold text-slate-900 hover:text-teal-700 hover:underline"
                        >
                          {v.patient.firstName} {v.patient.lastName}
                        </Link>
                        <div className="text-[11px] text-slate-500">
                          {v.patient.patientNumber} · {calcAge(v.patient.dateOfBirth)}
                        </div>
                      </div>
                      {v.reason && <div className="text-[11px] text-slate-600 italic">“{v.reason}”</div>}

                      {/* Assigned doctor selector for Receptionist / Nurse */}
                      {['WAITING', 'VITALS', 'AWAITING_DOCTOR'].includes(v.status) &&
                        (can('queue.checkin') || can('vitals.write')) ? (
                        <div className="flex items-center gap-1 text-[11px]">
                          <UserCog className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <select
                            value={v.assignedDoctor?.id || ''}
                            onChange={(e) => reassignDoctor(v, e.target.value)}
                            className="w-full px-1.5 py-1 border rounded bg-white text-[11px]"
                          >
                            <option value="">Any Available Doctor</option>
                            {doctors.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          Doctor: <b>{v.assignedDoctor?.fullName || 'Any available'}</b>
                        </div>
                      )}

                      {v.vitals?.[0] && (
                        <div className="text-[11px] bg-white p-1.5 rounded border text-slate-700">
                          T: <b>{v.vitals[0].temperature}°C</b> · BP:{' '}
                          <b>
                            {v.vitals[0].systolic}/{v.vitals[0].diastolic}
                          </b>{' '}
                          · P: <b>{v.vitals[0].pulse}</b>
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 pt-1">
                        {['WAITING', 'VITALS', 'AWAITING_DOCTOR'].includes(v.status) && can('vitals.write') && (
                          <button
                            onClick={() => openVitalsModal(v)}
                            className="w-full py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center justify-center gap-1"
                          >
                            <Activity className="w-3.5 h-3.5" /> {v.vitals?.length ? 'Update Vitals' : 'Record Vitals'}
                          </button>
                        )}
                        {v.status === 'AWAITING_DOCTOR' && canCallThis && (
                          <button
                            onClick={() => callNext(v.id)}
                            className="w-full py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                          >
                            Start Consultation →
                          </button>
                        )}
                        {v.status === 'IN_CONSULTATION' && v.consultation && can('consultations.view') && (
                          <button
                            onClick={() => navigate(`/consultations/${v.consultation.id}`)}
                            className="w-full py-1.5 rounded bg-slate-800 text-white font-semibold"
                          >
                            Open Consultation →
                          </button>
                        )}
                        {v.status === 'COMPLETED' && v.consultation && can('consultations.view') && (
                          <button
                            onClick={() => navigate(`/consultations/${v.consultation.id}`)}
                            className="w-full py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold"
                          >
                            View Consultation Summary →
                          </button>
                        )}
                        {/* Step Back / Undo Stage buttons */}
                        {v.status === 'VITALS' && (can('vitals.write') || can('queue.checkin')) && (
                          <button
                            onClick={() => reopenOrStepBack(v, 'WAITING', 'Return to Waiting')}
                            className="w-full py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium inline-flex items-center justify-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Return to Waiting
                          </button>
                        )}
                        {v.status === 'AWAITING_DOCTOR' && (can('vitals.write') || can('queue.checkin')) && (
                          <button
                            onClick={() => reopenOrStepBack(v, 'VITALS', 'Return to Vitals')}
                            className="w-full py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium inline-flex items-center justify-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Return to Vitals
                          </button>
                        )}
                        {v.status === 'COMPLETED' && (can('consultations.write') || can('queue.checkin')) && (
                          <button
                            onClick={() => reopenOrStepBack(v, 'AWAITING_DOCTOR', 'Reopen Visit to Queue')}
                            className="w-full py-1 rounded border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 font-medium inline-flex items-center justify-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Reopen Visit
                          </button>
                        )}
                        {['WAITING', 'VITALS', 'AWAITING_DOCTOR'].includes(v.status) &&
                          (can('queue.checkin') || can('vitals.write')) && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => cancelVisit(v)}
                                className="flex-1 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 font-medium inline-flex items-center justify-center gap-1"
                              >
                                <XCircle className="w-3 h-3" /> Cancel
                              </button>
                              {v.status === 'WAITING' && can('queue.checkin') && (
                                <button
                                  onClick={() => deleteVisit(v)}
                                  title="Delete accidental check-in"
                                  className="px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="text-center text-xs text-slate-400 py-6">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancelled Visits Drawer (if any) */}
      {showCancelled && cancelledVisits.length > 0 && (
        <div className="bg-white rounded-xl border border-rose-200 p-4 space-y-3 text-xs">
          <div className="font-bold text-rose-900">Cancelled Visits on {date} ({cancelledVisits.length})</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {cancelledVisits.map((v) => (
              <div key={v.id} className="p-3 rounded-lg border bg-rose-50/40 flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-900">
                    #{v.queueNumber} · {v.patient.firstName} {v.patient.lastName}
                  </div>
                  <div className="text-[11px] text-rose-700">Reason: {v.cancelReason || 'Cancelled'}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {(can('queue.checkin') || can('vitals.write')) && (
                    <button
                      onClick={() => reopenOrStepBack(v, 'WAITING', 'Restore Cancelled Visit')}
                      className="px-2.5 py-1 rounded-lg bg-teal-600 text-white font-semibold inline-flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                  )}
                  {can('queue.checkin') && (
                    <button
                      onClick={() => deleteVisit(v)}
                      title="Delete empty cancelled visit"
                      className="p-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Check-in modal */}
      <Modal
        open={showCheckIn}
        onClose={() => setShowCheckIn(false)}
        title="Check In Patient to Queue"
        subtitle="Generate a queue token, open today's visit invoice, and notify triage nurses"
      >
        {err && <div className="p-2.5 bg-rose-50 text-rose-700 rounded">{err}</div>}
        <form onSubmit={submitCheckIn} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Patient</label>
            <select
              value={checkInForm.patientId}
              onChange={(e) => setCheckInForm({ ...checkInForm, patientId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.patientNumber} · {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">Assign Doctor (optional)</label>
            <select
              value={checkInForm.doctorId}
              onChange={(e) => setCheckInForm({ ...checkInForm, doctorId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Any available doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">Priority</label>
            <select
              value={checkInForm.priority}
              onChange={(e) => setCheckInForm({ ...checkInForm, priority: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="NORMAL">Normal</option>
              <option value="URGENT">Urgent / Emergency</option>
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">Chief Complaint / Reason</label>
            <input
              value={checkInForm.reason}
              onChange={(e) => setCheckInForm({ ...checkInForm, reason: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowCheckIn(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Generate Queue #</button>
          </div>
        </form>
      </Modal>

      {/* Vitals modal */}
      <Modal
        open={!!vitalsVisit}
        onClose={() => setVitalsVisit(null)}
        title={
          vitalsVisit
            ? `Record Vital Signs — #${vitalsVisit.queueNumber} ${vitalsVisit.patient.firstName} ${vitalsVisit.patient.lastName}`
            : ''
        }
        subtitle="Record triage measurements and move patient to Awaiting Doctor"
      >
        {err && <div className="p-2.5 bg-rose-50 text-rose-700 rounded">{err}</div>}
        <form onSubmit={submitVitals} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="font-semibold block mb-1">Temp (°C)</label>
            <input
              type="number"
              step="0.1"
              value={vitalsForm.temperature}
              onChange={(e) => setVitalsForm({ ...vitalsForm, temperature: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Systolic BP</label>
            <input
              type="number"
              value={vitalsForm.systolic}
              onChange={(e) => setVitalsForm({ ...vitalsForm, systolic: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Diastolic BP</label>
            <input
              type="number"
              value={vitalsForm.diastolic}
              onChange={(e) => setVitalsForm({ ...vitalsForm, diastolic: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Pulse (bpm)</label>
            <input
              type="number"
              value={vitalsForm.pulse}
              onChange={(e) => setVitalsForm({ ...vitalsForm, pulse: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Resp Rate</label>
            <input
              type="number"
              value={vitalsForm.respRate}
              onChange={(e) => setVitalsForm({ ...vitalsForm, respRate: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">SpO2 (%)</label>
            <input
              type="number"
              value={vitalsForm.spo2}
              onChange={(e) => setVitalsForm({ ...vitalsForm, spo2: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Weight (kg)</label>
            <input
              type="number"
              step="0.1"
              value={vitalsForm.weightKg}
              onChange={(e) => setVitalsForm({ ...vitalsForm, weightKg: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Height (cm)</label>
            <input
              type="number"
              value={vitalsForm.heightCm}
              onChange={(e) => setVitalsForm({ ...vitalsForm, heightCm: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div className="col-span-2">
            <label className="font-semibold block mb-1">Send to Doctor</label>
            <select
              value={vitalsForm.doctorId}
              onChange={(e) => setVitalsForm({ ...vitalsForm, doctorId: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            >
              <option value="">Any available doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="font-semibold block mb-1">Nurse Triage Notes</label>
            <input
              value={vitalsForm.notes}
              onChange={(e) => setVitalsForm({ ...vitalsForm, notes: e.target.value })}
              className="w-full px-2.5 py-1.5 border rounded"
            />
          </div>
          <div className="col-span-2 sm:col-span-4 flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setVitalsVisit(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">
              Save Vitals & Notify Doctor
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
