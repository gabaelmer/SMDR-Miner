import { CallCategory } from '../../../../shared/types';
import { CATEGORY_ORDER } from './constants';
import { toLabel } from './utils';

interface BillingReportFiltersProps {
  from: string;
  to: string;
  extension: string;
  category: 'all' | CallCategory;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setExtension: (value: string) => void;
  setCategory: (value: 'all' | CallCategory) => void;
  onApply: () => void;
  onExport: () => void;
  loading: boolean;
  exporting: boolean;
  hasData: boolean;
  exportTopCallsLimit: number;
  setExportTopCallsLimit: (value: number) => void;
  topCallsTotal: number;
  exportLimitOptions: readonly number[];
}

export function BillingReportFilters({
  from,
  to,
  extension,
  category,
  setFrom,
  setTo,
  setExtension,
  setCategory,
  onApply,
  onExport,
  loading,
  exporting,
  hasData,
  exportTopCallsLimit,
  setExportTopCallsLimit,
  topCallsTotal,
  exportLimitOptions
}: BillingReportFiltersProps) {
  return (
    <div className="card p-3 flex flex-wrap gap-2 items-end justify-between">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs" style={{ color: 'var(--text)' }}>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-xl border px-2 py-1.5 text-sm"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--text)' }}>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-xl border px-2 py-1.5 text-sm"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--text)' }}>
          Extension (optional)
          <input
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            placeholder="e.g. 1001"
            className="mt-1 block rounded-xl border px-2 py-1.5 text-sm w-28"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--text)' }}>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | CallCategory)}
            className="mt-1 block rounded-xl border px-2 py-1.5 text-sm"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {toLabel(cat)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2 items-end">
        <div className="flex items-end gap-2">
          <label className="text-xs" style={{ color: 'var(--muted2)' }}>
            Export Top Calls
            <select
              value={exportTopCallsLimit}
              onChange={(e) => setExportTopCallsLimit(Number(e.target.value))}
              className="ml-2 rounded-lg border px-2 py-1 text-xs"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              disabled={exporting}
            >
              {exportLimitOptions.map((limit) => (
                <option key={limit} value={limit}>
                  {limit.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={onExport}
            disabled={exporting || loading || !hasData}
            className="rounded-2xl border px-4 py-2 text-sm font-semibold flex items-center gap-2"
            style={{ borderColor: 'var(--border)', color: exporting ? 'var(--brand)' : 'var(--muted)' }}
          >
            {exporting ? <span className="spin">⟳</span> : 'Export PDF'}
          </button>
          <button onClick={onApply} className="rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            Apply
          </button>
        </div>
        {topCallsTotal > exportTopCallsLimit && (
          <p className="text-xs" style={{ color: '#fbbf24' }}>
            Export will include only top {exportTopCallsLimit.toLocaleString()} of {topCallsTotal.toLocaleString()} calls.
          </p>
        )}
      </div>
    </div>
  );
}
