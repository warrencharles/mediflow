import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Calendar,
  ListOrdered,
  Stethoscope,
  Pill,
  FlaskConical,
  Receipt,
  BarChart3,
  ShieldCheck,
  FileSearch,
  Bell,
  LogOut,
  Menu,
  X,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, fmtDateTime } from '../lib/api.js';

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'PHARMACIST', 'ACCOUNTANT', 'LAB_TECHNICIAN'],
  },
  {
    to: '/patients',
    label: 'Patient Registry',
    icon: Users,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'DOCTOR', 'NURSE'],
  },
  {
    to: '/appointments',
    label: 'Appointments',
    icon: Calendar,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'DOCTOR', 'NURSE'],
  },
  {
    to: '/queue',
    label: 'Patient Queue & Vitals',
    icon: ListOrdered,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'NURSE', 'DOCTOR'],
  },
  {
    to: '/consultations',
    label: 'Medical Consultations',
    icon: Stethoscope,
    roles: ['SUPER_ADMIN', 'DOCTOR'],
  },
  {
    to: '/pharmacy',
    label: 'Pharmacy & Inventory',
    icon: Pill,
    roles: ['SUPER_ADMIN', 'PHARMACIST', 'MANAGER'],
  },
  {
    to: '/lab',
    label: 'Laboratory',
    icon: FlaskConical,
    roles: ['SUPER_ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE'],
  },
  {
    to: '/billing',
    label: 'Billing & Cashier',
    icon: Receipt,
    roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'MANAGER'],
  },
  {
    to: '/reports',
    label: 'Reports & Exports',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PHARMACIST'],
  },
  {
    to: '/admin',
    label: 'System & Staff Admin',
    icon: ShieldCheck,
    roles: ['SUPER_ADMIN'],
  },
  {
    to: '/admin',
    label: 'Audit Logs & Schedules',
    icon: FileSearch,
    roles: ['MANAGER'],
  },
];

const ROLE_SUBTITLE = {
  SUPER_ADMIN: 'System Administrator · Staff Accounts, Clinic Settings & Backups',
  MANAGER: 'Clinic Manager · Operations, Discount Approvals, Schedules & Audit Oversight',
  RECEPTIONIST: 'Front Desk · Patient Registration, Appointments & Queue Check-In',
  NURSE: 'Nursing Triage · Patient Queue, Vital Signs & Lab Support',
  DOCTOR: 'Medical Officer · Consultations, Prescriptions & Lab Orders',
  PHARMACIST: 'Pharmacy · Prescription Dispensing, Batches & Stock Control',
  ACCOUNTANT: 'Finance & Cashier · Invoices, Payments, Receipts & Revenue',
  LAB_TECHNICIAN: 'Diagnostics · Lab Queue, Result Entry & Reports',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });
  const [showNotifs, setShowNotifs] = useState(false);

  const loadNotifs = async () => {
    try {
      const r = await api('/admin/notifications');
      setNotifs(r);
    } catch {}
  };

  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 12000);
    return () => clearInterval(t);
  }, []);

  const markRead = async () => {
    await api('/admin/notifications/read-all', { method: 'POST' });
    loadNotifs();
  };

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user?.role));

  return (
    <div className="h-screen overflow-hidden flex bg-slate-50 print:h-auto print:overflow-visible">
      {/* Static Full-Height Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 h-screen bg-slate-900 text-slate-100 flex flex-col shrink-0 transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-500 text-slate-950 font-bold flex items-center justify-center text-lg shadow">
              M
            </div>
            <div>
              <div className="font-bold tracking-tight leading-none text-white">MediFlow</div>
              <div className="text-[11px] text-teal-400 mt-0.5">Clinic & Patient Care</div>
            </div>
          </div>
          <button className="lg:hidden text-slate-400" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={`${item.to}-${item.label}`}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${
                    isActive
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Pinned bottom user card + Logout */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 text-xs space-y-2 shrink-0">
          <div className="font-semibold text-white truncate">{user?.fullName}</div>
          <div className="inline-block px-2 py-0.5 rounded bg-teal-500/20 border border-teal-500/30 text-teal-300 text-[11px] font-bold">
            {user?.role?.replace('_', ' ')}
          </div>
          <div className="flex items-center gap-2 pt-1.5">
            <button
              onClick={() => navigate('/change-password')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
            >
              <KeyRound className="w-3.5 h-3.5" /> Password
            </button>
            <button
              onClick={logout}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition shadow-sm"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Scrollable Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden print:h-auto print:overflow-visible">
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between shrink-0 z-30">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-lg hover:bg-slate-100" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <div className="text-xs font-bold text-slate-800">
                {ROLE_SUBTITLE[user?.role] || 'MediFlow Healthcare Group'}
              </div>
              <div className="text-[11px] text-slate-400 hidden sm:block">
                Dar es Salaam, Tanzania · Signed in as {user?.email}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 relative">
            <button
              onClick={() => setShowNotifs((s) => !s)}
              className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {notifs.unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {notifs.unread}
                </span>
              )}
            </button>

            <button
              onClick={logout}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-xs font-semibold text-slate-600 transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </button>

            {showNotifs && (
              <div className="animate-modal absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wider text-slate-600">Notifications</span>
                  <button onClick={markRead} className="text-xs text-teal-600 hover:underline font-medium">
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifs.items.length === 0 ? (
                    <div className="p-4 text-xs text-slate-400 text-center">No notifications yet</div>
                  ) : (
                    notifs.items.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          setShowNotifs(false);
                          if (n.link) navigate(n.link);
                        }}
                        className={`p-3 text-xs cursor-pointer hover:bg-slate-50 ${n.unread ? 'bg-teal-50/50' : ''}`}
                      >
                        <div className="font-semibold text-slate-800">{n.title}</div>
                        <div className="text-slate-600 mt-0.5">{n.message}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{fmtDateTime(n.createdAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8 print:overflow-visible print:p-0">
          <div className="max-w-7xl w-full mx-auto animate-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
