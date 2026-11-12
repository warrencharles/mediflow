# MediFlow REST API Documentation

Base URL: `/api`  
Authentication: `httpOnly` session cookie (`mf_session`) set on `POST /api/auth/login` or `Authorization: Bearer <token>` header.  
All error responses follow `{ "error": "Human-readable message", "details": { ...optionalFieldErrors } }`.

---

## 1. Authentication (`/api/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticate with `{ email, password }`. Locks account for 15 min after 5 failed attempts. |
| `POST` | `/api/auth/logout` | Authenticated | Revokes the current session in the database and clears the cookie. |
| `GET` | `/api/auth/me` | Authenticated | Returns the current user profile and effective permissions array. |
| `POST` | `/api/auth/forgot-password` | Public | Generates a 30-minute single-use reset token and sends reset link. |
| `POST` | `/api/auth/reset-password` | Public | Completes password reset with `{ token, password }` and revokes old sessions. |
| `POST` | `/api/auth/change-password` | Authenticated | Changes password with `{ currentPassword, newPassword }`. |
| `GET` | `/api/auth/sessions` | Authenticated | Lists active sessions for the signed-in user. |

---

## 2. User & Role Management (`/api/users`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/directory?role=DOCTOR` | Authenticated | Active staff directory for doctor pickers. |
| `GET` | `/api/users` | `users.manage` | Paginated staff list (`q`, `role`, `status`). |
| `POST` | `/api/users` | `users.manage` | Register staff member; returns one-time `temporaryPassword` with `mustChangePassword=true`. |
| `PUT` | `/api/users/:id` | `users.manage` | Update user name, email, phone, or role. |
| `POST` | `/api/users/:id/status` | `users.manage` | Activate/deactivate account (`{ isActive }`); deactivating immediately revokes all sessions. |
| `POST` | `/api/users/:id/reset-password` | `users.manage` | Generates a new temporary password and revokes sessions. |
| `POST` | `/api/users/:id/sessions/revoke` | `users.manage` | Force-sign-out all sessions of a user. |

---

## 3. Patient Management (`/api/patients`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/patients?q=&status=` | `patients.view` | Search patients by name, phone number, or permanent ID (`MF-000001`). |
| `POST` | `/api/patients/check-duplicates` | `patients.write` | Pre-check for potential duplicate registrations. |
| `POST` | `/api/patients` | `patients.write` | Register patient; automatically assigns `MF-XXXXXX` and blocks accidental duplicates with `409 Conflict` unless `confirmDuplicate: true` + `duplicateReason` is supplied. |
| `GET` | `/api/patients/:id` | `patients.view` | Complete patient demographics, stats, and duplicate link. |
| `PUT` | `/api/patients/:id` | `patients.write` | Update patient record (writes field-level diff to `AuditLog`). |
| `POST` | `/api/patients/:id/status` | `patients.write` | Mark patient `ACTIVE` or `INACTIVE`. |
| `POST` | `/api/patients/:id/photo` | `patients.write` | Upload profile photo (`multipart/form-data`, `photo`). |
| `GET` | `/api/patients/:id/visits` | `patients.view` | Patient visit history. |
| `GET` | `/api/patients/:id/consultations` | `consultations.view` | Patient medical consultations (denied to receptionists/pharmacists/accountants). |
| `GET` | `/api/patients/:id/vitals` | `vitals.write` or `consultations.view` | Patient recorded vital signs. |
| `GET` | `/api/patients/:id/prescriptions` | `prescriptions.view` | Patient prescriptions history. |
| `GET` | `/api/patients/:id/lab-requests` | `lab.view` | Patient laboratory history. |
| `GET` | `/api/patients/:id/invoices` | `billing.view` | Patient billing & payment history. |

---

## 4. Appointments (`/api/appointments`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/appointments?date=&doctorId=` | `appointments.view` | List appointments by date, range, doctor, patient, or status. |
| `GET` | `/api/appointments/availability?doctorId=&date=` | `appointments.view` | Compute free/taken time slots from `DoctorSchedule` and existing bookings. |
| `POST` | `/api/appointments` | `appointments.write` | Book appointment; advisory lock prevents overlapping doctor or patient bookings. |
| `POST` | `/api/appointments/:id/reschedule` | `appointments.write` | Reschedule date/time/doctor with conflict check. |
| `POST` | `/api/appointments/:id/status` | `appointments.write` | Transition status (`SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). |
| `GET` | `/api/appointments/schedules/all` | `appointments.view` | View weekly working hours for all doctors. |
| `PUT` | `/api/appointments/schedules/:doctorId` | `schedules.manage` | Update a doctor's weekly working hours. |

---

## 5. Patient Queue & Vital Signs (`/api/queue`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/queue?date=` | `queue.view` | Live queue for the day (`WAITING` → `VITALS` → `AWAITING_DOCTOR` → `IN_CONSULTATION` → `COMPLETED`). |
| `POST` | `/api/queue/check-in` | `queue.checkin` | Generates daily queue number, creates `Visit`, opens visit invoice with consultation charge, and notifies nurses. |
| `POST` | `/api/queue/:id/start-vitals` | `vitals.write` | Moves patient from `WAITING` to `VITALS`. |
| `POST` | `/api/queue/:id/vitals` | `vitals.write` | Records temperature, BP, pulse, respRate, SpO2, weight, height, auto-computes BMI, moves status to `AWAITING_DOCTOR`, and notifies doctor. |
| `POST` | `/api/queue/call-next` | `queue.call` | Calls the next waiting patient (or specific `visitId`), sets `IN_CONSULTATION`, and opens a `Consultation` record. |
| `POST` | `/api/queue/:id/cancel` | `queue.checkin` or `vitals.write` | Cancels visit with reason and voids unpaid check-in fee. |

---

## 6. Medical Consultations (`/api/consultations`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/consultations` | `consultations.view` | Search/filter consultations. |
| `POST` | `/api/consultations` | `consultations.write` | Start a standalone consultation. |
| `GET` | `/api/consultations/:id` | `consultations.view` | Full consultation record with vitals, prescriptions, and lab results (logged to `AuditLog`). |
| `PUT` | `/api/consultations/:id` | `consultations.write` | Record symptoms, examination, diagnosis, treatment plan, notes, and follow-up date. Completed records require `amendmentReason`. |
| `POST` | `/api/consultations/:id/complete` | `consultations.write` | Requires diagnosis; marks consultation and linked visit/appointment `COMPLETED`. |
| `POST` | `/api/consultations/:id/prescriptions` | `consultations.write` | Creates multi-medicine prescription (`RX-YYYY-XXXXXX`) and notifies Pharmacist. |
| `POST` | `/api/consultations/:id/lab-requests` | `lab.request` | Orders one or more lab tests (`LAB-YYYY-XXXXXX`), adds lab charges to the visit invoice, and notifies Lab. |

---

## 7. Pharmacy & Inventory (`/api/pharmacy`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/pharmacy/medicines` | `medicines.view` | List medicines with live non-expired stock on hand, next expiry, and low-stock flag. |
| `POST` | `/api/pharmacy/medicines` | `pharmacy.manage` | Register new medicine in formulary. |
| `PUT` | `/api/pharmacy/medicines/:id` | `pharmacy.manage` | Update medicine details, selling price, or reorder level. |
| `POST` | `/api/pharmacy/stock-in` | `pharmacy.manage` | Receive medicine batch (`batchNumber`, `expiryDate`, `quantity`, `purchasePrice`, `supplierId`). |
| `POST` | `/api/pharmacy/adjustments` | `pharmacy.manage` | Record audited stock adjustment (`ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `EXPIRED_WRITE_OFF`). |
| `GET` | `/api/pharmacy/alerts` | `medicines.view` | Low-stock medicines, expiring batches (≤90 days), and expired batches. |
| `GET` | `/api/pharmacy/prescriptions` | `prescriptions.view` | List prescriptions (`OPEN`, `DISPENSED`, `ALL`). |
| `GET` | `/api/pharmacy/prescriptions/:id` | `prescriptions.view` | Prescription detail with per-item live stock availability. |
| `POST` | `/api/pharmacy/prescriptions/:id/dispense` | `pharmacy.dispense` | Transactional FEFO batch deduction: rejects quantities exceeding prescription remainder or available stock, writes `Dispensation`, `StockMovement`, and adds medicine charges to the patient's invoice. |
| `GET` | `/api/pharmacy/dispensations` | `pharmacy.dispense` | Dispensing transaction history. |

---

## 8. Laboratory (`/api/lab`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/lab/tests` | `lab.view` | Diagnostic test catalogue and prices. |
| `POST` | `/api/lab/tests` | `lab.catalog` | Add new lab test. |
| `GET` | `/api/lab/requests` | `lab.view` | List lab requests (`OPEN`, `COMPLETED`, `ALL`). |
| `POST` | `/api/lab/requests/:id/result` | `lab.results` | Enter test result, quantitative value, abnormal flag, and optional PDF/image upload (`multipart/form-data`); marks test `COMPLETED` and notifies the requesting doctor. |
| `GET` | `/api/lab/requests/:id/file` | `lab.view` | Download/view uploaded lab result document. |

---

## 9. Billing & Payments (`/api/billing`)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/billing/invoices` | `billing.view` | List invoices with totals (`total`, `paid`, `balance`). |
| `POST` | `/api/billing/invoices` | `billing.write` | Create manual invoice. |
| `GET` | `/api/billing/invoices/:id` | `billing.view` | Full invoice with line items, payments, and discounts. |
| `POST` | `/api/billing/invoices/:id/items` | `billing.write` | Add consultation, procedure, or other service charge. |
| `POST` | `/api/billing/invoices/:id/discounts` | `billing.discount.request` | Request discount with reason (sent to Manager for approval). |
| `POST` | `/api/billing/discounts/:id/decide` | `billing.discount.approve` | Approve or reject discount request and recalculate invoice balance. |
| `POST` | `/api/billing/invoices/:id/payments` | `billing.write` | Record full or partial payment (`CASH`, `MPESA`, `TIGO_PESA`, `AIRTEL_MONEY`, `BANK_TRANSFER`), issue receipt (`RCT-YYYY-XXXXXX`), and recalculate balance. |
| `POST` | `/api/billing/payments/:id/void` | `billing.cancel` | Void a payment with mandatory reason (audit logged; record preserved). |
| `POST` | `/api/billing/invoices/:id/cancel` | `billing.cancel` | Cancel an unpaid invoice with mandatory reason (audit logged). |

---

## 10. Dashboard, Reports & Administration (`/api/dashboard`, `/api/reports`, `/api/admin`)

- `GET /api/dashboard`: Role-filtered live KPIs (total patients, attended today, appointments today, pending consultations, revenue today, outstanding balances, low-stock and expiring medicines).
- `GET /api/reports/:reportType?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|week|month&format=json|pdf|xlsx`
  - `:reportType` ∈ `revenue`, `payments`, `outstanding`, `medicine-sales`, `patients`, `doctor-performance`, `inventory`, `stock-movements`.
- `GET /api/admin/audit`: Paginated immutable audit log (supports `format=pdf|xlsx`).
- `GET /api/admin/backups` & `POST /api/admin/backups`: List and trigger database backups.

