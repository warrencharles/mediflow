import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { localDateStr, addDays, localDateTime } from '../src/lib/time.js';
import { nextPatientNumber, nextNumber, nextValue } from '../src/lib/counters.js';
import { recalcInvoice } from '../src/lib/billing.js';

export async function seedDatabase({ includeDemo = true } = {}) {
  const pw = await bcrypt.hash('MediFlow2026!', 10);

  // 1. Clinic settings
  await prisma.setting.upsert({
    where: { key: 'clinic' },
    create: {
      key: 'clinic',
      value: {
        name: 'MediFlow Healthcare Group – Dar es Salaam',
        address: 'Plot 42, Ali Hassan Mwinyi Road, Kinondoni, Dar es Salaam',
        phone: '+255 22 266 4800',
        email: 'info@mediflow.co.tz',
        tin: '132-894-210',
        receiptFooter: 'Asante kwa kutuchagua · Thank you for choosing MediFlow Clinic',
      },
    },
    update: {},
  });

  // 2. Staff accounts matching the clinic's exact roster (4 doctors, 3 nurses, 2 receptionists, 1 pharmacist, 1 accountant, 1 manager, 1 lab tech, 1 super admin)
  const staffList = [
    { fullName: 'Neema Mwakasege', email: 'admin@mediflow.co.tz', phone: '+255754100001', role: 'SUPER_ADMIN' },
    { fullName: 'Juma Kikwete', email: 'manager@mediflow.co.tz', phone: '+255754100002', role: 'MANAGER' },
    { fullName: 'Dr. Amani Massawe', email: 'dr.massawe@mediflow.co.tz', phone: '+255754100011', role: 'DOCTOR' },
    { fullName: 'Dr. Zainab Mwinyi', email: 'dr.mwinyi@mediflow.co.tz', phone: '+255754100012', role: 'DOCTOR' },
    { fullName: 'Dr.Kelvin Mushi', email: 'dr.mushi@mediflow.co.tz', phone: '+255754100013', role: 'DOCTOR' },
    { fullName: 'Dr. Halima Said', email: 'dr.said@mediflow.co.tz', phone: '+255754100014', role: 'DOCTOR' },
    { fullName: 'Grace Mrema', email: 'nurse.grace@mediflow.co.tz', phone: '+255754100021', role: 'NURSE' },
    { fullName: 'Upendo Tarimo', email: 'nurse.upendo@mediflow.co.tz', phone: '+255754100022', role: 'NURSE' },
    { fullName: 'Baraka Ngowi', email: 'nurse.baraka@mediflow.co.tz', phone: '+255754100023', role: 'NURSE' },
    { fullName: 'Asha Bakari', email: 'reception1@mediflow.co.tz', phone: '+255754100031', role: 'RECEPTIONIST' },
    { fullName: 'Erick Lyimo', email: 'reception2@mediflow.co.tz', phone: '+255754100032', role: 'RECEPTIONIST' },
    { fullName: 'Salma Hassan', email: 'pharmacist@mediflow.co.tz', phone: '+255754100041', role: 'PHARMACIST' },
    { fullName: 'Peter Kimaro', email: 'accountant@mediflow.co.tz', phone: '+255754100051', role: 'ACCOUNTANT' },
    { fullName: 'Daudi Mollel', email: 'lab@mediflow.co.tz', phone: '+255754100061', role: 'LAB_TECHNICIAN' },
  ];

  const users = {};
  for (const s of staffList) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      create: { ...s, passwordHash: pw, mustChangePassword: false, isActive: true },
      update: { fullName: s.fullName, role: s.role, isActive: true },
    });
    users[s.email] = u;
  }

  // 3. Doctor working schedules (all 7 days 07:00–20:00 so demos/tests can book any day)
  const doctors = [
    users['dr.massawe@mediflow.co.tz'],
    users['dr.mwinyi@mediflow.co.tz'],
    users['dr.mushi@mediflow.co.tz'],
    users['dr.said@mediflow.co.tz'],
  ];
  for (const doc of doctors) {
    const existing = await prisma.doctorSchedule.count({ where: { doctorId: doc.id } });
    if (!existing) {
      await prisma.doctorSchedule.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          doctorId: doc.id,
          weekday,
          startTime: '07:00',
          endTime: '20:00',
        })),
      });
    }
  }

  // 4. Clinic services catalogue
  const services = [
    { code: 'CONS-GEN', name: 'General Outpatient Consultation', category: 'CONSULTATION', price: 20000 },
    { code: 'CONS-SPEC', name: 'Specialist Consultation', category: 'CONSULTATION', price: 35000 },
    { code: 'CONS-REV', name: 'Follow-up Review Consultation', category: 'CONSULTATION', price: 10000 },
    { code: 'PROC-DRESS', name: 'Wound Dressing & Cleaning', category: 'PROCEDURE', price: 15000 },
    { code: 'PROC-INJ', name: 'Injection Administration', category: 'PROCEDURE', price: 5000 },
    { code: 'PROC-NEB', name: 'Nebulization Session', category: 'PROCEDURE', price: 12000 },
    { code: 'PROC-SUT', name: 'Minor Suturing', category: 'PROCEDURE', price: 30000 },
  ];
  for (const s of services) {
    await prisma.service.upsert({ where: { code: s.code }, create: s, update: { price: s.price, name: s.name } });
  }

  // 5. Laboratory tests catalogue
  const labTests = [
    { code: 'MRDT', name: 'Malaria Rapid Diagnostic Test (mRDT)', category: 'Parasitology', price: 8000, normalRange: 'Negative', unit: '' },
    { code: 'BS-MPS', name: 'Blood Slide for Malaria Parasites', category: 'Parasitology', price: 10000, normalRange: 'No parasites seen', unit: '/200 WBC' },
    { code: 'FBC', name: 'Full Blood Picture (FBP / CBC)', category: 'Haematology', price: 18000, normalRange: 'Hb 12–17 g/dL, WBC 4–11 x10^9/L', unit: 'g/dL' },
    { code: 'FBG', name: 'Fasting Blood Glucose', category: 'Biochemistry', price: 10000, normalRange: '3.9 – 5.6', unit: 'mmol/L' },
    { code: 'RBG', name: 'Random Blood Glucose', category: 'Biochemistry', price: 8000, normalRange: '4.0 – 7.8', unit: 'mmol/L' },
    { code: 'URINE', name: 'Urinalysis (Full)', category: 'Microbiology', price: 10000, normalRange: 'Clear, leucocytes nil, nitrite neg', unit: '' },
    { code: 'WIDAL', name: 'Typhoid IgG/IgM Rapid Test', category: 'Serology', price: 15000, normalRange: 'Non-reactive', unit: '' },
    { code: 'LFT', name: 'Liver Function Panel (ALT / AST / Bilirubin)', category: 'Biochemistry', price: 35000, normalRange: 'ALT 7–56 U/L', unit: 'U/L' },
    { code: 'RFT', name: 'Renal Function (Creatinine & Urea)', category: 'Biochemistry', price: 30000, normalRange: 'Creatinine 60–110 umol/L', unit: 'umol/L' },
    { code: 'UPT', name: 'Urine Pregnancy Test (hCG)', category: 'Serology', price: 7000, normalRange: 'Negative / Positive', unit: '' },
  ];
  for (const t of labTests) {
    await prisma.labTest.upsert({ where: { code: t.code }, create: t, update: { price: t.price } });
  }

  // 6. Suppliers & Medicines with initial stock batches
  const sup1 = await prisma.supplier.upsert({
    where: { name: 'MSD Tanzania (Medical Stores Department)' },
    create: { name: 'MSD Tanzania (Medical Stores Department)', phone: '+255222860890', email: 'sales@msd.go.tz', address: 'Keko Mwanga, Dar es Salaam' },
    update: {},
  });
  const sup2 = await prisma.supplier.upsert({
    where: { name: 'Shelys Pharmaceuticals Ltd' },
    create: { name: 'Shelys Pharmaceuticals Ltd', phone: '+255222771822', email: 'orders@shelys.co.tz', address: 'New Bagamoyo Road, Dar es Salaam' },
    update: {},
  });

  const medDefs = [
    { name: 'Artemether 20mg / Lumefantrine 120mg (ALU)', genericName: 'Artemether + Lumefantrine', brandName: 'Coartem', category: 'Antimalarial', form: 'Tablet', unit: 'pack', sellingPrice: 6000, purchasePrice: 3500, reorderLevel: 20, qty: 120, batch: 'ALU-2601' },
    { name: 'Paracetamol 500mg', genericName: 'Paracetamol', brandName: 'Panadol', category: 'Analgesic', form: 'Tablet', unit: 'tablet', sellingPrice: 200, purchasePrice: 80, reorderLevel: 100, qty: 1000, batch: 'PCM-2604' },
    { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', brandName: 'Amoxil', category: 'Antibiotic', form: 'Capsule', unit: 'capsule', sellingPrice: 500, purchasePrice: 220, reorderLevel: 60, qty: 450, batch: 'AMX-2602' },
    { name: 'Azithromycin 500mg', genericName: 'Azithromycin', brandName: 'Zithromax', category: 'Antibiotic', form: 'Tablet', unit: 'tablet', sellingPrice: 2000, purchasePrice: 950, reorderLevel: 30, qty: 150, batch: 'AZM-2603' },
    { name: 'Ciprofloxacin 500mg', genericName: 'Ciprofloxacin', brandName: 'Cipro', category: 'Antibiotic', form: 'Tablet', unit: 'tablet', sellingPrice: 800, purchasePrice: 350, reorderLevel: 40, qty: 200, batch: 'CIP-2605' },
    { name: 'Metronidazole 400mg', genericName: 'Metronidazole', brandName: 'Flagyl', category: 'Antibiotic', form: 'Tablet', unit: 'tablet', sellingPrice: 300, purchasePrice: 120, reorderLevel: 60, qty: 300, batch: 'MTZ-2601' },
    { name: 'Ibuprofen 400mg', genericName: 'Ibuprofen', brandName: 'Brufen', category: 'NSAID', form: 'Tablet', unit: 'tablet', sellingPrice: 300, purchasePrice: 110, reorderLevel: 80, qty: 400, batch: 'IBU-2602' },
    { name: 'Omeprazole 20mg', genericName: 'Omeprazole', brandName: 'Losec', category: 'Gastrointestinal', form: 'Capsule', unit: 'capsule', sellingPrice: 600, purchasePrice: 250, reorderLevel: 40, qty: 220, batch: 'OMP-2606' },
    { name: 'Oral Rehydration Salts (ORS)', genericName: 'ORS Sachet', brandName: 'Afya ORS', category: 'Gastrointestinal', form: 'Powder', unit: 'sachet', sellingPrice: 1000, purchasePrice: 400, reorderLevel: 30, qty: 12, batch: 'ORS-2601' }, // Low stock alert demo
    { name: 'Cetirizine 10mg', genericName: 'Cetirizine', brandName: 'Zyrtec', category: 'Antihistamine', form: 'Tablet', unit: 'tablet', sellingPrice: 400, purchasePrice: 150, reorderLevel: 30, qty: 180, batch: 'CET-2604' },
    { name: 'Amlodipine 5mg', genericName: 'Amlodipine', brandName: 'Norvasc', category: 'Cardiovascular', form: 'Tablet', unit: 'tablet', sellingPrice: 700, purchasePrice: 280, reorderLevel: 30, qty: 210, batch: 'AML-2602' },
    { name: 'Metformin 500mg', genericName: 'Metformin', brandName: 'Glucophage', category: 'Antidiabetic', form: 'Tablet', unit: 'tablet', sellingPrice: 500, purchasePrice: 200, reorderLevel: 50, qty: 260, batch: 'MET-2603' },
  ];

  const today = localDateStr();
  const pharmacist = users['pharmacist@mediflow.co.tz'];

  for (let i = 0; i < medDefs.length; i++) {
    const m = medDefs[i];
    let med = await prisma.medicine.findFirst({ where: { name: m.name } });
    if (!med) {
      med = await prisma.medicine.create({
        data: {
          name: m.name,
          genericName: m.genericName,
          brandName: m.brandName,
          category: m.category,
          form: m.form,
          unit: m.unit,
          sellingPrice: m.sellingPrice,
          reorderLevel: m.reorderLevel,
        },
      });
      const expiryDate = new Date(addDays(today, i === 8 ? 35 : 365)); // ORS expiring soon demo
      const b = await prisma.medicineBatch.create({
        data: {
          medicineId: med.id,
          batchNumber: m.batch,
          expiryDate,
          purchasePrice: m.purchasePrice,
          quantityReceived: m.qty,
          quantityRemaining: m.qty,
          supplierId: i % 2 === 0 ? sup1.id : sup2.id,
          receivedById: pharmacist.id,
        },
      });
      await prisma.stockMovement.create({
        data: {
          medicineId: med.id,
          batchId: b.id,
          type: 'STOCK_IN',
          quantity: m.qty,
          reason: 'Initial opening stock',
          reference: 'INIT-2026',
          userId: pharmacist.id,
        },
      });
    }
  }

  if (!includeDemo) return;

  // 7. Realistic demo patients, visits, consultations, prescriptions, lab requests & invoices
  const existingPatients = await prisma.patient.count();
  if (existingPatients > 0) return;

  const reception = users['reception1@mediflow.co.tz'];
  const nurse = users['nurse.grace@mediflow.co.tz'];
  const dr1 = users['dr.massawe@mediflow.co.tz'];
  const dr2 = users['dr.mwinyi@mediflow.co.tz'];
  const accountant = users['accountant@mediflow.co.tz'];
  const labTech = users['lab@mediflow.co.tz'];

  const samplePatients = [
    { firstName: 'Fatuma', middleName: 'Said', lastName: 'Mwakaleli', gender: 'FEMALE', dateOfBirth: '1991-04-14', phone: '+255713210101', address: 'Mikocheni B, Kinondoni', region: 'Dar es Salaam', bloodGroup: 'O+', emergencyName: 'Said Mwakaleli', emergencyPhone: '+255713210102', emergencyRelation: 'Spouse', allergies: 'Penicillin', medicalHistory: 'Mild asthma since childhood' },
    { firstName: 'Joseph', middleName: 'Paul', lastName: 'Nyerere', gender: 'MALE', dateOfBirth: '1978-09-22', phone: '+255754310201', address: 'Sinza Mori, Ubungo', region: 'Dar es Salaam', bloodGroup: 'A+', emergencyName: 'Maria Nyerere', emergencyPhone: '+255754310202', emergencyRelation: 'Wife', chronicConditions: 'Hypertension', medicalHistory: 'On Amlodipine 5mg daily' },
    { firstName: 'Zawadi', middleName: 'Hassan', lastName: 'Kigoda', gender: 'FEMALE', dateOfBirth: '1999-12-03', phone: '+255765410301', address: 'Mbezi Beach, Kawe', region: 'Dar es Salaam', bloodGroup: 'B+', emergencyName: 'Hassan Kigoda', emergencyPhone: '+255765410302', emergencyRelation: 'Father' },
    { firstName: 'Emmanuel', middleName: 'John', lastName: 'Komba', gender: 'MALE', dateOfBirth: '1985-06-18', phone: '+255784510401', address: 'Tabata Segerea, Ilala', region: 'Dar es Salaam', bloodGroup: 'O-', emergencyName: 'Rehema Komba', emergencyPhone: '+255784510402', emergencyRelation: 'Sister', allergies: 'Sulfa drugs' },
    { firstName: 'Halima', middleName: 'Ally', lastName: 'Mtulia', gender: 'FEMALE', dateOfBirth: '1967-02-11', phone: '+255715610501', address: 'Kariakoo, Ilala', region: 'Dar es Salaam', bloodGroup: 'AB+', emergencyName: 'Omary Mtulia', emergencyPhone: '+255715610502', emergencyRelation: 'Son', chronicConditions: 'Type 2 Diabetes Mellitus' },
    { firstName: 'Godfrey', middleName: 'Lucas', lastName: 'Minja', gender: 'MALE', dateOfBirth: '2003-08-29', phone: '+255756710601', address: 'Mwenge, Kinondoni', region: 'Dar es Salaam', bloodGroup: 'A-', emergencyName: 'Lucas Minja', emergencyPhone: '+255756710602', emergencyRelation: 'Father' },
  ];

  const patients = [];
  for (const sp of samplePatients) {
    const patientNumber = await nextPatientNumber();
    const p = await prisma.patient.create({
      data: {
        ...sp,
        patientNumber,
        dateOfBirth: new Date(sp.dateOfBirth),
        createdById: reception.id,
      },
    });
    patients.push(p);
  }

  const consService = await prisma.service.findUnique({ where: { code: 'CONS-GEN' } });
  const mrdt = await prisma.labTest.findUnique({ where: { code: 'MRDT' } });
  const fbc = await prisma.labTest.findUnique({ where: { code: 'FBC' } });
  const alu = await prisma.medicine.findFirst({ where: { name: { contains: 'Artemether' } } });
  const pcm = await prisma.medicine.findFirst({ where: { name: { contains: 'Paracetamol' } } });

  // Patient 0: Completed visit today + dispensed prescription + lab result + paid partial & remaining invoice
  const q1 = await nextValue(`queue:${today}`);
  const v1 = await prisma.visit.create({
    data: {
      visitNumber: await nextNumber('V'),
      patientId: patients[0].id,
      queueDate: today,
      queueNumber: q1,
      status: 'COMPLETED',
      reason: 'High fever, headache and joint pains for 2 days',
      assignedDoctorId: dr1.id,
      checkedInById: reception.id,
      vitalsAt: new Date(Date.now() - 70 * 60000),
      consultationStartedAt: new Date(Date.now() - 55 * 60000),
      completedAt: new Date(Date.now() - 35 * 60000),
    },
  });
  await prisma.vitals.create({
    data: {
      visitId: v1.id,
      patientId: patients[0].id,
      temperature: 38.6,
      systolic: 118,
      diastolic: 76,
      pulse: 96,
      respRate: 18,
      spo2: 98,
      weightKg: 64,
      heightCm: 165,
      bmi: 23.5,
      recordedById: nurse.id,
    },
  });
  const c1 = await prisma.consultation.create({
    data: {
      visitId: v1.id,
      patientId: patients[0].id,
      doctorId: dr1.id,
      symptoms: 'Fever for 2 days, chills, frontal headache, body malaise.',
      examination: 'Febrile (38.6°C), alert, no neck stiffness, chest clear.',
      diagnosis: 'Uncomplicated Plasmodium falciparum Malaria',
      treatmentPlan: 'Oral ALU 4 tablets stat, after 8h, then BD for 2 days + Paracetamol 1g TDS. Plenty of oral fluids.',
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 35 * 60000),
    },
  });
  const lr1 = await prisma.labRequest.create({
    data: {
      requestNumber: await nextNumber('LAB'),
      patientId: patients[0].id,
      visitId: v1.id,
      consultationId: c1.id,
      doctorId: dr1.id,
      labTestId: mrdt.id,
      price: mrdt.price,
      priority: 'URGENT',
      status: 'COMPLETED',
      result: 'Positive for P. falciparum HRP2 antigen',
      resultValue: 'Positive (Pf)',
      isAbnormal: true,
      resultEnteredById: labTech.id,
      resultEnteredAt: new Date(Date.now() - 40 * 60000),
    },
  });
  const rx1 = await prisma.prescription.create({
    data: {
      prescriptionNumber: await nextNumber('RX'),
      consultationId: c1.id,
      patientId: patients[0].id,
      doctorId: dr1.id,
      status: 'DISPENSED',
      items: {
        create: [
          { medicineId: alu.id, dosage: '4 tablets', frequency: 'BD', durationDays: 3, quantity: 1, quantityDispensed: 1, instructions: 'Take with food or milk' },
          { medicineId: pcm.id, dosage: '1000mg (2 tabs)', frequency: 'TDS', durationDays: 3, quantity: 18, quantityDispensed: 18, instructions: 'After meals for fever' },
        ],
      },
    },
    include: { items: true },
  });
  const aluBatch = await prisma.medicineBatch.findFirst({ where: { medicineId: alu.id } });
  const pcmBatch = await prisma.medicineBatch.findFirst({ where: { medicineId: pcm.id } });
  await prisma.medicineBatch.update({ where: { id: aluBatch.id }, data: { quantityRemaining: { decrement: 1 } } });
  await prisma.medicineBatch.update({ where: { id: pcmBatch.id }, data: { quantityRemaining: { decrement: 18 } } });
  const dspNum = await nextNumber('DSP');
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNumber: await nextNumber('INV'),
      patientId: patients[0].id,
      visitId: v1.id,
      createdById: reception.id,
    },
  });
  const disp1 = await prisma.dispensation.create({
    data: {
      dispenseNumber: dspNum,
      prescriptionId: rx1.id,
      patientId: patients[0].id,
      pharmacistId: pharmacist.id,
      totalAmount: alu.sellingPrice * 1 + pcm.sellingPrice * 18,
      invoiceId: inv1.id,
      items: {
        create: [
          { prescriptionItemId: rx1.items[0].id, medicineId: alu.id, batchId: aluBatch.id, quantity: 1, unitPrice: alu.sellingPrice, lineTotal: alu.sellingPrice },
          { prescriptionItemId: rx1.items[1].id, medicineId: pcm.id, batchId: pcmBatch.id, quantity: 18, unitPrice: pcm.sellingPrice, lineTotal: pcm.sellingPrice * 18 },
        ],
      },
    },
  });
  await prisma.invoiceItem.createMany({
    data: [
      { invoiceId: inv1.id, type: 'CONSULTATION', description: consService.name, quantity: 1, unitPrice: consService.price, lineTotal: consService.price, sourceType: 'Visit', sourceId: v1.id, createdById: reception.id },
      { invoiceId: inv1.id, type: 'LAB', description: `Lab: ${mrdt.name}`, quantity: 1, unitPrice: mrdt.price, lineTotal: mrdt.price, sourceType: 'LabRequest', sourceId: lr1.id, createdById: dr1.id },
      { invoiceId: inv1.id, type: 'MEDICINE', description: `${alu.name} (${dspNum})`, quantity: 1, unitPrice: alu.sellingPrice, lineTotal: alu.sellingPrice, sourceType: 'Dispensation', sourceId: disp1.id, createdById: pharmacist.id },
      { invoiceId: inv1.id, type: 'MEDICINE', description: `${pcm.name} (${dspNum})`, quantity: 18, unitPrice: pcm.sellingPrice, lineTotal: pcm.sellingPrice * 18, sourceType: 'Dispensation', sourceId: disp1.id, createdById: pharmacist.id },
    ],
  });
  await prisma.payment.create({
    data: {
      receiptNumber: await nextNumber('RCT'),
      invoiceId: inv1.id,
      patientId: patients[0].id,
      amount: 37600,
      method: 'MPESA',
      reference: 'MPESA984120A',
      receivedById: accountant.id,
    },
  });
  await recalcInvoice(inv1.id);

  // Patient 1: Checked in & vitals recorded → AWAITING_DOCTOR + partially paid invoice
  const q2 = await nextValue(`queue:${today}`);
  const v2 = await prisma.visit.create({
    data: {
      visitNumber: await nextNumber('V'),
      patientId: patients[1].id,
      queueDate: today,
      queueNumber: q2,
      status: 'AWAITING_DOCTOR',
      reason: 'Blood pressure review and prescription refill',
      assignedDoctorId: dr1.id,
      checkedInById: reception.id,
      vitalsAt: new Date(Date.now() - 20 * 60000),
    },
  });
  await prisma.vitals.create({
    data: {
      visitId: v2.id,
      patientId: patients[1].id,
      temperature: 36.7,
      systolic: 148,
      diastolic: 92,
      pulse: 78,
      respRate: 16,
      spo2: 99,
      weightKg: 82,
      heightCm: 174,
      bmi: 27.1,
      recordedById: nurse.id,
    },
  });
  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNumber: await nextNumber('INV'),
      patientId: patients[1].id,
      visitId: v2.id,
      createdById: reception.id,
    },
  });
  await prisma.invoiceItem.create({
    data: {
      invoiceId: inv2.id,
      type: 'CONSULTATION',
      description: consService.name,
      quantity: 1,
      unitPrice: consService.price,
      lineTotal: consService.price,
      sourceType: 'Visit',
      sourceId: v2.id,
      createdById: reception.id,
    },
  });
  await prisma.payment.create({
    data: {
      receiptNumber: await nextNumber('RCT'),
      invoiceId: inv2.id,
      patientId: patients[1].id,
      amount: 10000,
      method: 'CASH',
      receivedById: accountant.id,
    },
  });
  await recalcInvoice(inv2.id);

  // Patient 2: Just checked in → WAITING for vitals + pending lab request from earlier consultation
  const q3 = await nextValue(`queue:${today}`);
  const v3 = await prisma.visit.create({
    data: {
      visitNumber: await nextNumber('V'),
      patientId: patients[2].id,
      queueDate: today,
      queueNumber: q3,
      status: 'WAITING',
      reason: 'Dizziness and fatigue',
      assignedDoctorId: dr2.id,
      checkedInById: reception.id,
    },
  });
  const inv3 = await prisma.invoice.create({
    data: {
      invoiceNumber: await nextNumber('INV'),
      patientId: patients[2].id,
      visitId: v3.id,
      createdById: reception.id,
    },
  });
  await prisma.invoiceItem.create({
    data: {
      invoiceId: inv3.id,
      type: 'CONSULTATION',
      description: consService.name,
      quantity: 1,
      unitPrice: consService.price,
      lineTotal: consService.price,
      sourceType: 'Visit',
      sourceId: v3.id,
      createdById: reception.id,
    },
  });
  await recalcInvoice(inv3.id);

  // Patient 3: Completed consultation with PENDING prescription for pharmacy + PENDING lab test
  const c4 = await prisma.consultation.create({
    data: {
      patientId: patients[3].id,
      doctorId: dr2.id,
      symptoms: 'Productive cough and mild fever for 4 days.',
      examination: 'Chest: coarse crepitations right lower zone, SpO2 97%.',
      diagnosis: 'Acute Lower Respiratory Tract Infection',
      treatmentPlan: 'Oral Azithromycin 500mg OD x 3 days + Paracetamol 1g TDS.',
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 15 * 60000),
    },
  });
  const azm = await prisma.medicine.findFirst({ where: { name: { contains: 'Azithromycin' } } });
  await prisma.prescription.create({
    data: {
      prescriptionNumber: await nextNumber('RX'),
      consultationId: c4.id,
      patientId: patients[3].id,
      doctorId: dr2.id,
      status: 'PENDING',
      items: {
        create: [
          { medicineId: azm.id, dosage: '500mg (1 tab)', frequency: 'OD', durationDays: 3, quantity: 3, instructions: '1 hour before or 2 hours after food' },
          { medicineId: pcm.id, dosage: '1000mg (2 tabs)', frequency: 'TDS', durationDays: 3, quantity: 18, instructions: 'When feverish' },
        ],
      },
    },
  });
  await prisma.labRequest.create({
    data: {
      requestNumber: await nextNumber('LAB'),
      patientId: patients[3].id,
      consultationId: c4.id,
      doctorId: dr2.id,
      labTestId: fbc.id,
      price: fbc.price,
      priority: 'ROUTINE',
      status: 'PENDING',
      clinicalNotes: 'Check WBC differential for bacterial infection',
    },
  });

  // Upcoming appointments today
  await prisma.appointment.createMany({
    data: [
      {
        patientId: patients[4].id,
        doctorId: dr1.id,
        startAt: localDateTime(today, '14:00'),
        endAt: localDateTime(today, '14:30'),
        reason: 'Diabetes monthly check-up & fasting glucose',
        status: 'CONFIRMED',
        createdById: reception.id,
      },
      {
        patientId: patients[5].id,
        doctorId: dr2.id,
        startAt: localDateTime(today, '15:00'),
        endAt: localDateTime(today, '15:30'),
        reason: 'Sports knee injury follow-up',
        status: 'SCHEDULED',
        createdById: reception.id,
      },
    ],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDatabase({ includeDemo: true })
    .then(() => {
      console.log('MediFlow database seeded.');
      return prisma.$disconnect();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

