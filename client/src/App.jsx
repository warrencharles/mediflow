import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
import Layout from './components/Layout.jsx';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, ChangePasswordPage } from './pages/AuthPages.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import { PatientsListPage, PatientProfilePage } from './pages/PatientsPages.jsx';
import AppointmentsPage from './pages/AppointmentsPage.jsx';
import QueuePage from './pages/QueuePage.jsx';
import { ConsultationsListPage, ConsultationDetailPage } from './pages/ConsultationsPages.jsx';
import PharmacyPage from './pages/PharmacyPage.jsx';
import LabPage from './pages/LabPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

const HOME_BY_ROLE = {
  SUPER_ADMIN: '/',
  MANAGER: '/',
  RECEPTIONIST: '/patients',
  NURSE: '/queue',
  DOCTOR: '/queue',
  PHARMACIST: '/pharmacy',
  ACCOUNTANT: '/billing',
  LAB_TECHNICIAN: '/lab',
};

function Protected({ perms = [], children }) {
  const { user, loading, can } = useAuth();
  if (loading) return <div className="p-8 text-sm text-slate-500">Loading MediFlow…</div>;
  if (!user) return <Navigate to="/login" replace />;
  // If a user navigates to a route outside their role, smoothly redirect them to their primary workspace instead of showing a 403 wall
  if (perms.length > 0 && !perms.some((p) => can(p))) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <UIProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route
              path="/"
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="change-password" element={<ChangePasswordPage />} />
              <Route
                path="patients"
                element={
                  <Protected perms={['patients.view']}>
                    <PatientsListPage />
                  </Protected>
                }
              />
              <Route
                path="patients/:id"
                element={
                  <Protected perms={['patients.view']}>
                    <PatientProfilePage />
                  </Protected>
                }
              />
              <Route
                path="appointments"
                element={
                  <Protected perms={['appointments.view']}>
                    <AppointmentsPage />
                  </Protected>
                }
              />
              <Route
                path="queue"
                element={
                  <Protected perms={['queue.view']}>
                    <QueuePage />
                  </Protected>
                }
              />
              <Route
                path="consultations"
                element={
                  <Protected perms={['consultations.view']}>
                    <ConsultationsListPage />
                  </Protected>
                }
              />
              <Route
                path="consultations/:id"
                element={
                  <Protected perms={['consultations.view']}>
                    <ConsultationDetailPage />
                  </Protected>
                }
              />
              <Route
                path="pharmacy"
                element={
                  <Protected perms={['medicines.view', 'prescriptions.view']}>
                    <PharmacyPage />
                  </Protected>
                }
              />
              <Route
                path="pharmacy/prescriptions/:rxId"
                element={
                  <Protected perms={['prescriptions.view']}>
                    <PharmacyPage />
                  </Protected>
                }
              />
              <Route
                path="lab"
                element={
                  <Protected perms={['lab.view']}>
                    <LabPage />
                  </Protected>
                }
              />
              <Route
                path="billing"
                element={
                  <Protected perms={['billing.view']}>
                    <BillingPage />
                  </Protected>
                }
              />
              <Route
                path="billing/invoices/:id"
                element={
                  <Protected perms={['billing.view']}>
                    <BillingPage />
                  </Protected>
                }
              />
              <Route
                path="reports"
                element={
                  <Protected perms={['reports.financial', 'reports.clinical', 'reports.inventory']}>
                    <ReportsPage />
                  </Protected>
                }
              />
              <Route
                path="admin"
                element={
                  <Protected perms={['users.manage', 'audit.view', 'settings.manage']}>
                    <AdminPage />
                  </Protected>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </UIProvider>
    </AuthProvider>
  );
}
