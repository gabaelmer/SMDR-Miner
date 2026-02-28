import { useEffect, useState } from 'react';
import { CATEGORY_ORDER, CAT_BG, CAT_BORDER, CAT_COLOR, EXPORT_TOP_CALL_LIMITS } from './billing-report/constants';
import { BillingReportFilters } from './billing-report/BillingReportFilters';
import { DailyTrendChart } from './billing-report/DailyTrendChart';
import { TopCostCallsTable } from './billing-report/TopCostCallsTable';
import { ReportToast, ToastState } from './billing-report/ReportToast';
import { formatTotalsByCurrency, fmtCur, fmtDur, toLabel } from './billing-report/utils';
import { useBillingReportData } from './billing-report/useBillingReportData';
import { api } from '../lib/api';

export function BillingReportPage() {
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exportTopCallsLimit, setExportTopCallsLimit] = useState<number>(1000);

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

  const blockingError = !loading && !data && !!error;

  return (
    <div className="h-[calc(100vh-148px)] min-h-0 overflow-hidden flex flex-col gap-1.5">
      <BillingReportFilters
        from={from}
        to={to}
        extension={extension}
        category={category}
        setFrom={setFrom}
        setTo={setTo}
        setExtension={setExtension}
        setCategory={setCategory}
        onApply={applyFilters}
        onExport={exportPDF}
        loading={loading}
        exporting={exporting}
        hasData={!!data}
        exportTopCallsLimit={exportTopCallsLimit}
        setExportTopCallsLimit={setExportTopCallsLimit}
        topCallsTotal={topCallsTotal}
        exportLimitOptions={EXPORT_TOP_CALL_LIMITS}
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

      <div className="min-h-0 flex-1 overflow-auto xl:overflow-hidden">
        {loading && !data ? (
          <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading...</div>
        ) : (
          data && (
            <div className="grid gap-1.5 min-h-0 h-full xl:grid-cols-12 xl:grid-rows-[auto_auto_minmax(0,1fr)]">
              <div className="card p-4 rounded-2xl xl:col-span-3" style={{ background: 'var(--surface-alt)', borderColor: 'var(--brand)', borderWidth: '1px' }}>
                <div className="text-center mb-2">
                  <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>Total Call Charges</p>
                  <p className="text-2xl md:text-3xl font-bold mt-1.5" style={{ color: 'var(--brand)' }}>
                    {categoryMetrics.primaryCurrency
                      ? fmtCur(totalCostNumeric, categoryMetrics.primaryCurrency)
                      : 'Multiple currencies'}
                  </p>
                  {!categoryMetrics.primaryCurrency && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>{formatTotalsByCurrency(categoryMetrics.totalsByCurrency)}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="text-center">
                    <p className="text-xl font-bold" style={{ color: 'var(--text)' }}>{grandCalls.toLocaleString()}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted2)' }}>total calls</p>
                  </div>
                  <div className="text-center" style={{ borderLeft: '1px solid var(--border)' }}>
                    <p className="text-xl font-bold" style={{ color: 'var(--text)' }}>{fmtDur(grandDuration)}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted2)' }}>talk time</p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 xl:col-span-9">
                <DailyTrendChart
                  trendData={trendModel.trendData}
                  trendCurrencies={trendModel.trendCurrencies}
                  from={appliedFilters.from}
                  to={appliedFilters.to}
                />
              </div>

              <div className="card p-3 xl:col-span-4">
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
                    const value = categoryMetrics.primaryCurrency
                      ? categoryCost
                      : categoryCalls;
                    const total = categoryMetrics.primaryCurrency
                      ? totalCostNumeric
                      : Math.max(1, grandCalls);
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

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 xl:col-span-8">
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

              <div className="min-h-0 xl:col-span-12">
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
