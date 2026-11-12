import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
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
  ChevronDown,
  ChevronRight,
  MessageSquare,
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
    children: [
      { to: '/patients?tab=directory', label: 'Patient Directory' },
      { to: '/patients?tab=new', label: 'New Registration' },
    ],
  },
  {
    to: '/appointments',
    label: 'Appointments',
    icon: Calendar,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'DOCTOR', 'NURSE'],
    children: [
      { to: '/appointments', label: 'Daily Calendar' },
      { to: '/appointments?action=new', label: 'Book Appointment' },
    ],
  },
  {
    to: '/queue',
    label: 'Patient Queue & Vitals',
    icon: ListOrdered,
    roles: ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'NURSE', 'DOCTOR'],
    children: [
      { to: '/queue?status=WAITING', label: 'Waiting Room' },
      { to: '/queue?status=VITALS', label: 'Triage & Vitals' },
      { to: '/queue?status=AWAITING_DOCTOR', label: 'Awaiting Doctor' },
    ],
  },
  {
    to: '/consultations',
    label: 'Medical Consultations',
    icon: Stethoscope,
    roles: ['SUPER_ADMIN', 'DOCTOR'],
    children: [
      { to: '/consultations', label: 'Doctor Queue' },
      { to: '/consultations?tab=history', label: 'Past Consultations' },
    ],
  },
  {
    to: '/pharmacy',
    label: 'Pharmacy & Inventory',
    icon: Pill,
    roles: ['SUPER_ADMIN', 'PHARMACIST', 'MANAGER'],
    children: [
      { to: '/pharmacy?tab=prescriptions', label: 'Pending Prescriptions', countKey: 'pendingRx' },
      { to: '/pharmacy?tab=inventory', label: 'Medicine Stock', countKey: 'medStock' },
      { to: '/pharmacy?tab=alerts', label: 'Low-Stock & Expiry Alerts', countKey: 'alerts' },
      { to: '/pharmacy?tab=suppliers', label: 'Suppliers', countKey: 'suppliers' },
      { to: '/pharmacy?tab=dispensations', label: 'Dispensing History', countKey: 'dispensed' },
    ],
  },
  {
    to: '/lab',
    label: 'Laboratory',
    icon: FlaskConical,
    roles: ['SUPER_ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE'],
    children: [
      { to: '/lab?tab=pending', label: 'Pending Tests', countKey: 'labPending' },
      { to: '/lab?tab=completed', label: 'Completed Results' },
      { to: '/lab?tab=catalog', label: 'Test Catalog' },
    ],
  },
  {
    to: '/billing',
    label: 'Billing & Cashier',
    icon: Receipt,
    roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'MANAGER'],
    children: [
      { to: '/billing?tab=invoices', label: 'Patient Invoices', countKey: 'invoices' },
      { to: '/billing?tab=payments', label: 'Receipts & Payments' },
      { to: '/billing?tab=prices', label: 'Service Tariffs' },
    ],
  },
  {
    to: '/reports',
    label: 'Reports & Exports',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PHARMACIST'],
    children: [
      { to: '/reports?type=revenue', label: 'Revenue Reports' },
      { to: '/reports?type=patients', label: 'Patient Reports' },
      { to: '/reports?type=inventory', label: 'Inventory Reports' },
    ],
  },
  {
    to: '/admin',
    label: 'System & Staff Admin',
    icon: ShieldCheck,
    roles: ['SUPER_ADMIN'],
    children: [
      { to: '/admin?tab=users', label: 'Staff Accounts' },
      { to: '/admin?tab=schedules', label: 'Doctor Schedules' },
      { to: '/admin?tab=audit', label: 'Audit Trail' },
      { to: '/admin?tab=sms', label: 'SMS Gateway & Logs' },
      { to: '/admin?tab=backups', label: 'Database Backups' },
      { to: '/admin?tab=clinic', label: 'Clinic Profile' },
    ],
  },
  {
    to: '/admin',
    label: 'Audit Logs & Schedules',
    icon: FileSearch,
    roles: ['MANAGER'],
    children: [
      { to: '/admin?tab=audit', label: 'Audit Trail' },
      { to: '/admin?tab=schedules', label: 'Doctor Schedules' },
      { to: '/admin?tab=sms', label: 'SMS Notification Logs' },
      { to: '/admin?tab=clinic', label: 'Clinic Information' },
    ],
  },
];

const ROLE_SUBTITLE = {
  SUPER_ADMIN: 'System Administrator · Full System Control, Staff & Backups',
  MANAGER: 'Clinic Manager · Operations, Approvals & Audit Oversight',
  RECEPTIONIST: 'Front Desk · Registration, Appointments & Queue Check-In',
  NURSE: 'Nursing Triage · Patient Queue, Vital Signs & Care',
  DOCTOR: 'Medical Officer · Consultations, Prescriptions & Diagnostics',
  PHARMACIST: 'Pharmacy · Prescriptions, FEFO Stock Control & Suppliers',
  ACCOUNTANT: 'Finance & Cashier · Invoices, Payments, Receipts & Revenue',
  LAB_TECHNICIAN: 'Diagnostics · Lab Queue, Specimen Analysis & Results',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });
  const [showNotifs, setShowNotifs] = useState(false);
  const [counts, setCounts] = useState({});
  const [openMenus, setOpenMenus] = useState({});

  const loadData = async () => {
    try {
      const [n, d] = await Promise.all([
        api('/admin/notifications').catch(() => ({ items: [], unread: 0 })),
        api('/dashboard').catch(() => null),
      ]);
      setNotifs(n);
      if (d) {
        setCounts({
          pendingRx: d.pharmacy?.pendingPrescriptions ?? 0,
          medStock: d.pharmacy?.totalMedicines ?? 12,
          alerts: (d.pharmacy?.lowStockCount || 0) + (d.pharmacy?.expiringCount || 0) + (d.pharmacy?.expiredCount || 0),
          suppliers: d.pharmacy?.supplierCount ?? 3,
          dispensed: d.pharmacy?.dispensationsToday ?? 0,
          labPending: d.lab?.pending ?? 0,
          invoices: d.finance?.outstandingInvoices ?? 0,
        });
      }
    } catch { }
  };

  useEffect(() => {
    loadData();
    const t = setInterval(loadData, 15000);
    return () => clearInterval(t);
  }, []);

  // Automatically keep current section open in sidebar
  useEffect(() => {
    const p = location.pathname;
    setOpenMenus((prev) => ({ ...prev, [p]: true }));
  }, [location.pathname]);

  const toggleMenu = (path, e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenus((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const markRead = async () => {
    await api('/admin/notifications/read-all', { method: 'POST' });
    loadData();
  };

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user?.role));

  return (
    <div className="h-screen overflow-hidden flex bg-slate-50 print:h-auto print:overflow-visible">
      {/* Static Full-Height Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 h-screen bg-slate-900 text-slate-100 flex flex-col shrink-0 transition-transform lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-500 text-slate-950 font-bold flex items-center justify-center text-lg shadow">
              M
            </div>
            <div>
              <div className="font-bold tracking-tight leading-none text-white">MediFlow</div>
              <div className="text-[11px] text-teal-400 mt-0.5">Clinic & Patient Care</div>
            </div>
          </Link>
          <button className="lg:hidden text-slate-400" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isParentActive = location.pathname === item.to;
            const hasChildren = item.children && item.children.length > 0;
            const isOpen = openMenus[item.to] ?? isParentActive;

            return (
              <div key={`${item.to}-${item.label}`} className="space-y-0.5">
                <div
                  className={`flex items-center justify-between rounded-lg transition ${isParentActive && !hasChildren
                      ? 'bg-teal-600 text-white shadow-sm'
                      : isParentActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                >
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => {
                      if (!hasChildren) setSidebarOpen(false);
                      setOpenMenus((prev) => ({ ...prev, [item.to]: true }));
                    }}
                    className="flex-1 flex items-center gap-3 px-3 py-2 text-xs font-semibold"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>

                  {hasChildren && (
                    <button
                      onClick={(e) => toggleMenu(item.to, e)}
                      className="p-2 text-slate-400 hover:text-white transition"
                      title="Toggle submenus"
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                {/* Submenu Children */}
                {hasChildren && isOpen && (
                  <div className="ml-4 pl-2.5 border-l border-slate-700/80 space-y-0.5 pt-0.5 pb-1">
                    {item.children.map((child) => {
                      const currentFull = `${location.pathname}${location.search}`;
                      const isChildActive =
                        currentFull === child.to ||
                        (child.to.includes('tab=') && location.search.includes(child.to.split('?')[1]));
                      const countVal = child.countKey ? counts[child.countKey] : null;

                      return (
                        <Link
                          key={child.to}
                          to={child.to}
                          onClick={() => setSidebarOpen(false)}
                          className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-medium transition ${isChildActive
                              ? 'bg-teal-500/20 text-teal-300 font-bold border border-teal-500/30'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                            }`}
                        >
                          <span className="truncate">
                            {child.label}
                            {countVal != null && (
                              <span
                                className={`ml-1 text-[10px] font-semibold ${isChildActive ? 'text-teal-200' : 'text-slate-500'
                                  }`}
                              >
                                ({countVal})
                              </span>
                            )}
                          </span>
                          {isChildActive && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
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
              <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 text-xs space-y-2">
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="font-bold text-slate-800">Notifications ({notifs.items?.length || 0})</div>
                  {notifs.unread > 0 && (
                    <button onClick={markRead} className="text-teal-600 hover:underline text-[11px] font-semibold">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1.5">
                  {notifs.items?.length === 0 ? (
                    <p className="text-slate-400 py-4 text-center">No notifications</p>
                  ) : (
                    notifs.items?.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (n.link) {
                            navigate(n.link);
                            setShowNotifs(false);
                          }
                        }}
                        className={`p-2 rounded-lg border transition ${n.link ? 'cursor-pointer hover:bg-slate-50' : ''
                          } ${n.unread ? 'bg-teal-50/60 border-teal-200' : 'bg-white border-slate-100'}`}
                      >
                        <div className="font-semibold text-slate-800 flex items-center justify-between">
                          <span>{n.title}</span>
                          <span className="text-[10px] text-slate-400 font-normal">{fmtDateTime(n.createdAt)}</span>
                        </div>
                        <div className="text-slate-600 text-[11px] mt-0.5">{n.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8 print:p-0 print:overflow-visible">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
