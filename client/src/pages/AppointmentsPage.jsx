import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Calendar as CalIcon, Plus, CalendarClock } from 'lucide-react';
import { api, todayStr, fmtDateTime, fmtDate } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal, ActionMenu } from '../context/UIContext.jsx';

export default function AppointmentsPage() {
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || todayStr());
  const [doctorId, setDoctorId] = useState(params.get('doctorId') || '');
  const [doctors, setDoctors] = useState([]);
  const [items, setItems] = useState([]);
  const [slots, setSlots] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [patients, setPatients] = useState([]);
  const [form, setForm] = useState({
    patientId: '',
    doctorId: '',
    date: todayStr(),
    startTime: '10:00',
    durationMinutes: 30,
    reason: '',
  });
  const [err, setErr] = useState('');

  const load = async () => {
    const next = new URLSearchParams();
    if (date) next.set('date', date);
    if (doctorId) next.set('doctorId', doctorId);
    setParams(next, { replace: true });
    const r = await api(`/appointments?date=${date}${doctorId ? `&doctorId=${doctorId}` : ''}`);
    setItems(r.items);
  };

  useEffect(() => {
    api('/users/directory?role=DOCTOR').then((d) => {
      setDoctors(d);
      if (d[0]) setForm((f) => ({ ...f, doctorId: user.role === 'DOCTOR' ? user.id : d[0].id }));
    });
    api('/patients?pageSize=100').then((r) => {
      setPatients(r.items);
      if (r.items[0]) setForm((f) => ({ ...f, patientId: r.items[0].id }));
    });
  }, []);

  useEffect(() => {
    load();
  }, [date, doctorId]);

  useEffect(() => {
    if (form.doctorId && form.date) {
      api(`/appointments/availability?doctorId=${form.doctorId}&date=${form.date}`)
        .then((r) => setSlots(r.slots || []))
        .catch(() => setSlots([]));
    }
  }, [form.doctorId, form.date]);

  const openBook = () => {
    setRescheduleTarget(null);
    setErr('');
    setShowModal(true);
  };

  const openReschedule = (a) => {
    setRescheduleTarget(a);
    setForm({
      patientId: a.patient.id,
      doctorId: a.doctor.id,
      date: fmtDate(a.startAt),
      startTime: new Date(a.startAt).toTimeString().slice(0, 5),
      durationMinutes: 30,
      reason: a.reason,
    });
    setErr('');
    setShowModal(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (rescheduleTarget) {
        await api(`/appointments/${rescheduleTarget.id}/reschedule`, {
          method: 'POST',
          body: {
            doctorId: Number(form.doctorId),
            date: form.date,
            startTime: form.startTime,
            durationMinutes: Number(form.durationMinutes),
            reason: form.reason,
          },
        });
        toast('Appointment rescheduled successfully.');
      } else {
        await api('/appointments', {
          method: 'POST',
          body: {
            ...form,
            patientId: Number(form.patientId),
            doctorId: Number(form.doctorId),
            durationMinutes: Number(form.durationMinutes),
          },
        });
        toast('Appointment booked.');
      }
      setShowModal(false);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const changeStatus = async (a, status) => {
    let reason;
    if (status === 'CANCELLED') {
      reason = await confirm({
        title: `Cancel Appointment for ${a.patient.firstName} ${a.patient.lastName}?`,
        message: 'Cancelled appointments remain in the audit history and free up the doctor time slot.',
        confirmText: 'Cancel Appointment',
        danger: true,
        requireInput: true,
        inputLabel: 'Cancellation Reason *',
        inputPlaceholder: 'e.g. Patient requested to cancel by phone',
      });
      if (!reason) return;
    } else if (status === 'NO_SHOW') {
      const ok = await confirm({
        title: 'Mark Appointment as No-Show?',
        message: `${a.patient.firstName} ${a.patient.lastName} did not attend at the scheduled time.`,
        confirmText: 'Mark No-Show',
        danger: true,
      });
      if (!ok) return;
    } else if (status === 'CONFIRMED') {
      const ok = await confirm({
        title: `Confirm Appointment for ${a.patient.firstName} ${a.patient.lastName}?`,
        message: `Confirms booking with ${a.doctor.fullName} at ${fmtDateTime(a.startAt)}.`,
        confirmText: 'Confirm Booking',
      });
      if (!ok) return;
    } else if (status === 'SCHEDULED') {
      const ok = await confirm({
        title: `Reopen / Undo ${a.status} Appointment?`,
        message: `Restores ${a.patient.firstName} ${a.patient.lastName}'s appointment back to SCHEDULED if the time slot is still available.`,
        confirmText: 'Reopen Appointment',
      });
      if (!ok) return;
    }
    try {
      await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status, reason } });
      toast(`Appointment marked ${status}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const sendSmsReminder = async (a) => {
    try {
      await api(`/appointments/${a.id}/send-sms`, { method: 'POST' });
      toast(`SMS reminder sent to ${a.patient.firstName} (${a.patient.phone})`);
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteAppointment = async (a) => {
    const ok = await confirm({
      title: `Delete Appointment for ${a.patient.firstName} ${a.patient.lastName}?`,
      message:
        'Permanently deletes this un-checked-in appointment slot and records the deletion in the audit log.',
      confirmText: 'Delete Booking',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/appointments/${a.id}`, { method: 'DELETE' });
      toast('Appointment deleted.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const checkInFromAppt = async (a) => {
    const ok = await confirm({
      title: `Check In ${a.patient.firstName} ${a.patient.lastName} to Queue?`,
      message: `Generates a queue token, assigns ${a.doctor.fullName}, opens today's visit invoice, and notifies nursing triage.`,
      confirmText: 'Check In Patient',
    });
    if (!ok) return;
    try {
      const v = await api('/queue/check-in', {
        method: 'POST',
        body: { patientId: a.patient.id, appointmentId: a.id, doctorId: a.doctor.id, reason: a.reason },
      });
      toast(`Checked in as Queue #${v.queueNumber} and assigned to ${a.doctor.fullName}.`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Appointments & Doctor Availability</h1>
          <p className="text-xs text-slate-500">
            Book, confirm, reschedule, check in, or cancel appointments with automatic conflict prevention
          </p>
        </div>
        {can('appointments.write') && (
          <button
            onClick={openBook}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4" /> Book Appointment
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white p-3 rounded-xl border flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <CalIcon className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2.5 py-1.5 border rounded-lg"
          />
        </div>
        {user.role !== 'DOCTOR' && (
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="px-3 py-1.5 border rounded-lg"
          >
            <option value="">All Doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b text-slate-500 uppercase">
            <tr>
              <th className="py-3 px-4">Time</th>
              <th className="py-3 px-4">Patient</th>
              <th className="py-3 px-4">Doctor</th>
              <th className="py-3 px-4">Reason</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="py-3 px-4 font-semibold">{fmtDateTime(a.startAt)}</td>
                <td className="py-3 px-4">
                  <Link to={`/patients/${a.patient.id}`} className="font-semibold text-slate-900 hover:text-teal-700 hover:underline">
                    {a.patient.firstName} {a.patient.lastName}
                  </Link>
                  <div className="text-slate-400 font-mono">{a.patient.patientNumber}</div>
                </td>
                <td className="py-3 px-4">{a.doctor.fullName}</td>
                <td className="py-3 px-4 text-slate-600">
                  {a.reason}
                  {a.cancelReason && <div className="text-rose-600 text-[11px]">Cancelled: {a.cancelReason}</div>}
                </td>
                <td className="py-3 px-4">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 font-bold text-[10px]">{a.status}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <ActionMenu
                    primary={
                      ['SCHEDULED', 'CONFIRMED'].includes(a.status) && can('queue.checkin') ? (
                        <button
                          onClick={() => checkInFromAppt(a)}
                          className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                        >
                          Check In
                        </button>
                      ) : ['CANCELLED', 'NO_SHOW'].includes(a.status) && can('appointments.write') ? (
                        <button
                          onClick={() => changeStatus(a, 'SCHEDULED')}
                          className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 font-semibold"
                        >
                          Undo / Reopen
                        </button>
                      ) : null
                    }
                    items={[
                      a.status === 'SCHEDULED' &&
                      can('appointments.write') && {
                        label: 'Confirm Booking',
                        tone: 'teal',
                        onClick: () => changeStatus(a, 'CONFIRMED'),
                      },
                      a.patient?.phone &&
                      ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
                      can('appointments.write') && {
                        label: 'Send SMS Reminder',
                        tone: 'teal',
                        onClick: () => sendSmsReminder(a),
                      },
                      ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
                      can('appointments.write') && {
                        label: 'Reschedule Slot',
                        onClick: () => openReschedule(a),
                      },
                      ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
                      can('appointments.write') && {
                        label: 'Mark No-Show',
                        tone: 'amber',
                        onClick: () => changeStatus(a, 'NO_SHOW'),
                      },
                      ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
                      can('appointments.write') && {
                        label: 'Cancel Appointment',
                        danger: true,
                        onClick: () => changeStatus(a, 'CANCELLED'),
                      },
                      !['CHECKED_IN', 'COMPLETED'].includes(a.status) &&
                      can('appointments.write') && {
                        label: 'Delete Booking',
                        danger: true,
                        onClick: () => deleteAppointment(a),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No appointments scheduled for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={
          rescheduleTarget
            ? `Reschedule Appointment — ${rescheduleTarget.patient.firstName} ${rescheduleTarget.patient.lastName}`
            : 'Book Doctor Appointment'
        }
        subtitle="Select doctor, date and an available conflict-free time slot"
      >
        {err && <div className="p-2.5 rounded bg-rose-50 text-rose-700">{err}</div>}
        <form onSubmit={submitForm} className="space-y-3">
          {!rescheduleTarget && (
            <div>
              <label className="font-semibold block mb-1">Patient</label>
              <select
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNumber} · {p.firstName} {p.lastName} ({p.phone})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Doctor</label>
              <select
                value={form.doctorId}
                onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Available Time Slots (click to select)</label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 border rounded-lg bg-slate-50">
              {slots.map((s) => (
                <button
                  type="button"
                  key={s.time}
                  disabled={!s.available}
                  onClick={() => setForm({ ...form, startTime: s.time })}
                  className={`px-2 py-1 rounded text-[11px] font-semibold ${form.startTime === s.time
                      ? 'bg-teal-600 text-white'
                      : s.available
                        ? 'bg-white border hover:border-teal-500'
                        : 'bg-slate-200 text-slate-400 line-through cursor-not-allowed'
                    }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">
              {rescheduleTarget ? 'Reason for Rescheduling' : 'Reason for Visit *'}
            </label>
            <input
              required={!rescheduleTarget}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">
              {rescheduleTarget ? 'Save New Slot' : 'Save Booking'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
