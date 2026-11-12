import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Printer, Plus, Ban, Trash2, Edit3, RotateCcw } from 'lucide-react';
import { api, fmtTSh, fmtDateTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, Modal, ActionMenu } from '../context/UIContext.jsx';

const METHODS = [
  ['CASH', 'Cash'],
  ['MPESA', 'M-Pesa'],
  ['TIGO_PESA', 'Tigo Pesa'],
  ['AIRTEL_MONEY', 'Airtel Money'],
  ['BANK_TRANSFER', 'Bank Transfer'],
];

export default function BillingPage() {
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'invoices';
  const [status, setStatusState] = useState(params.get('status') || '');
  const setTab = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const setStatus = (next) => {
    setStatusState(next);
    const p = new URLSearchParams(params);
    if (next) p.set('status', next);
    else p.delete('status');
    setParams(p, { replace: true });
  };
  const [invoices, setInvoices] = useState([]);
  const [totals, setTotals] = useState({ total: 0, paid: 0, balance: 0 });
  const [selected, setSelected] = useState(null);
  const [services, setServices] = useState([]);
  const [payForm, setPayForm] = useState({ amount: '', method: 'CASH', reference: '', notes: '' });
  const [discForm, setDiscForm] = useState({ amount: '', reason: '' });
  const [addItemForm, setAddItemForm] = useState({ serviceId: '', description: '', quantity: 1, unitPrice: '' });

  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [serviceForm, setServiceForm] = useState({ code: '', name: '', category: 'PROCEDURE', price: 15000 });

  const load = async () => {
    const r = await api(`/billing/invoices?status=${status}`);
    setInvoices(r.items);
    setTotals(r.totals);
    const openId = params.get('invoice');
    if (openId && !selected) openInvoice(openId);
    else if (!selected && r.items[0]) openInvoice(r.items[0].id);
  };

  useEffect(() => {
    load();
    api('/billing/services?active=all').then((s) => {
      setServices(s);
      if (s[0]) setAddItemForm((f) => ({ ...f, serviceId: s[0].id }));
    });
  }, [status]);

  const openInvoice = async (id) => {
    const inv = await api(`/billing/invoices/${id}`);
    setSelected(inv);
    setPayForm({ amount: inv.balance > 0 ? String(inv.balance) : '', method: 'CASH', reference: '', notes: '' });
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    const ok = await confirm({
      title: `Confirm Payment of ${fmtTSh(Number(payForm.amount))}?`,
      message: `Records a ${payForm.method} payment for ${selected.patient.firstName} ${selected.patient.lastName} on Invoice ${selected.invoiceNumber} and issues an official receipt.`,
      confirmText: 'Receive Payment & Issue Receipt',
    });
    if (!ok) return;
    try {
      const r = await api(`/billing/invoices/${selected.id}/payments`, {
        method: 'POST',
        body: {
          amount: Number(payForm.amount),
          method: payForm.method,
          reference: payForm.reference || undefined,
          notes: payForm.notes || undefined,
        },
      });
      setSelected(r.invoice);
      setPayForm({
        amount: r.invoice.balance > 0 ? String(r.invoice.balance) : '',
        method: 'CASH',
        reference: '',
        notes: '',
      });
      toast(`Payment received! Receipt ${r.payment.receiptNumber} issued.`);
      load();
    } catch (e2) {
      toast(e2.details ? Object.values(e2.details).join(' · ') : e2.message, 'error');
    }
  };

  const addChargeItem = async (e) => {
    e.preventDefault();
    try {
      const body = addItemForm.serviceId
        ? { serviceId: Number(addItemForm.serviceId), quantity: Number(addItemForm.quantity) }
        : {
          type: 'OTHER',
          description: addItemForm.description,
          quantity: Number(addItemForm.quantity),
          unitPrice: Number(addItemForm.unitPrice),
        };
      const inv = await api(`/billing/invoices/${selected.id}/items`, { method: 'POST', body });
      setSelected(inv);
      toast('Service charge added to invoice.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const voidItem = async (item) => {
    const reason = await confirm({
      title: `Void Charge "${item.description}" (${fmtTSh(item.lineTotal)})?`,
      message: 'Financial records are never deleted. This line item will be marked VOIDED with your reason in the audit trail.',
      confirmText: 'Void Charge',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for voiding charge *',
    });
    if (!reason) return;
    try {
      const inv = await api(`/billing/invoices/${selected.id}/items/${item.id}/void`, {
        method: 'POST',
        body: { reason },
      });
      setSelected(inv);
      toast('Invoice item voided.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const restoreItem = async (item) => {
    const ok = await confirm({
      title: `Restore Voided Charge "${item.description}" (${fmtTSh(item.lineTotal)})?`,
      message: 'Restores this charge back onto the active invoice and recalculates the balance.',
      confirmText: 'Restore Charge',
    });
    if (!ok) return;
    try {
      const inv = await api(`/billing/invoices/${selected.id}/items/${item.id}/restore`, { method: 'POST' });
      setSelected(inv);
      toast('Voided charge restored to invoice.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const voidPayment = async (p) => {
    const reason = await confirm({
      title: `Void Payment Receipt ${p.receiptNumber} (${fmtTSh(p.amount)})?`,
      message: 'Marks this receipt VOIDED in the ledger and restores the balance on the invoice.',
      confirmText: 'Void Receipt',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for voiding receipt (min 5 chars) *',
    });
    if (!reason) return;
    try {
      const inv = await api(`/billing/payments/${p.id}/void`, { method: 'POST', body: { reason } });
      setSelected(inv);
      toast(`Receipt ${p.receiptNumber} voided.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const requestDiscount = async (e) => {
    e.preventDefault();
    try {
      const inv = await api(`/billing/invoices/${selected.id}/discounts`, {
        method: 'POST',
        body: { amount: Number(discForm.amount), reason: discForm.reason },
      });
      setSelected(inv);
      setDiscForm({ amount: '', reason: '' });
      toast('Discount request submitted for Clinic Manager approval.');
    } catch (e2) {
      toast(e2.details ? Object.values(e2.details).join(' · ') : e2.message, 'error');
    }
  };

  const decideDiscount = async (discId, approve) => {
    const ok = await confirm({
      title: `${approve ? 'Approve' : 'Reject'} Discount Request?`,
      message: approve
        ? 'Deducts this discount amount from the invoice total and logs your approval in the audit trail.'
        : 'Marks this discount request as rejected.',
      confirmText: approve ? 'Approve Discount' : 'Reject Discount',
      danger: !approve,
    });
    if (!ok) return;
    const inv = await api(`/billing/discounts/${discId}/decide`, { method: 'POST', body: { approve } });
    setSelected(inv);
    toast(`Discount ${approve ? 'approved' : 'rejected'}.`);
    load();
  };

  const revokeDiscount = async (disc) => {
    const reason = await confirm({
      title: `Revoke Approved Discount (${fmtTSh(disc.amount)})?`,
      message: 'Revokes this discount and restores the original balance on the invoice.',
      confirmText: 'Revoke Discount',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for revoking discount *',
    });
    if (!reason) return;
    try {
      const inv = await api(`/billing/discounts/${disc.id}/revoke`, { method: 'POST', body: { reason } });
      setSelected(inv);
      toast('Discount revoked and invoice recalculated.');
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reopenInvoice = async () => {
    const ok = await confirm({
      title: `Reopen Cancelled Invoice ${selected.invoiceNumber}?`,
      message: 'Restores this invoice back to UNPAID and recalculates its active charges.',
      confirmText: 'Reopen Invoice',
    });
    if (!ok) return;
    try {
      const inv = await api(`/billing/invoices/${selected.id}/reopen`, {
        method: 'POST',
        body: { reason: 'Reopened from billing' },
      });
      setSelected(inv);
      toast(`Invoice ${selected.invoiceNumber} reopened.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteService = async (s) => {
    const ok = await confirm({
      title: `Delete Service Tariff "${s.name}" (${s.code})?`,
      message: 'Only newly created services that have never been billed on an invoice can be deleted.',
      confirmText: 'Delete Service',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/billing/services/${s.id}`, { method: 'DELETE' });
      toast(`Service ${s.code} deleted.`);
      api('/billing/services?active=all').then(setServices);
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const cancelInvoice = async () => {
    const reason = await confirm({
      title: `Cancel Invoice ${selected.invoiceNumber}?`,
      message: 'Cancels this unpaid invoice while preserving the full audit record.',
      confirmText: 'Cancel Invoice',
      danger: true,
      requireInput: true,
      inputLabel: 'Cancellation Reason (min 5 chars) *',
    });
    if (!reason) return;
    try {
      const inv = await api(`/billing/invoices/${selected.id}/cancel`, { method: 'POST', body: { reason } });
      setSelected(inv);
      toast(`Invoice ${selected.invoiceNumber} cancelled.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const saveService = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...serviceForm, price: Number(serviceForm.price) };
      if (editingService) {
        await api(`/billing/services/${editingService.id}`, { method: 'PUT', body: payload });
        toast('Service updated.');
      } else {
        await api('/billing/services', { method: 'POST', body: payload });
        toast('Service added.');
      }
      setShowServiceModal(false);
      api('/billing/services?active=all').then(setServices);
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Billing, Invoices & Payments</h1>
          <p className="text-xs text-slate-500">
            Total Invoiced: <b>{fmtTSh(totals.total)}</b> · Total Received:{' '}
            <b className="text-emerald-700">{fmtTSh(totals.paid)}</b> · Outstanding Balance:{' '}
            <b className="text-rose-700">{fmtTSh(totals.balance)}</b>
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab('invoices')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${tab === 'invoices' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-600'
              }`}
          >
            Invoices & Cashier
          </button>
          {can('services.manage') && (
            <button
              onClick={() => setTab('services')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${tab === 'services' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-600'
                }`}
            >
              Clinic Tariff / Services ({services.length})
            </button>
          )}
        </div>
      </div>

      {tab === 'invoices' && (
        <>
          <div className="no-print flex gap-1.5 text-xs">
            {[
              ['', 'All Invoices'],
              ['OUTSTANDING', 'Unpaid / Partial'],
              ['PAID', 'Paid'],
              ['CANCELLED', 'Cancelled'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={`px-3 py-1.5 rounded-lg font-semibold ${status === k ? 'bg-teal-600 text-white' : 'bg-white border text-slate-600'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
            {/* Invoices list */}
            <div className="lg:col-span-5 bg-white rounded-xl border divide-y max-h-[75vh] overflow-y-auto">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => openInvoice(inv.id)}
                  className={`p-4 cursor-pointer hover:bg-slate-50 flex items-center justify-between ${selected?.id === inv.id ? 'bg-teal-50/70' : ''
                    }`}
                >
                  <div>
                    <div className="font-mono font-bold text-teal-800">{inv.invoiceNumber}</div>
                    <div className="font-semibold text-slate-900">
                      {inv.patient.firstName} {inv.patient.lastName}
                    </div>
                    <div className="text-slate-400">{fmtDateTime(inv.createdAt)}</div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${inv.status === 'PAID'
                        ? 'bg-emerald-100 text-emerald-800'
                        : inv.status === 'PARTIALLY_PAID'
                          ? 'bg-amber-100 text-amber-800'
                          : inv.status === 'CANCELLED'
                            ? 'bg-slate-200 text-slate-500'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                    >
                      {inv.status}
                    </span>
                    <div className="font-bold text-slate-900 mt-1">{fmtTSh(inv.total)}</div>
                    {inv.balance > 0 && <div className="text-rose-600 font-semibold">Bal: {fmtTSh(inv.balance)}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Invoice detail & payment receipt */}
            <div className="lg:col-span-7">
              {selected ? (
                <div className="bg-white rounded-xl border p-6 space-y-5">
                  <div className="flex items-start justify-between border-b pb-4">
                    <div>
                      <div className="font-mono font-bold text-teal-700 text-sm">{selected.invoiceNumber}</div>
                      <h2 className="text-base font-bold text-slate-900">
                        <Link to={`/patients/${selected.patient.id}`} className="hover:text-teal-700 hover:underline">
                          {selected.patient.firstName} {selected.patient.lastName}
                        </Link>{' '}
                        ({selected.patient.patientNumber})
                      </h2>
                      <div className="text-slate-500">
                        Issued: {fmtDateTime(selected.createdAt)} · Status: <b>{selected.status}</b>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"
                      >
                        <Printer className="w-3.5 h-3.5" /> Print Invoice / Receipt
                      </button>
                      {can('billing.cancel') && selected.status !== 'CANCELLED' && selected.amountPaid === 0 && (
                        <button
                          onClick={cancelInvoice}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold"
                        >
                          <Ban className="w-3.5 h-3.5" /> Cancel Invoice
                        </button>
                      )}
                      {can('billing.cancel') && selected.status === 'CANCELLED' && (
                        <button
                          onClick={reopenInvoice}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 font-semibold"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reopen Invoice
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Line items */}
                  <table className="w-full text-left">
                    <thead className="border-b text-slate-500 uppercase text-[11px]">
                      <tr>
                        <th className="py-2">Charge Description</th>
                        <th className="py-2">Type</th>
                        <th className="py-2 text-right">Qty</th>
                        <th className="py-2 text-right">Unit Price</th>
                        <th className="py-2 text-right">Total</th>
                        {can('billing.cancel') && <th className="py-2 text-right">Void</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selected.items.map((it) => (
                        <tr key={it.id} className={it.voided ? 'line-through text-slate-400' : ''}>
                          <td className="py-2 font-medium">
                            {it.description}
                            {it.voidReason && (
                              <span className="ml-2 text-[10px] text-rose-500 no-underline">(Voided: {it.voidReason})</span>
                            )}
                          </td>
                          <td className="py-2 text-slate-500">{it.type}</td>
                          <td className="py-2 text-right">{it.quantity}</td>
                          <td className="py-2 text-right">{fmtTSh(it.unitPrice)}</td>
                          <td className="py-2 text-right font-semibold">{fmtTSh(it.lineTotal)}</td>
                          {can('billing.cancel') && (
                            <td className="py-2 text-right">
                              {!it.voided && it.sourceType !== 'Dispensation' && (
                                <button
                                  onClick={() => voidItem(it)}
                                  className="text-rose-600 hover:bg-rose-50 p-1 rounded"
                                  title="Void charge"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {it.voided && it.sourceType !== 'Dispensation' && (
                                <button
                                  onClick={() => restoreItem(it)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-semibold no-underline"
                                  title="Restore voided charge"
                                >
                                  <RotateCcw className="w-3 h-3" /> Restore
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Add extra service/procedure charge */}
                  {can('billing.write') && selected.status !== 'CANCELLED' && (
                    <form onSubmit={addChargeItem} className="flex flex-wrap gap-2 pt-2 border-t">
                      <select
                        value={addItemForm.serviceId}
                        onChange={(e) => setAddItemForm({ ...addItemForm, serviceId: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 border rounded-lg"
                      >
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({fmtTSh(s.price)})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={addItemForm.quantity}
                        onChange={(e) => setAddItemForm({ ...addItemForm, quantity: e.target.value })}
                        className="w-16 px-2 py-1.5 border rounded-lg text-center"
                      />
                      <button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border font-semibold hover:bg-slate-50">
                        <Plus className="w-3.5 h-3.5" /> Add Charge
                      </button>
                    </form>
                  )}

                  {/* Totals box */}
                  <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-right">
                    <div>
                      Subtotal: <b>{fmtTSh(selected.subtotal)}</b>
                    </div>
                    {selected.discountAmount > 0 && (
                      <div className="text-teal-700">Approved Discount: −{fmtTSh(selected.discountAmount)}</div>
                    )}
                    <div className="text-sm font-bold">Invoice Total: {fmtTSh(selected.total)}</div>
                    <div className="text-emerald-700 font-semibold">Amount Paid: {fmtTSh(selected.amountPaid)}</div>
                    <div className="text-sm font-bold text-rose-700">
                      Outstanding Balance: {fmtTSh(selected.balance)}
                    </div>
                  </div>

                  {/* Payments history */}
                  <div className="space-y-2">
                    <h3 className="font-bold text-slate-800">Recorded Payments & Receipts</h3>
                    {selected.payments.map((p) => (
                      <div
                        key={p.id}
                        className={`p-2.5 rounded border flex items-center justify-between ${p.status === 'VOIDED'
                          ? 'bg-slate-100 line-through text-slate-400'
                          : 'bg-emerald-50/60 border-emerald-200'
                          }`}
                      >
                        <div>
                          <span className="font-mono font-bold text-emerald-900">{p.receiptNumber}</span> · {p.method}{' '}
                          {p.reference ? `(${p.reference})` : ''} · {fmtDateTime(p.paidAt)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{fmtTSh(p.amount)}</span>
                          {p.status === 'VALID' && can('billing.cancel') && (
                            <button
                              onClick={() => voidPayment(p)}
                              className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold hover:bg-rose-200"
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {selected.payments.length === 0 && <div className="text-slate-400">No payments received yet.</div>}
                  </div>

                  {/* Record payment form */}
                  {can('billing.write') && selected.status !== 'CANCELLED' && selected.balance > 0 && (
                    <form onSubmit={recordPayment} className="border-t pt-4 space-y-3">
                      <div className="font-bold text-slate-900">Record Payment (Full or Partial)</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          min="1"
                          max={selected.balance}
                          required
                          placeholder="Amount (TSh)"
                          value={payForm.amount}
                          onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                          className="px-3 py-2 border rounded-lg font-bold"
                        />
                        <select
                          value={payForm.method}
                          onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                          className="px-3 py-2 border rounded-lg"
                        >
                          {METHODS.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          placeholder={payForm.method === 'CASH' ? 'Reference (optional)' : 'Txn Reference *'}
                          required={payForm.method !== 'CASH'}
                          value={payForm.reference}
                          onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                          className="px-3 py-2 border rounded-lg"
                        />
                      </div>
                      <button className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold">
                        Receive Payment & Issue Receipt
                      </button>
                    </form>
                  )}

                  {/* Discounts */}
                  {selected.discounts?.length > 0 && (
                    <div className="space-y-1.5 border-t pt-3">
                      <div className="font-bold">Discount Requests</div>
                      {selected.discounts.map((d) => (
                        <div key={d.id} className="p-2 rounded bg-slate-50 border flex items-center justify-between">
                          <span>
                            {fmtTSh(d.amount)} — {d.reason} (<b>{d.status}</b>)
                          </span>
                          {d.status === 'PENDING' && can('billing.discount.approve') && (
                            <div className="space-x-1">
                              <button
                                onClick={() => decideDiscount(d.id, true)}
                                className="px-2 py-1 rounded bg-emerald-600 text-white font-semibold"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => decideDiscount(d.id, false)}
                                className="px-2 py-1 rounded bg-rose-600 text-white font-semibold"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {d.status === 'APPROVED' && can('billing.discount.approve') && (
                            <button
                              onClick={() => revokeDiscount(d)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-700 font-semibold text-[11px]"
                            >
                              <RotateCcw className="w-3 h-3" /> Revoke
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(can('billing.discount.request') || can('billing.discount.approve')) &&
                    selected.status !== 'CANCELLED' &&
                    selected.balance > 0 && (
                      <form onSubmit={requestDiscount} className="flex gap-2 border-t pt-3">
                        <input
                          type="number"
                          min="1"
                          placeholder="Discount TSh"
                          value={discForm.amount}
                          onChange={(e) => setDiscForm({ ...discForm, amount: e.target.value })}
                          className="w-36 px-2.5 py-1.5 border rounded-lg"
                        />
                        <input
                          placeholder="Reason for discount"
                          value={discForm.reason}
                          onChange={(e) => setDiscForm({ ...discForm, reason: e.target.value })}
                          className="flex-1 px-2.5 py-1.5 border rounded-lg"
                        />
                        <button className="px-3 py-1.5 border rounded-lg font-semibold hover:bg-slate-50">
                          Request Discount
                        </button>
                      </form>
                    )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border p-10 text-center text-slate-400">
                  Select an invoice on the left to inspect charges, record payments or print a receipt.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Clinic Tariff / Services Catalogue */}
      {tab === 'services' && (
        <div className="no-print space-y-4 text-xs">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setEditingService(null);
                setServiceForm({ code: '', name: '', category: 'PROCEDURE', price: 15000 });
                setShowServiceModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold"
            >
              <Plus className="w-4 h-4" /> Add Service Tariff
            </button>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Service Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {services.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-4 font-mono font-bold text-teal-700">{s.code}</td>
                    <td className="py-2.5 px-4 font-semibold">{s.name}</td>
                    <td className="py-2.5 px-4">{s.category}</td>
                    <td className="py-2.5 px-4 font-bold">{fmtTSh(s.price)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <ActionMenu
                        primary={
                          <button
                            onClick={() => {
                              setEditingService(s);
                              setServiceForm({ code: s.code, name: s.name, category: s.category, price: s.price });
                              setShowServiceModal(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border hover:bg-slate-50 font-semibold"
                          >
                            <Edit3 className="w-3 h-3" /> Edit
                          </button>
                        }
                        items={[
                          {
                            label: 'Delete Unused Service',
                            danger: true,
                            onClick: () => deleteService(s),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        title={editingService ? `Edit Service — ${editingService.code}` : 'Add Service Tariff'}
        subtitle="Configure clinic service code, category and standard tariff price"
      >
        <form onSubmit={saveService} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Service Code *</label>
              <input
                required
                placeholder="e.g. PROC-ECG"
                value={serviceForm.code}
                onChange={(e) => setServiceForm({ ...serviceForm, code: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Category *</label>
              <select
                value={serviceForm.category}
                onChange={(e) => setServiceForm({ ...serviceForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="CONSULTATION">Consultation</option>
                <option value="PROCEDURE">Procedure</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Service Description *</label>
            <input
              required
              placeholder="e.g. 12-Lead Electrocardiogram (ECG)"
              value={serviceForm.name}
              onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Price (TSh) *</label>
            <input
              type="number"
              required
              placeholder="Price (TSh)"
              value={serviceForm.price}
              onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowServiceModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Service</button>
          </div>
        </form>
      </Modal>

      {/* Dedicated Printable Invoice & Official Payment Receipt Sheet (ONLY this prints!) */}
      {selected && (
        <div className="hidden print-only print-sheet text-xs space-y-4">
          <div className="border-b-2 border-slate-900 pb-3 flex justify-between items-start">
            <div>
              <h1 className="text-lg font-bold">MediFlow Healthcare Group — Dar es Salaam</h1>
              <p className="text-slate-600">Plot 42, Ali Hassan Mwinyi Road · Tel: +255 22 266 4800 · TIN: 132-894-210</p>
              <p className="font-bold mt-1">OFFICIAL PATIENT INVOICE & PAYMENT RECEIPT</p>
            </div>
            <div className="text-right">
              <div>Invoice #: <b>{selected.invoiceNumber}</b></div>
              <div>Date: <b>{fmtDateTime(selected.createdAt)}</b></div>
              <div>Status: <b>{selected.status}</b></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 border rounded">
            <div>Patient Name: <b>{selected.patient.firstName} {selected.patient.lastName}</b></div>
            <div>Patient ID: <b>{selected.patient.patientNumber}</b></div>
            <div>Phone: <b>{selected.patient.phone}</b></div>
          </div>

          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-slate-100">
                <th className="border p-2 text-left">Description</th>
                <th className="border p-2 text-left">Category</th>
                <th className="border p-2 text-right">Qty</th>
                <th className="border p-2 text-right">Unit Price</th>
                <th className="border p-2 text-right">Total (TSh)</th>
              </tr>
            </thead>
            <tbody>
              {selected.items
                .filter((it) => !it.voided)
                .map((it) => (
                  <tr key={it.id}>
                    <td className="border p-2">{it.description}</td>
                    <td className="border p-2">{it.type}</td>
                    <td className="border p-2 text-right">{it.quantity}</td>
                    <td className="border p-2 text-right">{fmtTSh(it.unitPrice)}</td>
                    <td className="border p-2 text-right font-semibold">{fmtTSh(it.lineTotal)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-right">
              <div>Subtotal: <b>{fmtTSh(selected.subtotal)}</b></div>
              {selected.discountAmount > 0 && <div>Discount: −{fmtTSh(selected.discountAmount)}</div>}
              <div className="text-sm font-bold border-t pt-1">Invoice Total: {fmtTSh(selected.total)}</div>
              <div>Amount Paid: <b>{fmtTSh(selected.amountPaid)}</b></div>
              <div className="text-sm font-bold">Balance Due: {fmtTSh(selected.balance)}</div>
            </div>
          </div>

          {selected.payments.filter((p) => p.status === 'VALID').length > 0 && (
            <div>
              <div className="font-bold uppercase text-[11px] text-slate-500 mb-1">Payments Received</div>
              <table className="w-full border-collapse border">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border p-1.5 text-left">Receipt #</th>
                    <th className="border p-1.5 text-left">Date / Time</th>
                    <th className="border p-1.5 text-left">Method & Ref</th>
                    <th className="border p-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.payments
                    .filter((p) => p.status === 'VALID')
                    .map((p) => (
                      <tr key={p.id}>
                        <td className="border p-1.5 font-mono font-bold">{p.receiptNumber}</td>
                        <td className="border p-1.5">{fmtDateTime(p.paidAt)}</td>
                        <td className="border p-1.5">
                          {p.method} {p.reference ? `(${p.reference})` : ''}
                        </td>
                        <td className="border p-1.5 text-right font-bold">{fmtTSh(p.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-6 text-center text-slate-500 border-t">
            Asante kwa kutuchagua · Thank you for choosing MediFlow Clinic
          </div>
        </div>
      )}
    </div>
  );
}
