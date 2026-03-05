import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_ORDER, CAT_BG, CAT_BORDER, CAT_COLOR, EXPORT_TOP_CALL_LIMITS } from './billing-report/constants';
import { BillingReportFilters } from './billing-report/BillingReportFilters';
import { DailyTrendChart } from './billing-report/DailyTrendChart';
import { TopCostCallsTable } from './billing-report/TopCostCallsTable';
import { ReportToast, ToastState } from './billing-report/ReportToast';
import { formatTotalsByCurrency, fmtCur, fmtDur, toLabel } from './billing-report/utils';
import { useBillingReportData } from './billing-report/useBillingReportData';
import { api } from '../lib/api';

function buildCsvRows(data: ReturnType<typeof useBillingReportData>['data']): string {
  if (!data) return '';
  const rows: string[][] = [];

  rows.push(['=== BILLING REPORT ===']);
  rows.push([]);
  rows.push(['Category', 'Calls', 'Duration (s)', 'Total Cost', 'Avg Cost', 'Max Cost', 'Currency']);
  for (const row of data.summary) {
    rows.push([
      row.call_category,
      String(row.call_count),
      String(row.total_duration_secs),
      String(row.total_cost),
      String(row.avg_cost),
      String(row.max_cost),
      row.currency
    ]);
  }

  rows.push([]);
  rows.push(['=== TOP COST CALLS ===']);
  rows.push(['Date', 'Start Time', 'Calling Party', 'Called Party', 'Digits Dialed', 'Category', 'Duration (s)', 'Rate/min', 'Cost', 'Tax', 'Currency']);
  for (const call of data.topCostCalls) {
    rows.push([
      call.date,
      call.start_time,
      call.calling_party,
      call.called_party,
      call.digits_dialed || '',
      call.call_category,
      String(call.duration_seconds),
      String(call.rate_per_minute),
      String(call.call_cost),
      String(call.tax_amount),
      call.bill_currency
    ]);
  }

  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function download(name: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BillingReportPage() {
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exportTopCallsLimit, setExportTopCallsLimit] = useState<number>(1000);
  const [displayCurrency, setDisplayCurrency] = useState<'PHP' | 'USD'>('PHP');

  const {
    from,
    to,
    extension,
    category,
    setFrom,
    setTo,
    setExtension,
    setCategory,
    appliedFilters,
    sortBy,
    sortDir,
    page,
    pageSize,
    setSortBy,
    setSortDir,
    setPage,
    setPageSize,
    data,
    loading,
    isRefreshing,
    isStaleData,
    error,
    applyFilters,
    clearFilters,
    fetchReport,
    buildReportQuery,
    categoryMetrics,
    trendModel,
    grandCalls,
    grandDuration,
    totalCostNumeric,
    topCallsTotal,
    totalPages
  } = useBillingReportData();

  useEffect(() => {
    if (!toast || toast.type === 'loading') return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const showToast = (type: ToastState['type'], title: string, sub: string) => {
    setToast({ type, title, sub });
  };

  const exportPDF = async () => {
    if (!data) {
      showToast('error', 'Export failed', 'No billing data available');
      return;
    }

    setExporting(true);
    showToast('loading', 'Generating PDF...', 'Building billing report');

    try {
      const exportQuery = buildReportQuery({
        page: undefined,
        pageSize: undefined,
        includeAllTopCalls: true,
        topCallsLimit: exportTopCallsLimit
      });
      const result = await api.exportBillingReportPdf(exportQuery, { timeoutMs: 60000 });
      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      if (result.truncated) {
        showToast(
          'success',
          'PDF Exported',
          `${result.fileName} (top calls truncated to ${result.exportedCount.toLocaleString()})`
        );
      } else {
        showToast('success', 'PDF Exported', result.fileName);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      showToast('error', 'Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = () => {
    if (!data) {
      showToast('error', 'Export failed', 'No billing data available');
      return;
    }
    setExportingCsv(true);
    try {
      const csv = buildCsvRows(data);
      const filename = `billing-report-${appliedFilters.from}-to-${appliedFilters.to}.csv`;
      download(filename, csv, 'text/csv');
      showToast('success', 'CSV Exported', filename);
    } catch {
      showToast('error', 'Export failed', 'Could not generate CSV');
    } finally {
      setExportingCsv(false);
    }
  };

  // Stable top spenders come from backend aggregation (not paged table rows).
  const topSpenders = useMemo(() => {
    if (!data?.topSpenders?.length) return [];
    const inDisplayCurrency = data.topSpenders
      .filter((row) => row.currency === displayCurrency)
      .map((row) => ({
        ext: row.extension || '—',
        calls: row.call_count,
        cost: row.total_cost,
        currency: row.currency
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
    if (inDisplayCurrency.length > 0) return inDisplayCurrency;
    return data.topSpenders
      .map((row) => ({
        ext: row.extension || '—',
        calls: row.call_count,
        cost: row.total_cost,
        currency: row.currency
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  }, [data?.topSpenders, displayCurrency]);

  const selectedCurrencyTotal = categoryMetrics.totalsByCurrency.get(displayCurrency) ?? 0;
  const avgCostPerCallSelectedCurrency = grandCalls > 0 ? selectedCurrencyTotal / grandCalls : 0;

  const blockingError = !loading && !data && !!error;

  return (
    <div className="app-page gap-1.5">
      <BillingReportFilters
        from={from}
        to={to}
        extension={extension}
        category={category}
        appliedFilters={appliedFilters}
        setFrom={setFrom}
        setTo={setTo}
        setExtension={setExtension}
        setCategory={setCategory}
        onApply={applyFilters}
        onClear={clearFilters}
        onExport={exportPDF}
        onExportCsv={exportCsv}
        loading={loading}
        exporting={exporting}
        exportingCsv={exportingCsv}
        hasData={!!data}
        exportTopCallsLimit={exportTopCallsLimit}
        setExportTopCallsLimit={setExportTopCallsLimit}
        topCallsTotal={topCallsTotal}
        exportLimitOptions={EXPORT_TOP_CALL_LIMITS}
        displayCurrency={displayCurrency}
        setDisplayCurrency={setDisplayCurrency}
      />

      {isRefreshing && data && (
        <div className="card p-2 text-xs shrink-0" style={{ color: 'var(--muted2)' }}>
          Refreshing report...
        </div>
      )}

      {blockingError && (
        <div className="card p-5 shrink-0" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.08)' }}>
          <p className="text-sm font-semibold" style={{ color: '#fca5a5' }}>
            Failed to load billing report
          </p>
          <p className="text-xs mt-1" style={{ color: '#fecaca' }}>
            {error}
          </p>
          <button
            onClick={() => void fetchReport()}
            className="mt-3 rounded-xl border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: 'rgba(248, 113, 113, 0.45)', color: '#fca5a5' }}
          >
            Retry
          </button>
        </div>
      )}

      {!blockingError && error && (
        <div className="card p-3 flex items-center justify-between gap-3 shrink-0" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.08)' }}>
          <div className="min-w-0">
            <p className="text-sm" style={{ color: '#fca5a5' }}>{error}</p>
            {isStaleData && (
              <p className="text-xs mt-1" style={{ color: '#fecaca' }}>
                Showing previous successful data. Retry to refresh.
              </p>
            )}
          </div>
          <button
            onClick={() => void fetchReport()}
            className="rounded-xl border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: 'rgba(248, 113, 113, 0.45)', color: '#fca5a5' }}
          >
            Retry
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !data ? (
          <div className="grid gap-2 lg:grid-cols-12 animate-pulse">
            <div className="card h-36 lg:col-span-3 xl:col-span-2" />
            <div className="card h-36 lg:col-span-3 xl:col-span-2" />
            <div className="card h-36 lg:col-span-6 xl:col-span-8" />
            <div className="card h-24 lg:col-span-4" />
            <div className="card h-24 lg:col-span-8" />
            <div className="card h-[380px] lg:col-span-12" />
          </div>
        ) : (
          data && (
            <div className="grid gap-2 min-h-0 h-full overflow-hidden lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_minmax(0,1fr)]">
              {/* Row 1: KPI cards */}
              <div className="card p-5 rounded-2xl lg:col-span-3 xl:col-span-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--brand)', borderWidth: '1px' }}>
                <div className="text-center mb-3">
                  <p className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>Total Charges</p>
                  <p className="text-3xl md:text-4xl font-bold mt-2" style={{ color: 'var(--brand)' }}>
                    {fmtCur(selectedCurrencyTotal, displayCurrency)}
                  </p>
                  <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                    Displaying {displayCurrency} totals
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="text-center">
                    <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{grandCalls.toLocaleString()}</p>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted2)' }}>total calls</p>
                  </div>
                  <div className="text-center" style={{ borderLeft: '1px solid var(--border)' }}>
                    <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{fmtDur(grandDuration)}</p>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted2)' }}>talk time</p>
                  </div>
                </div>
              </div>

              {/* Avg cost per call KPI */}
              <div className="card p-5 rounded-2xl lg:col-span-3 xl:col-span-2" style={{ background: 'var(--surface-alt)' }}>
                <div className="text-center h-full flex flex-col justify-center">
                  <p className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>Avg Cost / Call</p>
                  <p className="text-4xl font-bold mt-3" style={{ color: grandCalls > 0 ? '#f59e0b' : 'var(--muted)' }}>
                    {grandCalls > 0
                      ? fmtCur(avgCostPerCallSelectedCurrency, displayCurrency)
                      : '—'}
                  </p>
                  <p className="text-sm mt-2" style={{ color: 'var(--muted2)' }}>across {grandCalls.toLocaleString()} calls</p>
                </div>
              </div>

              {/* Daily trend chart */}
              <div className="min-h-0 lg:col-span-6 xl:col-span-8">
                <DailyTrendChart
                  trendData={trendModel.trendData}
                  trendCurrencies={trendModel.trendCurrencies}
                  from={appliedFilters.from}
                  to={appliedFilters.to}
                />
              </div>

              {/* Row 2: Category breakdown */}
              <div className="card p-3 lg:col-span-4">
                <div className="flex flex-wrap gap-2 justify-between items-center mb-2">
                  <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
                    {categoryMetrics.primaryCurrency ? 'Cost Breakdown' : 'Category Breakdown (by call volume)'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted2)' }}>
                    {categoryMetrics.primaryCurrency ? 'Share of total cost' : 'Mixed currencies detected'}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {CATEGORY_ORDER.map((cat) => (
                    <div key={cat} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CAT_COLOR[cat] }}></div>
                      <span className="text-xs" style={{ color: 'var(--text)' }}>{toLabel(cat)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex h-3 rounded-full overflow-hidden mt-2.5" style={{ background: 'var(--surface-alt)' }}>
                  {CATEGORY_ORDER.map((cat) => {
                    const bucket = categoryMetrics.byCategory.get(cat);
                    const categoryCost = bucket ? bucket.totalCost : 0;
                    const categoryCalls = bucket ? bucket.callCount : 0;
                    const value = categoryMetrics.primaryCurrency ? categoryCost : categoryCalls;
                    const total = categoryMetrics.primaryCurrency ? totalCostNumeric : Math.max(1, grandCalls);
                    return (
                      <div
                        key={cat}
                        style={{ width: `${total > 0 ? (value / total) * 100 : 0}%`, background: CAT_COLOR[cat] }}
                        title={`${toLabel(cat)}: ${categoryMetrics.primaryCurrency ? fmtCur(categoryCost, categoryMetrics.primaryCurrency) : `${categoryCalls.toLocaleString()} calls`}`}
                      ></div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-1.5 lg:col-span-8">
                {CATEGORY_ORDER.map((cat) => {
                  const bucket = categoryMetrics.byCategory.get(cat);
                  const callCount = bucket?.callCount ?? 0;
                  const duration = bucket?.duration ?? 0;
                  const costLabel = categoryMetrics.primaryCurrency
                    ? fmtCur(bucket?.totalCost ?? 0, categoryMetrics.primaryCurrency)
                    : formatTotalsByCurrency(bucket?.totalsByCurrency ?? new Map<string, number>());
                  return (
                    <div key={cat} className="card p-3" style={{ background: CAT_BG[cat], border: `1px solid ${CAT_BORDER[cat]}` }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CAT_COLOR[cat] }}></div>
                        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: CAT_COLOR[cat] }}>
                          {toLabel(cat)}
                        </span>
                      </div>
                      <p className="text-xl font-bold" style={{ color: 'var(--text)' }}>{callCount.toLocaleString()}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{fmtDur(duration)} talk time</p>
                      <p className="text-xs font-bold mt-1.5" style={{ color: CAT_COLOR[cat] }}>{costLabel}</p>
                    </div>
                  );
                })}
              </div>

              {/* Row 3: Top Spenders + Top Cost Calls Table */}
              {topSpenders.length > 0 && (
                <div
                  className="card lg:col-span-4 xl:col-span-3"
                  style={{ padding: '12px 14px', minHeight: 0, maxHeight: 'clamp(280px, 48vh, 560px)', display: 'flex', flexDirection: 'column' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
                    <div className="ct" style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>Top Spenders by Extension</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--muted2)' }}>
                      <div className="etrk" style={{ height: '5px', width: '20px', borderRadius: '3px' }}>
                        <div className="efil" style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, var(--brand), var(--purple))', borderRadius: '3px' }}></div>
                      </div>
                      <span>Cost</span>
                    </div>
                  </div>
                  <div style={{ marginBottom: '8px', fontSize: '11px', color: 'var(--muted2)' }}>
                    {topSpenders.some((row) => row.currency !== displayCurrency)
                      ? `Showing mixed currencies (no ${displayCurrency} aggregate available)`
                      : `Showing ${displayCurrency} totals`}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px', fontSize: '10px', color: 'var(--muted2)', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
                    <div>Extension</div>
                    <div style={{ textAlign: 'right' }}>Calls / Cost</div>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
                    {topSpenders.map((s) => {
                      const maxCost = topSpenders[0].cost || 1;
                      const costPct = Math.max((s.cost / maxCost) * 100, 4);
                      return (
                        <button
                          type="button"
                          key={s.ext}
                          className="erow"
                          style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '7px 0' }}
                        >
                          <span className="mono" style={{ width: '48px', color: 'var(--text)', fontWeight: 700, fontSize: '12px' }}>{s.ext}</span>
                          <div className="etrk" style={{ height: '5px' }}>
                            <div className="efil" style={{ width: `${costPct}%`, background: 'linear-gradient(90deg, var(--brand), var(--purple))' }}></div>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--muted2)', width: '85px', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '11px' }}>{s.calls}</div>
                            <div style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '11px' }}>{fmtCur(s.cost, s.currency)}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={topSpenders.length > 0 ? 'min-h-0 lg:col-span-8 xl:col-span-9' : 'min-h-0 lg:col-span-12'}>
                <TopCostCallsTable
                  topCostCalls={data.topCostCalls}
                  topCallsTotal={topCallsTotal}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  pageSize={pageSize}
                  page={page}
                  totalPages={totalPages}
                  loading={loading}
                  isRefreshing={isRefreshing}
                  onSortByChange={(value) => {
                    setPage(1);
                    setSortBy(value);
                  }}
                  onSortDirToggle={() => {
                    setPage(1);
                    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                  }}
                  onPageSizeChange={(size) => {
                    setPage(1);
                    setPageSize(size);
                  }}
                  onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
                  onNextPage={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  onFirstPage={() => setPage(1)}
                  onLastPage={() => setPage(totalPages)}
                />
              </div>
            </div>
          )
        )}
      </div>

      <ReportToast toast={toast} />
    </div>
  );
}
