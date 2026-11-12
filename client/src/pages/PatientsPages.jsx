import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, AlertCircle, Edit3, Power, ShieldAlert, Trash2 } from 'lucide-react';
import { api, fmtDate, fmtDateTime, calcAge, fmtTSh } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, UploadProgressBox, Modal, BackButton, ActionMenu } from '../context/UIContext.jsx';

const EMPTY_FORM = {
  firstName: '',
  middleName: '',
  lastName: '',
  gender: 'FEMALE',
  dateOfBirth: '1992-01-15',
  phone: '',
  altPhone: '',
  email: '',
  address: '',
  region: 'Dar es Salaam',
  nationalId: '',
  occupation: '',
  bloodGroup: 'O+',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
  medicalHistory: '',
  allergies: '',
  chronicConditions: '',
};

export function PatientsListPage() {
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [data, setData] = useState({ items: [], total: 0 });
  const [showModal, setShowModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [dupes, setDupes] = useState([]);
  const [duplicateReason, setDuplicateReason] = useState('');
  const [err, setErr] = useState('');

  const load = async (query = q, st = status) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (st) next.set('status', st);
    setParams(next, { replace: true });
    const r = await api(`/patients?q=${encodeURIComponent(query)}&status=${st}`);
    setData(r);
  };

  const deletePatient = async (p) => {
    const ok = await confirm({
      title: `Delete Patient Record "${p.firstName} ${p.lastName}" (${p.patientNumber})?`,
      message:
        'Only accidental registrations with zero clinic visits, consultations, or invoices can be permanently deleted. Patients with medical or financial history should be marked Inactive instead.',
      confirmText: 'Delete Patient',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/patients/${p.id}`, { method: 'DELETE' });
      toast(`Deleted empty patient record ${p.patientNumber}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const openCreate = () => {
    setEditingPatient(null);
    setForm(EMPTY_FORM);
    setDupes([]);
    setErr('');
    setShowModal(true);
  };

  const openEdit = async (p) => {
    const full = await api(`/patients/${p.id}`);
    setEditingPatient(full);
    setForm({
      firstName: full.firstName || '',
      middleName: full.middleName || '',
      lastName: full.lastName || '',
      gender: full.gender || 'FEMALE',
      dateOfBirth: fmtDate(full.dateOfBirth),
      phone: full.phone || '',
      altPhone: full.altPhone || '',
      email: full.email || '',
      address: full.address || '',
      region: full.region || '',
      nationalId: full.nationalId || '',
      occupation: full.occupation || '',
      bloodGroup: full.bloodGroup || '',
      emergencyName: full.emergencyName || '',
      emergencyPhone: full.emergencyPhone || '',
      emergencyRelation: full.emergencyRelation || '',
      medicalHistory: full.medicalHistory || '',
      allergies: full.allergies || '',
      chronicConditions: full.chronicConditions || '',
    });
    setDupes([]);
    setErr('');
    setShowModal(true);
  };

  const submit = async (e, confirmDuplicate = false) => {
    e.preventDefault();
    setErr('');
    try {
      if (editingPatient) {
        await api(`/patients/${editingPatient.id}`, { method: 'PUT', body: form });
        toast(`Patient ${editingPatient.patientNumber} updated successfully.`);
        setShowModal(false);
        load();
      } else {
        const p = await api('/patients', {
          method: 'POST',
          body: { ...form, ...(confirmDuplicate ? { confirmDuplicate: true, duplicateReason } : {}) },
        });
        toast(`Registered ${p.firstName} ${p.lastName} (${p.patientNumber})`, 'success', 'Patient Registered');
        setShowModal(false);
        setForm(EMPTY_FORM);
        setDupes([]);
        navigate(`/patients/${p.id}`);
      }
    } catch (e2) {
      if (e2.status === 409 && e2.details?.duplicates) {
        setDupes(e2.details.duplicates);
      } else {
        setErr(e2.details ? Object.values(e2.details).join(' · ') : e2.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Patient Registry</h1>
          <p className="text-xs text-slate-500">
            Search by patient name, phone number or permanent MediFlow ID ({data.total} registered)
          </p>
        </div>
        {can('patients.write') && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-sm"
          >
            <UserPlus className="w-4 h-4" /> Register New Patient
          </button>
        )}
      </div>

      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="flex flex-col sm:flex-row gap-2 bg-white p-3 rounded-xl border border-slate-200"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by Name, Phone (e.g. 0713...) or ID (e.g. MF-000001)…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active only</option>
          <option value="INACTIVE">Inactive only</option>
        </select>
        <button className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold">Search</button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b text-slate-500 uppercase">
            <tr>
              <th className="py-3 px-4">Patient ID</th>
              <th className="py-3 px-4">Full Name</th>
              <th className="py-3 px-4">Gender / Age</th>
              <th className="py-3 px-4">Phone</th>
              <th className="py-3 px-4">Address</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="py-3 px-4 font-mono font-bold text-teal-700">{p.patientNumber}</td>
                <td className="py-3 px-4 font-semibold text-slate-900">
                  {p.firstName} {p.middleName || ''} {p.lastName}
                  {p.possibleDuplicateOf && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800">
                      Possible duplicate
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {p.gender} · {calcAge(p.dateOfBirth)} ({fmtDate(p.dateOfBirth)})
                </td>
                <td className="py-3 px-4">{p.phone}</td>
                <td className="py-3 px-4 text-slate-600 truncate max-w-xs">{p.address}</td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <ActionMenu
                    primary={
                      <Link
                        to={`/patients/${p.id}`}
                        className="px-3 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold whitespace-nowrap"
                      >
                        Open Profile →
                      </Link>
                    }
                    items={[
                      can('patients.write') && {
                        label: 'Edit Demographics',
                        onClick: () => openEdit(p),
                      },
                      can('patients.write') && {
                        label: 'Delete Unused Record',
                        danger: true,
                        onClick: () => deletePatient(p),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No matching patient records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingPatient ? `Edit Patient ${editingPatient.patientNumber}` : 'Register New Patient'}
        subtitle="Complete demographic, emergency contact, and medical background details"
        maxWidth="max-w-2xl"
      >
        {err && <div className="p-3 rounded-lg bg-rose-50 text-rose-700 text-xs">{err}</div>}

        {dupes.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2 text-xs">
            <div className="font-bold text-amber-900 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> Potential duplicate patient record detected!
            </div>
            <p className="text-amber-800">
              The following existing patient(s) match this name, date of birth, or phone number:
            </p>
            <div className="space-y-1">
              {dupes.map((d) => (
                <div key={d.id} className="flex items-center justify-between bg-white p-2 rounded border">
                  <div>
                    <span className="font-mono font-bold text-teal-700">{d.patientNumber}</span> · {d.firstName}{' '}
                    {d.lastName} ({fmtDate(d.dateOfBirth)}) · {d.phone}
                  </div>
                  <Link
                    to={`/patients/${d.id}`}
                    className="text-teal-700 font-semibold hover:underline"
                    onClick={() => setShowModal(false)}
                  >
                    Use existing →
                  </Link>
                </div>
              ))}
            </div>
            <div className="pt-2 space-y-2">
              <input
                value={duplicateReason}
                onChange={(e) => setDuplicateReason(e.target.value)}
                placeholder="If this is genuinely a different person (e.g. family sharing phone), state reason…"
                className="w-full px-3 py-1.5 border rounded bg-white"
              />
              <button
                type="button"
                onClick={(e) => submit(e, true)}
                className="px-3 py-1.5 rounded bg-amber-700 text-white font-semibold"
              >
                Confirm & Register Anyway (Flagged for Review)
              </button>
            </div>
          </div>
        )}

        <form onSubmit={(e) => submit(e, false)} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="font-semibold block mb-1">First Name *</label>
            <input
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Middle Name</label>
            <input
              value={form.middleName}
              onChange={(e) => setForm({ ...form, middleName: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Last Name *</label>
            <input
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Gender *</label>
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            >
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">Date of Birth *</label>
            <input
              type="date"
              required
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Blood Group</label>
            <select
              value={form.bloodGroup}
              onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            >
              <option value="">Unknown</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">Phone Number *</label>
            <input
              required
              placeholder="0754 123 456"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="font-semibold block mb-1">Residential Address *</label>
            <input
              required
              placeholder="Street / Ward / District"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Emergency Contact Name *</label>
            <input
              required
              value={form.emergencyName}
              onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Emergency Contact Phone *</label>
            <input
              required
              value={form.emergencyPhone}
              onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Relationship</label>
            <input
              placeholder="Spouse / Parent / Sibling"
              value={form.emergencyRelation}
              onChange={(e) => setForm({ ...form, emergencyRelation: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="font-semibold block mb-1">Known Allergies</label>
            <input
              placeholder="e.g. Penicillin, Sulfa, NSAIDs (leave blank if none)"
              value={form.allergies}
              onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="font-semibold block mb-1">Medical History & Chronic Conditions</label>
            <textarea
              rows={2}
              value={form.medicalHistory}
              onChange={(e) => setForm({ ...form, medicalHistory: e.target.value })}
              className="w-full px-2.5 py-2 border rounded-lg"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 rounded-lg border text-slate-600"
            >
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 rounded-lg bg-teal-600 text-white font-semibold">
              {editingPatient ? 'Save Changes' : 'Register Patient'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function PatientProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const [patient, setPatient] = useState(null);
  const tab = params.get('tab') || 'overview';
  const setTab = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const [visits, setVisits] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [labs, setLabs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const load = async () => {
    const p = await api(`/patients/${id}`);
    setPatient(p);
    setEditForm({
      ...p,
      dateOfBirth: fmtDate(p.dateOfBirth),
    });
    const v = await api(`/patients/${id}/visits`);
    setVisits(v);
    if (can('consultations.view')) {
      api(`/patients/${id}/consultations`).then(setConsultations).catch(() => { });
    }
    if (can('vitals.write') || can('consultations.view')) {
      api(`/patients/${id}/vitals`).then(setVitals).catch(() => { });
    }
    if (can('prescriptions.view')) {
      api(`/patients/${id}/prescriptions`).then(setPrescriptions).catch(() => { });
    }
    if (can('lab.view')) {
      api(`/patients/${id}/lab-requests`).then(setLabs).catch(() => { });
    }
    if (can('billing.view')) {
      api(`/patients/${id}/invoices`).then(setInvoices).catch(() => { });
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!patient) return <div className="text-sm text-slate-500">Loading patient profile…</div>;

  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await api(`/patients/${id}`, { method: 'PUT', body: editForm });
      setEditing(false);
      toast('Patient demographics and clinical details updated.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const toggleStatus = async () => {
    const next = patient.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const reason = await confirm({
      title: `${next === 'INACTIVE' ? 'Deactivate' : 'Reactivate'} Patient Record`,
      message:
        next === 'INACTIVE'
          ? 'Medical records are never deleted so clinical and financial history stays auditable. Deactivating prevents new check-ins until reactivated.'
          : 'Reactivate this patient so they can book appointments and check in to the queue.',
      confirmText: next === 'INACTIVE' ? 'Mark Inactive' : 'Mark Active',
      danger: next === 'INACTIVE',
      requireInput: next === 'INACTIVE',
      inputLabel: 'Reason for deactivating patient record *',
      inputPlaceholder: 'e.g. Patient relocated / duplicate merged',
    });
    if (!reason) return;
    await api(`/patients/${id}/status`, {
      method: 'POST',
      body: { status: next, reason: typeof reason === 'string' ? reason : undefined },
    });
    toast(`Patient status changed to ${next}.`);
    load();
  };

  const clearDupeFlag = async () => {
    const ok = await confirm({
      title: 'Clear Duplicate Warning Flag?',
      message: 'Confirm that you have verified this patient is a distinct person.',
      confirmText: 'Clear Flag',
    });
    if (!ok) return;
    await api(`/patients/${id}/clear-duplicate-flag`, { method: 'POST' });
    toast('Duplicate flag cleared.');
    load();
  };

  const quickCheckIn = async () => {
    const reason = await confirm({
      title: `Check In ${patient.firstName} ${patient.lastName} to Queue`,
      message: 'Generates a queue number, opens today’s visit invoice, and notifies the triage nurses.',
      confirmText: 'Check In Now',
      requireInput: true,
      inputLabel: 'Reason for visit / Chief complaint *',
      defaultValue: 'General outpatient consultation',
    });
    if (!reason) return;
    try {
      const v = await api('/queue/check-in', {
        method: 'POST',
        body: { patientId: patient.id, reason },
      });
      toast(`Checked in as Queue #${v.queueNumber}! Sent to Nursing Triage.`, 'success', 'Checked In');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const deletePatientProfile = async () => {
    const ok = await confirm({
      title: `Delete Patient Record "${patient.firstName} ${patient.lastName}" (${patient.patientNumber})?`,
      message:
        'Only accidental registrations with zero clinic visits, consultations, or invoices can be permanently deleted. Patients with medical or financial history should be marked Inactive instead.',
      confirmText: 'Delete Patient',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/patients/${id}`, { method: 'DELETE' });
      toast(`Deleted empty patient record ${patient.patientNumber}.`);
      navigate('/patients');
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <BackButton fallback="/patients" label="Back" />
      </div>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-teal-100 text-teal-800 font-bold text-xl flex items-center justify-center overflow-hidden border-2 border-teal-500 shrink-0">
            {patient.photoPath ? (
              <img
                src={`/api/patients/${patient.id}/photo?t=${patient.updatedAt}`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              `${patient.firstName[0]}${patient.lastName[0]}`
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                {patient.patientNumber}
              </span>
              <h1 className="text-xl font-bold text-slate-900">
                {patient.firstName} {patient.middleName || ''} {patient.lastName}
              </h1>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${patient.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}
              >
                {patient.status}
              </span>
              {patient.possibleDuplicateOf && can('patients.write') && (
                <button
                  onClick={clearDupeFlag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-semibold hover:bg-amber-200"
                >
                  <ShieldAlert className="w-3 h-3" /> Clear Duplicate Flag
                </button>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {patient.gender} · {calcAge(patient.dateOfBirth)} (DOB {fmtDate(patient.dateOfBirth)}) · Blood:{' '}
              <span className="font-semibold text-slate-700">{patient.bloodGroup || '—'}</span> · Phone:{' '}
              <span className="font-semibold text-slate-700">{patient.phone}</span>
            </div>
            {patient.allergies && (
              <div className="mt-1.5 inline-block px-2.5 py-0.5 rounded bg-rose-100 text-rose-800 text-xs font-semibold">
                Allergies: {patient.allergies}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {can('queue.checkin') && patient.status === 'ACTIVE' && (
            <button
              onClick={quickCheckIn}
              className="px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs"
            >
              Check In to Queue
            </button>
          )}
          {can('patients.write') && (
            <>
              <button
                onClick={() => setEditing((s) => !s)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50"
              >
                <Edit3 className="w-3.5 h-3.5" /> {editing ? 'Close Editor' : 'Edit Full Record'}
              </button>
              <button
                onClick={toggleStatus}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50"
              >
                <Power className="w-3.5 h-3.5" /> {patient.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </button>
              <button
                onClick={deletePatientProfile}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                title="Delete if accidentally created with zero history"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Photo Upload with Progress Bar + Full Edit Form inside Portal Modal */}
      <Modal
        open={editing && !!editForm}
        onClose={() => setEditing(false)}
        title={`Edit Patient Profile — ${patient.patientNumber}`}
        subtitle={`${patient.firstName} ${patient.lastName} · Update photo, demographics, contacts & allergies`}
        maxWidth="max-w-2xl"
      >
        {editForm && (
          <div className="space-y-4">
            <div className="pb-4 border-b">
              <div className="font-bold text-slate-800 mb-1">Update Patient Profile Photo</div>
              <p className="text-slate-500 text-[11px] mb-2">JPG, PNG or WEBP up to 2 MB</p>
              <UploadProgressBox
                url={`/patients/${id}/photo`}
                fieldName="photo"
                accept="image/jpeg,image/png,image/webp"
                label="Upload new patient photo…"
                onSuccess={() => {
                  toast('Profile photo uploaded.');
                  load();
                }}
                onError={(e) => toast(e.message, 'error')}
              />
            </div>

            <form onSubmit={saveEdit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold block mb-1">First Name *</label>
                <input
                  required
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Middle Name</label>
                <input
                  value={editForm.middleName || ''}
                  onChange={(e) => setEditForm({ ...editForm, middleName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Last Name *</label>
                <input
                  required
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Gender *</label>
                <select
                  value={editForm.gender}
                  onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                >
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">Date of Birth *</label>
                <input
                  type="date"
                  required
                  value={editForm.dateOfBirth}
                  onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Phone *</label>
                <input
                  required
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="font-semibold block mb-1">Address *</label>
                <input
                  required
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Blood Group</label>
                <select
                  value={editForm.bloodGroup || ''}
                  onChange={(e) => setEditForm({ ...editForm, bloodGroup: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                >
                  <option value="">Unknown</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">Emergency Contact Name *</label>
                <input
                  required
                  value={editForm.emergencyName}
                  onChange={(e) => setEditForm({ ...editForm, emergencyName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Emergency Phone *</label>
                <input
                  required
                  value={editForm.emergencyPhone}
                  onChange={(e) => setEditForm({ ...editForm, emergencyPhone: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Allergies</label>
                <input
                  value={editForm.allergies || ''}
                  onChange={(e) => setEditForm({ ...editForm, allergies: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="font-semibold block mb-1">Medical History & Chronic Conditions</label>
                <textarea
                  rows={2}
                  value={editForm.medicalHistory || ''}
                  onChange={(e) => setEditForm({ ...editForm, medicalHistory: e.target.value })}
                  className="w-full px-2.5 py-1.5 border rounded-lg"
                />
              </div>
              <div className="sm:col-span-3 flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300"
                >
                  Cancel
                </button>
                <button className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold">Save All Changes</button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4 text-xs font-semibold overflow-x-auto">
        {[
          ['overview', 'Demographics & History'],
          ['visits', `Visits (${visits.length})`],
          ...(can('consultations.view') ? [['consultations', `Medical Consultations (${consultations.length})`]] : []),
          ...(can('vitals.write') || can('consultations.view') ? [['vitals', `Vitals (${vitals.length})`]] : []),
          ...(can('prescriptions.view') ? [['prescriptions', `Prescriptions (${prescriptions.length})`]] : []),
          ...(can('lab.view') ? [['labs', `Laboratory (${labs.length})`]] : []),
          ...(can('billing.view') ? [['invoices', `Invoices & Bills (${invoices.length})`]] : []),
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${
              tab === k ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-white rounded-xl border p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Contact & Emergency Information</h3>
              {can('patients.write') && (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border hover:bg-slate-50 font-semibold"
                >
                  <Edit3 className="w-3 h-3" /> Edit Details
                </button>
              )}
            </div>
            <div>
              <span className="text-slate-500">Address:</span> {patient.address} ({patient.region || '—'})
            </div>
            <div>
              <span className="text-slate-500">Emergency Contact:</span> {patient.emergencyName} (
              {patient.emergencyRelation || 'Contact'})
            </div>
            <div>
              <span className="text-slate-500">Emergency Phone:</span> {patient.emergencyPhone}
            </div>
            <div>
              <span className="text-slate-500">National ID:</span> {patient.nationalId || '—'}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Clinical Background</h3>
              {can('patients.write') && (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border hover:bg-slate-50 font-semibold"
                >
                  <Edit3 className="w-3 h-3" /> Edit Clinical Info
                </button>
              )}
            </div>
            <div>
              <span className="text-slate-500">Allergies:</span>{' '}
              <span className="font-semibold text-rose-700">{patient.allergies || 'None recorded'}</span>
            </div>
            <div>
              <span className="text-slate-500">Chronic Conditions:</span> {patient.chronicConditions || 'None recorded'}
            </div>
            <div>
              <span className="text-slate-500">Medical History:</span> {patient.medicalHistory || 'None recorded'}
            </div>
            {patient.stats?.outstandingBalance != null && (
              <div className="pt-2 border-t flex items-center justify-between">
                <div>
                  <span className="text-slate-500">Outstanding Balance:</span>{' '}
                  <span className="font-bold text-rose-700">{fmtTSh(patient.stats.outstandingBalance)}</span>
                </div>
                {can('billing.view') && (
                  <button
                    onClick={() => setTab('invoices')}
                    className="text-teal-700 hover:underline font-semibold"
                  >
                    View Invoices →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'visits' && (
        <div className="bg-white rounded-xl border divide-y text-xs">
          {visits.map((v) => (
            <div key={v.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-bold">
                  {v.visitNumber} · Queue #{v.queueNumber} ({v.queueDate})
                </div>
                <div className="text-slate-500">
                  {v.reason || 'General visit'} · Doctor: {v.assignedDoctor?.fullName || 'Unassigned'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-slate-100 font-semibold">{v.status}</span>
                {['WAITING', 'VITALS', 'AWAITING_DOCTOR', 'IN_CONSULTATION'].includes(v.status) && can('queue.view') && (
                  <Link
                    to="/queue"
                    className="px-3 py-1 rounded-lg bg-teal-600 text-white font-semibold"
                  >
                    Manage in Queue →
                  </Link>
                )}
              </div>
            </div>
          ))}
          {visits.length === 0 && <div className="p-6 text-center text-slate-400">No visits recorded yet.</div>}
        </div>
      )}

      {tab === 'consultations' && (
        <div className="space-y-3 text-xs">
          {consultations.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-900">
                  {fmtDateTime(c.startedAt)} · {c.doctor?.fullName}
                </div>
                <Link
                  to={`/consultations/${c.id}`}
                  className="px-3 py-1 rounded-lg bg-teal-50 text-teal-700 font-semibold hover:bg-teal-100"
                >
                  Open / Edit / Print Summary →
                </Link>
              </div>
              <div>
                <span className="font-semibold">Symptoms:</span> {c.symptoms || '—'}
              </div>
              <div>
                <span className="font-semibold">Diagnosis:</span>{' '}
                <span className="text-teal-800 font-bold">{c.diagnosis || '—'}</span>
              </div>
              <div>
                <span className="font-semibold">Treatment Plan:</span> {c.treatmentPlan || '—'}
              </div>
            </div>
          ))}
          {consultations.length === 0 && (
            <div className="p-6 bg-white rounded-xl border text-center text-slate-400">No consultations recorded.</div>
          )}
        </div>
      )}

      {tab === 'vitals' && (
        <div className="space-y-3 text-xs">
          {can('vitals.write') && (
            <div className="flex justify-end">
              <Link
                to="/queue"
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700"
              >
                Record / Update Vitals in Triage Queue →
              </Link>
            </div>
          )}
          <div className="bg-white rounded-xl border divide-y">
            {vitals.map((v) => (
              <div key={v.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{fmtDateTime(v.createdAt)}</div>
                <div className="flex flex-wrap gap-4">
                  <span>
                    Temp: <b>{v.temperature ?? '—'}°C</b>
                  </span>
                  <span>
                    BP: <b>{v.systolic ?? '—'}/{v.diastolic ?? '—'}</b>
                  </span>
                  <span>
                    Pulse: <b>{v.pulse ?? '—'} bpm</b>
                  </span>
                  <span>
                    SpO2: <b>{v.spo2 ?? '—'}%</b>
                  </span>
                  <span>
                    Weight: <b>{v.weightKg ?? '—'} kg</b> (BMI {v.bmi ?? '—'})
                  </span>
                </div>
              </div>
            ))}
            {vitals.length === 0 && <div className="p-6 text-center text-slate-400">No vital signs recorded yet.</div>}
          </div>
        </div>
      )}

      {tab === 'prescriptions' && (
        <div className="space-y-3 text-xs">
          {prescriptions.map((rx) => (
            <div key={rx.id} className="bg-white rounded-xl border p-4 space-y-2">
              <div className="flex items-center justify-between font-bold">
                <span>
                  {rx.prescriptionNumber} · {fmtDateTime(rx.createdAt)} · {rx.doctor?.fullName}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-teal-700">{rx.status}</span>
                  {['PENDING', 'PARTIALLY_DISPENSED'].includes(rx.status) && can('pharmacy.dispense') && (
                    <Link
                      to={`/pharmacy?rx=${rx.id}`}
                      className="px-2.5 py-1 rounded-lg bg-teal-600 text-white font-semibold"
                    >
                      Dispense in Pharmacy →
                    </Link>
                  )}
                </div>
              </div>
              <ul className="list-disc list-inside text-slate-700">
                {rx.items.map((it) => (
                  <li key={it.id}>
                    <b>{it.medicine.name}</b> — {it.dosage}, {it.frequency} ({it.quantityDispensed}/{it.quantity}{' '}
                    {it.medicine.unit} dispensed)
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {prescriptions.length === 0 && (
            <div className="p-6 bg-white rounded-xl border text-center text-slate-400">No prescriptions recorded.</div>
          )}
        </div>
      )}

      {tab === 'labs' && (
        <div className="bg-white rounded-xl border divide-y text-xs">
          {labs.map((l) => (
            <div key={l.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-bold">
                  {l.requestNumber} · {l.labTest.name}
                </div>
                <div className="text-slate-500">
                  Result: <b>{l.resultValue || l.result || 'Pending'}</b>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold">{l.status}</span>
                {can('lab.view') && (
                  <Link
                    to="/lab"
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold"
                  >
                    {l.status === 'COMPLETED' ? 'View / Print Report →' : 'Enter Result in Lab →'}
                  </Link>
                )}
              </div>
            </div>
          ))}
          {labs.length === 0 && <div className="p-6 text-center text-slate-400">No laboratory requests recorded.</div>}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="bg-white rounded-xl border divide-y text-xs">
          {invoices.map((inv) => (
            <div key={inv.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <Link to={`/billing?invoice=${inv.id}`} className="font-bold text-teal-700 hover:underline">
                  {inv.invoiceNumber}
                </Link>
                <div className="text-slate-500">
                  {fmtDateTime(inv.createdAt)} · Status: {inv.status}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div>
                    Total: <b>{fmtTSh(inv.total)}</b> · Paid: {fmtTSh(inv.amountPaid)}
                  </div>
                  <div className="text-rose-700 font-bold">Balance: {fmtTSh(inv.balance)}</div>
                </div>
                {can('billing.view') && (
                  <Link
                    to={`/billing?invoice=${inv.id}`}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold"
                  >
                    {inv.balance > 0 ? 'Collect Payment →' : 'Open / Receipt →'}
                  </Link>
                )}
              </div>
            </div>
          ))}
          {invoices.length === 0 && <div className="p-6 text-center text-slate-400">No invoices recorded.</div>}
        </div>
      )}
    </div>
  );
}
