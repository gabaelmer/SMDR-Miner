import {
    AlertEvent,
    AnalyticsSnapshot,
    AppConfig,
    AuthCredentials,
    BillingReportData,
    BillingReportQuery,
    CallLogSummary,
    DashboardMetrics,
    ExportDialogOptions,
    ExportOptions,
    ConnectionEvent,
    ConnectionEventsPage,
    ConnectionEventLevel,
    HealthStatus,
    ServiceState,
    ParseError,
    RecordFilters,
    RecordsPage,
    SMDRRecord,
    SMDRImportResult,
    AuditEntry,
    AuditAction,
    User
} from '../../../shared/types';

const isElectron = typeof window.smdrInsight !== 'undefined';
// Use relative path - works for both localhost and remote
const API_BASE = '';
const DEV_LOG = import.meta.env.DEV;

function formatApiErrorDetails(details: unknown): string {
    if (!details) return '';
    if (Array.isArray(details)) {
        const first = details[0] as { path?: Array<string | number>; message?: string } | undefined;
        if (!first) return '';
        const path = Array.isArray(first.path) ? first.path.join('.') : '';
        const message = first.message ?? 'Validation failed';
        return path ? `${path}: ${message}` : message;
    }
    if (typeof details === 'string') return details;
    return '';
}

async function rest<T>(path: string, options?: RequestInit, timeoutMs: number = 10000): Promise<T> {
    const headers = {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (options?.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', onExternalAbort);
    }
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
            signal: controller.signal,
            credentials: 'include'
        });
        clearTimeout(timeoutId);

        if (response.status === 401) {
            localStorage.removeItem('smdr_token');
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            const detailText = formatApiErrorDetails((error as { details?: unknown }).details);
            throw new Error(detailText ? `${error.error || 'Request failed'} (${detailText})` : (error.error || `HTTP error! status: ${response.status}`));
        }
        return response.json() as Promise<T>;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            if (timedOut) {
                throw new Error(`Request timeout for ${path}`);
            }
            throw error;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        if (options?.signal) options.signal.removeEventListener('abort', onExternalAbort);
    }
}

async function restBlob(path: string, options?: RequestInit, timeoutMs: number = 30000): Promise<{ blob: Blob; headers: Headers }> {
    const headers = {
        ...(options?.headers || {}),
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (options?.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', onExternalAbort);
    }
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
            signal: controller.signal,
            credentials: 'include'
        });
        if (response.status === 401) {
            localStorage.removeItem('smdr_token');
        }
        if (!response.ok) {
            const maybeJson = await response
                .json()
                .catch(async () => ({ error: await response.text().catch(() => 'Request failed') }));
            const detailText = formatApiErrorDetails((maybeJson as { details?: unknown }).details);
            throw new Error(
                detailText
                    ? `${(maybeJson as { error?: string }).error || 'Request failed'} (${detailText})`
                    : (maybeJson as { error?: string }).error || `HTTP error! status: ${response.status}`
            );
        }
        return { blob: await response.blob(), headers: response.headers };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            if (timedOut) throw new Error(`Request timeout for ${path}`);
            throw error;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        if (options?.signal) options.signal.removeEventListener('abort', onExternalAbort);
    }
}

type UsersSortBy = 'username' | 'role' | 'created_at' | 'last_login';
type UsersSortDir = 'asc' | 'desc';

export interface UsersQuery {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: 'admin' | 'user' | 'all';
    sortBy?: UsersSortBy;
    sortDir?: UsersSortDir;
    // Advanced filters
    status?: 'all' | 'active' | 'inactive' | 'locked';
    createdAfter?: string;
    createdBefore?: string;
    lastLoginAfter?: string;
    lastLoginBefore?: string;
    neverLoggedIn?: boolean;
    inactiveDays?: number;
}

export interface UsersListResponse {
    items: User[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ConnectionEventsQuery {
    level?: ConnectionEventLevel | 'all';
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
}

function cleanRecordFilters(filters: RecordFilters): Record<string, string> {
    const cleanFilters: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
            cleanFilters[key] = String(value);
        }
    });
    return cleanFilters;
}

function durationToSeconds(duration: string | undefined): number {
    if (!duration) return 0;
    const parts = duration.split(':').map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

function aggregateTop(rows: SMDRRecord[], getKey: (row: SMDRRecord) => string): Array<{ extension: string; count: number }> {
    const map: Record<string, number> = {};
    for (const row of rows) {
        const key = getKey(row);
        if (!key) continue;
        map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([extension, count]) => ({ extension, count: count as number }));
}

export const api = {
    isElectron: () => isElectron,

    login: async (credentials: AuthCredentials): Promise<{ success: boolean; error?: string }> => {
        if (isElectron) {
            const result = await window.smdrInsight.login(credentials);
            return { success: result, error: result ? undefined : 'Invalid credentials' };
        }
        try {
            const res = await rest<{ success: boolean; token?: string; error?: string }>('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            });
            return { success: Boolean(res.success), error: res.success ? undefined : res.error };
        } catch (error) {
            // Return error message instead of throwing
            const errorMessage = error instanceof Error ? error.message : 'Login failed';
            console.warn('Login failed:', errorMessage);
            return { success: false, error: errorMessage };
        }
    },

    logout: async () => {
        if (isElectron) {
            // Electron logout handled elsewhere
        } else {
            try {
                await rest('/api/auth/logout', { method: 'POST' });
            } catch {
                // Ignore logout errors
            }
        }
        localStorage.removeItem('smdr_token');
    },

    verifyAuth: async (): Promise<boolean> => {
        if (isElectron) return true;
        try {
            const res = await rest<{ success: boolean }>('/api/auth/verify');
            return res.success;
        } catch {
            return false;
        }
    },

    getHealth: async (options?: { signal?: AbortSignal }): Promise<HealthStatus> => {
        return rest<HealthStatus>('/api/health/details', { signal: options?.signal });
    },

    getCurrentUser: async (): Promise<{ username: string; role: string } | null> => {
        if (isElectron) return null;
        try {
            const res = await rest<{ success: boolean; user?: { username: string; role: string } }>('/api/auth/verify');
            if (!res.success || !res.user) return null;
            return res.user;
        } catch {
            return null;
        }
    },

    getConfig: async (): Promise<AppConfig> => {
        if (isElectron) return window.smdrInsight.getConfig();
        return rest<AppConfig>('/api/config');
    },

    updateConfig: async (config: AppConfig): Promise<boolean> => {
        if (isElectron) return window.smdrInsight.updateConfig(config);
        const res = await rest<{ success: boolean }>('/api/config/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        return res.success;
    },

    updateAlertRules: async (rules: AppConfig['alerts']): Promise<boolean> => {
        if (isElectron) return window.smdrInsight.updateAlertRules(rules);
        const res = await rest<{ success: boolean }>('/api/alerts/update-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rules)
        });
        return res.success;
    },

    getState: async (): Promise<ServiceState> => {
        if (isElectron) return window.smdrInsight.getState();
        return rest<ServiceState>('/api/state');
    },

    getRecords: async (filters: RecordFilters): Promise<SMDRRecord[]> => {
        if (isElectron) return window.smdrInsight.getRecords(filters);
        const params = new URLSearchParams(cleanRecordFilters(filters)).toString();
        return rest<SMDRRecord[]>(`/api/records?${params}`);
    },

    getRecordsPage: async (filters: RecordFilters): Promise<RecordsPage> => {
        if (isElectron) {
            const rows = await window.smdrInsight.getRecords(filters);
            const limit = filters.limit ?? rows.length;
            const offset = filters.offset ?? 0;
            return { rows, total: rows.length, limit, offset };
        }
        const params = new URLSearchParams(cleanRecordFilters(filters)).toString();
        return rest<RecordsPage>(`/api/records/page?${params}`);
    },

    getRecordSummary: async (filters: RecordFilters): Promise<CallLogSummary> => {
        if (isElectron) {
            const rows = await window.smdrInsight.getRecords({ ...filters, limit: 50000, offset: 0 });
            const totalDurationSeconds = rows.reduce((sum, row) => sum + durationToSeconds(row.duration), 0);
            const made = aggregateTop(rows, (row) => row.callingParty);
            const received = aggregateTop(rows, (row) => {
                const ext = row.calledParty ?? '';
                return /^\d{3,6}$/.test(ext) ? ext : '';
            });
            return {
                totalCalls: rows.length,
                totalDurationSeconds,
                topExtensionsMade: made,
                topExtensionsReceived: received
            };
        }
        const params = new URLSearchParams(cleanRecordFilters(filters)).toString();
        return rest<CallLogSummary>(`/api/records/summary?${params}`);
    },

    getDashboard: async (date?: string): Promise<DashboardMetrics> => {
        if (isElectron) return window.smdrInsight.getDashboard(date);
        return rest<DashboardMetrics>(`/api/dashboard${date ? `?date=${date}` : ''}`);
    },

    getAnalytics: async (startDate?: string, endDate?: string): Promise<AnalyticsSnapshot> => {
        if (isElectron) return window.smdrInsight.getAnalytics(startDate, endDate);
        const q = new URLSearchParams();
        if (startDate) q.append('startDate', startDate);
        if (endDate) q.append('endDate', endDate);
        return rest<AnalyticsSnapshot>(`/api/analytics?${q.toString()}`);
    },

    getAlerts: async (limit?: number): Promise<AlertEvent[]> => {
        if (isElectron) return window.smdrInsight.getAlerts(limit) as Promise<AlertEvent[]>;
        return rest<AlertEvent[]>(`/api/alerts${limit ? `?limit=${limit}` : ''}`);
    },

    getParseErrors: async (limit?: number): Promise<ParseError[]> => {
        if (isElectron) return window.smdrInsight.getParseErrors(limit) as Promise<ParseError[]>;
        return rest<ParseError[]>(`/api/parse-errors${limit ? `?limit=${limit}` : ''}`);
    },

    startStream: async (): Promise<boolean> => {
        if (isElectron) return window.smdrInsight.startStream();
        const res = await rest<{ success: boolean }>('/api/stream/start', { method: 'POST' });
        return res.success;
    },

    stopStream: async (): Promise<boolean> => {
        if (isElectron) return window.smdrInsight.stopStream();
        const res = await rest<{ success: boolean }>('/api/stream/stop', { method: 'POST' });
        return res.success;
    },

    purgeRecords: async (days: number): Promise<number> => {
        if (isElectron) return window.smdrInsight.purgeRecords(days);
        const res = await rest<{ success: boolean; removed: number }>('/api/records/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days })
        });
        return res.removed;
    },

    importSmdrText: async (payload: { fileName?: string; content: string }): Promise<SMDRImportResult> => {
        if (isElectron) {
            if (typeof window.smdrInsight.importSmdrText === 'function') {
                return window.smdrInsight.importSmdrText(payload);
            }
            throw new Error('SMDR text import is not available in desktop mode yet');
        }
        const response = await fetch(`${API_BASE}/api/records/import-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        if (response.status === 401) {
            localStorage.removeItem('smdr_token');
        }
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Import endpoint is missing on the running backend. Restart the server so it loads the latest build.');
            }
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error((error as { error?: string }).error || `HTTP ${response.status}`);
        }
        const res = (await response.json()) as { success: boolean; data: SMDRImportResult; error?: string };
        if (!res.success || !res.data) {
            throw new Error(res.error || 'Import request failed');
        }
        return res.data;
    },

    estimatePurgeRecords: async (days: number): Promise<{ count: number; cutoffDate: string }> => {
        const res = await rest<{ success: boolean; data: { count: number; cutoffDate: string } }>(`/api/records/purge-estimate?days=${days}`);
        return res.data;
    },

    exportRecordsWithDialog: async (options: ExportDialogOptions): Promise<string | null> => {
        if (isElectron) return window.smdrInsight.exportRecordsWithDialog(options);

        const format = options.format || 'csv';
        const cleanFilters: Record<string, string> = {};
        Object.entries((options.filters as Record<string, unknown> | undefined) ?? {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                cleanFilters[key] = String(value);
            }
        });
        const params = new URLSearchParams(cleanFilters).toString();
        const separator = params ? '&' : '';
        const url = `/api/records/export?${params}${separator}format=${format}&_t=${Date.now()}`;

        try {
            const { blob, headers } = await restBlob(url, undefined, 60000);
            const disposition = headers.get('Content-Disposition') || '';
            const fileNameMatch = /filename=\"?([^"]+)\"?/i.exec(disposition);
            const fallbackExt = format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv';
            const fileName = fileNameMatch?.[1] || `smdr-export-${new Date().toISOString().split('T')[0]}.${fallbackExt}`;
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);
            return `Export initiated: ${format.toUpperCase()}`;
        } catch {
            return null;
        }
    },

    onServiceEvent: (
        handler: (event: any) => void,
        options?: {
            onOpen?: () => void;
            onError?: (error: unknown) => void;
            onClose?: () => void;
        }
    ): (() => void) => {
        if (isElectron) {
            options?.onOpen?.();
            return window.smdrInsight.onServiceEvent(handler);
        }

        const eventSource = new EventSource(`${API_BASE}/api/events`);

        eventSource.onopen = () => {
            options?.onOpen?.();
        };

        eventSource.onmessage = (e) => {
            try {
                // Skip heartbeat messages
                if (e.data === 'heartbeat' || e.data.startsWith(':')) {
                    return;
                }
                const data = JSON.parse(e.data);
                handler(data);
            } catch (err) {
                if (DEV_LOG) console.error('[API] SSE Parse error', err);
            }
        };

        eventSource.onerror = (e) => {
            // Keep stream alive on transient network/server hiccups.
            // EventSource will automatically reconnect.
            if (DEV_LOG) console.warn('[API] SSE Connection error, browser will retry:', e);
            options?.onError?.(e);
        };

        return () => {
            eventSource.close();
            options?.onClose?.();
        };
    },


    // ── Billing ────────────────────────────────────────────────────────────
    getBillingConfig: async () => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/config');
        return res.data;
    },

    saveBillingConfig: async (config: any) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        return res.data;
    },

    addPrefixRule: async (rule: any) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/prefix-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule),
        });
        return res.data;
    },

    updatePrefixRule: async (id: string, rule: any) => {
        const res = await rest<{ success: boolean; data: any }>(`/api/billing/prefix-rules/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule),
        });
        return res.data;
    },

    deletePrefixRule: async (id: string) => {
        await rest<{ success: boolean }>(`/api/billing/prefix-rules/${id}`, { method: 'DELETE' });
    },

    updateRates: async (rates: any[]) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/rates', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rates }),
        });
        return res.data;
    },

    testBillingNumber: async (number: string, durationSeconds: number, options?: { callDate?: string; isHoliday?: boolean }) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number, durationSeconds, ...options }),
        });
        return res.data;
    },

    // ── Bulk Operations ─────────────────────────────────────────────────────
    bulkRuleAction: async (action: 'enable' | 'disable' | 'delete', ruleIds: string[]) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ruleIds }),
        });
        return res.data;
    },

    // ── Audit History ───────────────────────────────────────────────────────
    getBillingAuditHistory: async (limit = 100, offset = 0) => {
        const res = await rest<{ success: boolean; data: any }>(`/api/billing/audit?limit=${limit}&offset=${offset}`);
        return res.data;
    },

    // ── Impact Analysis ─────────────────────────────────────────────────────
    analyzeBillingImpact: async (category: string, currentRate: number, proposedRate: number, periodDays = 30) => {
        const res = await rest<{ success: boolean; data: any }>('/api/billing/impact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, currentRate, proposedRate, periodDays }),
        });
        return res.data;
    },

    getBillingReport: async (
        query: BillingReportQuery = {},
        options?: { timeoutMs?: number; signal?: AbortSignal }
    ): Promise<BillingReportData> => {
        const q = new URLSearchParams();
        if (query.from) q.append('from', query.from);
        if (query.to) q.append('to', query.to);
        if (query.extension) q.append('extension', query.extension);
        if (query.category) q.append('category', query.category);
        if (query.sortBy) q.append('sortBy', query.sortBy);
        if (query.sortDir) q.append('sortDir', query.sortDir);
        if (query.page) q.append('page', String(query.page));
        if (query.pageSize) q.append('pageSize', String(query.pageSize));
        if (query.includeAllTopCalls !== undefined) q.append('includeAllTopCalls', String(query.includeAllTopCalls));
        if (query.topCallsLimit !== undefined) q.append('topCallsLimit', String(query.topCallsLimit));
        const res = await rest<{ success: boolean; data: BillingReportData }>(
            `/api/billing/report?${q.toString()}`,
            { signal: options?.signal },
            options?.timeoutMs ?? 30000
        );
        return res.data;
    },

    exportBillingReportPdf: async (
        query: BillingReportQuery = {},
        options?: { timeoutMs?: number; signal?: AbortSignal }
    ): Promise<{ blob: Blob; fileName: string; truncated: boolean; exportedCount: number }> => {
        const { blob, headers } = await restBlob('/api/billing/report/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query),
            signal: options?.signal
        }, options?.timeoutMs ?? 60000);

        const disposition = headers.get('Content-Disposition') || '';
        const fileNameMatch = /filename=\"?([^"]+)\"?/i.exec(disposition);
        const fileName = fileNameMatch?.[1] || `billing-report-${Date.now()}.pdf`;
        const truncated = headers.get('X-Billing-Top-Calls-Truncated') === 'true';
        const exportedCount = Number(headers.get('X-Billing-Top-Calls-Count') || '0');
        return { blob, fileName, truncated, exportedCount };
    },

    log: (level: string, message: string): void => {
        if (isElectron) {
            window.smdrInsight.log(level, message);
        } else if (DEV_LOG) {
            console.log(`[${level.toUpperCase()}] ${message}`);
        }
    },

    // ── User Management ─────────────────────────────────────────────────────
    getUsers: async (query: UsersQuery = {}): Promise<UsersListResponse> => {
        const params = new URLSearchParams();
        if (query.page) params.append('page', String(query.page));
        if (query.pageSize) params.append('pageSize', String(query.pageSize));
        if (query.search) params.append('search', query.search);
        if (query.role && query.role !== 'all') params.append('role', query.role);
        if (query.sortBy) params.append('sortBy', query.sortBy);
        if (query.sortDir) params.append('sortDir', query.sortDir);
        // Advanced filters
        if (query.status && query.status !== 'all') params.append('status', query.status);
        if (query.createdAfter) params.append('createdAfter', query.createdAfter);
        if (query.createdBefore) params.append('createdBefore', query.createdBefore);
        if (query.lastLoginAfter) params.append('lastLoginAfter', query.lastLoginAfter);
        if (query.lastLoginBefore) params.append('lastLoginBefore', query.lastLoginBefore);
        if (query.neverLoggedIn) params.append('neverLoggedIn', 'true');
        if (query.inactiveDays) params.append('inactiveDays', String(query.inactiveDays));

        const queryString = params.toString();
        const res = await rest<{ success: boolean; data: UsersListResponse | User[] }>(`/api/users${queryString ? `?${queryString}` : ''}`);
        if (DEV_LOG) console.log('[API] getUsers response:', res);
        if (!res.success) {
            throw new Error(res.data as any || 'Failed to fetch users');
        }
        if (Array.isArray(res.data)) {
            const page = query.page ?? 1;
            const pageSize = query.pageSize ?? (res.data.length || 20);
            return {
                items: res.data,
                total: res.data.length,
                page,
                pageSize
            };
        }
        const result = {
            items: Array.isArray((res.data as UsersListResponse).items) ? (res.data as UsersListResponse).items : [],
            total: Number.isFinite((res.data as UsersListResponse).total) ? (res.data as UsersListResponse).total : 0,
            page: Number.isFinite((res.data as UsersListResponse).page) ? (res.data as UsersListResponse).page : (query.page ?? 1),
            pageSize: Number.isFinite((res.data as UsersListResponse).pageSize) ? (res.data as UsersListResponse).pageSize : (query.pageSize ?? 20)
        };
        if (DEV_LOG) console.log('[API] getUsers returning:', result);
        return result;
    },

    createUser: async (username: string, password: string, role: string = 'user') => {
        const res = await rest<{ success: boolean }>('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role }),
        });
        return res;
    },

    changePassword: async (username: string, newPassword: string, oldPassword?: string) => {
        const res = await rest<{ success: boolean; message?: string; error?: string }>(`/api/users/${username}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword, oldPassword }),
        });
        return res;
    },

    deleteUser: async (username: string) => {
        const res = await rest<{ success: boolean }>('/api/users/' + username, {
            method: 'DELETE',
        });
        return res;
    },

    getUserDetails: async (username: string) => {
        const res = await rest<{ success: boolean; data: {
            id: number;
            username: string;
            role: string;
            created_at: string;
            last_login?: string;
            account_status: 'active' | 'locked' | 'disabled';
            failed_login_attempts: number;
            login_count: number;
        } }>(`/api/users/${username}/details`);
        return res.data;
    },

    getUserAuditHistory: async (username: string, limit: number = 20) => {
        const res = await rest<{ success: boolean; data: AuditEntry[] }>(`/api/users/${username}/audit?limit=${limit}`);
        return res.data;
    },

    getAuditLogs: async (options?: {
        action?: AuditAction;
        user?: string;
        startDate?: string;
        endDate?: string;
        ipAddress?: string;
        limit?: number;
        offset?: number;
    }) => {
        const q = new URLSearchParams();
        if (options?.action) q.append('action', options.action);
        if (options?.user) q.append('user', options.user);
        if (options?.startDate) q.append('startDate', options.startDate);
        if (options?.endDate) q.append('endDate', options.endDate);
        if (options?.ipAddress) q.append('ipAddress', options.ipAddress);
        if (options?.limit) q.append('limit', String(options.limit));
        if (options?.offset) q.append('offset', String(options.offset));
        const res = await rest<{ success: boolean; data: AuditEntry[]; total: number }>('/api/audit-logs?' + q.toString());
        if (DEV_LOG) console.log('[API] getAuditLogs response:', res);
        if (!res.success) {
            throw new Error((res.data as any)?.error || 'Failed to fetch audit logs');
        }
        return { data: res.data, total: res.total };
    },

    getConnectionEvents: async (options?: ConnectionEventsQuery): Promise<ConnectionEventsPage> => {
        const q = new URLSearchParams();
        if (options?.level && options.level !== 'all') q.append('level', options.level);
        if (options?.startDate) q.append('startDate', options.startDate);
        if (options?.endDate) q.append('endDate', options.endDate);
        if (options?.limit) q.append('limit', String(options.limit));
        if (options?.offset) q.append('offset', String(options.offset));

        const query = q.toString();
        const res = await rest<{ success: boolean; data: ConnectionEventsPage }>(`/api/connection-events${query ? `?${query}` : ''}`);
        return res.data;
    },

    // Bulk Operations
    bulkDeleteUsers: async (usernames: string[]) => {
        const res = await rest<{ success: boolean; deleted: number; errors: string[] }>('/api/users/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames })
        });
        return res;
    },

    bulkUpdateRole: async (usernames: string[], role: 'admin' | 'user') => {
        const res = await rest<{ success: boolean; updated: number; errors: string[] }>('/api/users/bulk-update-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames, role })
        });
        return res;
    },
};
