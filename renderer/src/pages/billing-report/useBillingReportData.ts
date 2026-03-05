import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  BillingReportData,
  BillingReportQuery,
  BillingReportSortBy,
  BillingReportSortDir,
  CallCategory
} from '../../../../shared/types';
import { api } from '../../lib/api';
import { ISO_DATE_RE } from './constants';
import { buildCategoryMetrics, buildTrendModel, validateDateRange } from './utils';

type FilterCategory = 'all' | CallCategory;

interface AppliedFilters {
  from: string;
  to: string;
  extension: string;
  category: FilterCategory;
}

type AppliedFilterPatch = Partial<AppliedFilters>;

function normalizeInput(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function useBillingReportData() {
  const today = dayjs().format('YYYY-MM-DD');
  const defaultFrom = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [extension, setExtension] = useState('');
  const [category, setCategory] = useState<FilterCategory>('all');

  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    from: defaultFrom,
    to: today,
    extension: '',
    category: 'all'
  });

  const [sortBy, setSortBy] = useState<BillingReportSortBy>('cost');
  const [sortDir, setSortDir] = useState<BillingReportSortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [data, setData] = useState<BillingReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStaleData, setIsStaleData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<BillingReportData | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const buildReportQuery = (overrides: Partial<BillingReportQuery> = {}): BillingReportQuery => ({
    from: appliedFilters.from,
    to: appliedFilters.to,
    extension: appliedFilters.extension || undefined,
    category: appliedFilters.category === 'all' ? undefined : appliedFilters.category,
    sortBy,
    sortDir,
    page,
    pageSize,
    ...overrides
  });

  const fetchReport = async () => {
    const requestId = ++requestSeqRef.current;
    const hadData = dataRef.current !== null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    if (hadData) setIsRefreshing(true);
    else setLoading(true);

    try {
      const result = await api.getBillingReport(buildReportQuery(), {
        timeoutMs: 30000,
        signal: controller.signal
      });
      if (requestId !== requestSeqRef.current) return;
      setData(result);
      setIsStaleData(false);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load billing report');
      setIsStaleData(hadData);
    } finally {
      if (requestId !== requestSeqRef.current) return;
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchReport();
    return () => {
      abortRef.current?.abort();
    };
  }, [appliedFilters, sortBy, sortDir, page, pageSize]);

  const applyFilters = (patch: AppliedFilterPatch = {}) => {
    const trimmedFrom = normalizeInput(patch.from !== undefined ? patch.from : from);
    const trimmedTo = normalizeInput(patch.to !== undefined ? patch.to : to);
    const normalizedExtension = normalizeInput(patch.extension !== undefined ? patch.extension : extension);
    const nextCategory = patch.category ?? category;
    setError(null);
    if (!ISO_DATE_RE.test(trimmedFrom) || !ISO_DATE_RE.test(trimmedTo)) {
      setError('Dates must be in YYYY-MM-DD format.');
      return false;
    }
    const dateError = validateDateRange(trimmedFrom, trimmedTo);
    if (dateError) {
      setError(dateError);
      return false;
    }
    setPage(1);
    setAppliedFilters({
      from: trimmedFrom,
      to: trimmedTo,
      extension: normalizedExtension,
      category: nextCategory
    });
    return true;
  };

  const clearFilters = () => {
    setError(null);
    setFrom(defaultFrom);
    setTo(today);
    setExtension('');
    setCategory('all');
    setPage(1);
    setAppliedFilters({
      from: defaultFrom,
      to: today,
      extension: '',
      category: 'all'
    });
  };

  const summaryRows = data?.summary ?? [];
  const categoryMetrics = useMemo(() => buildCategoryMetrics(summaryRows), [summaryRows]);
  const trendModel = useMemo(() => buildTrendModel(data?.dailyTrend ?? []), [data?.dailyTrend]);
  const grandCalls = summaryRows.reduce((sum, row) => sum + Number(row.call_count || 0), 0);
  const grandDuration = summaryRows.reduce((sum, row) => sum + Number(row.total_duration_secs || 0), 0);
  const totalCostNumeric = Array.from(categoryMetrics.totalsByCurrency.values()).reduce((sum, amount) => sum + amount, 0);
  const topCallsTotal = data?.topCostCallsTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(topCallsTotal / pageSize));

  return {
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
    summaryRows,
    categoryMetrics,
    trendModel,
    grandCalls,
    grandDuration,
    totalCostNumeric,
    topCallsTotal,
    totalPages
  };
}
