import dayjs from 'dayjs';
import { BillingReportDailyTrendRow, BillingReportSummaryRow, CallCategory } from '../../../../shared/types';
import { CATEGORY_ORDER } from './constants';

export const fmtCur = (value: number, currency = 'PHP') =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value || 0);

export const fmtDur = (seconds: number) => {
  const s = Math.max(0, Number(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

export const toLabel = (category: CallCategory) => {
  if (category === 'unclassified') return 'Unclassified';
  return category.charAt(0).toUpperCase() + category.slice(1);
};

export function buildCategoryMetrics(summary: BillingReportSummaryRow[]) {
  const totalsByCurrency = new Map<string, number>();
  const byCategory = new Map<
    CallCategory,
    { callCount: number; duration: number; totalsByCurrency: Map<string, number>; totalCost: number }
  >();

  for (const category of CATEGORY_ORDER) {
    byCategory.set(category, {
      callCount: 0,
      duration: 0,
      totalsByCurrency: new Map<string, number>(),
      totalCost: 0
    });
  }

  for (const row of summary) {
    const category = (row.call_category || 'unclassified') as CallCategory;
    const currency = row.currency || 'PHP';
    const bucket = byCategory.get(category) ?? {
      callCount: 0,
      duration: 0,
      totalsByCurrency: new Map<string, number>(),
      totalCost: 0
    };

    bucket.callCount += Number(row.call_count || 0);
    bucket.duration += Number(row.total_duration_secs || 0);
    bucket.totalCost += Number(row.total_cost || 0);
    bucket.totalsByCurrency.set(currency, (bucket.totalsByCurrency.get(currency) ?? 0) + Number(row.total_cost || 0));
    byCategory.set(category, bucket);

    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + Number(row.total_cost || 0));
  }

  const currencies = Array.from(totalsByCurrency.keys());
  const primaryCurrency = currencies.length === 1 ? currencies[0] : null;

  return {
    byCategory,
    totalsByCurrency,
    primaryCurrency
  };
}

export function formatTotalsByCurrency(totals: Map<string, number>): string {
  const entries = Array.from(totals.entries());
  if (!entries.length) return fmtCur(0, 'PHP');
  return entries.map(([currency, amount]) => fmtCur(amount, currency)).join('  |  ');
}

export function buildTrendModel(rows: BillingReportDailyTrendRow[]) {
  const points = new Map<string, Record<string, string | number>>();
  const currencies = new Set<string>();

  for (const row of rows) {
    const day = row.date;
    const currency = row.currency || 'PHP';
    const costKey = `cost_${currency}`;
    currencies.add(currency);
    const existing = points.get(day) ?? {
      date: day,
      label: dayjs(day).format('MM/DD'),
      callCount: 0
    };
    existing.callCount = Number(existing.callCount || 0) + Number(row.call_count || 0);
    existing[costKey] = Number(existing[costKey] || 0) + Number(row.total_cost || 0);
    points.set(day, existing);
  }

  return {
    trendData: Array.from(points.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    trendCurrencies: Array.from(currencies).sort()
  };
}

export function validateDateRange(from: string, to: string): string | null {
  const fromDate = dayjs(from);
  const toDate = dayjs(to);
  if (!fromDate.isValid() || !toDate.isValid()) return 'Invalid date selected.';
  if (fromDate.isAfter(toDate)) return 'From date cannot be after To date.';
  if (toDate.diff(fromDate, 'day') > 366) return 'Date range cannot exceed 366 days.';
  return null;
}
