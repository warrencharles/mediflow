# MediFlow — Clinic Management & Patient Care System

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-blue.svg)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-18-cyan.svg)](https://reactjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)](https://tailwindcss.com/)

**MediFlow (`MF-2026-001`)** is an enterprise-grade, web-based clinic management and patient care SaaS platform tailored for private clinics, outpatient centers, and community hospitals in Tanzania and East Africa. 

It unifies front-desk registration, triaging, clinical consultations, laboratory orders, pharmacy dispensing with automated FEFO inventory deduction, multi-channel billing (Cash, M-Pesa, Tigo Pesa, Airtel Money, Bank Transfer), administrative oversight, audit logs, and executive PDF/Excel reporting.

---

## Key Modules & Role-Based Access Control (RBAC)

MediFlow implements a strict 7-role RBAC architecture where each user accesses only their authorized modules:

| Role | Core Responsibilities & Access |
| :--- | :--- |
| **Super Admin** | Full clinic administration, user provisioning, system logs, manual/automated database backups, and emergency record revocations. |
| **Manager** | Operational dashboard, clinical performance oversight, revenue analytics, audit trail reviews, and executive PDF/Excel exports. |
| **Receptionist** | Patient intake, search/registration, photo uploads, appointment scheduling, and queuing. |
| **Nurse** | Triage room queue, vital signs capture (BP, Temp, Pulse, SpO2, Resp, Weight, Height, BMI), and doctor escalation. |
| **Doctor** | Consultation queue, patient medical history, physical exams, ICD-10 diagnosis, lab requisitions, and prescriptions. |
| **Pharmacist** | Prescription verification, dispensing with batch & FEFO stock deduction, stock-in adjustments, supplier management, and expiry alerts. |
| **Accountant** | Invoicing (consultation, lab tests, medications), partial & full payments (Cash, M-Pesa, Tigo Pesa, Airtel Money, Bank), and receipt printing. |

---

## Key Features

- **Queue Management Workflow**: `Waiting` → `Vitals Captured` → `Awaiting Doctor` → `In Consultation` → `Completed`.
- **FEFO Pharmacy & Inventory**: First-Expired, First-Out automatic stock deduction with real-time stock-out guards and batch tracking.
- **Tanzanian Payment Methods**: Seamless support for Cash, M-Pesa, Tigo Pesa, Airtel Money, and Bank Transfer with partial payment tracking.
- **Auditable Security**: Immutable audit log for financial cancellations, diagnosis revisions, and administrative adjustments.
- **Executive Reporting**: Clean, light-mode PDF reports (zero blank pages, dynamic column sizing) and XLSX exports with frozen panes and formula formatting.
- **Automated Database Backups**: Gzipped JSON database snapshots with retention pruning and one-click restore.

---

## Technology Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Headless UI.
- **Backend**: Node.js, Express, Prisma ORM.
- **Database**: PostgreSQL 15+ (supports embedded local PostgreSQL for dev/testing).
- **Reporting & Exports**: PDFKit (custom dynamic layout engine) & ExcelJS.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+ and npm installed.

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/warrencharles/mediflow.git
cd mediflow

# Install root, client, and server dependencies
npm install --prefix client
npm install --prefix server
```

### 2. Environment Configuration
Copy the example environment configuration:
```bash
cp .env.example .env
```

### 3. Build & Run
MediFlow comes with an automated bootstrap runner that configures PostgreSQL, migrates the schema, seeds demo data, builds the client, and starts the service:

```bash
# Build frontend assets
npm run build

# Start the embedded server and database
npm start
```

Open your browser at **`http://localhost:4000`** (or `http://localhost:5173` if running Vite dev server).

---

## Seed Accounts (Demo)

All seed accounts use the default password: **`Password123!`**

| Role | Email |
| :--- | :--- |
| **Super Admin** | `admin@mediflow.local` |
| **Manager** | `manager@mediflow.local` |
| **Doctor** | `doctor.sarah@mediflow.local` |
| **Nurse** | `nurse.grace@mediflow.local` |
| **Receptionist** | `reception.amina@mediflow.local` |
| **Pharmacist** | `pharmacy.john@mediflow.local` |
| **Accountant** | `finance.daudi@mediflow.local` |

---

## Documentation

Full project documentation is available in the [`docs/`](./docs) directory:
- [API Documentation](./docs/API_DOCUMENTATION.md)
- [Installation & Deployment Guide](./docs/INSTALL_AND_DEPLOY.md)
- [User Manual & Staff Training Guide](./docs/USER_MANUAL_AND_TRAINING.md)
- [Testing & Quality Assurance Report](./docs/TESTING_REPORT.md)

---

## License

This project is licensed under the MIT License.
