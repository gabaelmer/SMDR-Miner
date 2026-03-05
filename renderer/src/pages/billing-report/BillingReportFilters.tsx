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
  appliedFilters: {
    from: string;
    to: string;
    extension: string;
    category: 'all' | CallCategory;
  };
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setExtension: (value: string) => void;
  setCategory: (value: 'all' | CallCategory) => void;
  onApply: (patch?: {
    from?: string;
    to?: string;
    extension?: string;
    category?: 'all' | CallCategory;
  }) => void;
  onClear: () => void;
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
  displayCurrency: 'PHP' | 'USD';
  setDisplayCurrency: (value: 'PHP' | 'USD') => void;
}

export function BillingReportFilters({
  from,
  to,
  extension,
  category,
  appliedFilters,
  setFrom,
  setTo,
  setExtension,
  setCategory,
  onApply,
  onClear,
  onExport,
  onExportCsv,
  loading,
  exporting,
  exportingCsv,
  hasData,
  exportTopCallsLimit,
  setExportTopCallsLimit,
  topCallsTotal,
  exportLimitOptions,
  displayCurrency,
  setDisplayCurrency
}: BillingReportFiltersProps) {
  const handlePreset = (preset: DatePreset) => {
    const { from: f, to: t } = applyPreset(preset);
    setFrom(f);
    setTo(t);
  };
  const activePreset = DATE_PRESETS.find((preset) => {
    const range = applyPreset(preset.value);
    return range.from === from && range.to === to;
  }) ?? null;
  const appliedPreset = DATE_PRESETS.find((preset) => {
    const range = applyPreset(preset.value);
    return range.from === appliedFilters.from && range.to === appliedFilters.to;
  }) ?? null;
  const isDirty =
    from !== appliedFilters.from ||
    to !== appliedFilters.to ||
    extension !== appliedFilters.extension ||
    category !== appliedFilters.category;

  return (
    <div className="card p-3 flex flex-col gap-2">
      {/* Preset dates */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs" style={{ color: 'var(--muted2)', marginRight: 4 }}>Quick:</span>
          {DATE_PRESETS.map((p) => {
            const isActive = activePreset?.value === p.value;
            return (
            <button
              type="button"
              key={p.value}
              onClick={() => handlePreset(p.value)}
              className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all inline-flex items-center gap-1 h-7"
                style={{
                  borderColor: isActive ? 'rgba(56, 189, 248, 0.75)' : 'var(--border)',
                  color: isActive ? '#dbeafe' : 'var(--muted)',
                  background: isActive ? 'rgba(36, 132, 235, 0.24)' : 'transparent',
                  boxShadow: isActive ? '0 0 0 1px rgba(56, 189, 248, 0.25) inset' : 'none'
                }}
                aria-pressed={isActive}
                title={isActive ? 'Currently applied quick filter' : undefined}
              >
                {isActive && <span aria-hidden="true">✓</span>}
                <span>{p.label}</span>
              </button>
            );
          })}
          <span className="text-xs font-semibold" style={{ color: 'var(--muted2)' }}>
            Draft: {activePreset ? activePreset.label : 'Custom'}
          </span>
          {isDirty && (
            <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
              Unsaved filter changes
            </span>
          )}
        </div>
        <div className="flex flex-col items-start md:items-end gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onExportCsv}
              disabled={exportingCsv || loading || !hasData}
              className="rounded-2xl border px-4 h-9 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: exportingCsv ? 'var(--brand)' : 'var(--muted)' }}
            >
              {exportingCsv ? <span className="spin">⟳</span> : 'Export CSV'}
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || loading || !hasData}
              className="rounded-2xl border px-4 h-9 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: exporting ? 'var(--brand)' : 'var(--muted)' }}
            >
              {exporting ? <span className="spin">⟳</span> : 'Export PDF'}
            </button>
          </div>
          {topCallsTotal > exportTopCallsLimit && (
            <p className="text-xs whitespace-nowrap text-right leading-tight" style={{ color: '#fbbf24' }}>
              Export will include only top {exportTopCallsLimit.toLocaleString()} of {topCallsTotal.toLocaleString()} calls.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--muted2)' }}>
        <span style={{ color: 'var(--muted2)' }}>Applied Filters:</span>
        <span className="rounded-full border px-2 py-1" style={{ borderColor: 'var(--border)' }}>
          Date: {appliedFilters.from} to {appliedFilters.to}
          {appliedPreset ? ` (${appliedPreset.label})` : ''}
        </span>
        {appliedFilters.category !== 'all' && (
          <button
            type="button"
            className="rounded-full border px-2 py-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => {
              setCategory('all');
              onApply({ category: 'all' });
            }}
          >
            Category: {toLabel(appliedFilters.category)} ×
          </button>
        )}
        {appliedFilters.extension && (
          <button
            type="button"
            className="rounded-full border px-2 py-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => {
              setExtension('');
              onApply({ extension: '' });
            }}
          >
            Extension: {appliedFilters.extension} ×
          </button>
        )}
      </div>

      {/* Main filter row */}
      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs" style={{ color: 'var(--text)' }}>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-xl border px-3 text-sm h-9 w-full min-w-[150px]"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--text)' }}>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-xl border px-3 text-sm h-9 w-full min-w-[150px]"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--text)' }}>
            Extension (optional)
            <input
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              placeholder="e.g. 1001"
              className="mt-1 block rounded-xl border px-3 text-sm h-9 w-full min-w-[140px]"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--text)' }}>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'all' | CallCategory)}
              className="mt-1 block rounded-xl border px-3 text-sm h-9 w-full min-w-[160px]"
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
        <div className="flex flex-col gap-1 items-start md:items-end">
          <div className="flex items-end gap-2 flex-wrap md:justify-end">
            <label className="text-xs min-w-[138px]" style={{ color: 'var(--muted2)' }}>
              Display Currency
              <select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value as 'PHP' | 'USD')}
                className="mt-1 block w-full rounded-lg border px-2 text-sm h-9"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <option value="PHP">₱ PHP</option>
                <option value="USD">$ USD</option>
              </select>
            </label>
            <label className="text-xs min-w-[148px]" style={{ color: 'var(--muted2)' }}>
              Export Top Calls
              <select
                value={exportTopCallsLimit}
                onChange={(e) => setExportTopCallsLimit(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border px-2 text-sm h-9"
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
              type="button"
              onClick={onClear}
              className="rounded-2xl border px-4 h-9 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Clear
            </button>
            <button type="button" onClick={() => onApply()} className="rounded-2xl bg-brand-600 px-4 h-9 text-sm font-semibold text-white">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
