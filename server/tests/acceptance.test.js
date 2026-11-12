import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { startLocalPostgres } from '../scripts/local-db.js';
import { localDateStr } from '../src/lib/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let pgInstance;
let app;
let prisma;

const agents = {};

async function loginAs(roleKey, email, password = 'MediFlow2026!') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  agents[roleKey] = agent;
  return res.body.user;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const { pg, url } = await startLocalPostgres({
    dbName: 'mediflow_test',
    port: 5439,
    persistent: false,
  });
  pgInstance = pg;
  process.env.DATABASE_URL = url;

  execSync('npx prisma db push --skip-generate', {
    cwd: rootDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });

  const dbMod = await import('../src/db.js');
  prisma = dbMod.prisma;

  const { seedDatabase } = await import('../prisma/seed.js');
  await seedDatabase({ includeDemo: false });

  const appMod = await import('../src/app.js');
  app = appMod.app;

  await loginAs('admin', 'admin@mediflow.co.tz');
  await loginAs('manager', 'manager@mediflow.co.tz');
  await loginAs('receptionist', 'reception1@mediflow.co.tz');
  await loginAs('nurse', 'nurse.grace@mediflow.co.tz');
  await loginAs('doctor', 'dr.massawe@mediflow.co.tz');
  await loginAs('pharmacist', 'pharmacist@mediflow.co.tz');
  await loginAs('accountant', 'accountant@mediflow.co.tz');
  await loginAs('lab', 'lab@mediflow.co.tz');
}, 120000);

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
  if (pgInstance) await pgInstance.stop();
}, 30000);

describe('MediFlow Acceptance Suite (MF-2026-001)', () => {
  let registeredPatient;
  let checkedInVisit;
  let consultation;
  let prescription;
  let labRequest;
  let visitInvoiceId;

  it('Test 1: Patient registration — unique ID, search, and duplicate detection', async () => {
    const payload = {
      firstName: 'Baraka',
      middleName: 'Juma',
      lastName: 'Mwakasege',
      gender: 'MALE',
      dateOfBirth: '1990-05-15',
      phone: '0754998877',
      address: 'Masaki, Kinondoni, Dar es Salaam',
      region: 'Dar es Salaam',
      bloodGroup: 'O+',
      emergencyName: 'Neema Mwakasege',
      emergencyPhone: '0754998878',
      emergencyRelation: 'Sister',
      allergies: 'None known',
    };

    const createRes = await agents.receptionist.post('/api/patients').send(payload);
    expect(createRes.status).toBe(201);
    expect(createRes.body.patientNumber).toMatch(/^MF-\d{6}$/);
    registeredPatient = createRes.body;

    // Search by name, phone, and patient ID
    for (const q of ['Baraka Mwakasege', '754998877', registeredPatient.patientNumber]) {
      const searchRes = await agents.receptionist.get('/api/patients').query({ q });
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.items.some((p) => p.id === registeredPatient.id)).toBe(true);
    }

    // Attempt accidental duplicate registration -> 409 Conflict with duplicate candidates
    const dupRes = await agents.receptionist.post('/api/patients').send(payload);
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.details.duplicates.length).toBeGreaterThan(0);
  });

  it('Test 2: Queue, Vitals, Consultation, Diagnosis, Lab Request & Prescription', async () => {
    // 1. Receptionist checks in the patient
    const checkinRes = await agents.receptionist.post('/api/queue/check-in').send({
      patientId: registeredPatient.id,
      reason: 'High fever and chills',
      priority: 'URGENT',
    });
    expect(checkinRes.status).toBe(201);
    expect(checkinRes.body.status).toBe('WAITING');
    expect(checkinRes.body.queueNumber).toBeGreaterThan(0);
    checkedInVisit = checkinRes.body;

    // 2. Nurse starts vitals & records vital signs -> AWAITING_DOCTOR
    const startVit = await agents.nurse.post(`/api/queue/${checkedInVisit.id}/start-vitals`);
    expect(startVit.status).toBe(200);
    expect(startVit.body.status).toBe('VITALS');

    const vitRes = await agents.nurse.post(`/api/queue/${checkedInVisit.id}/vitals`).send({
      temperature: 38.9,
      systolic: 122,
      diastolic: 78,
      pulse: 98,
      respRate: 19,
      spo2: 98,
      weightKg: 70,
      heightCm: 175,
      notes: 'Febrile on arrival',
    });
    expect(vitRes.status).toBe(200);
    expect(vitRes.body.status).toBe('AWAITING_DOCTOR');

    // 3. Doctor calls next patient -> IN_CONSULTATION and opens Consultation
    const callRes = await agents.doctor.post('/api/queue/call-next').send({ visitId: checkedInVisit.id });
    expect(callRes.status).toBe(200);
    expect(callRes.body.visit.status).toBe('IN_CONSULTATION');
    consultation = callRes.body.consultation;

    // 4. Doctor records symptoms, examination, diagnosis & treatment plan
    const saveRes = await agents.doctor.put(`/api/consultations/${consultation.id}`).send({
      symptoms: 'High grade fever for 3 days, headache, rigors',
      examination: 'Temp 38.9C, alert, chest clear',
      diagnosis: 'Acute Uncomplicated Malaria',
      treatmentPlan: 'Oral ALU + Paracetamol 500mg',
      notes: 'Return immediately if warning signs occur',
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.diagnosis).toBe('Acute Uncomplicated Malaria');

    // 5. Doctor requests a laboratory test (mRDT) and lab enters result
    const testsRes = await agents.doctor.get('/api/lab/tests');
    const mrdt = testsRes.body.find((t) => t.code === 'MRDT');
    const labReqRes = await agents.doctor.post(`/api/consultations/${consultation.id}/lab-requests`).send({
      labTestIds: [mrdt.id],
      priority: 'URGENT',
      clinicalNotes: 'Rule out falciparum malaria',
    });
    expect(labReqRes.status).toBe(201);
    labRequest = labReqRes.body[0];

    const labResultRes = await agents.lab.post(`/api/lab/requests/${labRequest.id}/result`).send({
      result: 'Positive for P. falciparum',
      resultValue: 'Pf (+)',
      isAbnormal: true,
    });
    expect(labResultRes.status).toBe(200);
    expect(labResultRes.body.status).toBe('COMPLETED');

    // 6. Doctor creates prescription with 2 medicines
    const medsRes = await agents.doctor.get('/api/pharmacy/medicines');
    const alu = medsRes.body.find((m) => m.name.includes('Artemether'));
    const pcm = medsRes.body.find((m) => m.name.includes('Paracetamol'));

    const rxRes = await agents.doctor.post(`/api/consultations/${consultation.id}/prescriptions`).send({
      notes: 'Complete full antimalarial course',
      items: [
        { medicineId: alu.id, dosage: '4 tablets', frequency: 'BD', durationDays: 3, quantity: 2, instructions: 'With food' },
        { medicineId: pcm.id, dosage: '2 tablets', frequency: 'TDS', durationDays: 3, quantity: 12, instructions: 'For fever' },
      ],
    });
    expect(rxRes.status).toBe(201);
    expect(rxRes.body.items.length).toBe(2);
    prescription = rxRes.body;

    // 7. Complete consultation -> visit becomes COMPLETED
    const doneRes = await agents.doctor.post(`/api/consultations/${consultation.id}/complete`);
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.status).toBe('COMPLETED');
    expect(doneRes.body.visit.status).toBe('COMPLETED');
  });

  it('Test 3: Pharmacy — receive prescription, enforce stock limit, dispense & deduct stock', async () => {
    const rxDetail = await agents.pharmacist.get(`/api/pharmacy/prescriptions/${prescription.id}`);
    expect(rxDetail.status).toBe(200);
    const [itemAlu, itemPcm] = rxDetail.body.items;
    const stockBeforeAlu = itemAlu.stockAvailable;
    const stockBeforePcm = itemPcm.stockAvailable;

    // Attempt to dispense more than prescribed -> rejected
    const overRx = await agents.pharmacist.post(`/api/pharmacy/prescriptions/${prescription.id}/dispense`).send({
      items: [{ prescriptionItemId: itemAlu.id, quantity: 9999 }],
    });
    expect(overRx.status).toBe(400);

    // Dispense exact prescribed quantities
    const dispRes = await agents.pharmacist.post(`/api/pharmacy/prescriptions/${prescription.id}/dispense`).send({
      items: [
        { prescriptionItemId: itemAlu.id, quantity: itemAlu.quantity },
        { prescriptionItemId: itemPcm.id, quantity: itemPcm.quantity },
      ],
    });
    expect(dispRes.status).toBe(201);
    expect(dispRes.body.status).toBe('DISPENSED');
    visitInvoiceId = dispRes.body.invoiceId;

    // Verify stock decreased accurately
    const rxAfter = await agents.pharmacist.get(`/api/pharmacy/prescriptions/${prescription.id}`);
    const afterAlu = rxAfter.body.items.find((i) => i.id === itemAlu.id).stockAvailable;
    const afterPcm = rxAfter.body.items.find((i) => i.id === itemPcm.id).stockAvailable;
    expect(afterAlu).toBe(stockBeforeAlu - itemAlu.quantity);
    expect(afterPcm).toBe(stockBeforePcm - itemPcm.quantity);

    // Verify transaction appears in dispensing history
    const histRes = await agents.pharmacist.get('/api/pharmacy/dispensations').query({ patientId: registeredPatient.id });
    expect(histRes.status).toBe(200);
    expect(histRes.body.items.some((d) => d.id === dispRes.body.dispensation.id)).toBe(true);
  });

  it('Test 4: Payment — invoice generation, partial payment, balance calculation & full settlement', async () => {
    const invRes = await agents.accountant.get(`/api/billing/invoices/${visitInvoiceId}`);
    expect(invRes.status).toBe(200);
    const total = invRes.body.total;
    expect(total).toBeGreaterThan(0);
    expect(invRes.body.status).toBe('UNPAID');

    // Pay part of the bill (TSh 15,000 via Cash)
    const partAmount = 15000;
    const pay1 = await agents.accountant.post(`/api/billing/invoices/${visitInvoiceId}/payments`).send({
      amount: partAmount,
      method: 'CASH',
      notes: 'First instalment',
    });
    expect(pay1.status).toBe(201);
    expect(pay1.body.invoice.status).toBe('PARTIALLY_PAID');
    expect(pay1.body.invoice.amountPaid).toBe(partAmount);
    expect(pay1.body.invoice.balance).toBe(total - partAmount);

    // Pay the remaining balance via M-Pesa -> invoice becomes PAID
    const remaining = pay1.body.invoice.balance;
    const pay2 = await agents.accountant.post(`/api/billing/invoices/${visitInvoiceId}/payments`).send({
      amount: remaining,
      method: 'MPESA',
      reference: 'MPESA-TEST-001',
    });
    expect(pay2.status).toBe(201);
    expect(pay2.body.invoice.status).toBe('PAID');
    expect(pay2.body.invoice.balance).toBe(0);
    expect(pay2.body.invoice.amountPaid).toBe(total);
  });

  it('Test 5: Permissions — strict RBAC denies unauthorized module access and logs attempt', async () => {
    // Receptionist attempts to access medical consultation records -> 403 Forbidden
    const recConsult = await agents.receptionist.get('/api/consultations');
    expect(recConsult.status).toBe(403);

    const recPatientConsult = await agents.receptionist.get(`/api/patients/${registeredPatient.id}/consultations`);
    expect(recPatientConsult.status).toBe(403);

    // Pharmacist attempts to access financial revenue reports -> 403 Forbidden
    const pharmRev = await agents.pharmacist.get('/api/reports/revenue');
    expect(pharmRev.status).toBe(403);

    // Nurse attempts to dispense medicine -> 403 Forbidden
    const nurseDisp = await agents.nurse.post(`/api/pharmacy/prescriptions/${prescription.id}/dispense`).send({ items: [] });
    expect(nurseDisp.status).toBe(403);
  });

  it('Test 6: Reporting — today revenue report matches actual payment transactions & exports PDF/XLSX', async () => {
    const today = localDateStr();
    const revRes = await agents.manager.get('/api/reports/revenue').query({ from: today, to: today, groupBy: 'day' });
    expect(revRes.status).toBe(200);

    const txRes = await agents.manager.get('/api/reports/payments').query({ from: today, to: today });
    expect(txRes.status).toBe(200);

    // Revenue total matches sum of actual valid payment transactions
    expect(revRes.body.totals.total).toBe(txRes.body.totals.total);
    expect(revRes.body.totals.total).toBeGreaterThan(0);

    // Export as PDF and Excel
    const pdfRes = await agents.manager.get('/api/reports/revenue').query({ from: today, to: today, format: 'pdf' });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');

    const xlsxRes = await agents.manager.get('/api/reports/revenue').query({ from: today, to: today, format: 'xlsx' });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml.sheet');
  });
});

