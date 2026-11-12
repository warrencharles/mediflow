import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Printer, FileText, Plus, Edit3, XCircle, RotateCcw, Trash2 } from 'lucide-react';
import { api, fmtDateTime, fmtTSh } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI, UploadProgressBox, Modal, ActionMenu } from '../context/UIContext.jsx';

export default function LabPage() {
  const { can } = useAuth();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'requests';
  const statusFilter = params.get('status') || 'OPEN';
  const setTab = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const setStatusFilter = (next) => {
    const p = new URLSearchParams(params);
    p.set('status', next);
    setParams(p, { replace: true });
  };
  const [requests, setRequests] = useState([]);
  const [tests, setTests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [resultForm, setResultForm] = useState({
    result: '',
    resultValue: '',
    isAbnormal: false,
    amendmentReason: '',
  });
  const [showTestModal, setShowTestModal] = useState(false);
  const [editingTest, setEditingTest] = useState(null);
  const [testForm, setTestForm] = useState({
    code: '',
    name: '',
    category: 'Haematology',
    price: 10000,
    normalRange: '',
    unit: '',
  });

  const load = async () => {
    const r = await api(`/lab/requests?status=${statusFilter}`);
    setRequests(r.items);
    if (can('lab.catalog') || can('lab.view')) {
      api('/lab/tests?active=all').then(setTests);
    }
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  const openReq = (lr) => {
    setSelected(lr);
    setResultForm({
      result: lr.result || '',
      resultValue: lr.resultValue || '',
      isAbnormal: !!lr.isAbnormal,
      amendmentReason: '',
    });
  };

  const submitResult = async (e) => {
    e.preventDefault();
    try {
      const updated = await api(`/lab/requests/${selected.id}/result`, {
        method: 'POST',
        body: resultForm,
      });
      toast(`Lab result saved for ${selected.requestNumber}.`);
      setSelected(updated);
      load();
    } catch (e2) {
      toast(e2.details ? Object.values(e2.details).join(' · ') : e2.message, 'error');
    }
  };

  const cancelRequest = async (lr) => {
    const reason = await confirm({
      title: `Cancel Lab Request ${lr.requestNumber}?`,
      message: 'Cancels the unperformed test and voids its charge on the patient invoice.',
      confirmText: 'Cancel Request',
      danger: true,
      requireInput: true,
      inputLabel: 'Reason for cancelling lab request *',
    });
    if (!reason) return;
    try {
      await api(`/lab/requests/${lr.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Lab request cancelled.');
      setSelected(null);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const reopenRequest = async (lr) => {
    const ok = await confirm({
      title: `Reopen Lab Request ${lr.requestNumber} (${lr.labTest.name})?`,
      message: 'Restores this lab investigation to PENDING so results can be entered or re-run.',
      confirmText: 'Reopen Request',
    });
    if (!ok) return;
    try {
      const updated = await api(`/lab/requests/${lr.id}/reopen`, {
        method: 'POST',
        body: { reason: 'Reopened in Lab' },
      });
      toast(`Lab request ${lr.requestNumber} reopened to PENDING.`);
      setSelected(updated);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const deleteTest = async (t) => {
    const ok = await confirm({
      title: `Delete Lab Test "${t.name}" (${t.code})?`,
      message:
        'Only newly added tests with zero historical lab requests can be permanently deleted. Used tests remain in the catalogue.',
      confirmText: 'Delete Test',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/lab/tests/${t.id}`, { method: 'DELETE' });
      toast(`Deleted lab test ${t.code}.`);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  const saveTest = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...testForm, price: Number(testForm.price) };
      if (editingTest) {
        await api(`/lab/tests/${editingTest.id}`, { method: 'PUT', body: payload });
        toast('Lab test updated.');
      } else {
        await api('/lab/tests', { method: 'POST', body: payload });
        toast('Lab test added to catalogue.');
      }
      setShowTestModal(false);
      load();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Laboratory Management</h1>
          <p className="text-xs text-slate-500">
            Track requested diagnostic tests, record results, upload lab documents & print reports
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab('requests')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${tab === 'requests' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-600'
              }`}
          >
            Lab Queue & Results
          </button>
          {can('lab.catalog') && (
            <button
              onClick={() => setTab('catalog')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${tab === 'catalog' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-600'
                }`}
            >
              Test Catalogue ({tests.length})
            </button>
          )}
        </div>
      </div>

      {tab === 'requests' && (
        <>
          <div className="no-print flex gap-2 text-xs">
            {['OPEN', 'COMPLETED', 'CANCELLED', 'ALL'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg font-semibold ${statusFilter === st ? 'bg-teal-600 text-white' : 'bg-white border text-slate-600'
                  }`}
              >
                {st === 'OPEN' ? 'Pending Tests' : st}
              </button>
            ))}
          </div>

          <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
            <div className="bg-white rounded-xl border divide-y">
              {requests.map((lr) => (
                <div key={lr.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-teal-700">{lr.requestNumber}</span>
                      {lr.priority === 'URGENT' && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                          URGENT
                        </span>
                      )}
                      <span className="font-bold text-slate-900">{lr.labTest.name}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      Patient:{' '}
                      <Link to={`/patients/${lr.patient.id}`} className="font-bold text-slate-800 hover:text-teal-700 hover:underline">
                        {lr.patient.firstName} {lr.patient.lastName}
                      </Link>{' '}
                      ({lr.patient.patientNumber}) · Ordered by {lr.doctor.fullName}
                    </div>
                    {lr.result && (
                      <div
                        className={`mt-1 ${lr.isAbnormal ? 'text-rose-700 font-bold' : 'text-emerald-700 font-semibold'
                          }`}
                      >
                        Result: {lr.resultValue ? `${lr.resultValue} — ` : ''}
                        {lr.result}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {['PENDING', 'IN_PROGRESS'].includes(lr.status) && (can('lab.results') || can('lab.request')) && (
                      <button
                        onClick={() => cancelRequest(lr)}
                        className="p-1.5 rounded text-rose-600 hover:bg-rose-50"
                        title="Cancel Request"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {['CANCELLED', 'COMPLETED'].includes(lr.status) && (can('lab.results') || can('lab.request')) && (
                      <button
                        onClick={() => reopenRequest(lr)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 font-semibold"
                        title="Reopen to Pending"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reopen
                      </button>
                    )}
                    <button
                      onClick={() => openReq(lr)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold"
                    >
                      {lr.status === 'COMPLETED' ? 'View / Amend / Print' : 'Enter Result'}
                    </button>
                  </div>
                </div>
              ))}
              {requests.length === 0 && (
                <div className="p-8 text-center text-slate-400">No laboratory requests in this view.</div>
              )}
            </div>

            {selected && (
              <div className="animate-modal bg-white rounded-xl border p-6 space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h2 className="font-bold text-sm">
                      Laboratory Report — {selected.requestNumber} ({selected.labTest.name})
                    </h2>
                    <div className="text-slate-500">
                      Patient: {selected.patient.firstName} {selected.patient.lastName} ({selected.patient.patientNumber}
                      ) · Normal range: {selected.labTest.normalRange || '—'} {selected.labTest.unit || ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Report
                  </button>
                </div>

                {selected.resultFilePath && (
                  <a
                    href={`/api/lab/requests/${selected.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-teal-700 font-semibold hover:underline"
                  >
                    <FileText className="w-4 h-4" /> Attached Result Document ({selected.resultFileName || 'Open'})
                  </a>
                )}

                {can('lab.results') ? (
                  <div className="space-y-4">
                    <form onSubmit={submitResult} className="space-y-3">
                      <div>
                        <label className="font-semibold block mb-1">Quantitative Value / Summary</label>
                        <input
                          value={resultForm.resultValue}
                          onChange={(e) => setResultForm({ ...resultForm, resultValue: e.target.value })}
                          placeholder="e.g. 5.1 mmol/L or Positive (Pf)"
                          className="w-full px-3 py-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="font-semibold block mb-1">Full Findings & Interpretation *</label>
                        <textarea
                          rows={3}
                          required
                          value={resultForm.result}
                          onChange={(e) => setResultForm({ ...resultForm, result: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg"
                        />
                      </div>
                      <label className="flex items-center gap-2 font-semibold text-rose-700">
                        <input
                          type="checkbox"
                          checked={resultForm.isAbnormal}
                          onChange={(e) => setResultForm({ ...resultForm, isAbnormal: e.target.checked })}
                        />
                        Flag result as Abnormal (alerts requesting doctor immediately)
                      </label>
                      {selected.status === 'COMPLETED' && (
                        <div>
                          <label className="font-semibold block mb-1 text-amber-800">
                            Reason for Amending Completed Result *
                          </label>
                          <input
                            required
                            value={resultForm.amendmentReason}
                            onChange={(e) => setResultForm({ ...resultForm, amendmentReason: e.target.value })}
                            placeholder="Explain correction to completed lab result…"
                            className="w-full px-3 py-2 border border-amber-300 rounded-lg"
                          />
                        </div>
                      )}
                      <button className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold">
                        {selected.status === 'COMPLETED'
                          ? 'Save Amended Result'
                          : 'Save Result & Mark Test Completed'}
                      </button>
                    </form>

                    {resultForm.result && (
                      <div className="pt-3 border-t">
                        <div className="font-semibold text-slate-700 mb-1.5">
                          Attach Scanned Lab Document (PDF or Image with Progress Bar)
                        </div>
                        <UploadProgressBox
                          url={`/lab/requests/${selected.id}/result`}
                          fieldName="file"
                          extraFields={{
                            result: resultForm.result,
                            resultValue: resultForm.resultValue,
                            isAbnormal: resultForm.isAbnormal,
                            amendmentReason:
                              selected.status === 'COMPLETED'
                                ? resultForm.amendmentReason || 'Attached result scan'
                                : undefined,
                          }}
                          accept="application/pdf,image/*"
                          label="Select PDF or image scan to upload…"
                          onSuccess={(updated) => {
                            toast('Lab document uploaded and attached.');
                            setSelected(updated);
                            load();
                          }}
                          onError={(e) => toast(e.message, 'error')}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-500">Value:</span> <b>{selected.resultValue || '—'}</b>
                    </div>
                    <div>
                      <span className="text-slate-500">Findings:</span> <b>{selected.result || 'Pending'}</b>
                    </div>
                    <div>
                      <span className="text-slate-500">Entered At:</span> {fmtDateTime(selected.resultEnteredAt)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Test Catalogue Management */}
      {tab === 'catalog' && (
        <div className="no-print space-y-4 text-xs">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setEditingTest(null);
                setTestForm({ code: '', name: '', category: 'Haematology', price: 10000, normalRange: '', unit: '' });
                setShowTestModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold"
            >
              <Plus className="w-4 h-4" /> Add Diagnostic Test
            </button>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Test Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Normal Range</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tests.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 px-4 font-mono font-bold text-teal-700">{t.code}</td>
                    <td className="py-2.5 px-4 font-semibold">{t.name}</td>
                    <td className="py-2.5 px-4">{t.category || '—'}</td>
                    <td className="py-2.5 px-4 text-slate-500">
                      {t.normalRange || '—'} {t.unit || ''}
                    </td>
                    <td className="py-2.5 px-4 font-bold">{fmtTSh(t.price)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <ActionMenu
                        primary={
                          <button
                            onClick={() => {
                              setEditingTest(t);
                              setTestForm({
                                code: t.code,
                                name: t.name,
                                category: t.category || '',
                                price: t.price,
                                normalRange: t.normalRange || '',
                                unit: t.unit || '',
                              });
                              setShowTestModal(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border hover:bg-slate-50 font-semibold"
                          >
                            <Edit3 className="w-3 h-3" /> Edit
                          </button>
                        }
                        items={[
                          {
                            label: 'Delete Unused Test',
                            danger: true,
                            onClick: () => deleteTest(t),
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
        open={showTestModal}
        onClose={() => setShowTestModal(false)}
        title={editingTest ? `Edit Lab Test — ${editingTest.code}` : 'Add Diagnostic Test'}
        subtitle="Configure test code, name, reference range, unit and price"
      >
        <form onSubmit={saveTest} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Test Code *</label>
              <input
                required
                placeholder="e.g. HBA1C"
                value={testForm.code}
                onChange={(e) => setTestForm({ ...testForm, code: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Price (TSh) *</label>
              <input
                type="number"
                required
                placeholder="Price (TSh)"
                value={testForm.price}
                onChange={(e) => setTestForm({ ...testForm, price: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Full Test Name *</label>
            <input
              required
              placeholder="e.g. Glycated Haemoglobin (HbA1c)"
              value={testForm.name}
              onChange={(e) => setTestForm({ ...testForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Category</label>
              <input
                placeholder="Haematology / Biochemistry"
                value={testForm.category}
                onChange={(e) => setTestForm({ ...testForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Unit</label>
              <input
                placeholder="e.g. mmol/L"
                value={testForm.unit}
                onChange={(e) => setTestForm({ ...testForm, unit: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold block mb-1">Normal Reference Range</label>
            <input
              placeholder="e.g. 4.0 – 5.6%"
              value={testForm.normalRange}
              onChange={(e) => setTestForm({ ...testForm, normalRange: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowTestModal(false)} className="px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold">Save Test</button>
          </div>
        </form>
      </Modal>

      {/* Dedicated Printable Laboratory Report Sheet (ONLY this prints!) */}
      {selected && (
        <div className="hidden print-only print-sheet text-xs space-y-4">
          <div className="border-b-2 border-slate-900 pb-3 flex justify-between items-start">
            <div>
              <h1 className="text-lg font-bold">MediFlow Healthcare Group — Diagnostic Laboratory</h1>
              <p className="text-slate-600">Official Laboratory Investigation Report</p>
            </div>
            <div className="text-right">
              <div>Request #: <b>{selected.requestNumber}</b></div>
              <div>Reported: <b>{fmtDateTime(selected.resultEnteredAt || selected.createdAt)}</b></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 border rounded">
            <div>Patient: <b>{selected.patient.firstName} {selected.patient.lastName}</b></div>
            <div>Patient ID: <b>{selected.patient.patientNumber}</b></div>
            <div>Requesting Doctor: <b>{selected.doctor.fullName}</b></div>
            <div>Investigation: <b>{selected.labTest.name} ({selected.labTest.code})</b></div>
          </div>

          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-slate-100">
                <th className="border p-2 text-left">Test Parameter</th>
                <th className="border p-2 text-left">Result / Value</th>
                <th className="border p-2 text-left">Reference Range</th>
                <th className="border p-2 text-left">Flag</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2 font-semibold">{selected.labTest.name}</td>
                <td className="border p-2 font-bold">{selected.resultValue || selected.result || 'Pending'}</td>
                <td className="border p-2">
                  {selected.labTest.normalRange || '—'} {selected.labTest.unit || ''}
                </td>
                <td className="border p-2 font-bold">{selected.isAbnormal ? 'ABNORMAL' : 'Normal'}</td>
              </tr>
            </tbody>
          </table>

          <div>
            <div className="font-bold uppercase text-[11px] text-slate-500">Full Laboratory Findings & Comments</div>
            <div className="p-3 border rounded">{selected.result || '—'}</div>
          </div>

          <div className="pt-8 flex justify-between">
            <div>Verified By: <b>{selected.resultEnteredBy?.fullName || 'Laboratory Staff'}</b></div>
            <div>Signature & Stamp: ___________________________</div>
          </div>
        </div>
      )}
    </div>
  );
}
