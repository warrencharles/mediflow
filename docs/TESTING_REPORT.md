# MediFlow — Acceptance Testing & Verification Report

**Project:** `MF-2026-001` · MediFlow Clinic Management & Patient Care System  
**Test Suite:** `server/tests/acceptance.test.js` (Vitest + Supertest against real PostgreSQL instance)  
**Date Executed:** 2026-11-12  
**Overall Result:** **6 / 6 Critical Acceptance Workflows PASSED**

---

## Summary of Executed Acceptance Workflows

| Test ID | Acceptance Workflow | Verification Steps Executed | Result |
|---|---|---|---|
| **Test 1** | **Patient Registration** | 1. Receptionist registers patient `Baraka Juma Mwakasege`.<br>2. System generates permanent sequential ID `MF-000001`.<br>3. Patient is searchable by full name, phone number (`754998877`), and patient ID.<br>4. Second registration with matching details is blocked with `409 Conflict` and returns the duplicate candidate list. | **PASS** |
| **Test 2** | **Queue, Vitals & Consultation** | 1. Receptionist checks patient in (`WAITING`, queue `#1`).<br>2. Nurse starts vitals (`VITALS`) and records Temp `38.9°C`, BP `122/78`, Pulse `98`, SpO2 `98%`, Weight `70kg`, Height `175cm` → auto-transitions to `AWAITING_DOCTOR`.<br>3. Doctor calls next patient → `IN_CONSULTATION`.<br>4. Doctor records symptoms, examination, diagnosis (`Acute Uncomplicated Malaria`), orders `mRDT` lab test (completed by lab), creates a 2-item prescription (`ALU` + `Paracetamol`), and completes the consultation (`COMPLETED`). | **PASS** |
| **Test 3** | **Pharmacy & Stock Deduction** | 1. Pharmacist opens the doctor's prescription.<br>2. Attempting to dispense `9999` units is rejected (`400 Bad Request`).<br>3. Pharmacist dispenses prescribed quantities (`2` packs ALU, `12` tabs Paracetamol).<br>4. Non-expired batch stock decreases by exact quantities (`120 → 118` and `1000 → 988`).<br>5. Dispensation (`DSP-2026-000001`) appears in dispensing history and adds medicine charges to the visit invoice. | **PASS** |
| **Test 4** | **Billing & Partial Payments** | 1. Accountant opens the visit invoice (Consultation `20,000` + Lab `8,000` + Medicine `14,400` = `TSh 42,400`, status `UNPAID`).<br>2. Patient pays partial amount `TSh 15,000` (`CASH`) → status becomes `PARTIALLY_PAID`, `amountPaid = 15,000`, `balance = 27,400`.<br>3. Patient pays remaining `TSh 27,400` (`MPESA`, ref `MPESA-TEST-001`) → status becomes `PAID`, `balance = 0`. | **PASS** |
| **Test 5** | **Role-Based Permissions (RBAC)** | 1. Receptionist requests `GET /api/consultations` and `GET /api/patients/:id/consultations` → denied with `403 Forbidden` and logged in `AuditLog` (`ACCESS_DENIED`).<br>2. Pharmacist requests `GET /api/reports/revenue` → denied with `403 Forbidden`.<br>3. Nurse attempts `POST /api/pharmacy/prescriptions/:id/dispense` → denied with `403 Forbidden`. | **PASS** |
| **Test 6** | **Management Reporting & Exports** | 1. Manager generates today's revenue report (`GET /api/reports/revenue`).<br>2. Report total (`TSh 42,400`) matches the exact sum of valid payment transactions in `GET /api/reports/payments`.<br>3. PDF export (`format=pdf`) returns valid `application/pdf` stream.<br>4. Excel export (`format=xlsx`) returns valid `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` workbook. | **PASS** |

