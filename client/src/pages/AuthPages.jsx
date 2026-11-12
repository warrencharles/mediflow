import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

const DEMO_ACCOUNTS = [
  { role: 'Super Admin', email: 'admin@mediflow.co.tz' },
  { role: 'Manager', email: 'manager@mediflow.co.tz' },
  { role: 'Receptionist', email: 'reception1@mediflow.co.tz' },
  { role: 'Nurse', email: 'nurse.grace@mediflow.co.tz' },
  { role: 'Doctor', email: 'dr.massawe@mediflow.co.tz' },
  { role: 'Pharmacist', email: 'pharmacist@mediflow.co.tz' },
  { role: 'Accountant', email: 'accountant@mediflow.co.tz' },
  { role: 'Lab Tech', email: 'lab@mediflow.co.tz' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@mediflow.co.tz');
  const [password, setPassword] = useState('MediFlow2026!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email, password);
      if (u.mustChangePassword) navigate('/change-password');
      else navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-teal-600 text-white font-bold text-xl flex items-center justify-center">
            M
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">MediFlow Clinic System</h1>
            <p className="text-xs text-slate-500">Healthcare Operations & Patient Care Portal</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Staff Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <Link to="/forgot-password" className="text-teal-700 hover:underline font-medium">
              Forgot password?
            </Link>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Quick Role Switcher (Password: MediFlow2026!)
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email);
                  setPassword('MediFlow2026!');
                }}
                className={`text-left px-2.5 py-1.5 rounded border text-xs transition ${
                  email === a.email
                    ? 'border-teal-600 bg-teal-50 text-teal-900 font-semibold'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <div>{a.role}</div>
                <div className="text-[10px] text-slate-400 truncate">{a.email}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(r.message);
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 space-y-4">
        <h1 className="text-lg font-bold">Reset your password</h1>
        {sent ? (
          <div className="p-3 rounded bg-teal-50 text-teal-800 text-sm">{sent}</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {err && <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded">{err}</div>}
            <input
              type="email"
              required
              placeholder="Enter your staff email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            <button className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold">
              Send Reset Link
            </button>
          </form>
        )}
        <Link to="/login" className="block text-xs text-teal-700 hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') || '');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setMsg('Password reset complete. Redirecting to login…');
      setTimeout(() => navigate('/login'), 1500);
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 space-y-4">
        <h1 className="text-lg font-bold">Choose a new password</h1>
        {msg && <div className="p-3 bg-teal-50 text-teal-800 text-sm rounded">{msg}</div>}
        {err && <div className="p-3 bg-rose-50 text-rose-700 text-sm rounded">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          <input
            placeholder="Reset token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="password"
            placeholder="New password (min 8 chars, letters & numbers)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <button className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold">
            Save New Password
          </button>
        </form>
      </div>
    </div>
  );
}

export function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      await refresh();
      setOk(true);
      setTimeout(() => navigate('/'), 1000);
    } catch (e2) {
      setErr(e2.details ? Object.values(e2.details).join(', ') : e2.message);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow-sm border border-slate-200 mt-8">
      <h1 className="text-lg font-bold mb-1">Change Password</h1>
      {user?.mustChangePassword && (
        <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded mb-3">
          You signed in with a temporary password. Please set a personal password to continue.
        </p>
      )}
      {err && <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded mb-3">{err}</div>}
      {ok && <div className="p-2.5 bg-teal-50 text-teal-700 text-xs rounded mb-3">Password updated!</div>}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">Current password</label>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">New password (min 8 chars, letters & numbers)</label>
          <input
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <button className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold">
          Update Password
        </button>
      </form>
    </div>
  );
}

