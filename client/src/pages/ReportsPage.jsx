import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import { api, todayStr, fmtTSh } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const REPORTS = [
  { key: 'revenue', label: 'Daily / Weekly / Monthly Revenue', perm: 'reports.financial', hasGroup: true },
  { key: 'payments', label: 'Payment Transactions Ledger', perm: 'reports.financial' },
  { key: 'outstanding', label: 'Outstanding Patient Balances', perm: 'reports.financial' },
  { key: 'medicine-sales', label: 'Medicine Sales & Gross Margin', perm: 'reports.financial' },
  { key: 'patients', label: 'Patient Registrations', perm: 'reports.clinical' },
  { key: 'doctor-performance', label: 'Doctor Performance', perm: 'reports.clinical' },
  { key: 'inventory', label: 'Medicine Inventory & Valuation', perm: 'reports.inventory' },
  { key: 'stock-movements', label: 'Stock Movements Ledger', perm: 'reports.inventory' },
];

export default function ReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const available = REPORTS.filter((r) => can(r.perm));
  const [type, setType] = useState(params.get('type') || available[0]?.key || 'revenue');
  const [from, setFrom] = useState(params.get('from') || todayStr());
  const [to, setTo] = useState(params.get('to') || todayStr());
  const [groupBy, setGroupBy] = useState(params.get('groupBy') || 'day');
  const [report, setReport] = useState(null);

  const load = async () => {
    setParams({ type, from, to, groupBy }, { replace: true });
    const r = await api(`/reports/${type}?from=${from}&to=${to}&groupBy=${groupBy}`);
    setReport(r);
  };

  useEffect(() => {
    load();
  }, [type, from, to, groupBy]);

  const exportUrl = (format) => `/api/reports/${type}?from=${from}&to=${to}&groupBy=${groupBy}&format=${format}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Management Reports & Exports</h1>
          <p className="text-xs text-slate-500">
            All reports are calculated directly from verified database transactions and exportable to PDF & Excel
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <a
            href={exportUrl('pdf')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white font-semibold"
          >
            <FileDown className="w-4 h-4" /> Export PDF
          </a>
          <a
            href={exportUrl('xlsx')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white font-semibold"
          >
            <FileDown className="w-4 h-4" /> Export Excel (.xlsx)
          </a>
        </div>
      </div>

      {/* Report selector & date range */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-3 text-xs">
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 border rounded-lg font-semibold">
          {available.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        {type === 'revenue' && (
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="px-3 py-2 border rounded-lg">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        )}
        <div className="flex items-center gap-2">
          <span>From:</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2.5 py-1.5 border rounded-lg" />
          <span>To:</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2.5 py-1.5 border rounded-lg" />
        </div>
      </div>

      {report && (
        <div className="space-y-4">
          {report.summary?.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {report.summary.map((s) => (
                <div key={s.label} className="bg-white rounded-xl border p-3.5">
                  <div className="text-slate-500">{s.label}</div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    {s.money ? fmtTSh(s.value) : s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-xl border overflow-x-auto">
            <div className="px-4 py-3 border-b">
              <div className="font-bold text-sm">{report.title}</div>
              <div className="text-xs text-slate-500">{report.subtitle}</div>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} className={`py-2.5 px-4 ${c.type ? 'text-right' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`py-2.5 px-4 ${c.type ? 'text-right font-medium' : ''}`}>
                        {c.type === 'money' ? fmtTSh(r[c.key]) : r[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={report.columns.length} className="py-8 text-center text-slate-400">
                      No records for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

