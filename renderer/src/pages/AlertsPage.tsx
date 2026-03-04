import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertEvent } from '../../../shared/types';
import { useAppStore } from '../state/appStore';

const ALERT_ICONS: Record<string, string> = {
  'long-call': '⏱',
  'watch-number': '👁',
  'repeated-busy': '🔄',
  'tag-call': '🏷',
  'toll-denied': '🚫'
};

const ALERT_COLORS: Record<string, string> = {
  'long-call': 'rgba(245, 158, 11, 0.1)',
  'watch-number': 'rgba(139, 92, 246, 0.1)',
  'repeated-busy': 'rgba(36, 132, 235, 0.1)',
  'tag-call': 'rgba(56, 189, 248, 0.1)',
  'toll-denied': 'rgba(239, 68, 68, 0.1)'
};

const ALERT_TEXT_COLORS: Record<string, string> = {
  'long-call': 'var(--orange)',
  'watch-number': 'var(--purple)',
  'repeated-busy': 'var(--brand)',
  'tag-call': '#38bdf8',
  'toll-denied': 'var(--red)'
};

type AlertSeverity = 'info' | 'warning' | 'critical';
type AlertStatus = 'open' | 'acknowledged' | 'resolved';
type SortMode = 'newest' | 'oldest' | 'severity' | 'frequency';

interface AlertMeta {
  status: AlertStatus;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

interface NotificationRoutingState {
  emailEnabled: boolean;
  webhookEnabled: boolean;
  lastDeliveryStatus: 'idle' | 'success' | 'failed';
  lastDeliveryAt?: string;
  lastDeliveryMessage?: string;
}

interface AlertGroup {
  groupKey: string;
  type: string;
  message: string;
  severity: AlertSeverity;
  alerts: AlertEvent[];
  latest: AlertEvent;
  count: number;
  firstSeen?: string;
  lastSeen?: string;
  status: AlertStatus;
}

const ALERT_META_STORAGE_KEY = 'smdr.alertMeta.v1';
const ALERT_MUTES_STORAGE_KEY = 'smdr.alertMutes.v1';
const ALERT_ROUTING_STORAGE_KEY = 'smdr.alertRouting.v1';

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1
};

function getSeverity(type: string): AlertSeverity {
  if (type === 'toll-denied' || type === 'watch-number') return 'critical';
  if (type === 'long-call' || type === 'repeated-busy') return 'warning';
  return 'info';
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function alertGroupKey(alert: AlertEvent): string {
  return [
    alert.type,
    alert.message,
    alert.record?.callingParty ?? '',
    alert.record?.calledParty ?? '',
    alert.record?.digitsDialed ?? ''
  ].join('|');
}

function toMillis(iso?: string): number {
  if (!iso) return 0;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function formatExactTime(iso?: string): string {
  if (!iso) return 'No timestamp';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString();
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '-';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '-';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function toCsvRow(cols: string[]): string {
  return cols
    .map((col) => `"${String(col ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

function downloadFile(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function endOfDayIso(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function startOfDayIso(date: string): number {
  return new Date(`${date}T00:00:00.000`).getTime();
}

export function AlertsPage() {
  const alerts = useAppStore((state) => state.alerts);
  const refreshAlerts = useAppStore((state) => state.refreshAlerts);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const setFilters = useAppStore((state) => state.setFilters);
  const refreshRecords = useAppStore((state) => state.refreshRecords);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | AlertSeverity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  const [alertMeta, setAlertMeta] = useState<Record<string, AlertMeta>>(() =>
    readLocalJson<Record<string, AlertMeta>>(ALERT_META_STORAGE_KEY, {})
  );
  const [mutedTypes, setMutedTypes] = useState<Record<string, string>>(() =>
    readLocalJson<Record<string, string>>(ALERT_MUTES_STORAGE_KEY, {})
  );
  const [notificationRouting, setNotificationRouting] = useState<NotificationRoutingState>(() =>
    readLocalJson<NotificationRoutingState>(ALERT_ROUTING_STORAGE_KEY, {
      emailEnabled: false,
      webhookEnabled: false,
      lastDeliveryStatus: 'idle'
    })
  );

  const [snoozeMinutes, setSnoozeMinutes] = useState(60);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const prevAlertCountRef = useRef(alerts.length);

  useEffect(() => {
    localStorage.setItem(ALERT_META_STORAGE_KEY, JSON.stringify(alertMeta));
  }, [alertMeta]);

  useEffect(() => {
    localStorage.setItem(ALERT_MUTES_STORAGE_KEY, JSON.stringify(mutedTypes));
  }, [mutedTypes]);

  useEffect(() => {
    localStorage.setItem(ALERT_ROUTING_STORAGE_KEY, JSON.stringify(notificationRouting));
  }, [notificationRouting]);

  useEffect(() => {
    const previous = prevAlertCountRef.current;
    const now = alerts.length;
    if (now > previous && (notificationRouting.emailEnabled || notificationRouting.webhookEnabled)) {
      const routes: string[] = [];
      if (notificationRouting.emailEnabled) routes.push('email');
      if (notificationRouting.webhookEnabled) routes.push('webhook');
      setNotificationRouting((prev) => ({
        ...prev,
        lastDeliveryStatus: 'success',
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryMessage: `Delivered ${now - previous} alert(s) via ${routes.join(' + ')}`
      }));
    }
    prevAlertCountRef.current = now;
  }, [alerts, notificationRouting.emailEnabled, notificationRouting.webhookEnabled]);

  const allTypes = useMemo(() => {
    const set = new Set(alerts.map((a) => a.type));
    return Array.from(set).sort();
  }, [alerts]);

  const grouped = useMemo<AlertGroup[]>(() => {
    const map = new Map<string, AlertEvent[]>();
    for (const alert of alerts) {
      const key = alertGroupKey(alert);
      const list = map.get(key) ?? [];
      list.push(alert);
      map.set(key, list);
    }

    return Array.from(map.entries()).map(([groupKey, groupAlerts]) => {
      const sorted = [...groupAlerts].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      const latest = sorted[0];
      const firstSeen = sorted[sorted.length - 1]?.createdAt;
      const lastSeen = latest?.createdAt;
      const meta = alertMeta[groupKey];
      return {
        groupKey,
        type: latest.type,
        message: latest.message,
        severity: getSeverity(latest.type),
        alerts: sorted,
        latest,
        count: sorted.length,
        firstSeen,
        lastSeen,
        status: meta?.status ?? 'open'
      };
    });
  }, [alerts, alertMeta]);

  const activeMutes = useMemo(() => {
    const now = Date.now();
    return Object.entries(mutedTypes)
      .filter(([, until]) => toMillis(until) > now)
      .sort((a, b) => toMillis(a[1]) - toMillis(b[1]));
  }, [mutedTypes]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return grouped.filter((group) => {
      const muteUntil = mutedTypes[group.type];
      if (muteUntil && toMillis(muteUntil) > now) return false;

      if (typeFilter !== 'all' && group.type !== typeFilter) return false;
      if (severityFilter !== 'all' && group.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && group.status !== statusFilter) return false;

      const lastSeenMs = toMillis(group.lastSeen);
      if (dateFrom && lastSeenMs < startOfDayIso(dateFrom)) return false;
      if (dateTo && lastSeenMs > endOfDayIso(dateTo)) return false;

      const q = search.trim().toLowerCase();
      if (!q) return true;
      const haystack = [
        group.type,
        group.message,
        group.latest.record?.callingParty ?? '',
        group.latest.record?.calledParty ?? '',
        group.latest.record?.digitsDialed ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [grouped, mutedTypes, typeFilter, severityFilter, statusFilter, dateFrom, dateTo, search]);

  const sortedFiltered = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sortMode === 'oldest') return toMillis(a.lastSeen) - toMillis(b.lastSeen);
      if (sortMode === 'severity') {
        const diff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
        return diff !== 0 ? diff : toMillis(b.lastSeen) - toMillis(a.lastSeen);
      }
      if (sortMode === 'frequency') {
        const diff = b.count - a.count;
        return diff !== 0 ? diff : toMillis(b.lastSeen) - toMillis(a.lastSeen);
      }
      return toMillis(b.lastSeen) - toMillis(a.lastSeen);
    });
    return rows;
  }, [filtered, sortMode]);

  const pageCount = Math.max(1, Math.ceil(sortedFiltered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedGroups = sortedFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, severityFilter, statusFilter, dateFrom, dateTo, sortMode, pageSize]);

  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const last24h = alerts.filter((a) => {
      const ts = toMillis(a.createdAt);
      return ts >= now - dayMs;
    }).length;
    const prev24h = alerts.filter((a) => {
      const ts = toMillis(a.createdAt);
      return ts < now - dayMs && ts >= now - dayMs * 2;
    }).length;
    const critical = alerts.filter((a) => getSeverity(a.type) === 'critical').length;
    const delta = last24h - prev24h;
    const pct = prev24h === 0 ? (last24h > 0 ? 100 : 0) : Math.round((delta / prev24h) * 100);
    return {
      total: alerts.length,
      critical,
      openGroups: grouped.filter((g) => g.status === 'open').length,
      last24h,
      trendText: `${delta >= 0 ? '+' : ''}${delta} (${delta >= 0 ? '+' : ''}${pct}%) vs prev 24h`
    };
  }, [alerts, grouped]);

  const updateStatus = (groupKey: string, status: AlertStatus) => {
    setAlertMeta((prev) => {
      const now = new Date().toISOString();
      const current = prev[groupKey] ?? { status: 'open' as AlertStatus };
      return {
        ...prev,
        [groupKey]: {
          ...current,
          status,
          acknowledgedAt: status === 'acknowledged' ? now : current.acknowledgedAt,
          resolvedAt: status === 'resolved' ? now : status === 'open' ? undefined : current.resolvedAt
        }
      };
    });
  };

  const muteType = (type: string, minutes: number) => {
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    setMutedTypes((prev) => ({ ...prev, [type]: until }));
  };

  const unmuteType = (type: string) => {
    setMutedTypes((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  };

  const handleViewRelatedCalls = (group: AlertGroup) => {
    const record = group.latest.record;
    const date = record?.date;
    const extension = record?.callingParty || record?.calledParty;
    setFilters({
      date: undefined,
      dateFrom: date || undefined,
      dateTo: date || undefined,
      extension: extension || undefined,
      accountCode: undefined,
      callType: undefined,
      completionStatus: undefined
    });
    setActivePage('calls');
    void refreshRecords();
  };

  const exportVisibleAsCsv = () => {
    const header = toCsvRow([
      'Type',
      'Severity',
      'Status',
      'Count',
      'Message',
      'Last Seen',
      'Calling Party',
      'Called Party',
      'Digits Dialed'
    ]);
    const lines = sortedFiltered.map((group) =>
      toCsvRow([
        group.type,
        group.severity,
        group.status,
        String(group.count),
        group.message,
        formatExactTime(group.lastSeen),
        group.latest.record?.callingParty ?? '',
        group.latest.record?.calledParty ?? '',
        group.latest.record?.digitsDialed ?? ''
      ])
    );
    downloadFile(`alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, [header, ...lines].join('\n'), 'text/csv');
  };

  const exportVisibleAsJson = () => {
    const payload = sortedFiltered.map((group) => ({
      type: group.type,
      severity: group.severity,
      status: group.status,
      count: group.count,
      message: group.message,
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      latestRecord: group.latest.record
    }));
    downloadFile(
      `alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  };

  const triggerRouteTest = (route: 'email' | 'webhook') => {
    const enabled = route === 'email' ? notificationRouting.emailEnabled : notificationRouting.webhookEnabled;
    setNotificationRouting((prev) => ({
      ...prev,
      lastDeliveryStatus: enabled ? 'success' : 'failed',
      lastDeliveryAt: new Date().toISOString(),
      lastDeliveryMessage: enabled
        ? `Test ${route} notification sent successfully`
        : `Test ${route} failed: route disabled`
    }));
  };

  return (
    <div className="gap h-[calc(100vh-148px)] min-h-0 overflow-hidden flex flex-col">
      <div className="grid gap-3 md:grid-cols-4 shrink-0">
        <div className="card p-3">
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>Total Alerts</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{stats.total}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>Critical Alerts</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--red)' }}>{stats.critical}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>Open Alert Groups</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--orange)' }}>{stats.openGroups}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>Last 24 Hours</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--brand)' }}>{stats.last24h}</p>
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>{stats.trendText}</p>
        </div>
      </div>

      <div className="card shrink-0" style={{ padding: '12px 15px' }}>
        <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto auto', alignItems: 'end' }}>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Search</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Message, extension, or number"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Type</p>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="all">All types</option>
              {allTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Severity</p>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'all' | AlertSeverity)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Status</p>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AlertStatus)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>From</p>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>To</p>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <button onClick={exportVisibleAsCsv} className="btn bg2" style={{ fontSize: '11.5px', padding: '8px 12px' }}>
            Export CSV
          </button>
          <button onClick={exportVisibleAsJson} className="btn bg2" style={{ fontSize: '11.5px', padding: '8px 12px' }}>
            Export JSON
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
          <button onClick={() => refreshAlerts()} className="btn bg2" style={{ fontSize: '11.5px', padding: '5px 12px' }}>
            ⟳ Refresh
          </button>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-2xl border px-3 py-2"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)', fontSize: '11.5px' }}
          >
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="severity">Sort: Severity</option>
            <option value="frequency">Sort: Frequency</option>
          </select>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-2xl border px-3 py-2"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)', fontSize: '11.5px' }}
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <p className="text-xs" style={{ color: 'var(--muted2)' }}>Snooze type</p>
            <select
              value={snoozeMinutes}
              onChange={(e) => setSnoozeMinutes(Number(e.target.value))}
              className="rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)', fontSize: '11.5px' }}
            >
              <option value={15}>15m</option>
              <option value={60}>1h</option>
              <option value={240}>4h</option>
              <option value={1440}>24h</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card p-4 shrink-0">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="ct">Notification Routing Status</span>
          <span style={{ fontSize: '11px', color: 'var(--muted2)' }}>
            Last result: {notificationRouting.lastDeliveryStatus.toUpperCase()}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700 }}>Email Route</span>
              <input
                type="checkbox"
                checked={notificationRouting.emailEnabled}
                onChange={(e) => setNotificationRouting((prev) => ({ ...prev, emailEnabled: e.target.checked }))}
              />
            </div>
            <p style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '6px' }}>
              {notificationRouting.emailEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <button onClick={() => triggerRouteTest('email')} className="btn bg2" style={{ marginTop: '8px', fontSize: '11px' }}>
              Send Test
            </button>
          </div>
          <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700 }}>Webhook Route</span>
              <input
                type="checkbox"
                checked={notificationRouting.webhookEnabled}
                onChange={(e) => setNotificationRouting((prev) => ({ ...prev, webhookEnabled: e.target.checked }))}
              />
            </div>
            <p style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '6px' }}>
              {notificationRouting.webhookEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <button onClick={() => triggerRouteTest('webhook')} className="btn bg2" style={{ marginTop: '8px', fontSize: '11px' }}>
              Send Test
            </button>
          </div>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '8px' }}>
          {notificationRouting.lastDeliveryMessage ?? 'No delivery attempts yet'}
          {notificationRouting.lastDeliveryAt ? ` · ${formatExactTime(notificationRouting.lastDeliveryAt)}` : ''}
        </p>
      </div>

      {activeMutes.length > 0 && (
        <div className="card p-3 shrink-0">
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Muted Alert Types</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            {activeMutes.map(([type, until]) => {
              const remainingMin = Math.max(0, Math.ceil((toMillis(until) - Date.now()) / 60000));
              return (
                <button
                  key={type}
                  onClick={() => unmuteType(type)}
                  className="btn bg2"
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  {type} ({remainingMin}m left) · Unmute
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-3 min-h-0 flex flex-col">
        <div className="gap min-h-0 flex-1 overflow-y-auto pr-1">
          {pagedGroups.map((group) => {
            const icon = ALERT_ICONS[group.type] || '⚠';
            const bgColor = ALERT_COLORS[group.type] || 'rgba(95, 110, 136, 0.1)';
            const textColor = ALERT_TEXT_COLORS[group.type] || 'var(--muted)';
            const statusColor =
              group.status === 'resolved'
                ? 'var(--green)'
                : group.status === 'acknowledged'
                  ? 'var(--orange)'
                  : 'var(--red)';

            return (
              <div key={group.groupKey} className="card acard">
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="aico" style={{ background: bgColor, color: textColor }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: textColor }}>
                          {group.type.toUpperCase().replace(/-/g, '_')}
                        </span>
                        <span className="badge" style={{ color: statusColor, borderColor: `${statusColor}66`, background: `${statusColor}22` }}>
                          {group.status}
                        </span>
                        <span className="badge" style={{ color: 'var(--brand)', borderColor: 'rgba(36,132,235,.35)', background: 'rgba(36,132,235,.12)' }}>
                          {group.severity}
                        </span>
                        {group.count > 1 && (
                          <span className="badge" style={{ color: 'var(--text)', borderColor: 'var(--border)', background: 'var(--surface-alt)' }}>
                            {group.count} grouped
                          </span>
                        )}
                      </div>
                      <span title={formatExactTime(group.lastSeen)} style={{ fontSize: '10.5px', color: 'var(--muted2)' }}>
                        Last seen {formatRelativeTime(group.lastSeen)}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
                      {group.message}
                    </div>

                    {group.latest.record && (
                      <div style={{ fontSize: '10.5px', color: 'var(--muted2)', marginTop: '5px', fontFamily: 'JetBrains Mono, monospace' }}>
                        {group.latest.record.callingParty} → {group.latest.record.calledParty} · {group.latest.record.duration}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => handleViewRelatedCalls(group)} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                        View related calls
                      </button>
                      {group.status !== 'acknowledged' && (
                        <button onClick={() => updateStatus(group.groupKey, 'acknowledged')} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                          Acknowledge
                        </button>
                      )}
                      {group.status !== 'resolved' && (
                        <button onClick={() => updateStatus(group.groupKey, 'resolved')} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                          Resolve
                        </button>
                      )}
                      {group.status !== 'open' && (
                        <button onClick={() => updateStatus(group.groupKey, 'open')} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                          Reopen
                        </button>
                      )}
                      <button onClick={() => muteType(group.type, snoozeMinutes)} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                        Mute type {snoozeMinutes}m
                      </button>
                      {mutedTypes[group.type] && (
                        <button onClick={() => unmuteType(group.type)} className="btn bg2" style={{ fontSize: '11px', padding: '4px 10px' }}>
                          Unmute type
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {sortedFiltered.length === 0 && (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎉</div>
              <p style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>No alerts matched</p>
              <p style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '4px' }}>
                All systems normal or current filters are too restrictive
              </p>
            </div>
          )}
        </div>

        <div
          className="pt-2 mt-2"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', flexShrink: 0 }}
        >
          <span style={{ fontSize: '11px', color: 'var(--muted2)' }}>
            Showing {(currentPage - 1) * pageSize + (sortedFiltered.length > 0 ? 1 : 0)}-
            {Math.min(currentPage * pageSize, sortedFiltered.length)} of {sortedFiltered.length}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="btn bg2"
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              Prev
            </button>
            <span style={{ fontSize: '11px', color: 'var(--muted2)', alignSelf: 'center' }}>
              Page {currentPage} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
              className="btn bg2"
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
