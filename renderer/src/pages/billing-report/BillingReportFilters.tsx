import { CallCategory } from '../../../../shared/types';
import { CATEGORY_ORDER } from './constants';
import { toLabel } from './utils';
import dayjs from 'dayjs';

type DatePreset = 'this-week' | 'this-month' | 'last-month' | 'last-90';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'this-week', label: 'This Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-90', label: 'Last 90 Days' }
];

function applyPreset(preset: DatePreset): { from: string; to: string } {
  const today = dayjs();
  switch (preset) {
    case 'this-week':
      return { from: today.startOf('week').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') };
    case 'this-month':
      return { from: today.startOf('month').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') };
    case 'last-month': {
      const lastMonth = today.subtract(1, 'month');
      return { from: lastMonth.startOf('month').format('YYYY-MM-DD'), to: lastMonth.endOf('month').format('YYYY-MM-DD') };
    }
    case 'last-90':
      return { from: today.subtract(89, 'day').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') };
  }
}

interface BillingReportFiltersProps {
  from: string;
  to: string;
  extension: string;
  category: 'all' | CallCategory;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setExtension: (value: string) => void;
  setCategory: (value: 'all' | CallCategory) => void;
  onApply: (newFrom?: string, newTo?: string) => void;
  onExport: () => void;
  onExportCsv: () => void;
  loading: boolean;
  exporting: boolean;
  exportingCsv: boolean;
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
  onExportCsv,
  loading,
  exporting,
  exportingCsv,
  hasData,
  exportTopCallsLimit,
  setExportTopCallsLimit,
  topCallsTotal,
  exportLimitOptions
}: BillingReportFiltersProps) {
  const handlePreset = (preset: DatePreset) => {
    const { from: f, to: t } = applyPreset(preset);
    setFrom(f);
    setTo(t);
    // Auto-apply with new values directly
    onApply(f, t);
  };

  return (
    <div className="card p-3 flex flex-col gap-2">
      {/* Preset dates */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs" style={{ color: 'var(--muted2)', marginRight: 4 }}>Quick:</span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePreset(p.value)}
            className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Main filter row */}
      <div className="flex flex-wrap gap-2 items-end justify-between">
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
          <div className="flex items-end gap-2 flex-wrap">
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
              onClick={onExportCsv}
              disabled={exportingCsv || loading || !hasData}
              className="rounded-2xl border px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: exportingCsv ? 'var(--brand)' : 'var(--muted)' }}
            >
              {exportingCsv ? <span className="spin">⟳</span> : 'Export CSV'}
            </button>
            <button
              onClick={onExport}
              disabled={exporting || loading || !hasData}
              className="rounded-2xl border px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: exporting ? 'var(--brand)' : 'var(--muted)' }}
            >
              {exporting ? <span className="spin">⟳</span> : 'Export PDF'}
            </button>
            <button onClick={() => onApply()} className="rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
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
    </div>
  );
}
