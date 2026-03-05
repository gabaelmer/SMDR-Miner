import { create } from 'zustand';
import dayjs from 'dayjs';
import {
  AlertEvent,
  AnalyticsSnapshot,
  AppConfig,
  CallLogSummary,
  DashboardMetrics,
  ParseError,
  RecordFilters,
  ServiceState,
  SMDRRecord
} from '../../../shared/types';
import { api } from '../lib/api';
import { EMPTY_SUMMARY, normalizeAnalyticsSnapshot } from '../lib/analyticsSnapshot';

export type PageId = 'dashboard' | 'calls' | 'analytics' | 'settings' | 'alerts' | 'billing' | 'billing-report' | 'diagnostics' | 'users' | 'audit' | 'password-policy';
export interface ServiceEventLog {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
}

const defaultAnalytics: AnalyticsSnapshot = {
  volumeByHour: [],
  heatmap: [],
  extensionUsage: [],
  transferConference: [],
  summary: EMPTY_SUMMARY,
  correlations: []
};

const defaultDashboard: DashboardMetrics = {
  date: '',
  lastUpdatedAt: '',
  totalCallsToday: 0,
  totalDurationSeconds: 0,
  incomingCalls: 0,
  outgoingCalls: 0,
  internalCalls: 0,
  internalDurationSeconds: 0,
  inboundCalls: 0,
  inboundDurationSeconds: 0,
  outboundCalls: 0,
  outboundDurationSeconds: 0,
  totalCostToday: 0,
  avgCallDurationSeconds: 0,
  highCostCalls: 0,
  sevenDayTrend: [],
  callDistribution: [],
  topExtensionsByCostAndVolume: [],
  topExtensions: [],
  topDialedNumbers: [],
  longCalls: [],
  activeStream: false
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeDashboard(input: unknown): DashboardMetrics {
  const source = (input ?? {}) as Partial<DashboardMetrics> & Record<string, unknown>;

  const sevenDayTrend = Array.isArray(source.sevenDayTrend)
    ? source.sevenDayTrend.map((row) => ({
      date: typeof row?.date === 'string' ? row.date : '',
      callCount: toNumber(row?.callCount),
      totalCost: toNumber(row?.totalCost)
    })).filter((row) => row.date)
    : [];

  const callDistribution = Array.isArray(source.callDistribution)
    ? source.callDistribution.map((row) => ({
      category: typeof row?.category === 'string' ? row.category : 'unclassified',
      count: toNumber(row?.count),
      percentage: toNumber(row?.percentage),
      totalCost: toNumber(row?.totalCost)
    }))
    : [];

  const topExtensionsByCostAndVolume = Array.isArray(source.topExtensionsByCostAndVolume)
    ? source.topExtensionsByCostAndVolume.map((row) => ({
      extension: typeof row?.extension === 'string' ? row.extension : '',
      count: toNumber(row?.count),
      totalCost: toNumber(row?.totalCost)
    })).filter((row) => row.extension)
    : [];

  const topExtensions = Array.isArray(source.topExtensions)
    ? source.topExtensions.map((row) => ({
      extension: typeof row?.extension === 'string' ? row.extension : '',
      count: toNumber(row?.count)
    })).filter((row) => row.extension)
    : [];

  const topDialedNumbers = Array.isArray(source.topDialedNumbers)
    ? source.topDialedNumbers.map((row) => ({
      number: typeof row?.number === 'string' ? row.number : '',
      count: toNumber(row?.count)
    })).filter((row) => row.number)
    : [];

  const longCalls = Array.isArray(source.longCalls)
    ? (source.longCalls as SMDRRecord[]).filter((row) => Boolean(row?.date && row?.startTime))
    : [];

  return {
    ...defaultDashboard,
    date: typeof source.date === 'string' ? source.date : defaultDashboard.date,
    lastUpdatedAt: typeof source.lastUpdatedAt === 'string' ? source.lastUpdatedAt : defaultDashboard.lastUpdatedAt,
    totalCallsToday: toNumber(source.totalCallsToday),
    totalDurationSeconds: toNumber(source.totalDurationSeconds),
    incomingCalls: toNumber(source.incomingCalls),
    outgoingCalls: toNumber(source.outgoingCalls),
    internalCalls: toNumber(source.internalCalls),
    internalDurationSeconds: toNumber(source.internalDurationSeconds),
    inboundCalls: toNumber(source.inboundCalls),
    inboundDurationSeconds: toNumber(source.inboundDurationSeconds),
    outboundCalls: toNumber(source.outboundCalls),
    outboundDurationSeconds: toNumber(source.outboundDurationSeconds),
    totalCostToday: toNumber(source.totalCostToday),
    avgCallDurationSeconds: toNumber(source.avgCallDurationSeconds),
    highCostCalls: toNumber(source.highCostCalls),
    sevenDayTrend,
    callDistribution,
    topExtensionsByCostAndVolume,
    topExtensions,
    topDialedNumbers,
    longCalls,
    activeStream: Boolean(source.activeStream)
  };
}

const defaultCallLogSummary: CallLogSummary = {
  totalCalls: 0,
  totalDurationSeconds: 0,
  topExtensionsMade: [],
  topExtensionsReceived: []
};

const DEV_LOG = import.meta.env.DEV;

function debugLog(...args: unknown[]): void {
  if (DEV_LOG) console.log(...args);
}

interface AppState {
  initialized: boolean;
  isAuthenticated: boolean;
  activePage: PageId;
  theme: 'light' | 'dark';
  connectionStatus: string;
  activeController?: string;
  parserOptions: Record<string, unknown>;
  config?: AppConfig;
  records: SMDRRecord[];
  recordsTotal: number;
  recordsLoading: boolean;
  dashboardLoading: boolean;
  dashboardError?: string;
  callLogSummary: CallLogSummary;
  alerts: AlertEvent[];
  parseErrors: ParseError[];
  dashboard: DashboardMetrics;
  analytics: AnalyticsSnapshot;
  filters: RecordFilters;
  statusText: string;
  sseConnectionStatus: 'connecting' | 'connected' | 'disconnected';
  lastServiceEventAt?: string;
  serviceEvents: ServiceEventLog[];
  recentRecordsCount: number;
  maxInMemoryRecords: number;
  toast: { type: 'loading' | 'success' | 'error' | 'warning'; title: string; sub: string } | null;

  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setActivePage: (page: PageId) => void;
  toggleTheme: () => void;
  setFilters: (filters: Partial<RecordFilters>) => void;
  setToast: (toast: { type: 'loading' | 'success' | 'error' | 'warning'; title: string; sub: string } | null) => void;
  refreshRecords: () => Promise<void>;
  refreshDashboard: (date?: string) => Promise<void>;
  refreshAnalytics: (startDate?: string, endDate?: string) => Promise<void>;
  refreshAlerts: () => Promise<void>;
  refreshParseErrors: () => Promise<void>;

  saveConfig: (config: AppConfig) => Promise<void>;
  updateAlertRules: (rules: AppConfig['alerts']) => Promise<void>;
  startStream: () => Promise<void>;
  stopStream: () => Promise<void>;
  exportRecords: (format: 'csv' | 'xlsx' | 'pdf') => Promise<string | null>;
  purgeRecords: (days: number) => Promise<number>;
}

let unsubscribeEvents: (() => void) | undefined;
let dashboardRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let analyticsRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let recordsRefreshTimer: ReturnType<typeof setTimeout> | undefined;

function cleanupLiveSubscriptions(): void {
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = undefined;
  }
  if (dashboardRefreshTimer) {
    clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = undefined;
  }
  if (analyticsRefreshTimer) {
    clearTimeout(analyticsRefreshTimer);
    analyticsRefreshTimer = undefined;
  }
  if (recordsRefreshTimer) {
    clearTimeout(recordsRefreshTimer);
    recordsRefreshTimer = undefined;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  isAuthenticated: false,
  activePage: 'dashboard',
  theme: 'dark',
  connectionStatus: 'disconnected',
  parserOptions: {},
  records: [],
  recordsTotal: 0,
  recordsLoading: false,
  dashboardLoading: false,
  dashboardError: undefined,
  callLogSummary: defaultCallLogSummary,
  alerts: [],
  parseErrors: [],
  dashboard: defaultDashboard,
  analytics: defaultAnalytics,
  filters: {
    date: undefined, // Start with no date filter for call logs
    limit: 50,
    offset: 0
  },
  statusText: 'Ready',
  sseConnectionStatus: 'connecting',
  lastServiceEventAt: undefined,
  serviceEvents: [],
  recentRecordsCount: 0,
  maxInMemoryRecords: 0,
  toast: null,

  initialize: async () => {
    if (get().initialized) {
      debugLog('[AppStore] Already initialized, skipping');
      return;
    }

    api.log('info', 'Renderer initialize() starting');

    try {
      // For browser mode, check if we have a valid session
      if (!api.isElectron()) {
        const isAuthed = await api.verifyAuth();
        debugLog('[AppStore] Auth check result:', isAuthed);
        if (isAuthed) {
          set({ isAuthenticated: true });
        } else {
          cleanupLiveSubscriptions();
          debugLog('[AppStore] Not authenticated, showing login screen');
          set({ initialized: true }); // No session, but we are initialized at login screen
          return;
        }
      }

      debugLog('[AppStore] Fetching initial state...');
      const [config, state] = await Promise.all([api.getConfig(), api.getState()]);
      set({
        connectionStatus: String(state.connectionStatus ?? 'disconnected'),
        activeController: state.activeController,
        parserOptions: asRecord(state.parserOptions),
        recentRecordsCount: Number(state.recentRecordsCount ?? 0),
        maxInMemoryRecords: Number(state.maxInMemoryRecords ?? 0)
      });

      debugLog('[AppStore] Fetching initial data...');
      const filters = get().filters;
      const [recordsResult, summaryResult, dashboardResult, analyticsResult, alertsResult, parseErrorsResult] = await Promise.allSettled([
        api.getRecordsPage(filters),
        api.getRecordSummary(filters),
        api.getDashboard(filters.date),
        api.getAnalytics(filters.date, filters.date),
        api.getAlerts(200),
        api.getParseErrors(200)
      ]);

      const failedCount = [recordsResult, summaryResult, dashboardResult, analyticsResult, alertsResult, parseErrorsResult].filter(
        (result) => result.status === 'rejected'
      ).length;

      if (recordsResult.status === 'rejected') console.error('[AppStore] Initial records fetch failed:', recordsResult.reason);
      if (summaryResult.status === 'rejected') console.error('[AppStore] Initial call summary fetch failed:', summaryResult.reason);
      if (dashboardResult.status === 'rejected') console.error('[AppStore] Initial dashboard fetch failed:', dashboardResult.reason);
      if (analyticsResult.status === 'rejected') console.error('[AppStore] Initial analytics fetch failed:', analyticsResult.reason);
      if (alertsResult.status === 'rejected') console.error('[AppStore] Initial alerts fetch failed:', alertsResult.reason);
      if (parseErrorsResult.status === 'rejected') console.error('[AppStore] Initial parse-errors fetch failed:', parseErrorsResult.reason);

      const recordsPage = recordsResult.status === 'fulfilled'
        ? recordsResult.value
        : { rows: [], total: 0, limit: filters.limit ?? 50, offset: filters.offset ?? 0 };
      const callLogSummary = summaryResult.status === 'fulfilled' ? summaryResult.value : defaultCallLogSummary;
      const dashboard = dashboardResult.status === 'fulfilled' ? normalizeDashboard(dashboardResult.value) : defaultDashboard;
      const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : defaultAnalytics;
      const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];
      const parseErrors = parseErrorsResult.status === 'fulfilled' ? parseErrorsResult.value : [];

      api.log('info', 'Renderer initialize() data fetched');

      set({
        config,
        records: recordsPage.rows,
        recordsTotal: recordsPage.total,
        callLogSummary,
        dashboard,
        dashboardLoading: false,
        dashboardError: dashboardResult.status === 'rejected' ? 'Failed to load dashboard metrics' : undefined,
        analytics: normalizeAnalyticsSnapshot(analytics as AnalyticsSnapshot),
        alerts: alerts as AlertEvent[],
        parseErrors: parseErrors as ParseError[],
        initialized: true,
        statusText: failedCount > 0 ? `Initialized with partial data (${failedCount} request${failedCount > 1 ? 's' : ''} failed)` : 'Initialized'
      });
      debugLog('[AppStore] Initialization complete');
    } catch (error) {
      console.error('[AppStore] Initialization error:', error);
      const fallbackState = await api.getState().catch(() => undefined as ServiceState | undefined);
      set({
        connectionStatus: String(fallbackState?.connectionStatus ?? get().connectionStatus ?? 'disconnected'),
        activeController: fallbackState?.activeController ?? get().activeController,
        parserOptions: asRecord(fallbackState?.parserOptions ?? get().parserOptions),
        recentRecordsCount: Number(fallbackState?.recentRecordsCount ?? get().recentRecordsCount ?? 0),
        maxInMemoryRecords: Number(fallbackState?.maxInMemoryRecords ?? get().maxInMemoryRecords ?? 0),
        dashboardLoading: false,
        dashboardError: 'Failed to load dashboard metrics',
        initialized: true,
        statusText: 'Initialization failed - refresh to retry'
      });
    }

    if (!unsubscribeEvents) {
      set({ sseConnectionStatus: 'connecting' });
      unsubscribeEvents = api.onServiceEvent((event) => {
        debugLog('[AppStore] Received event:', event.type);
        const createdAt = new Date().toISOString();
        const summary = (() => {
          if (event.type === 'status') return String(event.payload ?? 'status');
          if (event.type === 'record') {
            const record = event.payload as SMDRRecord;
            return `${record.callingParty ?? 'unknown'} -> ${record.calledParty ?? 'unknown'}`;
          }
          if (event.type === 'alert') {
            const alert = event.payload as AlertEvent;
            return alert.message ?? alert.type ?? 'alert';
          }
          if (event.type === 'connection-event') {
            const payload = event.payload as { message?: string };
            return payload.message ?? 'connection event';
          }
          if (event.type === 'parse-error') {
            const parseError = event.payload as ParseError;
            return parseError.reason ?? 'parse error';
          }
          try {
            return JSON.stringify(event.payload).slice(0, 160);
          } catch {
            return String(event.payload ?? 'event');
          }
        })();
        set((state) => ({
          lastServiceEventAt: createdAt,
          serviceEvents: [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: String(event.type), summary, createdAt }, ...state.serviceEvents].slice(0, 200)
        }));
        
        if (event.type === 'status') {
          const newStatus = String(event.payload);
          const oldStatus = get().connectionStatus;
          debugLog('[AppStore] Status change:', oldStatus, '->', newStatus);
          set({ connectionStatus: newStatus });

          // Only refresh on transition to connected to avoid loops
          if (newStatus === 'connected' && oldStatus !== 'connected') {
            debugLog('[AppStore] Connection established, refreshing dashboard');
            void get().refreshDashboard(get().filters.date);
          }
        }

        if (event.type === 'record') {
          const record = event.payload as SMDRRecord;
          set((state) => {
            return {
              records: [record, ...state.records].slice(0, 2000),
              statusText: `Live record: ${record.callingParty} -> ${record.calledParty}`,
              recentRecordsCount: Math.min(Math.max(50, state.maxInMemoryRecords || 0), state.recentRecordsCount + 1)
            };
          });

          // Debounce refreshes so bursts of records don't flood the API.
          if (dashboardRefreshTimer) clearTimeout(dashboardRefreshTimer);
          dashboardRefreshTimer = setTimeout(() => {
            void get().refreshDashboard(undefined);
          }, 700);

          // Also refresh records to ensure call log is in sync
          if (get().activePage === 'calls' || get().activePage === 'dashboard') {
            if (recordsRefreshTimer) clearTimeout(recordsRefreshTimer);
            recordsRefreshTimer = setTimeout(() => {
              void get().refreshRecords().catch((error) => {
                console.error('Records refresh failed', error);
              });
            }, 900);
          }

          if (get().activePage === 'analytics') {
            if (analyticsRefreshTimer) clearTimeout(analyticsRefreshTimer);
            analyticsRefreshTimer = setTimeout(() => {
              const stateFilters = get().filters;
              const rangeStart = stateFilters.dateFrom ?? stateFilters.date;
              const rangeEnd = stateFilters.dateTo ?? stateFilters.date;
              void get().refreshAnalytics(rangeStart, rangeEnd).catch((error) => {
                console.error('Analytics refresh failed', error);
              });
            }, 1200);
          }
        }

        if (event.type === 'alert') {
          const alert = event.payload as AlertEvent;
          debugLog('[AppStore] Alert:', alert.type, alert.message);
          set((state) => ({ alerts: [alert, ...state.alerts].slice(0, 500) }));
        }

        if (event.type === 'connection-event') {
          const payload = event.payload as { message?: string };
          debugLog('[AppStore] Connection event:', payload.message);
          set({ statusText: payload.message ?? 'Connection event' });
        }

        if (event.type === 'parse-error') {
          const parseError = event.payload as ParseError;
          debugLog('[AppStore] Parse error:', parseError.reason);
          set((state) => ({
            parseErrors: [parseError, ...state.parseErrors].slice(0, 500),
            statusText: `Parse error: ${parseError.reason}`
          }));
        }
      }, {
        onOpen: () => set({ sseConnectionStatus: 'connected' }),
        onError: () => set({ sseConnectionStatus: 'disconnected' }),
        onClose: () => set({ sseConnectionStatus: 'disconnected' })
      });
    }
  },

  login: async (username, password) => {
    const result = await api.login({ username, password });
    if (result.success) {
      set({ isAuthenticated: true });
      // Reset initialized flag to force data reload
      set({ initialized: false });
      await get().initialize();
    }
    return result;  // Return full result object with error message
  },

  logout: async () => {
    await api.logout();
    cleanupLiveSubscriptions();
    set({
      isAuthenticated: false,
      initialized: true,
      activePage: 'dashboard',
      sseConnectionStatus: 'disconnected',
      serviceEvents: [],
      lastServiceEventAt: undefined
    });
  },

  setActivePage: (page) => set({ activePage: page }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    set({ theme: next });
  },

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),

  setToast: (toast) => set({ toast }),

  refreshRecords: async () => {
    set({ recordsLoading: true });
    try {
      const filters = get().filters;
      debugLog('[AppStore] Refreshing records with filters:', filters);
      const [recordsPage, callLogSummary] = await Promise.all([
        api.getRecordsPage(filters),
        api.getRecordSummary(filters)
      ]);
      debugLog('[AppStore] Received', recordsPage.rows.length, 'records');
      set({
        records: recordsPage.rows,
        recordsTotal: recordsPage.total,
        callLogSummary
      });
    } catch (error) {
      console.error('Records refresh failed', error);
      set({ statusText: 'Failed to load filtered call logs' });
    } finally {
      set({ recordsLoading: false });
    }
  },

  refreshDashboard: async (date) => {
    // Always use today's date for dashboard if no date specified
    const dateToUse = date ?? dayjs().format('YYYY-MM-DD');
    set({ dashboardLoading: true, dashboardError: undefined });
    try {
      const dashboard = normalizeDashboard(await api.getDashboard(dateToUse));
      set({ dashboard, dashboardLoading: false, dashboardError: undefined });
    } catch (error) {
      console.error('[AppStore] Dashboard refresh failed', error);
      set({
        dashboardLoading: false,
        dashboardError: 'Failed to refresh dashboard',
        statusText: 'Failed to refresh dashboard'
      });
    }
  },

  refreshAnalytics: async (startDate, endDate) => {
    const filters = get().filters;
    const resolvedStart = startDate ?? filters.dateFrom ?? filters.date;
    const resolvedEnd = endDate ?? filters.dateTo ?? filters.date;
    const analytics = await api.getAnalytics(resolvedStart, resolvedEnd);
    set({ analytics: normalizeAnalyticsSnapshot(analytics as AnalyticsSnapshot) });
  },

  refreshAlerts: async () => {
    const alerts = (await api.getAlerts(200)) as AlertEvent[];
    set({ alerts });
  },

  refreshParseErrors: async () => {
    const parseErrors = (await api.getParseErrors(200)) as ParseError[];
    set({ parseErrors });
  },

  saveConfig: async (config) => {
    await api.updateConfig(config);
    const state = await api.getState();
    set({
      config,
      statusText: 'Configuration saved',
      connectionStatus: String(state.connectionStatus ?? 'disconnected'),
      activeController: state.activeController,
      parserOptions: asRecord(state.parserOptions),
      recentRecordsCount: Number(state.recentRecordsCount ?? get().recentRecordsCount ?? 0),
      maxInMemoryRecords: Number(state.maxInMemoryRecords ?? Math.max(50, config.maxInMemoryRecords || 0))
    });
  },

  updateAlertRules: async (rules) => {
    await api.updateAlertRules(rules);
    set((state) => ({
      config: state.config ? { ...state.config, alerts: rules } : state.config,
      statusText: 'Alert rules saved'
    }));
  },

  startStream: async () => {
    await api.startStream();
    set({ statusText: 'Stream started' });
    await get().refreshDashboard(get().filters.date);
  },

  stopStream: async () => {
    await api.stopStream();
    set({ statusText: 'Stream stopped' });
    await get().refreshDashboard(get().filters.date);
  },

  exportRecords: async (format) => {
    const savedPath = await api.exportRecordsWithDialog({
      format,
      filters: get().filters
    });
    if (!savedPath) {
      set({ statusText: 'Export canceled' });
      return null;
    }
    set({ statusText: `Export completed: ${savedPath}` });
    return savedPath;
  },

  purgeRecords: async (days) => {
    const removed = await api.purgeRecords(days);
    set({ statusText: `Purged ${removed} records older than ${days} days` });
    return removed;
  }
}));
