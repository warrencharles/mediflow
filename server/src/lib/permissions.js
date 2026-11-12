export const ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'RECEPTIONIST',
  'DOCTOR',
  'NURSE',
  'PHARMACIST',
  'ACCOUNTANT',
  'LAB_TECHNICIAN',
];

const P = {
  // System administration (Super Admin ONLY — staff accounts, passwords, system settings, DB backups)
  'users.manage': [],
  'settings.manage': [],

  // Management & oversight (Clinic Manager + Super Admin)
  'audit.view': ['MANAGER'],
  'dashboard.view': ['MANAGER', 'ACCOUNTANT'],
  'schedules.manage': ['MANAGER'],

  // Patients (Receptionists register/edit; Doctors & Nurses view clinical profile; Manager views oversight)
  'patients.view': ['RECEPTIONIST', 'DOCTOR', 'NURSE', 'MANAGER'],
  'patients.write': ['RECEPTIONIST'],

  // Appointments
  'appointments.view': ['RECEPTIONIST', 'DOCTOR', 'NURSE', 'MANAGER'],
  'appointments.write': ['RECEPTIONIST', 'DOCTOR'],

  // Queue & Vitals
  'queue.view': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'MANAGER'],
  'queue.checkin': ['RECEPTIONIST'],
  'vitals.write': ['NURSE', 'DOCTOR'],
  'queue.call': ['DOCTOR'],

  // Clinical Consultations & Prescriptions
  'consultations.view': ['DOCTOR'],
  'consultations.write': ['DOCTOR'],
  'prescriptions.view': ['DOCTOR', 'PHARMACIST'],

  // Pharmacy & Inventory
  'medicines.view': ['DOCTOR', 'PHARMACIST', 'MANAGER'],
  'pharmacy.manage': ['PHARMACIST'],
  'pharmacy.dispense': ['PHARMACIST'],

  // Laboratory
  'lab.request': ['DOCTOR'],
  'lab.view': ['DOCTOR', 'LAB_TECHNICIAN', 'NURSE'],
  'lab.results': ['LAB_TECHNICIAN', 'NURSE'],
  'lab.catalog': ['LAB_TECHNICIAN', 'MANAGER'],

  // Billing & Payments
  'billing.view': ['ACCOUNTANT', 'MANAGER'],
  'billing.write': ['ACCOUNTANT'],
  'billing.discount.request': ['ACCOUNTANT'],
  'billing.discount.approve': ['MANAGER'],
  'billing.cancel': ['MANAGER', 'ACCOUNTANT'],
  'services.manage': ['MANAGER', 'ACCOUNTANT'],

  // Reports
  'reports.financial': ['ACCOUNTANT', 'MANAGER'],
  'reports.clinical': ['MANAGER'],
  'reports.inventory': ['PHARMACIST', 'MANAGER'],
};

export const PERMISSIONS = Object.keys(P);

export function can(role, permission) {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  const roles = P[permission];
  if (!roles) throw new Error(`Unknown permission: ${permission}`);
  return roles.includes(role);
}

export function permissionsFor(role) {
  return PERMISSIONS.filter((p) => can(role, p));
}
