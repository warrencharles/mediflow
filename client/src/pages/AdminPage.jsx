import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Database, Edit3, CalendarClock, Building2, Download, Trash2, FileDown, Search } from 'lucide-react';
import { api, fmtDateTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal, ActionMenu } from '../context/UIContext.jsx';

const ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'PHARMACIST',
  'ACCOUNTANT',
  'LAB_TECHNICIAN',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminPage() {
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const defaultTab = can('users.manage') ? 'users' : 'audit';
  const tab = params.get('tab') || defaultTab;
  const setTab = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const [auditFilter, setAuditFilter] = useState('');
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [backups, setBackups] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [settings, setSettings] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    tin: '',
    receiptFooter: '',
  });

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', role: 'RECEPTIONIST' });
  const [tempCreds, setTempCreds] = useState(null);

  // Doctor schedule editor modal
  const [schedDoc, setSchedDoc] = useState(null);
  const [schedForm, setSchedForm] = useState({
    days: [1, 2, 3, 4, 5, 6],
    startTime: '08:00',
    endTime: '17:00',
    slotMinutes: 30,
  });

  const load = async () => {
    if (can('users.manage')) api('/users?pageSize=100').then((r) => setUsers(r.items));
    if (can('audit.view')) api('/admin/audit?pageSize=100').then((r) => setLogs(r.items));
    if (can('settings.manage')) {
      api('/admin/backups').then(setBackups);
      api('/admin/settings').then((s) =>
        setSettings({
          name: s.name || 'MediFlow Healthcare Group',
          address: s.address || '',
          phone: s.phone || '',
          email: s.email || '',
          tin: s.tin || '',
          receiptFooter: s.receiptFooter || '',
        }),
      );
    }
    if (can('schedules.manage')) {
      api('/appointments/schedules/all').then(setDoctors);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreateUser = () => {
    setEditingUser(null);
    setForm({ fullName: '', email: '', phone: '', role: 'RECEPTIONIST' });
    setShowUserModal(true);
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setForm({ fullName: u.fullName, email: u.email, phone: u.phone || '', role: u.role });
    setShowUserModal(true);
  };

  const saveUser = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api(`/users/${editingUser.id}`, { method: 'PUT', body: form });
        toast(`Updated staff account ${form.fullName}.`);
      } else {
        const r = await api('/users', { method: 'POST', body: form });
        setTempCreds({ email: r.user.email, password: r.temporaryPassword });
        toast(`Created staff account ${r.user.fullName}.`);
      }
      setShowUserModal(false);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const toggleActive = async (u) => {
    const ok = await confirm({
      title: `${u.isActive ? 'Deactivate' : 'Activate'} ${u.fullName}?`,
      message: u.isActive
        ? 'Deactivating immediately revokes all active login sessions for this user while preserving their historical audit records.'
        : 'Reactivates this staff account so they can sign in.',
      confirmText: u.isActive ? 'Deactivate Account' : 'Activate Account',
      danger: u.isActive,
    });
    if (!ok) return;
    await api(`/users/${u.id}/status`, { method: 'POST', body: { isActive: !u.isActive } });
    toast(`Account ${u.isActive ? 'deactivated' : 'activated'}.`);
    load();
  };

  const resetPw = async (u) => {
    const ok = await confirm({
      title: `Reset Password for ${u.fullName}?`,
      message: 'Generates a new one-time temporary password and signs out any existing sessions.',
      confirmText: 'Reset Password',
    });
    if (!ok) return;
    const r = await api(`/users/${u.id}/reset-password`, { method: 'POST' });
    setTempCreds({ email: u.email, password: r.temporaryPassword });
    toast('Temporary password generated.');
  };

  const revokeSessions = async (u) => {
    const ok = await confirm({
      title: `Force Logout ${u.fullName}?`,
      message: 'Immediately revokes all active browser/device sessions for this staff member.',
      confirmText: 'Revoke Sessions',
      danger: true,
    });
    if (!ok) return;
    const r = await api(`/users/${u.id}/sessions/revoke`, { method: 'POST' });
    toast(`Revoked ${r.revoked} active session(s) for ${u.fullName}.`);
  };

  const deleteUser = async (u) => {
    const ok = await confirm({
      title: `Delete Staff Account "${u.fullName}"?`,
      message:
        'Only newly created accounts with zero clinical or financial activity can be permanently deleted. Accounts with historical activity should be Deactivated instead.',
      confirmText: 'Delete Account',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast(`Deleted staff account ${u.fullName}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const triggerBackup = async () => {
    const ok = await confirm({
      title: 'Run Full Database Backup Now?',
      message: 'Creates a compressed snapshot (.gz) of all clinic tables and audit logs.',
      confirmText: 'Create Backup',
    });
    if (!ok) return;
    const b = await api('/admin/backups', { method: 'POST' });
    toast(`Database backup saved: ${b.name}`);
    load();
  };

  const deleteBackup = async (b) => {
    const ok = await confirm({
      title: `Delete Backup "${b.name}"?`,
      message: 'Permanently removes this backup archive from the server disk. This action is logged in the audit trail.',
      confirmText: 'Delete Backup',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
      toast(`Backup ${b.name} deleted.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    await api('/admin/settings', { method: 'PUT', body: settings });
    toast('Clinic settings saved.');
  };

  const openScheduleModal = (doc) => {
    const first = doc.schedules?.[0] || { startTime: '08:00', endTime: '17:00', slotMinutes: 30 };
    const days = doc.schedules?.length ? doc.schedules.map((s) => s.weekday) : [0, 1, 2, 3, 4, 5, 6];
    setSchedDoc(doc);
    setSchedForm({
      days,
      startTime: first.startTime || '08:00',
      endTime: first.endTime || '17:00',
      slotMinutes: first.slotMinutes || 30,
    });
  };

  const saveDoctorSchedule = async (e) => {
    e.preventDefault();
    try {
      const schedules = schedForm.days.map((weekday) => ({
        weekday: Number(weekday),
        startTime: schedForm.startTime,
        endTime: schedForm.endTime,
        slotMinutes: Number(schedForm.slotMinutes),
      }));
      await api(`/appointments/schedules/${schedDoc.id}`, { method: 'PUT', body: { schedules } });
      toast(`Working schedule saved for ${schedDoc.fullName}.`);
      setSchedDoc(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {user.role === 'SUPER_ADMIN'
              ? 'System Administration, Staff Accounts & Backups'
              : 'Clinic Manager Oversight — Audit Logs & Doctor Schedules'}
          </h1>
          <p className="text-xs text-slate-500">
            {user.role === 'SUPER_ADMIN'
              ? 'Manage staff accounts, clinic identity settings, database backups & audit logs'
              : 'Review immutable staff activity logs and customize doctor working schedules'}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {can('users.manage') && (
            <button
              onClick={openCreateUser}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold"
            >
              <UserPlus className="w-4 h-4" /> Register Staff User
            </button>
          )}
          {can('settings.manage') && (
            <button
              onClick={triggerBackup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white font-semibold"
            >
              <Database className="w-4 h-4" /> Run Backup Now
            </button>
          )}
        </div>
      </div>

      {tempCreds && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs flex items-center justify-between">
          <div>
            <div className="font-bold text-amber-900">Temporary Staff Password Generated (copy now):</div>
            <div>
              Email: <b>{tempCreds.email}</b> · Temporary Password:{' '}
              <code className="px-2 py-0.5 rounded bg-white border font-mono font-bold">{tempCreds.password}</code>
            </div>
          </div>
          <button onClick={() => setTempCreds(null)} className="text-amber-800 font-semibold">
            Dismiss ✕
          </button>
        </div>
      )}

      <div className="border-b flex gap-5 text-xs font-semibold overflow-x-auto">
        {can('users.manage') && (
          <button
            onClick={() => setTab('users')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'users' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Staff Accounts ({users.length})
          </button>
        )}
        {can('audit.view') && (
          <button
            onClick={() => setTab('audit')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'audit' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Activity & Audit Logs ({logs.length})
          </button>
        )}
        {can('schedules.manage') && (
          <button
            onClick={() => setTab('schedules')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'schedules' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Doctor Schedules ({doctors.length})
          </button>
        )}
        {can('settings.manage') && (
          <>
            <button
              onClick={() => setTab('settings')}
              className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'settings' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
                }`}
            >
              Clinic Settings
            </button>
            <button
              onClick={() => setTab('backups')}
              className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'backups' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
                }`}
            >
              Database Backups ({backups.length})
            </button>
          </>
        )}
      </div>

      {tab === 'users' && (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Last Login</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-bold">{u.fullName}</td>
                  <td className="py-3 px-4">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 font-semibold">{u.role}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-500">{fmtDateTime(u.lastLoginAt)}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}
                    >
                      {u.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <ActionMenu
                      primary={
                        <button
                          onClick={() => openEditUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 font-semibold"
                        >
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                      }
                      items={[
                        { label: 'Reset Password', tone: 'teal', onClick: () => resetPw(u) },
                        { label: 'Force Logout Sessions', tone: 'amber', onClick: () => revokeSessions(u) },
                        {
                          label: u.isActive ? 'Deactivate Account' : 'Activate Account',
                          danger: u.isActive,
                          onClick: () => toggleActive(u),
                        },
                        u.id !== user.id && {
                          label: 'Delete Unused Account',
                          danger: true,
                          onClick: () => deleteUser(u),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-3">
          <div className="bg-white p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
              <input
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                placeholder="Filter audit log by action, user, entity or details…"
                className="w-full pl-9 pr-3 py-1.5 border rounded-lg outline-none focus:border-teal-500"
              />
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/admin/audit?format=pdf${auditFilter ? `&action=${encodeURIComponent(auditFilter)}` : ''}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold"
              >
                <FileDown className="w-3.5 h-3.5" /> Export PDF
              </a>
              <a
                href={`/api/admin/audit?format=xlsx${auditFilter ? `&action=${encodeURIComponent(auditFilter)}` : ''}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold"
              >
                <FileDown className="w-3.5 h-3.5" /> Export Excel
              </a>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs
                  .filter((l) => {
                    if (!auditFilter.trim()) return true;
                    const q = auditFilter.toLowerCase();
                    return (
                      l.action?.toLowerCase().includes(q) ||
                      l.entity?.toLowerCase().includes(q) ||
                      l.user?.fullName?.toLowerCase().includes(q) ||
                      JSON.stringify(l.details || '').toLowerCase().includes(q)
                    );
                  })
                  .map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-4 whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                      <td className="py-2.5 px-4">{l.user ? `${l.user.fullName} (${l.user.role})` : 'System'}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-teal-800">{l.action}</td>
                      <td className="py-2.5 px-4">
                        {l.entity} #{l.entityId}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px] max-w-md truncate">
                        {l.details ? JSON.stringify(l.details) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'schedules' && (
        <div className="bg-white rounded-xl border divide-y text-xs">
          {doctors.map((doc) => (
            <div key={doc.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-900">{doc.fullName}</div>
                <div className="text-slate-500 mt-0.5">
                  Active days:{' '}
                  {doc.schedules?.length
                    ? doc.schedules
                      .map((s) => `${WEEKDAYS[s.weekday].slice(0, 3)} (${s.startTime}–${s.endTime})`)
                      .join(' · ')
                    : 'No working hours configured'}
                </div>
              </div>
              <button
                onClick={() => openScheduleModal(doc)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
              >
                <CalendarClock className="w-4 h-4" /> Edit Working Schedule
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <form onSubmit={saveSettings} className="bg-white rounded-xl border p-6 max-w-xl space-y-3 text-xs">
          <div className="font-bold text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4 text-teal-600" /> Clinic Identity & Receipt Header
          </div>
          <div>
            <label className="font-semibold block mb-1">Clinic Name *</label>
            <input
              required
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Address</label>
            <input
              value={settings.address}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Phone</label>
              <input
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">TIN Number</label>
              <input
                value={settings.tin}
                onChange={(e) => setSettings({ ...settings, tin: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Printed Receipt Footer</label>
            <input
              value={settings.receiptFooter}
              onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Clinic Settings</button>
        </form>
      )}

      {tab === 'backups' && (
        <div className="bg-white rounded-xl border divide-y text-xs">
          {backups.map((b) => (
            <div key={b.name} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-mono font-bold text-slate-900">{b.name}</div>
                <div className="text-slate-500 mt-0.5">
                  {(b.size / 1024).toFixed(1)} KB · Created {fmtDateTime(b.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/admin/backups/${encodeURIComponent(b.name)}/download`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  type="button"
                  onClick={() => deleteBackup(b)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
          {backups.length === 0 && <div className="p-6 text-center text-slate-400">No backups created yet.</div>}
        </div>
      )}

      {/* Create / Edit Staff User Modal */}
      <Modal
        open={showUserModal}
        onClose={() => setShowUserModal(false)}
        title={editingUser ? `Edit Staff Account — ${editingUser.fullName}` : 'Register New Staff Account'}
        subtitle="Assign staff role and contact details"
      >
        <form onSubmit={saveUser} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Full Name *</label>
            <input
              required
              placeholder="e.g. Dr. Asha Mwinyi"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Staff Email *</label>
            <input
              type="email"
              required
              placeholder="staff@mediflow.co.tz"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Phone</label>
              <input
                placeholder="+255..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Role *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowUserModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">
              {editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Doctor Schedule Modal */}
      <Modal
        open={!!schedDoc}
        onClose={() => setSchedDoc(null)}
        title={schedDoc ? `Edit Working Schedule — ${schedDoc.fullName}` : ''}
        subtitle="Choose working days, shift start/end times, and appointment slot duration"
      >
        <form onSubmit={saveDoctorSchedule} className="space-y-4">
          <div>
            <label className="font-semibold block mb-1.5">Active Working Days</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WEEKDAYS.map((dayName, idx) => {
                const checked = schedForm.days.includes(idx);
                return (
                  <label
                    key={idx}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${checked ? 'bg-teal-50 border-teal-500 font-semibold text-teal-900' : 'bg-white'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSchedForm({
                          ...schedForm,
                          days: e.target.checked
                            ? [...schedForm.days, idx].sort()
                            : schedForm.days.filter((d) => d !== idx),
                        })
                      }
                    />
                    <span>{dayName.slice(0, 3)}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold block mb-1">Start Time *</label>
              <input
                type="time"
                required
                value={schedForm.startTime}
                onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })}
                className="w-full px-2.5 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">End Time *</label>
              <input
                type="time"
                required
                value={schedForm.endTime}
                onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })}
                className="w-full px-2.5 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Slot Duration</label>
              <select
                value={schedForm.slotMinutes}
                onChange={(e) => setSchedForm({ ...schedForm, slotMinutes: e.target.value })}
                className="w-full px-2.5 py-2 border rounded-lg"
              >
                <option value={15}>15 mins</option>
                <option value={20}>20 mins</option>
                <option value={30}>30 mins</option>
                <option value={60}>60 mins</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setSchedDoc(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Schedule</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
