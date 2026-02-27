import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConnectionEvent,
  ConnectionEventLevel,
  ConnectionEventsPage,
  HealthStatus,
  RecordFilters
} from '../../../shared/types';
import { api } from '../lib/api';
import { useAppStore } from '../state/appStore';

type ServiceEventType = 'all' | 'status' | 'record' | 'alert' | 'connection-event' | 'parse-error';
type ServiceEventSeverity = 'all' | 'low' | 'medium' | 'high';
type ToastKind = 'loading' | 'success' | 'error' | 'info';

interface ActionToast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

const DEFAULT_CONNECTION_EVENTS: ConnectionEventsPage = {
  items: [],
  total: 0,
  limit: 25,
  offset: 0
};

const DEFAULT_EVENT_LOG_VIEWPORT_HEIGHT = 180;
const EVENT_ROW_HEIGHT = 64;
const EVENT_ROW_OVERSCAN = 4;

function formatTimestamp(value?: string): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatUptime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function statusColor(status: string): string {
  if (status === 'connected' || status === 'ok') return 'text-green-500';
  if (status === 'retrying' || status === 'connecting') return 'text-yellow-500';
  return 'text-red-500';
}

function toLocalDateInput(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toIsoStartOfDay(localDate: string): string | undefined {
  if (!localDate) return undefined;
  const date = new Date(`${localDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toIsoEndOfDay(localDate: string): string | undefined {
  if (!localDate) return undefined;
  const date = new Date(`${localDate}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function inferSeverity(event: { type: string; summary: string }): ServiceEventSeverity {
  const summary = event.summary.toLowerCase();
  if (event.type === 'alert' || event.type === 'parse-error') return 'high';
  if (event.type === 'connection-event' && (summary.includes('error') || summary.includes('fail') || summary.includes('drop'))) {
    return 'high';
  }
  if (event.type === 'connection-event') return 'medium';
  return 'low';
}

function extractCallHint(value: string): string | undefined {
  const match = value.match(/\b\d{3,15}\b/);
  return match?.[0];
}

function csvEscape(value: string): string {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
}

function getToastStyles(kind: ToastKind): { border: string; text: string; icon: string } {
  if (kind === 'success') return { border: 'border-green-500/40', text: 'text-green-200', icon: 'text-green-400' };
  if (kind === 'error') return { border: 'border-red-500/40', text: 'text-red-200', icon: 'text-red-400' };
  if (kind === 'loading') return { border: 'border-blue-500/40', text: 'text-blue-100', icon: 'text-blue-300' };
  return { border: 'border-slate-500/40', text: 'text-slate-100', icon: 'text-slate-300' };
}

export function DiagnosticsPage() {
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const activeController = useAppStore((state) => state.activeController);
  const dashboard = useAppStore((state) => state.dashboard);
  const parseErrors = useAppStore((state) => state.parseErrors);
  const refreshRecords = useAppStore((state) => state.refreshRecords);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const refreshParseErrors = useAppStore((state) => state.refreshParseErrors);
  const sseConnectionStatus = useAppStore((state) => state.sseConnectionStatus);
  const serviceEvents = useAppStore((state) => state.serviceEvents);
  const lastServiceEventAt = useAppStore((state) => state.lastServiceEventAt);
  const recentRecordsCount = useAppStore((state) => state.recentRecordsCount);
  const maxInMemoryRecords = useAppStore((state) => state.maxInMemoryRecords);
  const startStream = useAppStore((state) => state.startStream);
  const stopStream = useAppStore((state) => state.stopStream);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const setFilters = useAppStore((state) => state.setFilters);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLastSuccessAt, setHealthLastSuccessAt] = useState<string | null>(null);
  const [healthFailureCount, setHealthFailureCount] = useState(0);
  const [autoHealthRefresh, setAutoHealthRefresh] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState !== 'hidden');

  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [refreshingParseErrors, setRefreshingParseErrors] = useState(false);
  const [lastDashboardRefreshAt, setLastDashboardRefreshAt] = useState<string | null>(null);
  const [lastRecordsRefreshAt, setLastRecordsRefreshAt] = useState<string | null>(null);
  const [lastParseErrorsRefreshAt, setLastParseErrorsRefreshAt] = useState<string | null>(null);
  const [streamAction, setStreamAction] = useState<'start' | 'stop' | null>(null);

  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [connectionEvents, setConnectionEvents] = useState<ConnectionEventsPage>(DEFAULT_CONNECTION_EVENTS);
  const [connectionEventsLoading, setConnectionEventsLoading] = useState(false);
  const [connectionEventsError, setConnectionEventsError] = useState<string | null>(null);
  const [lastConnectionEventsRefreshAt, setLastConnectionEventsRefreshAt] = useState<string | null>(null);
  const [connectionLevelFilter, setConnectionLevelFilter] = useState<ConnectionEventLevel | 'all'>('all');
  const [connectionStartDate, setConnectionStartDate] = useState('');
  const [connectionEndDate, setConnectionEndDate] = useState('');
  const [connectionPage, setConnectionPage] = useState(1);
  const [connectionPageSize, setConnectionPageSize] = useState(25);

  const [eventTypeFilter, setEventTypeFilter] = useState<ServiceEventType>('all');
  const [eventSeverityFilter, setEventSeverityFilter] = useState<ServiceEventSeverity>('all');
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [eventLogScrollTop, setEventLogScrollTop] = useState(0);
  const [eventLogViewportHeight, setEventLogViewportHeight] = useState(DEFAULT_EVENT_LOG_VIEWPORT_HEIGHT);
  const [copyingSnapshot, setCopyingSnapshot] = useState(false);
  const [actionToasts, setActionToasts] = useState<ActionToast[]>([]);

  const healthRequestRef = useRef(0);
  const healthAbortRef = useRef<AbortController | null>(null);
  const connectionRequestRef = useRef(0);
  const eventLogViewportRef = useRef<HTMLDivElement | null>(null);

  const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time';
  const isAdmin = currentUser?.role === 'admin';
  const memoryCap = Math.max(50, maxInMemoryRecords || 0);
  const memoryUsagePct = memoryCap > 0 ? Math.round((recentRecordsCount / memoryCap) * 100) : 0;
  const connectionPages = Math.max(1, Math.ceil((connectionEvents.total || 0) / Math.max(1, connectionPageSize)));

  const parseErrorReasonBreakdown = useMemo(() => {
    const bucket = new Map<string, number>();
    for (const error of parseErrors) {
      bucket.set(error.reason, (bucket.get(error.reason) ?? 0) + 1);
    }
    return Array.from(bucket.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [parseErrors]);

  const filteredServiceEvents = useMemo(() => {
    const normalizedSearch = eventSearchTerm.trim().toLowerCase();
    return serviceEvents.filter((event) => {
      if (eventTypeFilter !== 'all' && event.type !== eventTypeFilter) return false;
      if (eventSeverityFilter !== 'all' && inferSeverity(event) !== eventSeverityFilter) return false;
      if (!normalizedSearch) return true;
      const haystack = `${event.type} ${event.summary}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [eventSearchTerm, eventSeverityFilter, eventTypeFilter, serviceEvents]);

  const visibleEventRows = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(eventLogScrollTop / EVENT_ROW_HEIGHT) - EVENT_ROW_OVERSCAN);
    const visibleCount = Math.ceil(eventLogViewportHeight / EVENT_ROW_HEIGHT) + EVENT_ROW_OVERSCAN * 2;
    const endIndex = Math.min(filteredServiceEvents.length, startIndex + visibleCount);
    const rows = filteredServiceEvents.slice(startIndex, endIndex).map((event, idx) => ({
      event,
      index: startIndex + idx
    }));
    return {
      rows,
      totalHeight: filteredServiceEvents.length * EVENT_ROW_HEIGHT
    };
  }, [eventLogScrollTop, eventLogViewportHeight, filteredServiceEvents]);

  const currentHealthIntervalMs = useMemo(() => {
    const multiplier = healthFailureCount > 0 ? 2 ** Math.min(healthFailureCount, 3) : 1;
    return Math.min(5 * 60_000, 60_000 * multiplier);
  }, [healthFailureCount]);

  const pushToast = useCallback((toast: ActionToast) => {
    setActionToasts((prev) => [toast, ...prev].slice(0, 6));
  }, []);

  const replaceToast = useCallback((id: string, next: Omit<ActionToast, 'id'>) => {
    setActionToasts((prev) => prev.map((toast) => (toast.id === id ? { ...next, id } : toast)));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setActionToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timers = actionToasts
      .filter((toast) => toast.kind !== 'loading')
      .map((toast) => window.setTimeout(() => dismissToast(toast.id), 4200));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [actionToasts, dismissToast]);

  const beginActionToast = useCallback((title: string, detail?: string): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pushToast({ id, kind: 'loading', title, detail });
    return id;
  }, [pushToast]);

  const completeActionToast = useCallback((
    id: string,
    kind: Exclude<ToastKind, 'loading'>,
    title: string,
    detail?: string
  ) => {
    replaceToast(id, { kind, title, detail });
  }, [replaceToast]);

  const openCallsWithHint = useCallback((source: string) => {
    const hint = extractCallHint(source);
    const nextFilters: Partial<RecordFilters> = {
      extension: hint,
      offset: 0
    };
    setFilters(nextFilters);
    setActivePage('calls');
    pushToast({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'info',
      title: hint ? `Opened Call Logs for ${hint}` : 'Opened Call Logs',
      detail: hint ? 'Filter applied from diagnostics context.' : 'No number detected; showing current filters.'
    });
  }, [pushToast, setActivePage, setFilters]);

  const downloadTextFile = useCallback((content: string, fileName: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const fetchHealth = useCallback(async (options?: { withToast?: boolean }) => {
    const requestId = healthRequestRef.current + 1;
    healthRequestRef.current = requestId;

    healthAbortRef.current?.abort();
    const controller = new AbortController();
    healthAbortRef.current = controller;

    const toastId = options?.withToast ? beginActionToast('Checking API health') : null;

    try {
      setHealthLoading(true);
      setHealthError(null);
      const status = await api.getHealth({ signal: controller.signal });
      if (healthRequestRef.current !== requestId) return;
      const refreshedAt = new Date().toISOString();
      setHealth(status);
      setHealthFailureCount(0);
      setHealthLastSuccessAt(refreshedAt);
      if (toastId) {
        completeActionToast(toastId, 'success', 'Health check completed', `Status: ${(status.status ?? 'unknown').toUpperCase()}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (healthRequestRef.current !== requestId) return;
      setHealthError(message);
      setHealthFailureCount((prev) => prev + 1);
      if (toastId) {
        completeActionToast(toastId, 'error', 'Health check failed', message);
      }
    } finally {
      if (healthRequestRef.current === requestId) {
        setHealthLoading(false);
        healthAbortRef.current = null;
      }
    }
  }, [beginActionToast, completeActionToast]);

  const loadConnectionEvents = useCallback(async (options?: { withToast?: boolean }) => {
    if (!authChecked || !isAdmin) return;

    const requestId = connectionRequestRef.current + 1;
    connectionRequestRef.current = requestId;
    const toastId = options?.withToast ? beginActionToast('Loading connection event history') : null;

    try {
      setConnectionEventsLoading(true);
      setConnectionEventsError(null);
      const offset = (connectionPage - 1) * connectionPageSize;
      const result = await api.getConnectionEvents({
        level: connectionLevelFilter,
        startDate: toIsoStartOfDay(connectionStartDate),
        endDate: toIsoEndOfDay(connectionEndDate),
        limit: connectionPageSize,
        offset
      });
      if (connectionRequestRef.current !== requestId) return;
      setConnectionEvents(result);
      setLastConnectionEventsRefreshAt(new Date().toISOString());
      if (toastId) {
        completeActionToast(toastId, 'success', 'Connection events refreshed', `Loaded ${result.items.length} records`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (connectionRequestRef.current !== requestId) return;
      setConnectionEventsError(message);
      if (toastId) {
        completeActionToast(toastId, 'error', 'Connection events refresh failed', message);
      }
    } finally {
      if (connectionRequestRef.current === requestId) {
        setConnectionEventsLoading(false);
      }
    }
  }, [
    authChecked,
    beginActionToast,
    completeActionToast,
    connectionEndDate,
    connectionLevelFilter,
    connectionPage,
    connectionPageSize,
    connectionStartDate,
    isAdmin
  ]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadCurrentUser = async () => {
      try {
        const user = await api.getCurrentUser();
        if (mounted) setCurrentUser(user);
      } finally {
        if (mounted) setAuthChecked(true);
      }
    };
    void loadCurrentUser();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void fetchHealth();
    return () => {
      healthAbortRef.current?.abort();
    };
  }, [fetchHealth]);

  useEffect(() => {
    if (!autoHealthRefresh || !isPageVisible) return undefined;
    const timer = window.setTimeout(() => {
      void fetchHealth();
    }, currentHealthIntervalMs);
    return () => window.clearTimeout(timer);
  }, [autoHealthRefresh, currentHealthIntervalMs, fetchHealth, healthLastSuccessAt, isPageVisible]);

  useEffect(() => {
    if (!isPageVisible || !autoHealthRefresh) return;
    if (!healthLastSuccessAt) return;
    const staleMs = Date.now() - new Date(healthLastSuccessAt).getTime();
    if (staleMs > currentHealthIntervalMs) {
      void fetchHealth();
    }
  }, [autoHealthRefresh, currentHealthIntervalMs, fetchHealth, healthLastSuccessAt, isPageVisible]);

  useEffect(() => {
    void loadConnectionEvents();
  }, [loadConnectionEvents]);

  useEffect(() => {
    const viewportEl = eventLogViewportRef.current;
    if (!viewportEl) return undefined;

    const measure = () => {
      const next = Math.max(140, viewportEl.clientHeight || DEFAULT_EVENT_LOG_VIEWPORT_HEIGHT);
      setEventLogViewportHeight((prev) => (prev === next ? prev : next));
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(viewportEl);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const handleRefreshDashboard = async () => {
    const toastId = beginActionToast('Refreshing dashboard metrics');
    try {
      setRefreshingDashboard(true);
      await refreshDashboard();
      const refreshedAt = new Date().toISOString();
      setLastDashboardRefreshAt(refreshedAt);
      completeActionToast(toastId, 'success', 'Dashboard refreshed', formatTimestamp(refreshedAt));
    } catch (error) {
      completeActionToast(toastId, 'error', 'Dashboard refresh failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingDashboard(false);
    }
  };

  const handleRefreshRecords = async () => {
    const toastId = beginActionToast('Refreshing call logs');
    try {
      setRefreshingRecords(true);
      await refreshRecords();
      const refreshedAt = new Date().toISOString();
      setLastRecordsRefreshAt(refreshedAt);
      completeActionToast(toastId, 'success', 'Call logs refreshed', formatTimestamp(refreshedAt));
    } catch (error) {
      completeActionToast(toastId, 'error', 'Call log refresh failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingRecords(false);
    }
  };

  const handleRefreshParseErrors = async () => {
    const toastId = beginActionToast('Refreshing parse errors');
    try {
      setRefreshingParseErrors(true);
      await refreshParseErrors();
      const refreshedAt = new Date().toISOString();
      setLastParseErrorsRefreshAt(refreshedAt);
      completeActionToast(toastId, 'success', 'Parse errors refreshed', formatTimestamp(refreshedAt));
    } catch (error) {
      completeActionToast(toastId, 'error', 'Parse error refresh failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingParseErrors(false);
    }
  };

  const handleStreamControl = async (action: 'start' | 'stop') => {
    const toastId = beginActionToast(action === 'start' ? 'Starting stream' : 'Stopping stream');
    try {
      setStreamAction(action);
      if (action === 'start') await startStream();
      else await stopStream();
      await fetchHealth();
      completeActionToast(toastId, 'success', action === 'start' ? 'Stream started' : 'Stream stopped');
    } catch (error) {
      completeActionToast(toastId, 'error', action === 'start' ? 'Failed to start stream' : 'Failed to stop stream', error instanceof Error ? error.message : String(error));
    } finally {
      setStreamAction(null);
    }
  };

  const handleCopySnapshot = async () => {
    const toastId = beginActionToast('Copying diagnostics snapshot');
    try {
      setCopyingSnapshot(true);
      const snapshot = [
        `PBX=${connectionStatus}`,
        `SSE=${sseConnectionStatus}`,
        `Health=${health?.status ?? 'unknown'}`,
        `Uptime=${health ? formatUptime(health.uptime) : 'unknown'}`,
        `RecentRecords=${recentRecordsCount}/${memoryCap}`,
        `ParseErrors=${parseErrors.length}`,
        `LastEvent=${lastServiceEventAt ?? 'none'}`,
        `HealthLastSuccess=${healthLastSuccessAt ?? 'none'}`
      ].join(' | ');
      await navigator.clipboard.writeText(snapshot);
      completeActionToast(toastId, 'success', 'Snapshot copied', 'Diagnostics summary copied to clipboard');
    } catch (error) {
      completeActionToast(toastId, 'error', 'Snapshot copy failed', error instanceof Error ? error.message : String(error));
    } finally {
      setCopyingSnapshot(false);
    }
  };

  const handleExportEventLog = (format: 'json' | 'csv') => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') {
      const payload = JSON.stringify(filteredServiceEvents, null, 2);
      downloadTextFile(payload, `diagnostics-events-${timestamp}.json`, 'application/json;charset=utf-8');
      pushToast({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'success',
        title: 'Event log exported',
        detail: 'JSON export downloaded.'
      });
      return;
    }

    const lines = [
      ['id', 'type', 'severity', 'createdAt', 'summary'].join(','),
      ...filteredServiceEvents.map((event) => [
        csvEscape(event.id),
        csvEscape(event.type),
        csvEscape(inferSeverity(event)),
        csvEscape(event.createdAt),
        csvEscape(event.summary)
      ].join(','))
    ];
    downloadTextFile(lines.join('\n'), `diagnostics-events-${timestamp}.csv`, 'text/csv;charset=utf-8');
    pushToast({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'success',
      title: 'Event log exported',
      detail: 'CSV export downloaded.'
    });
  };

  const applyQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - Math.max(days - 1, 0));
    setConnectionStartDate(toLocalDateInput(start));
    setConnectionEndDate(toLocalDateInput(end));
    setConnectionPage(1);
  };

  return (
    <div className="h-[calc(100vh-148px)] min-h-0 overflow-hidden flex flex-col gap-1.5">
      <div className="fixed right-4 top-4 z-40 space-y-2">
        {actionToasts.map((toast) => {
          const styles = getToastStyles(toast.kind);
          return (
            <div
              key={toast.id}
              className={`max-w-sm rounded-xl border bg-slate-950/95 px-3 py-2 shadow-lg ${styles.border}`}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${styles.icon}`}>{toast.kind.toUpperCase()}</p>
                  <p className={`text-sm font-semibold ${styles.text}`}>{toast.title}</p>
                  {toast.detail && <p className="text-xs mt-1 text-slate-300">{toast.detail}</p>}
                </div>
                {toast.kind !== 'loading' && (
                  <button
                    onClick={() => dismissToast(toast.id)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                    aria-label="Dismiss notification"
                  >
                    x
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-1.5 xl:grid-cols-2">
      <div className="card p-2.5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Connection Status</h2>
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={autoHealthRefresh}
              onChange={(e) => setAutoHealthRefresh(e.target.checked)}
            />
            Auto-refresh health ({Math.round(currentHealthIntervalMs / 1000)}s)
          </label>
        </div>
        <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>PBX Connection</p>
            <p className={`text-2xl font-bold ${statusColor(connectionStatus)}`}>
              {connectionStatus?.toUpperCase()}
            </p>
            {activeController && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Active: {activeController}
              </p>
            )}
          </div>

          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>SSE Stream</p>
            <p className={`text-2xl font-bold ${statusColor(sseConnectionStatus)}`}>
              {sseConnectionStatus.toUpperCase()}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Last event: {formatTimestamp(lastServiceEventAt)}
            </p>
          </div>

          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>HTTP Health</p>
            <p className={`text-2xl font-bold ${statusColor(health?.status ?? 'error')}`}>
              {healthLoading ? 'CHECKING' : (health?.status ?? 'DOWN').toUpperCase()}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Uptime: {health ? formatUptime(health.uptime) : 'N/A'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Last success: {formatTimestamp(healthLastSuccessAt ?? undefined)}
            </p>
          </div>

          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Memory Buffer</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--brand)' }}>
              {recentRecordsCount} / {memoryCap}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Usage: {memoryUsagePct}%
            </p>
          </div>
        </div>
        {healthError && (
          <p className="text-xs mt-3 text-red-400">Health check failed: {healthError}</p>
        )}
      </div>

      <div className="card p-2.5">
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Quick Stats</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <div
            className="p-3 rounded-xl border flex flex-col min-h-[126px]"
            style={{ background: 'rgba(36, 132, 235, 0.1)', borderColor: 'var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Total Calls Today</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--brand)' }}>{dashboard.totalCallsToday}</p>
          </div>
          <div
            className="p-3 rounded-xl border flex flex-col min-h-[126px]"
            style={{ background: 'rgba(36, 132, 235, 0.1)', borderColor: 'var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Incoming</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--brand)' }}>{dashboard.incomingCalls}</p>
          </div>
          <div
            className="p-3 rounded-xl border flex flex-col min-h-[126px]"
            style={{ background: 'rgba(38, 182, 127, 0.1)', borderColor: 'var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Outgoing</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--green)' }}>{dashboard.outgoingCalls}</p>
          </div>
          <div
            className="p-3 rounded-xl border flex flex-col min-h-[126px]"
            style={{ background: 'rgba(139, 92, 246, 0.1)', borderColor: 'var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Parse Errors</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--purple)' }}>{parseErrors.length}</p>
          </div>
        </div>
      </div>
      </div>

      <div className="grid gap-1.5 lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] min-h-0 flex-1">
        <div className="card p-2.5 order-1 min-h-0 overflow-auto lg:col-start-1 lg:row-start-1">
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Diagnostics Actions</h2>
          <div className="space-y-1.5">
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                onClick={handleRefreshDashboard}
                disabled={refreshingDashboard}
                className="w-full rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {refreshingDashboard ? 'Refreshing...' : 'Refresh Dashboard'}
              </button>
              <button
                onClick={handleRefreshRecords}
                disabled={refreshingRecords}
                className="w-full rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {refreshingRecords ? 'Refreshing...' : 'Refresh Call Logs'}
              </button>
              <button
                onClick={handleRefreshParseErrors}
                disabled={refreshingParseErrors}
                className="w-full rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {refreshingParseErrors ? 'Refreshing...' : 'Refresh Parse Errors'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                onClick={() => void fetchHealth({ withToast: true })}
                disabled={healthLoading}
                className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {healthLoading ? 'Checking...' : 'Check API Health'}
              </button>
              <button
                onClick={handleCopySnapshot}
                disabled={copyingSnapshot}
                className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {copyingSnapshot ? 'Copying...' : 'Copy Snapshot'}
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => void handleStreamControl('start')}
                    disabled={streamAction !== null}
                    className="w-full rounded-2xl border border-green-700 px-4 py-2 text-sm font-semibold text-green-400 disabled:opacity-50"
                  >
                    {streamAction === 'start' ? 'Starting...' : 'Start Stream'}
                  </button>
                  <button
                    onClick={() => void handleStreamControl('stop')}
                    disabled={streamAction !== null}
                    className="w-full rounded-2xl border border-red-700 px-4 py-2 text-sm font-semibold text-red-400 disabled:opacity-50"
                  >
                    {streamAction === 'stop' ? 'Stopping...' : 'Stop Stream'}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="grid gap-1 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            <p>Dashboard refreshed: {formatTimestamp(lastDashboardRefreshAt ?? undefined)}</p>
            <p>Call logs refreshed: {formatTimestamp(lastRecordsRefreshAt ?? undefined)}</p>
            <p>Parse errors refreshed: {formatTimestamp(lastParseErrorsRefreshAt ?? undefined)}</p>
            <p>Connection events refreshed: {formatTimestamp(lastConnectionEventsRefreshAt ?? undefined)}</p>
          </div>
          {!isAdmin && authChecked && (
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Stream control is restricted to administrators.
            </p>
          )}
        </div>

        <div className="card p-2.5 order-4 min-h-0 overflow-hidden flex flex-col lg:order-2 lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Real-time Event Log</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleExportEventLog('json')}
                disabled={filteredServiceEvents.length === 0}
                className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Export JSON
              </button>
              <button
                onClick={() => handleExportEventLog('csv')}
                disabled={filteredServiceEvents.length === 0}
                className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 mb-2">
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as ServiceEventType)}
              className="rounded-xl border px-3 py-2 text-xs"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="all">All types</option>
              <option value="status">Status</option>
              <option value="record">Record</option>
              <option value="alert">Alert</option>
              <option value="connection-event">Connection</option>
              <option value="parse-error">Parse Error</option>
            </select>

            <select
              value={eventSeverityFilter}
              onChange={(e) => setEventSeverityFilter(e.target.value as ServiceEventSeverity)}
              className="rounded-xl border px-3 py-2 text-xs"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <input
              value={eventSearchTerm}
              onChange={(e) => setEventSearchTerm(e.target.value)}
              placeholder="Search event summary..."
              className="rounded-xl border px-3 py-2 text-xs sm:col-span-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>

          <div
            ref={eventLogViewportRef}
            className="flex-1 min-h-0 overflow-auto rounded-xl bg-black/20"
            onScroll={(e) => setEventLogScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
          >
            {filteredServiceEvents.length > 0 ? (
              <div style={{ height: visibleEventRows.totalHeight, position: 'relative' }}>
                {visibleEventRows.rows.map(({ event, index }) => (
                  <div
                    key={event.id}
                    className="px-3 py-2 border-b"
                    style={{
                      borderColor: 'var(--border)',
                      height: EVENT_ROW_HEIGHT,
                      position: 'absolute',
                      top: index * EVENT_ROW_HEIGHT,
                      left: 0,
                      right: 0
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="uppercase text-[10px] font-bold tracking-wide" style={{ color: 'var(--brand)' }}>
                        {event.type}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-1">
                      <p className="text-xs truncate" style={{ color: 'var(--text)' }}>{event.summary}</p>
                      {event.type === 'alert' ? (
                        <button
                          className="rounded-lg border border-amber-700 px-2 py-1 text-[10px] font-semibold text-amber-300"
                          onClick={() => setActivePage('alerts')}
                        >
                          Open Alerts
                        </button>
                      ) : (event.type === 'parse-error' || event.type === 'connection-event') ? (
                        <button
                          className="rounded-lg border border-blue-700 px-2 py-1 text-[10px] font-semibold text-blue-300"
                          onClick={() => openCallsWithHint(event.summary)}
                        >
                          Open Calls
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-3 text-xs" style={{ color: 'var(--muted)' }}>No events available for the selected filters.</p>
            )}
          </div>
        </div>
        <div className="card p-2.5 order-2 min-h-0 overflow-hidden flex flex-col lg:order-4 lg:col-start-2 lg:row-start-2 lg:row-span-2">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
              Recent Parse Errors ({parseErrors.length})
            </h2>
            <button
              onClick={handleRefreshParseErrors}
              disabled={refreshingParseErrors}
              className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {refreshingParseErrors ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {parseErrorReasonBreakdown.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {parseErrorReasonBreakdown.map(([reason, count]) => (
                <span key={reason} className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  {reason}: {count}
                </span>
              ))}
            </div>
          )}

          {parseErrors.length > 0 ? (
            <div className="flex-1 min-h-0 space-y-2 overflow-auto pr-1">
              {parseErrors.map((error, index) => (
                <div key={`${error.createdAt ?? index}-${index}`} className="p-3 rounded-xl bg-red-900/20 border border-red-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-red-300">{error.reason}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                        {formatTimestamp(error.createdAt)}
                      </p>
                    </div>
                    <button
                      className="rounded-lg border border-red-700 px-2 py-1 text-[11px] font-semibold text-red-300"
                      onClick={() => openCallsWithHint(`${error.reason} ${error.line}`)}
                    >
                      Open in Calls
                    </button>
                  </div>
                  <p className="text-xs font-mono mt-1 break-all" style={{ color: 'var(--text)' }}>
                    {error.line}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No parse errors recorded.</p>
          )}
        </div>

        <div className="card p-2.5 order-3 min-h-0 overflow-hidden flex flex-col lg:order-3 lg:col-start-1 lg:row-start-2 lg:row-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Connection Events History</h2>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Date filters use {timezoneLabel} and are sent as explicit ISO timestamps.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => void loadConnectionEvents({ withToast: true })}
              disabled={connectionEventsLoading}
              className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {connectionEventsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>

        {!authChecked ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Checking access...</p>
        ) : !isAdmin ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Connection event history is available to administrators only.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                className="rounded-lg border px-2 py-1 text-[11px]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => applyQuickDateRange(1)}
              >
                Today
              </button>
              <button
                className="rounded-lg border px-2 py-1 text-[11px]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => applyQuickDateRange(3)}
              >
                Last 3 days
              </button>
              <button
                className="rounded-lg border px-2 py-1 text-[11px]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => applyQuickDateRange(7)}
              >
                Last 7 days
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-5 mb-2">
              <label className="text-xs md:col-span-1" style={{ color: 'var(--muted)' }}>
                Level
                <select
                  value={connectionLevelFilter}
                  onChange={(e) => {
                    setConnectionLevelFilter(e.target.value as ConnectionEventLevel | 'all');
                    setConnectionPage(1);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <option value="all">All</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </label>
              <label className="text-xs md:col-span-1" style={{ color: 'var(--muted)' }}>
                Start Date
                <input
                  type="date"
                  value={connectionStartDate}
                  onChange={(e) => {
                    setConnectionStartDate(e.target.value);
                    setConnectionPage(1);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
              </label>
              <label className="text-xs md:col-span-1" style={{ color: 'var(--muted)' }}>
                End Date
                <input
                  type="date"
                  value={connectionEndDate}
                  onChange={(e) => {
                    setConnectionEndDate(e.target.value);
                    setConnectionPage(1);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
              </label>
              <label className="text-xs md:col-span-1" style={{ color: 'var(--muted)' }}>
                Page Size
                <select
                  value={connectionPageSize}
                  onChange={(e) => {
                    setConnectionPageSize(Number(e.target.value));
                    setConnectionPage(1);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="md:col-span-1 flex items-end">
                <button
                  onClick={() => {
                    setConnectionStartDate('');
                    setConnectionEndDate('');
                    setConnectionLevelFilter('all');
                    setConnectionPage(1);
                  }}
                  className="w-full rounded-xl border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  Reset Filters
                </button>
              </div>
            </div>

            {connectionEventsError && (
              <p className="text-xs mb-2 text-red-400">Failed to load connection events: {connectionEventsError}</p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              {connectionEventsLoading ? (
                <p className="p-3 text-sm" style={{ color: 'var(--muted)' }}>Loading connection events...</p>
              ) : connectionEvents.items.length > 0 ? (
                connectionEvents.items.map((event: ConnectionEvent) => (
                  <div key={`${event.id ?? event.createdAt}-${event.message}`} className="p-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-[11px] uppercase font-semibold ${
                        event.level === 'error' ? 'text-red-400' : event.level === 'warn' ? 'text-yellow-400' : 'text-blue-300'
                      }`}>
                        {event.level}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 mt-1">
                      <p className="text-sm" style={{ color: 'var(--text)' }}>{event.message}</p>
                      <button
                        className="rounded-lg border border-blue-700 px-2 py-1 text-[11px] font-semibold text-blue-300"
                        onClick={() => openCallsWithHint(event.message)}
                      >
                        Open in Calls
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-3 text-sm" style={{ color: 'var(--muted)' }}>No connection events found.</p>
              )}
            </div>

            <div className="flex items-center justify-between mt-2">
              <div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Showing {connectionEvents.items.length} of {connectionEvents.total} events
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Last refreshed: {formatTimestamp(lastConnectionEventsRefreshAt ?? undefined)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConnectionPage((prev) => Math.max(1, prev - 1))}
                  disabled={connectionPage <= 1 || connectionEventsLoading}
                  className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  Prev
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Page {connectionPage} / {connectionPages}
                </span>
                <button
                  onClick={() => setConnectionPage((prev) => Math.min(connectionPages, prev + 1))}
                  disabled={connectionPage >= connectionPages || connectionEventsLoading}
                  className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
