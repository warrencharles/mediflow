# MediFlow — Architecture, Installation & Deployment Guide

**Project Brief:** `MF-2026-001` · MediFlow Healthcare Group (Dar es Salaam, Tanzania)  
**Application Type:** Production-Ready Clinic Management & Patient Care Web Application

---

## 1. Architecture Overview

| Layer | Technology | Justification |
|---|---|---|
| **Frontend** | React 18 + Vite + Tailwind CSS + React Router v6 | Responsive single-page application that works smoothly on desktop reception stations, doctor consulting laptops, and nurse tablets; print-ready CSS layouts for consultation summaries, lab reports, and payment receipts. |
| **Backend** | Node.js (v22 ESM) + Express 4 REST API | Clean modular REST routes with Zod request validation, Helmet security headers, rate-limiting on authentication, and centralized error handling. |
| **Database** | PostgreSQL + Prisma ORM | ACID transactions with row-level & advisory locks prevent double-booking appointments, duplicate queue numbers, and over-dispensing pharmacy stock under concurrent requests. All monetary amounts are stored as integer Tanzanian Shillings (`TSh`) to prevent floating-point rounding errors. |
| **Authentication & RBAC** | `httpOnly` `SameSite=Strict` session cookies + Bearer tokens + SHA-256 hashed session store | Server-revocable sessions with idle timeout (60 min), absolute timeout (12 h), automatic account lockout after 5 failed attempts, and fine-grained permission guards on every API endpoint. |
| **Audit & Soft-Delete Policy** | Append-only `AuditLog` table + status transitions (`VOIDED`, `CANCELLED`, `INACTIVE`) | Financial and medical records are **never hard-deleted**. Every state change records who performed it, when, from which IP, and the before/after diff or mandatory reason. |
| **Backups** | Automated cron (`node-cron`) + `scripts/backup.js` (`pg_dump` or compressed `.json.gz` logical snapshot) | Daily automated backups with configurable retention (`BACKUP_RETENTION_DAYS=14`) plus one-click manual backup from the Admin screen. |

---

## 2. Quick Start (Local / Self-Contained Mode)

MediFlow includes an embedded PostgreSQL launcher so it can run out-of-the-box on any machine without pre-installing a separate database server, or connect to an external PostgreSQL server via `DATABASE_URL`.

```bash
# 1. Build the React frontend
npm run build

# 2. Start PostgreSQL, apply schema, seed clinic data, and start the server on http://localhost:4000
npm start
```

Open **`http://localhost:4000`** in your browser.

### Running the Automated Acceptance Test Suite

```bash
npm test
```

---

## 3. Production Deployment (Docker Compose / Cloud / VPS)

### Option A — Docker Compose (Recommended for Clinic Server or VPS)

```bash
POSTGRES_PASSWORD="StrongClinicDbPassword2026!" docker compose up -d --build
```

This starts:
- `db`: PostgreSQL 16 with persistent volume `pgdata`
- `app`: Node.js production server serving both `/api/*` and the compiled React SPA on port `4000`, with persistent volumes for `uploads` and `backups`, and nightly automated backups at `02:00 EAT`.

Place Nginx or Caddy in front with Let's Encrypt TLS (`https://clinic.mediflow.co.tz -> http://127.0.0.1:4000`).

### Option B — Standard Linux / Windows Server with External PostgreSQL

1. Create a PostgreSQL database and set `server/.env`:
   ```ini
   NODE_ENV=production
   PORT=4000
   DATABASE_URL="postgresql://mediflow:STRONG_PASSWORD@localhost:5432/mediflow?schema=public"
   CLINIC_NAME="MediFlow Healthcare Group"
   CORS_ORIGIN="https://clinic.mediflow.co.tz"
   APP_URL="https://clinic.mediflow.co.tz"
   COOKIE_SECURE=true
   BACKUP_CRON="0 2 * * *"
   BACKUP_RETENTION_DAYS=14
   ```
2. Install dependencies, build the frontend, push/migrate the schema, and seed initial accounts:
   ```bash
   cd client && npm ci && npm run build
   cd ../server && npm ci --omit=dev
   npx prisma db push
   node prisma/seed.js
   node src/index.js
   ```

---

## 4. Default Staff Accounts (Seeded Roster)

Default password for all initial accounts: **`MediFlow2026!`** (administrators can reset any account password or force a password change on next login).

| Role | Staff Name | Email | Module Access |
|---|---|---|---|
| **Super Admin** | Neema Mwakasege | `admin@mediflow.co.tz` | Full system access, staff accounts, backups, settings |
| **Manager** | Juma Kikwete | `manager@mediflow.co.tz` | Executive dashboard, all reports, discount approvals, invoice/payment voids, audit logs, doctor schedules |
| **Doctor (1 of 4)** | Dr. Amani Massawe | `dr.massawe@mediflow.co.tz` | Patients, appointments, queue call-next, vitals, consultations, prescriptions, lab requests |
| **Doctor (2 of 4)** | Dr. Zainab Mwinyi | `dr.mwinyi@mediflow.co.tz` | Same as above |
| **Doctor (3 of 4)** | Dr. Kelvin Mushi | `dr.mushi@mediflow.co.tz` | Same as above |
| **Doctor (4 of 4)** | Dr. Halima Said | `dr.said@mediflow.co.tz` | Same as above |
| **Nurse (1 of 3)** | Grace Mrema | `nurse.grace@mediflow.co.tz` | Patients view, appointments view, patient queue, vital signs, lab results |
| **Nurse (2 of 3)** | Upendo Tarimo | `nurse.upendo@mediflow.co.tz` | Same as above |
| **Nurse (3 of 3)** | Baraka Ngowi | `nurse.baraka@mediflow.co.tz` | Same as above |
| **Receptionist (1 of 2)** | Asha Bakari | `reception1@mediflow.co.tz` | Patient registration & edits, appointments booking/rescheduling, queue check-in |
| **Receptionist (2 of 2)** | Erick Lyimo | `reception2@mediflow.co.tz` | Same as above |
| **Pharmacist** | Salma Hassan | `pharmacist@mediflow.co.tz` | Medicine formulary, batches & suppliers, stock-in, adjustments, prescription dispensing, inventory reports |
| **Accountant** | Peter Kimaro | `accountant@mediflow.co.tz` | Invoices, payments (Cash, M-Pesa, Tigo Pesa, Airtel Money, Bank Transfer), receipts, discount requests, financial reports |
| **Lab Technician** | Daudi Mollel | `lab@mediflow.co.tz` | Lab test catalogue, pending lab requests, result & document entry, printable lab reports |

