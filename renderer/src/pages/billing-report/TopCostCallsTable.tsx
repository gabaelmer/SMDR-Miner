import { useEffect, useState } from 'react';
import { BillingReportSortBy, BillingReportSortDir, BillingReportTopCostCall } from '../../../../shared/types';
import { CAT_COLOR } from './constants';
import { fmtCur, fmtDur } from './utils';

interface TopCostCallsTableProps {
  topCostCalls: BillingReportTopCostCall[];
  topCallsTotal: number;
  sortBy: BillingReportSortBy;
  sortDir: BillingReportSortDir;
  pageSize: number;
  page: number;
  totalPages: number;
  loading: boolean;
  isRefreshing: boolean;
  onSortByChange: (value: BillingReportSortBy) => void;
  onSortDirToggle: () => void;
  onPageSizeChange: (value: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onFirstPage: () => void;
  onLastPage: () => void;
}

function CallDetailModal({ call, onClose }: { call: BillingReportTopCostCall; onClose: () => void }) {
  const fields: [string, string | number | null][] = [
    ['Date', call.date],
    ['Start Time', call.start_time],
    ['Calling Party', call.calling_party],
    ['Called Party', call.called_party],
    ['Digits Dialed', call.digits_dialed || '—'],
    ['Category', call.call_category],
    ['Duration', fmtDur(call.duration_seconds)],
    ['Matched Prefix', call.matched_prefix || '—'],
    ['Rate / min', call.rate_per_minute > 0 ? fmtCur(call.rate_per_minute, call.bill_currency) : '—'],
    ['Call Cost', fmtCur(call.call_cost, call.bill_currency)],
    ['Tax', fmtCur(call.tax_amount, call.bill_currency)],
    ['Currency', call.bill_currency],
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border p-5"
        style={{ background: 'var(--surface)', borderColor: 'var(--brand)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Call detail"
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold" style={{ color: 'var(--brand)' }}>Call Detail</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold"
            style={{ background: 'var(--surface-alt)', color: 'var(--muted)' }}
            aria-label="Close call detail"
          >✕</button>
        </div>
        <div className="space-y-2">
          {fields.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <span className="text-xs" style={{ color: 'var(--muted2)', minWidth: 100 }}>{label}</span>
              <span
                className="text-xs font-semibold mono text-right"
                style={{
                  color: label === 'Call Cost' ? 'var(--brand)' : label === 'Category' ? CAT_COLOR[call.call_category] : 'var(--text)'
                }}
              >
                {String(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TopCostCallsTable({
  topCostCalls,
  topCallsTotal,
  sortBy,
  sortDir,
  pageSize,
  page,
  totalPages,
  loading,
  isRefreshing,
  onSortByChange,
  onSortDirToggle,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
  onFirstPage,
  onLastPage
}: TopCostCallsTableProps) {
  const [selectedCall, setSelectedCall] = useState<BillingReportTopCostCall | null>(null);
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));

  return (
    <div className="card overflow-hidden h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Top Cost Calls ({topCallsTotal.toLocaleString()})
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            Sort
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as BillingReportSortBy)}
              className="ml-2 rounded-lg border px-2 py-0 h-8 leading-5 text-xs"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: '#eaf2ff' }}
              aria-label="Sort top cost calls by"
            >
              <option value="cost">Cost</option>
              <option value="duration">Duration</option>
              <option value="date">Date</option>
            </select>
          </label>
          <div className="flex flex-col">
            <span className="text-xs select-none invisible">Direction</span>
            <button
              type="button"
              onClick={onSortDirToggle}
              className="h-8 rounded-lg border px-2 text-xs font-semibold"
              style={{ borderColor: 'var(--border)', color: '#eaf2ff' }}
              aria-label={`Sort direction ${sortDir === 'desc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
          </div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="ml-2 rounded-lg border px-2 py-0 h-8 leading-5 text-xs"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: '#eaf2ff' }}
              aria-label="Rows per page"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-auto min-h-0 flex-1">
        <table className="w-full text-sm" style={{ minWidth: 760 }}>
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
              {['Date', 'From', 'Dialled', 'Category', 'Duration', 'Rate/min', 'Cost'].map((header) => (
                <th
                  key={header}
                  className={`sticky top-0 z-[1] px-4 py-2 text-xs font-semibold ${header === 'Duration' || header === 'Rate/min' || header === 'Cost' ? 'text-center' : 'text-left'}`}
                  style={{ color: '#bfd7ff', background: 'var(--surface-alt)' }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topCostCalls.map((call) => (
              <tr
                key={call.id}
                className="billing-top-cost-row border-b cursor-pointer transition-colors"
                tabIndex={0}
                aria-label={`Call ${call.calling_party} to ${call.called_party}`}
                style={{ borderColor: 'var(--border)' }}
                onClick={() => setSelectedCall(call)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedCall(call);
                  }
                }}
              >
                <td className="px-4 py-2 text-xs" style={{ color: 'var(--muted)' }}>
                  {call.date} {call.start_time}
                </td>
                <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text)' }}>
                  {call.calling_party}
                </td>
                <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text)' }}>
                  {call.digits_dialed || call.called_party}
                </td>
                <td className="px-4 py-2">
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold border"
                    style={{
                      color: CAT_COLOR[call.call_category],
                      borderColor: CAT_COLOR[call.call_category] + '55',
                      backgroundColor: CAT_COLOR[call.call_category] + '22'
                    }}
                  >
                    {call.call_category}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-center" style={{ color: 'var(--muted)' }}>
                  {fmtDur(call.duration_seconds)}
                </td>
                <td className="px-4 py-2 text-xs text-center" style={{ color: 'var(--muted)' }}>
                  {call.rate_per_minute > 0 ? fmtCur(call.rate_per_minute, call.bill_currency) : '—'}
                </td>
                <td className="px-4 py-2 font-bold text-brand-400 text-center">{fmtCur(call.call_cost, call.bill_currency)}</td>
              </tr>
            ))}
            {!topCostCalls.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  No calls found for the applied filters. Try widening the date range or clearing extension/category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          Page {safePage} of {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFirstPage}
            disabled={safePage <= 1 || loading || isRefreshing}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            aria-label="Go to first page"
          >
            « First
          </button>
          <button
            type="button"
            onClick={onPrevPage}
            disabled={safePage <= 1 || loading || isRefreshing}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            aria-label="Go to previous page"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={onNextPage}
            disabled={safePage >= totalPages || loading || isRefreshing}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            aria-label="Go to next page"
          >
            Next →
          </button>
          <button
            type="button"
            onClick={onLastPage}
            disabled={safePage >= totalPages || loading || isRefreshing}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            aria-label="Go to last page"
          >
            Last »
          </button>
        </div>
      </div>

      {selectedCall && <CallDetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />}
    </div>
  );
}
