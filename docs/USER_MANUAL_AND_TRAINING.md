# MediFlow — Staff User Manual & Training Session Guide

---

## Part 1: Daily Clinic Workflow by Department

### 1. Receptionist (`reception1@mediflow.co.tz`)
1. **Search Before Registering:** Open **Patients** and search by phone number, name, or `MF-XXXXXX` ID so returning patients are never registered twice.
2. **Register a New Patient:** Click **Register New Patient**, fill in full name, gender, date of birth, phone, address, emergency contact, and known allergies. If a potential duplicate is detected, MediFlow alerts you and shows the existing record.
3. **Book Appointments:** Open **Appointments** → **Book Appointment**. Select the patient, doctor, and date. Click any green available time slot and save. Conflicting bookings are blocked automatically.
4. **Arrival & Queue Check-In:** When a patient arrives, click **Check In** from their appointment or Patient Profile, or use **Patient Queue & Vitals → Check In Patient**. MediFlow assigns a sequential queue number (`#1, #2, …`), opens the visit invoice with the consultation fee, and notifies the nurses.

### 2. Nurse (`nurse.grace@mediflow.co.tz`)
1. Open **Patient Queue & Vitals**. Patients who have just checked in appear in **1. Waiting for Vitals** (urgent patients are highlighted at the top).
2. Click **Record Vitals** on the patient card, enter Temperature (°C), Blood Pressure (Systolic/Diastolic), Pulse, Respiratory Rate, SpO2, Weight (kg), and Height (cm).
3. Click **Save Vitals & Send to Doctor**. BMI is calculated automatically, the patient moves to **3. Awaiting Doctor**, and the doctor receives an instant notification.

### 3. Doctor (`dr.massawe@mediflow.co.tz`)
1. In **Patient Queue & Vitals**, click **Call Next Patient** (or **Start Consultation** on a specific waiting patient). MediFlow moves the patient to **4. In Consultation** and opens the consultation screen.
2. Review the patient's **Allergies banner**, **Triage Vital Signs**, and **Previous Consultations** on the right panel.
3. Enter **Presenting Symptoms**, **Physical Examination Findings**, **Diagnosis**, and **Treatment Plan**, then click **Save Record**.
4. **Order Lab Tests:** Tick one or more tests under **Laboratory Investigations** (e.g., `mRDT`, `FBC`) and click **Order Selected Tests**. When the lab technician enters results, they appear automatically on the consultation screen.
5. **Issue Prescriptions:** Under **Prescriptions**, select each medicine, enter dosage, frequency, duration, and quantity, and click **Send Prescription to Pharmacy**.
6. Click **Save & Complete Consultation** when finished. Click **Print Consultation Summary** if the patient needs a printed copy.

### 4. Laboratory Technician (`lab@mediflow.co.tz`)
1. Open **Laboratory**. Pending doctor requests appear in priority order (`URGENT` first).
2. Click **Enter Result**, record the quantitative value and full findings, flag **Abnormal** if outside the normal range, optionally attach a PDF/image scan, and click **Save Result & Mark Test Completed**.
3. Click **Print** to generate a printable laboratory report.

### 5. Pharmacist (`pharmacist@mediflow.co.tz`)
1. Open **Pharmacy & Stock**. Under **Pending Prescriptions**, click **Open & Dispense** on a prescription.
2. Check the patient's allergies and the live available stock for each item. Confirm the dispense quantities and click **Confirm Dispense & Deduct Inventory**.
   - MediFlow automatically deducts stock from the earliest-expiring non-expired batch (FEFO), writes a stock movement and dispensation record, and adds the medicine charges to the patient's visit invoice.
   - Quantities greater than available stock or the prescribed remainder are strictly blocked.
3. Use **Receive Stock Batch** when new deliveries arrive from suppliers, and check the **Alerts** tab daily for low-stock or expiring medicines.

### 6. Accountant (`accountant@mediflow.co.tz`)
1. Open **Billing & Payments**. Select the patient's invoice on the left to review all automatically collected consultation, lab, and medicine charges.
2. **Record Full or Partial Payment:** Enter the amount paid, select the payment method (**Cash**, **M-Pesa**, **Tigo Pesa**, **Airtel Money**, or **Bank Transfer**), and enter the mobile-money/bank reference number. Click **Receive Payment & Issue Receipt**.
   - If the patient pays part of the bill, the status becomes `PARTIALLY_PAID` and the exact remaining balance is tracked. When the remaining balance is paid, the invoice becomes `PAID`.
3. Click **Print Invoice / Receipt** to hand a printed receipt to the patient.
4. **Discounts:** Enter a discount amount and reason and click **Request Discount**. Once approved by the Clinic Manager, the invoice total and balance update automatically.

### 7. Clinic Manager (`manager@mediflow.co.tz`) & Super Admin (`admin@mediflow.co.tz`)
1. **Executive Dashboard:** Real-time visibility into total registered patients, patients attended today, pending consultations, today's revenue by payment method, outstanding balances, and pharmacy stock alerts.
2. **Reports & Exports:** Open **Reports & Exports**, choose any report (Daily/Weekly/Monthly Revenue, Payment Transactions, Outstanding Balances, Medicine Sales, Patient Registrations, Doctor Performance, Inventory), filter by date, and click **Export PDF** or **Export Excel (.xlsx)**.
3. **Staff & Audit Logs:** Open **Staff & Audit Logs** to create staff accounts, deactivate accounts, inspect the immutable activity log, or trigger a database backup.

---

## Part 2: 90-Minute Staff Training Session Plan

| Time | Segment | Audience | Hands-On Exercise |
|---|---|---|---|
| **00–15 min** | System Overview & Security Habits | All 11 clinic staff | Sign in with individual credentials, change temporary password, review role permissions and session timeout rules. |
| **15–35 min** | Reception & Triage Flow | 2 Receptionists + 3 Nurses | Register a new patient, test duplicate prevention, book an appointment, check the patient into the queue, and record vital signs. |
| **35–55 min** | Clinical Consultation & Lab Loop | 4 Doctors + Lab Staff | Call next patient from queue, review vitals & history, order an `mRDT` lab test, enter the lab result, write a 2-item prescription, and print the consultation summary. |
| **55–75 min** | Pharmacy Dispensing & Stock Control | Pharmacist | Receive a new medicine batch, dispense the doctor's prescription, verify stock deduction, and review low-stock/expiry alerts. |
| **75–90 min** | Cashier Billing, Mobile Money & Reports | Accountant + Manager | Record a partial Cash payment and a remaining M-Pesa payment on the visit invoice, print the receipt, approve a discount, and export today's Revenue Report to PDF and Excel. |

