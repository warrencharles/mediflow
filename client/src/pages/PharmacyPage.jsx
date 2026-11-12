import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Pill, PackagePlus, AlertTriangle, Edit3, Sliders, Truck, Search, Layers, RotateCcw, Trash2, ChevronDown, ChevronUp, Boxes } from 'lucide-react';
import { api, fmtTSh, fmtDate, fmtDateTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal, ActionMenu } from '../context/UIContext.jsx';

const EMPTY_MED = {
  name: '',
  genericName: '',
  brandName: '',
  category: 'Antibiotic',
  form: 'Tablet',
  unit: 'tablet',
  sellingPrice: 500,
  reorderLevel: 30,
};

export default function PharmacyPage() {
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') || (can('prescriptions.view') ? 'prescriptions' : 'inventory');
  const [tab, setTabState] = useState(initialTab);
  const setTab = (next) => {
    setTabState(next);
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const [searchQ, setSearchQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [dispenseQty, setDispenseQty] = useState({});
  const [medicines, setMedicines] = useState([]);
  const [alerts, setAlerts] = useState({ lowStock: [], expired: [], expiringSoon: [] });
  const [dispensations, setDispensations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [expandedSupplier, setExpandedSupplier] = useState(null);

  const [showMedModal, setShowMedModal] = useState(false);
  const [editingMed, setEditingMed] = useState(null);
  const [medForm, setMedForm] = useState(EMPTY_MED);

  const [showStockModal, setShowStockModal] = useState(false);
  const [stockForm, setStockForm] = useState({
    medicineId: '',
    batchNumber: '',
    expiryDate: '2028-06-30',
    quantity: 100,
    purchasePrice: 200,
    supplierId: '',
    reference: '',
  });

  const [adjustMed, setAdjustMed] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ batchId: '', type: 'ADJUSTMENT_OUT', quantity: 1, reason: '' });

  const [editingBatch, setEditingBatch] = useState(null);
  const [batchForm, setBatchForm] = useState({
    batchNumber: '',
    expiryDate: '',
    purchasePrice: 0,
    supplierId: '',
  });

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', email: '', address: '' });

  const load = async () => {
    if (can('prescriptions.view')) {
      api('/pharmacy/prescriptions?status=OPEN').then((r) => {
        setPrescriptions(r.items);
        const rxParam = params.get('rx');
        if (rxParam && !selectedRx) openRx(rxParam);
      });
    }
    if (can('medicines.view')) {
      api('/pharmacy/medicines').then((m) => {
        setMedicines(m);
        if (m[0]) setStockForm((f) => ({ ...f, medicineId: f.medicineId || m[0].id }));
      });
      api('/pharmacy/alerts').then(setAlerts);
    }
    if (can('pharmacy.dispense') || can('reports.inventory')) {
      api('/pharmacy/dispensations').then((r) => setDispensations(r.items));
    }
    if (can('pharmacy.manage')) {
      api('/pharmacy/suppliers').then((s) => {
        setSuppliers(s);
        if (s[0]) setStockForm((f) => ({ ...f, supplierId: f.supplierId || s[0].id }));
      });
    }
  };

  useEffect(() => {
    const t = params.get('tab');
    if (t) {
      if (t === 'stock') setTabState('inventory');
      else if (t === 'dispensations') setTabState('history');
      else setTabState(t);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, []);

  const openRx = async (id) => {
    const r = await api(`/pharmacy/prescriptions/${id}`);
    setSelectedRx(r);
    const map = {};
    for (const it of r.items) {
      map[it.id] = Math.min(it.remaining, it.stockAvailable);
    }
    setDispenseQty(map);
  };

  const submitDispense = async (e) => {
    e.preventDefault();
    const items = Object.entries(dispenseQty)
      .map(([prescriptionItemId, quantity]) => ({
        prescriptionItemId: Number(prescriptionItemId),
        quantity: Number(quantity),
      }))
      .filter((x) => x.quantity > 0);
    if (!items.length) {
      toast('Enter a quantity greater than zero to dispense.', 'error');
      return;
    }
    const ok = await confirm({
      title: `Confirm Dispensing for ${selectedRx.prescriptionNumber}?`,
      message: `Deducts ${items.length} medicine line(s) from earliest-expiring stock batches (FEFO) and posts charges to ${selectedRx.patient.firstName} ${selectedRx.patient.lastName}'s visit invoice.`,
      confirmText: 'Dispense & Deduct Stock',
    });
    if (!ok) return;
    try {
      await api(`/pharmacy/prescriptions/${selectedRx.id}/dispense`, { method: 'POST', body: { items } });
      toast(`Prescription ${selectedRx.prescriptionNumber} dispensed and stock deducted.`);
      setSelectedRx(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reverseDispensation = async (d) => {
    const reason = await confirm({
      title: `Reverse / Undo Dispensation ${d.dispenseNumber}?`,
      message: `Restores all dispensed quantities back to their original medicine batches, voids the medicine charge (${fmtTSh(d.totalAmount)}) on the patient's invoice, and reopens the prescription.`,
      confirmText: 'Reverse Dispensation',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for reversing dispensation *',
      inputPlaceholder: 'e.g. Entered wrong quantity / patient returned unopened pack before payment',
    });
    if (!reason) return;
    try {
      await api(`/pharmacy/dispensations/${d.id}/reverse`, { method: 'POST', body: { reason } });
      toast(`Dispensation ${d.dispenseNumber} reversed and stock restored.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteMedicine = async (m) => {
    const ok = await confirm({
      title: `Delete Medicine "${m.name}"?`,
      message:
        'Only newly added medicines with zero batches or prescriptions can be deleted. Medicines with stock or clinical history cannot be deleted.',
      confirmText: 'Delete Medicine',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/pharmacy/medicines/${m.id}`, { method: 'DELETE' });
      toast(`Deleted medicine ${m.name}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteBatch = async (b) => {
    const ok = await confirm({
      title: `Delete Untouched Batch "${b.batchNumber}"?`,
      message:
        'Only batches that have not been dispensed or adjusted can be deleted. For active batches, use Stock Adjustment or Expired Write-Off instead.',
      confirmText: 'Delete Batch',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/pharmacy/batches/${b.id}`, { method: 'DELETE' });
      toast(`Batch ${b.batchNumber} deleted.`);
      if (adjustMed) {
        const refreshed = await api(`/pharmacy/medicines/${adjustMed.id}`);
        setAdjustMed(refreshed);
      }
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteSupplier = async (s) => {
    const ok = await confirm({
      title: `Delete Supplier "${s.name}"?`,
      message: 'Removes this supplier if no stock batches are linked to them.',
      confirmText: 'Delete Supplier',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/pharmacy/suppliers/${s.id}`, { method: 'DELETE' });
      toast(`Supplier ${s.name} deleted.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openCreateMed = () => {
    setEditingMed(null);
    setMedForm(EMPTY_MED);
    setShowMedModal(true);
  };

  const openEditMed = (m) => {
    setEditingMed(m);
    setMedForm({
      name: m.name,
      genericName: m.genericName || '',
      brandName: m.brandName || '',
      category: m.category || 'General',
      form: m.form || '',
      unit: m.unit || 'tablet',
      sellingPrice: m.sellingPrice ?? 500,
      reorderLevel: m.reorderLevel ?? 30,
    });
    setShowMedModal(true);
  };

  const saveMed = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...medForm,
        sellingPrice: Number(medForm.sellingPrice),
        reorderLevel: Number(medForm.reorderLevel),
      };
      if (editingMed) {
        await api(`/pharmacy/medicines/${editingMed.id}`, { method: 'PUT', body: payload });
        toast(`Updated ${medForm.name}.`);
      } else {
        await api('/pharmacy/medicines', { method: 'POST', body: payload });
        toast(`Registered ${medForm.name}.`);
      }
      setShowMedModal(false);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openRestockFor = (medicineId) => {
    setStockForm((f) => ({
      ...f,
      medicineId: medicineId || medicines[0]?.id || '',
      batchNumber: `B-${new Date().getFullYear()}-${String(Math.floor(100 + Math.random() * 900))}`,
      expiryDate: '2028-06-30',
      quantity: 100,
    }));
    setShowStockModal(true);
  };

  const receiveStock = async (e) => {
    e.preventDefault();
    try {
      await api('/pharmacy/stock-in', {
        method: 'POST',
        body: {
          ...stockForm,
          medicineId: Number(stockForm.medicineId),
          quantity: Number(stockForm.quantity),
          purchasePrice: Number(stockForm.purchasePrice),
          supplierId: stockForm.supplierId ? Number(stockForm.supplierId) : null,
        },
      });
      setShowStockModal(false);
      toast('Stock batch received into inventory.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openAdjustModal = async (m, preselectBatchId = null, preselectType = 'ADJUSTMENT_OUT', preselectQty = 1) => {
    const detail = await api(`/pharmacy/medicines/${m.id}`);
    setAdjustMed(detail);
    setAdjustForm({
      batchId: preselectBatchId || detail.batches?.[0]?.id || '',
      type: preselectType,
      quantity: preselectQty || 1,
      reason: preselectType === 'EXPIRED_WRITE_OFF' ? 'Expired batch write-off from stock' : '',
    });
  };

  const submitAdjustment = async (e) => {
    e.preventDefault();
    const ok = await confirm({
      title: `Confirm Stock Adjustment (${adjustForm.type})?`,
      message: `Applies a quantity change of ${adjustForm.quantity} unit(s) on the selected batch and logs the reason in the inventory audit ledger.`,
      confirmText: 'Record Adjustment',
      danger: adjustForm.type !== 'ADJUSTMENT_IN',
    });
    if (!ok) return;
    try {
      await api('/pharmacy/adjustments', {
        method: 'POST',
        body: {
          batchId: Number(adjustForm.batchId),
          type: adjustForm.type,
          quantity: Number(adjustForm.quantity),
          reason: adjustForm.reason,
        },
      });
      toast('Stock adjustment recorded in audit ledger.');
      setAdjustMed(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const openBatchEditor = (b, medName) => {
    setEditingBatch({ ...b, medName: medName || b.medicine?.name || 'Medicine' });
    setBatchForm({
      batchNumber: b.batchNumber,
      expiryDate: fmtDate(b.expiryDate),
      purchasePrice: b.purchasePrice ?? 200,
      supplierId: b.supplierId || b.supplier?.id || '',
    });
  };

  const saveBatchEdit = async (e) => {
    e.preventDefault();
    try {
      await api(`/pharmacy/batches/${editingBatch.id}`, {
        method: 'PUT',
        body: {
          batchNumber: batchForm.batchNumber,
          expiryDate: batchForm.expiryDate,
          purchasePrice: Number(batchForm.purchasePrice),
          supplierId: batchForm.supplierId ? Number(batchForm.supplierId) : null,
        },
      });
      toast(`Batch ${batchForm.batchNumber} updated.`);
      setEditingBatch(null);
      if (adjustMed) {
        const refreshed = await api(`/pharmacy/medicines/${adjustMed.id}`);
        setAdjustMed(refreshed);
      }
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const saveSupplier = async (e) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        await api(`/pharmacy/suppliers/${editingSupplier.id}`, { method: 'PUT', body: supplierForm });
        toast('Supplier updated.');
      } else {
        await api('/pharmacy/suppliers', { method: 'POST', body: supplierForm });
        toast('Supplier added.');
      }
      setShowSupplierModal(false);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const filteredMedicines = medicines.filter((m) => {
    if (lowOnly && !m.lowStock) return false;
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return (
      m.name?.toLowerCase().includes(q) ||
      m.genericName?.toLowerCase().includes(q) ||
      m.brandName?.toLowerCase().includes(q) ||
      m.category?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pharmacy & Medicine Inventory</h1>
          <p className="text-xs text-slate-500">
            FEFO batch dispensing, real-time stock deduction, batch editing, stock adjustments, suppliers & alerts
          </p>
        </div>
        {can('pharmacy.manage') && (
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={openCreateMed}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border bg-white font-semibold hover:bg-slate-50"
            >
              <Pill className="w-4 h-4" /> Register Medicine
            </button>
            <button
              onClick={() => openRestockFor(medicines[0]?.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold shadow-xs"
            >
              <PackagePlus className="w-4 h-4" /> Receive Stock Batch
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-5 text-xs font-semibold overflow-x-auto">
        {can('prescriptions.view') && (
          <button
            onClick={() => setTab('prescriptions')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'prescriptions' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Pending Prescriptions ({prescriptions.length})
          </button>
        )}
        {can('medicines.view') && (
          <button
            onClick={() => setTab('inventory')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'inventory' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Medicine Stock ({medicines.length})
          </button>
        )}
        {can('medicines.view') && (
          <button
            onClick={() => setTab('alerts')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'alerts' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Low-Stock & Expiry Alerts ({alerts.lowStock.length + alerts.expired.length + alerts.expiringSoon.length})
          </button>
        )}
        {can('pharmacy.manage') && (
          <button
            onClick={() => setTab('suppliers')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'suppliers' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Suppliers ({suppliers.length})
          </button>
        )}
        {(can('pharmacy.dispense') || can('reports.inventory')) && (
          <button
            onClick={() => setTab('history')}
            className={`pb-2.5 border-b-2 whitespace-nowrap ${tab === 'history' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
              }`}
          >
            Dispensing History ({dispensations.length})
          </button>
        )}
      </div>

      {/* Prescriptions Queue */}
      {tab === 'prescriptions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white rounded-xl border divide-y">
            {prescriptions.map((rx) => (
              <div key={rx.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div className="font-bold text-slate-900">
                    {rx.prescriptionNumber} · {rx.patient.firstName} {rx.patient.lastName}{' '}
                    <span className="font-mono text-slate-400">({rx.patient.patientNumber})</span>
                  </div>
                  <div className="text-slate-500">
                    Prescribed by {rx.doctor.fullName} · {fmtDateTime(rx.createdAt)}
                  </div>
                  <div className="mt-1 text-slate-700">
                    {rx.items.map((i) => `${i.medicine.name} (${i.quantityDispensed}/${i.quantity})`).join(' · ')}
                  </div>
                </div>
                <button
                  onClick={() => openRx(rx.id)}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold"
                >
                  Open & Dispense →
                </button>
              </div>
            ))}
            {prescriptions.length === 0 && (
              <div className="p-8 text-center text-slate-400">No pending prescriptions waiting for dispensing.</div>
            )}
          </div>

          {selectedRx && (
            <form onSubmit={submitDispense} className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h2 className="font-bold text-sm">
                    Dispense {selectedRx.prescriptionNumber} — {selectedRx.patient.firstName}{' '}
                    {selectedRx.patient.lastName}
                  </h2>
                  {selectedRx.patient.allergies && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">
                      Allergies: {selectedRx.patient.allergies}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setSelectedRx(null)} className="text-slate-400">
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                {selectedRx.items.map((it) => (
                  <div
                    key={it.id}
                    className="p-3 rounded-lg bg-slate-50 border flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{it.medicine.name}</div>
                      <div className="text-slate-500">
                        {it.dosage} · {it.frequency} · Prescribed: <b>{it.quantity}</b> · Remaining:{' '}
                        <b>{it.remaining}</b> · Available in stock:{' '}
                        <b className={it.stockAvailable < it.remaining ? 'text-rose-600' : 'text-emerald-700'}>
                          {it.stockAvailable}
                        </b>
                      </div>
                    </div>
                    {can('pharmacy.dispense') && (
                      <div className="flex items-center gap-2">
                        <label className="text-slate-500">Dispense:</label>
                        <input
                          type="number"
                          min="0"
                          max={Math.min(it.remaining, it.stockAvailable)}
                          value={dispenseQty[it.id] ?? 0}
                          onChange={(e) => setDispenseQty({ ...dispenseQty, [it.id]: e.target.value })}
                          className="w-20 px-2 py-1 border rounded bg-white text-right font-bold"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {can('pharmacy.dispense') && (
                <button className="w-full py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold">
                  Confirm Dispense & Deduct Inventory
                </button>
              )}
            </form>
          )}
        </div>
      )}

      {/* Inventory table with Search, Restock, Edit & Batch/Stock Adjustment actions */}
      {tab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 bg-white p-3 rounded-xl border border-slate-200 text-xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Filter medicines by name, brand, generic or category…"
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-teal-500"
              />
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-slate-50 font-semibold cursor-pointer">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Show Low-Stock Only
            </label>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Medicine</th>
                  <th className="py-3 px-4">Brand / Generic</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Selling Price</th>
                  <th className="py-3 px-4">Available Stock</th>
                  <th className="py-3 px-4">Next Expiry</th>
                  {can('pharmacy.manage') && <th className="py-3 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredMedicines.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{m.name}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {m.brandName || '—'} / {m.genericName || '—'}
                    </td>
                    <td className="py-3 px-4">{m.category}</td>
                    <td className="py-3 px-4 font-semibold">{fmtTSh(m.sellingPrice)}</td>
                    <td className="py-3 px-4">
                      <span className={`font-bold ${m.lowStock ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {m.stock} / {m.reorderLevel} {m.unit}
                      </span>
                      {m.lowStock && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-[10px] font-bold">
                          LOW
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">{fmtDate(m.nextExpiry)}</td>
                    {can('pharmacy.manage') && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <ActionMenu
                          primary={
                            <button
                              onClick={() => openRestockFor(m.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 font-semibold"
                            >
                              <PackagePlus className="w-3 h-3" /> + Stock In
                            </button>
                          }
                          items={[
                            {
                              label: 'Batches & Adjust Stock',
                              tone: 'teal',
                              onClick: () => openAdjustModal(m),
                            },
                            {
                              label: 'Edit Medicine / Reorder Level',
                              onClick: () => openEditMed(m),
                            },
                            m.stock === 0 && {
                              label: 'Delete Unused Medicine',
                              danger: true,
                              onClick: () => deleteMedicine(m),
                            },
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actionable Alerts Tab */}
      {tab === 'alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          {/* Low-Stock Medicines with Direct Restock, Edit & Adjust Actions */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2.5">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-orange-600" /> Low-Stock Medicines ({alerts.lowStock.length})
              </h3>
              <span className="text-[11px] text-slate-500">At or below reorder threshold</span>
            </div>

            {alerts.lowStock.length === 0 ? (
              <div className="py-6 text-center text-slate-400">No medicines are currently low on stock.</div>
            ) : (
              <div className="space-y-2.5">
                {alerts.lowStock.map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-xl bg-orange-50/70 border border-orange-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{m.name}</div>
                      <div className="text-[11px] text-orange-900 font-semibold mt-0.5">
                        Available: <b>{m.stock}</b> {m.unit} · Reorder Level: <b>{m.reorderLevel}</b> {m.unit} · Price:{' '}
                        {fmtTSh(m.sellingPrice || 0)}
                      </div>
                    </div>
                    {can('pharmacy.manage') && (
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => openRestockFor(m.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                        >
                          <PackagePlus className="w-3.5 h-3.5" /> Restock
                        </button>
                        <button
                          onClick={() => openEditMed(m)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit / Reorder Level
                        </button>
                        <button
                          onClick={() => openAdjustModal(m)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700"
                        >
                          <Sliders className="w-3.5 h-3.5" /> Adjust
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expiring Soon & Expired Batches with Direct Edit Batch, Write-Off & Restock Actions */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2.5">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Expiring Soon / Expired Batches (
                {alerts.expired.length + alerts.expiringSoon.length})
              </h3>
              <span className="text-[11px] text-slate-500">Within 90 days or past expiry</span>
            </div>

            {alerts.expired.length === 0 && alerts.expiringSoon.length === 0 ? (
              <div className="py-6 text-center text-slate-400">No expiring or expired medicine batches.</div>
            ) : (
              <div className="space-y-2.5">
                {[
                  ...alerts.expired.map((b) => ({ ...b, isExpired: true })),
                  ...alerts.expiringSoon.map((b) => ({ ...b, isExpired: false })),
                ].map((b) => (
                  <div
                    key={b.id}
                    className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${b.isExpired
                      ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                      : 'bg-amber-50/80 border-amber-200 text-amber-950'
                      }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5 flex-wrap">
                        <span>{b.medicine.name}</span>
                        <span className="font-mono text-xs">· Batch {b.batchNumber}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${b.isExpired ? 'bg-rose-600 text-white' : 'bg-amber-200 text-amber-950'
                            }`}
                        >
                          {b.isExpired ? 'EXPIRED' : 'EXPIRING'} {fmtDate(b.expiryDate)}
                        </span>
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5">
                        Remaining in batch: <b>{b.quantityRemaining}</b> {b.medicine.unit} · Cost:{' '}
                        {fmtTSh(b.purchasePrice || 0)}
                      </div>
                    </div>
                    {can('pharmacy.manage') && (
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => openBatchEditor(b, b.medicine.name)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Batch
                        </button>
                        <button
                          onClick={() =>
                            openAdjustModal(
                              { id: b.medicine.id, name: b.medicine.name },
                              b.id,
                              b.isExpired ? 'EXPIRED_WRITE_OFF' : 'ADJUSTMENT_OUT',
                              b.quantityRemaining,
                            )
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold text-white ${b.isExpired ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-700 hover:bg-amber-800'
                            }`}
                        >
                          <Sliders className="w-3.5 h-3.5" /> {b.isExpired ? 'Write Off Expired' : 'Adjust Batch'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suppliers */}
      {tab === 'suppliers' && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Approved Pharmaceutical Suppliers</h2>
              <p className="text-slate-500 text-xs">
                Manage registered vendors and inspect itemized stock batches delivered by each supplier
              </p>
            </div>
            <button
              onClick={() => {
                setEditingSupplier(null);
                setSupplierForm({ name: '', phone: '', email: '', address: '' });
                setShowSupplierModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold shadow-xs hover:bg-teal-700"
            >
              <Truck className="w-4 h-4" /> Add New Supplier
            </button>
          </div>

          <div className="space-y-4">
            {suppliers.map((s) => {
              const batches = s.batches || [];
              const totalUnitsRecv = batches.reduce((acc, b) => acc + (b.quantityReceived || 0), 0);
              const totalUnitsRem = batches.reduce((acc, b) => acc + (b.quantityRemaining || 0), 0);
              const totalSpend = batches.reduce((acc, b) => acc + (b.purchasePrice * b.quantityReceived || 0), 0);
              const isExpanded = expandedSupplier === s.id;

              return (
                <div key={s.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  {/* Supplier Header */}
                  <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{s.name}</span>
                        <span className="px-2 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 font-bold text-[10px]">
                          {batches.length} Batch{batches.length === 1 ? '' : 'es'} Supplied
                        </span>
                      </div>
                      <div className="text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {s.phone && <span>Tel: <b>{s.phone}</b></span>}
                        {s.email && <span>Email: <b>{s.email}</b></span>}
                        {s.address && <span>Address: <b>{s.address}</b></span>}
                      </div>
                    </div>

                    {/* Financial & Stock Totals */}
                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                      <div className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Total Delivered</div>
                        <div className="font-bold text-slate-800">{totalUnitsRecv.toLocaleString()} units</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Available Stock</div>
                        <div className="font-bold text-teal-700">{totalUnitsRem.toLocaleString()} units</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Total Procurement</div>
                        <div className="font-bold text-slate-900">{fmtTSh(totalSpend)}</div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setStockForm((f) => ({
                              ...f,
                              supplierId: s.id,
                              batchNumber: `BAT-${Date.now().toString().slice(-4)}`,
                              reference: `PO-${s.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}`,
                            }));
                            setShowStockModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-xs"
                          title="Receive new batch from this supplier"
                        >
                          <PackagePlus className="w-3.5 h-3.5" /> + Receive Stock
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedSupplier(isExpanded ? null : s.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700 text-xs"
                        >
                          <Boxes className="w-3.5 h-3.5 text-slate-500" />
                          <span>{isExpanded ? 'Hide Stock' : 'View Stock'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => {
                            setEditingSupplier(s);
                            setSupplierForm({
                              name: s.name,
                              phone: s.phone || '',
                              email: s.email || '',
                              address: s.address || '',
                            });
                            setShowSupplierModal(true);
                          }}
                          className="px-2.5 py-2 rounded-lg border hover:bg-slate-100 font-semibold text-slate-700 text-xs"
                          title="Edit supplier contact info"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteSupplier(s)}
                          className="px-2.5 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs"
                          title="Delete supplier"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Itemized Stock Batches Brought by this Supplier */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-100 bg-white">
                      <div className="font-bold text-xs text-slate-800 mb-2 flex items-center justify-between">
                        <span>Stock Batches Delivered by {s.name} ({batches.length})</span>
                        <span className="text-[11px] text-slate-400 font-normal">Real-time inventory ledger</span>
                      </div>
                      {batches.length === 0 ? (
                        <div className="py-6 text-center text-slate-400 bg-slate-50/60 rounded-lg border border-dashed">
                          No stock batches recorded under this supplier yet. Click "+ Receive Stock" above to record a shipment.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-b">
                              <tr>
                                <th className="py-2.5 px-3">Batch #</th>
                                <th className="py-2.5 px-3">Medicine Name</th>
                                <th className="py-2.5 px-3">Date Received</th>
                                <th className="py-2.5 px-3">Expiry Date</th>
                                <th className="py-2.5 px-3 text-right">Qty Received</th>
                                <th className="py-2.5 px-3 text-right">In Stock</th>
                                <th className="py-2.5 px-3 text-right">Unit Cost</th>
                                <th className="py-2.5 px-3 text-right">Batch Total</th>
                                <th className="py-2.5 px-3">Received By</th>
                                <th className="py-2.5 px-3 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {batches.map((b) => {
                                const isExpired = new Date(b.expiryDate) < new Date();
                                const isLow = b.quantityRemaining <= 10 && b.quantityRemaining > 0;
                                const isDepleted = b.quantityRemaining === 0;

                                return (
                                  <tr key={b.id} className="hover:bg-slate-50/80">
                                    <td className="py-2.5 px-3 font-mono font-bold text-teal-700">{b.batchNumber}</td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-bold text-slate-900">{b.medicine?.name}</div>
                                      <div className="text-[10px] text-slate-400">{b.medicine?.genericName || b.medicine?.category}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-600">{fmtDate(b.receivedAt)}</td>
                                    <td className="py-2.5 px-3 text-slate-600">{fmtDate(b.expiryDate)}</td>
                                    <td className="py-2.5 px-3 text-right font-semibold">{b.quantityReceived.toLocaleString()} {b.medicine?.unit}</td>
                                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                                      {b.quantityRemaining.toLocaleString()} {b.medicine?.unit}
                                    </td>
                                    <td className="py-2.5 px-3 text-right">{fmtTSh(b.purchasePrice)}</td>
                                    <td className="py-2.5 px-3 text-right font-semibold">{fmtTSh(b.purchasePrice * b.quantityReceived)}</td>
                                    <td className="py-2.5 px-3 text-slate-500">{b.receivedBy?.fullName || 'System Staff'}</td>
                                    <td className="py-2.5 px-3 text-center">
                                      {isDepleted ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Depleted</span>
                                      ) : isExpired ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Expired</span>
                                      ) : isLow ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Low Stock</span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dispensing history */}
      {tab === 'history' && (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4">Dispense #</th>
                <th className="py-3 px-4">Date / Time</th>
                <th className="py-3 px-4">Patient</th>
                <th className="py-3 px-4">Items Dispensed</th>
                <th className="py-3 px-4">Pharmacist</th>
                <th className="py-3 px-4 text-right">Amount</th>
                {(can('pharmacy.dispense') || can('pharmacy.manage')) && (
                  <th className="py-3 px-4 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {dispensations.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-bold text-teal-700">{d.dispenseNumber}</td>
                  <td className="py-3 px-4">{fmtDateTime(d.createdAt)}</td>
                  <td className="py-3 px-4 font-semibold">
                    <Link to={`/patients/${d.patient.id}`} className="hover:text-teal-700 hover:underline">
                      {d.patient.firstName} {d.patient.lastName}
                    </Link>
                  </td>
                  <td className="py-3 px-4">
                    {d.items.map((i) => `${i.medicine.name} ×${i.quantity} (Batch ${i.batch.batchNumber})`).join(', ')}
                  </td>
                  <td className="py-3 px-4">{d.pharmacist.fullName}</td>
                  <td className="py-3 px-4 text-right font-bold">{fmtTSh(d.totalAmount)}</td>
                  {(can('pharmacy.dispense') || can('pharmacy.manage')) && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => reverseDispensation(d)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
                      >
                        <RotateCcw className="w-3 h-3" /> Reverse / Undo
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Register / Edit Medicine Modal */}
      <Modal
        open={showMedModal}
        onClose={() => setShowMedModal(false)}
        title={editingMed ? `Edit Medicine — ${editingMed.name}` : 'Register Medicine in Formulary'}
        subtitle="Manage medicine details, unit selling price, and low-stock reorder alert level"
      >
        <form onSubmit={saveMed} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Medicine Name *</label>
            <input
              required
              value={medForm.name}
              onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Brand Name</label>
              <input
                value={medForm.brandName}
                onChange={(e) => setMedForm({ ...medForm, brandName: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Generic Name</label>
              <input
                value={medForm.genericName}
                onChange={(e) => setMedForm({ ...medForm, genericName: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Category *</label>
              <input
                required
                value={medForm.category}
                onChange={(e) => setMedForm({ ...medForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Dosage Form</label>
              <input
                value={medForm.form}
                onChange={(e) => setMedForm({ ...medForm, form: e.target.value })}
                placeholder="Tablet / Syrup / Vial"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold block mb-1">Unit *</label>
              <input
                required
                value={medForm.unit}
                onChange={(e) => setMedForm({ ...medForm, unit: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Selling Price *</label>
              <input
                type="number"
                required
                value={medForm.sellingPrice}
                onChange={(e) => setMedForm({ ...medForm, sellingPrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Reorder Level *</label>
              <input
                type="number"
                required
                value={medForm.reorderLevel}
                onChange={(e) => setMedForm({ ...medForm, reorderLevel: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowMedModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Medicine</button>
          </div>
        </form>
      </Modal>

      {/* Receive Stock Batch Modal */}
      <Modal
        open={showStockModal}
        onClose={() => setShowStockModal(false)}
        title="Receive Medicine Batch (Stock-In)"
        subtitle="Record new batch number, expiry date, purchase price and quantity received"
      >
        <form onSubmit={receiveStock} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Medicine</label>
            <select
              value={stockForm.medicineId}
              onChange={(e) => setStockForm({ ...stockForm, medicineId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (Current stock: {m.stock} {m.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Batch Number *</label>
              <input
                required
                value={stockForm.batchNumber}
                onChange={(e) => setStockForm({ ...stockForm, batchNumber: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Expiry Date *</label>
              <input
                type="date"
                required
                value={stockForm.expiryDate}
                onChange={(e) => setStockForm({ ...stockForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Quantity Received *</label>
              <input
                type="number"
                min="1"
                required
                value={stockForm.quantity}
                onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Purchase Price (TSh) *</label>
              <input
                type="number"
                min="0"
                required
                value={stockForm.purchasePrice}
                onChange={(e) => setStockForm({ ...stockForm, purchasePrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          {suppliers.length > 0 && (
            <div>
              <label className="font-semibold block mb-1">Supplier</label>
              <select
                value={stockForm.supplierId}
                onChange={(e) => setStockForm({ ...stockForm, supplierId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">— Select supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowStockModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Receive Stock</button>
          </div>
        </form>
      </Modal>

      {/* Batches & Stock Adjustment Modal */}
      <Modal
        open={!!adjustMed}
        onClose={() => setAdjustMed(null)}
        title={adjustMed ? `Batches & Stock Adjustment — ${adjustMed.name}` : ''}
        subtitle="Inspect or edit individual batches, or record an audited stock adjustment / expired write-off"
        maxWidth="max-w-2xl"
      >
        {adjustMed && (
          <div className="space-y-4">
            {/* Existing batches table with Edit Batch button */}
            <div className="border rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b font-bold text-slate-700 flex items-center justify-between">
                <span>Recorded Batches ({adjustMed.batches?.length || 0})</span>
                <button
                  type="button"
                  onClick={() => {
                    const id = adjustMed.id;
                    setAdjustMed(null);
                    openRestockFor(id);
                  }}
                  className="text-teal-700 hover:underline font-semibold"
                >
                  + Receive New Batch
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y">
                {adjustMed.batches?.map((b) => (
                  <div key={b.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-slate-900">Batch {b.batchNumber}</span> · Remaining:{' '}
                      <b>{b.quantityRemaining}</b> / {b.quantityReceived} · Exp: <b>{fmtDate(b.expiryDate)}</b> · Cost:{' '}
                      {fmtTSh(b.purchasePrice)}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openBatchEditor(b, adjustMed.name)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border hover:bg-slate-50 font-semibold"
                      >
                        <Edit3 className="w-3 h-3" /> Edit Batch
                      </button>
                      {b.quantityRemaining === b.quantityReceived && (
                        <button
                          type="button"
                          onClick={() => deleteBatch(b)}
                          title="Delete untouched batch"
                          className="p-1.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(!adjustMed.batches || adjustMed.batches.length === 0) && (
                  <div className="p-4 text-center text-slate-400">No batches received yet.</div>
                )}
              </div>
            </div>

            {adjustMed.batches?.length > 0 && (
              <form onSubmit={submitAdjustment} className="space-y-3 pt-2 border-t">
                <div className="font-bold text-slate-900">Record Stock Adjustment / Write-Off</div>
                <div>
                  <label className="font-semibold block mb-1">Select Batch</label>
                  <select
                    value={adjustForm.batchId}
                    onChange={(e) => setAdjustForm({ ...adjustForm, batchId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {adjustMed.batches?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNumber} (Remaining: {b.quantityRemaining}, Exp {fmtDate(b.expiryDate)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold block mb-1">Adjustment Type</label>
                    <select
                      value={adjustForm.type}
                      onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="ADJUSTMENT_OUT">Stock Out / Damaged (−)</option>
                      <option value="ADJUSTMENT_IN">Stock Count Gain (+)</option>
                      <option value="EXPIRED_WRITE_OFF">Expired Write-Off (−)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold block mb-1">Quantity *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={adjustForm.quantity}
                      onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Reason for Adjustment (Audit Logged) *</label>
                  <input
                    required
                    value={adjustForm.reason}
                    onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                    placeholder="e.g. Physical stock-take reconciliation / broken vial / expired write-off"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setAdjustMed(null)} className="px-4 py-2 border rounded-lg">
                    Close
                  </button>
                  <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">
                    Record Adjustment
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>

      {/* Edit Individual Batch Modal */}
      <Modal
        open={!!editingBatch}
        onClose={() => setEditingBatch(null)}
        title={editingBatch ? `Edit Batch ${editingBatch.batchNumber} (${editingBatch.medName})` : ''}
        subtitle="Update batch number, expiration date, purchase price or supplier"
      >
        <form onSubmit={saveBatchEdit} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Batch Number *</label>
            <input
              required
              value={batchForm.batchNumber}
              onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Expiry Date *</label>
              <input
                type="date"
                required
                value={batchForm.expiryDate}
                onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Purchase Price (TSh) *</label>
              <input
                type="number"
                min="0"
                required
                value={batchForm.purchasePrice}
                onChange={(e) => setBatchForm({ ...batchForm, purchasePrice: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          {suppliers.length > 0 && (
            <div>
              <label className="font-semibold block mb-1">Supplier</label>
              <select
                value={batchForm.supplierId}
                onChange={(e) => setBatchForm({ ...batchForm, supplierId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">— No supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setEditingBatch(null)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Batch Changes</button>
          </div>
        </form>
      </Modal>

      {/* Supplier Modal */}
      <Modal
        open={showSupplierModal}
        onClose={() => setShowSupplierModal(false)}
        title={editingSupplier ? `Edit Supplier — ${editingSupplier.name}` : 'Add Pharmaceutical Supplier'}
      >
        <form onSubmit={saveSupplier} className="space-y-3">
          <div>
            <label className="font-semibold block mb-1">Supplier Name *</label>
            <input
              required
              placeholder="e.g. MSD Tanzania / Salama Pharmaceuticals"
              value={supplierForm.name}
              onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Phone</label>
            <input
              placeholder="+255..."
              value={supplierForm.phone}
              onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Email</label>
            <input
              placeholder="orders@supplier.co.tz"
              value={supplierForm.email}
              onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Address</label>
            <input
              placeholder="City / Industrial Area"
              value={supplierForm.address}
              onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowSupplierModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Supplier</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
