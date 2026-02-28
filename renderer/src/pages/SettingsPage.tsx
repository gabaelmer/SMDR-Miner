import { useEffect, useMemo, useState } from 'react';
import { AppConfig } from '../../../shared/types';
import { api } from '../lib/api';
import { useAppStore } from '../state/appStore';

const DEFAULT_CONFIG: AppConfig = {
  connection: {
    controllerIps: ['192.168.1.100'],
    port: 1752,
    concurrentConnections: 1,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    autoReconnectPrimary: true,
    primaryRecheckDelayMs: 60000,
    ipWhitelist: []
  },
  storage: {
    dbPath: './config/smdr-insight.sqlite',
    retentionDays: 60,
    archiveDirectory: './config/archive'
  },
  alerts: {
    longCallMinutes: 30,
    watchNumbers: [],
    repeatedBusyThreshold: 3,
    repeatedBusyWindowMinutes: 30,
    detectTagCalls: true,
    detectTollDenied: true
  },
  maxInMemoryRecords: 2000
};

const DANGER_CONFIRM_TEXT = 'PURGE';

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
  const groups = ip.split(':');
  if (groups.length < 3 || groups.length > 8) return false;
  return groups.every((group) => group.length <= 4);
}

function isValidIp(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

function validateConfig(draft: AppConfig): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!draft.connection.controllerIps.length) {
    errors.controllerIps = 'At least one controller IP is required.';
  } else {
    const invalid = draft.connection.controllerIps.find((ip) => !isValidIp(ip));
    if (invalid) errors.controllerIps = `Invalid controller IP: ${invalid}`;
  }

  if (draft.connection.port < 1 || draft.connection.port > 65535) {
    errors.port = 'Port must be between 1 and 65535.';
  }

  if (draft.connection.concurrentConnections < 1 || draft.connection.concurrentConnections > 10) {
    errors.concurrentConnections = 'Concurrent connections must be between 1 and 10.';
  }

  if (draft.connection.reconnectDelayMs < 100 || draft.connection.reconnectDelayMs > 3600000) {
    errors.reconnectDelayMs = 'Reconnect delay must be between 100 and 3,600,000 ms.';
  }

  if (draft.connection.primaryRecheckDelayMs < 1000 || draft.connection.primaryRecheckDelayMs > 86400000) {
    errors.primaryRecheckDelayMs = 'Primary recheck delay must be between 1,000 and 86,400,000 ms.';
  }

  const whitelist = draft.connection.ipWhitelist ?? [];
  const badWhitelistIp = whitelist.find((ip) => !isValidIp(ip));
  if (badWhitelistIp) {
    errors.ipWhitelist = `Invalid whitelist IP: ${badWhitelistIp}`;
  }

  if (draft.storage.retentionDays < 1 || draft.storage.retentionDays > 3650) {
    errors.retentionDays = 'Retention days must be between 1 and 3650.';
  }

  if (draft.maxInMemoryRecords < 50 || draft.maxInMemoryRecords > 50000) {
    errors.maxInMemoryRecords = 'Max in-memory records must be between 50 and 50,000.';
  }

  if (draft.alerts.longCallMinutes < 1 || draft.alerts.longCallMinutes > 1440) {
    errors.longCallMinutes = 'Long call alert must be between 1 and 1440 minutes.';
  }

  if (draft.alerts.repeatedBusyThreshold < 1 || draft.alerts.repeatedBusyThreshold > 100) {
    errors.repeatedBusyThreshold = 'Busy threshold must be between 1 and 100.';
  }

  if (draft.alerts.repeatedBusyWindowMinutes < 1 || draft.alerts.repeatedBusyWindowMinutes > 1440) {
    errors.repeatedBusyWindowMinutes = 'Busy window must be between 1 and 1440 minutes.';
  }

  const invalidWatch = draft.alerts.watchNumbers.find((n) => !/^[0-9*#]{2,20}$/.test(n));
  if (invalidWatch) {
    errors.watchNumbers = `Invalid watch number: ${invalidWatch}. Use 2-20 digits/*/#.`;
  }

  return errors;
}

export function SettingsPage() {
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const startStream = useAppStore((state) => state.startStream);
  const stopStream = useAppStore((state) => state.stopStream);
  const purgeRecords = useAppStore((state) => state.purgeRecords);
  const parseErrors = useAppStore((state) => state.parseErrors);
  const refreshParseErrors = useAppStore((state) => state.refreshParseErrors);

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [savedConfig, setSavedConfig] = useState<AppConfig>(() => (config ? structuredClone(config) : DEFAULT_CONFIG));
  const [draft, setDraft] = useState<AppConfig>(() => (config ? structuredClone(config) : DEFAULT_CONFIG));

  const [purgeDays, setPurgeDays] = useState('60');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purgeEstimate, setPurgeEstimate] = useState<{ count: number; cutoffDate: string } | null>(null);
  const [purgeEstimateLoading, setPurgeEstimateLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [streamAction, setStreamAction] = useState<'start' | 'stop' | null>(null);
  const [purging, setPurging] = useState(false);
  const [refreshingParseErrors, setRefreshingParseErrors] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin';
  const fieldErrors = useMemo(() => validateConfig(draft), [draft]);
  const hasValidationErrors = Object.keys(fieldErrors).length > 0;
  const hasUnsavedChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedConfig), [draft, savedConfig]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        setLoading(true);
        const fallback = config ? structuredClone(config) : DEFAULT_CONFIG;
        if (mounted) {
          setSavedConfig(fallback);
          setDraft(fallback);
        }

        const [fetchedConfig, user] = await Promise.all([api.getConfig(), api.getCurrentUser()]);
        if (!mounted) return;

        setSavedConfig(structuredClone(fetchedConfig));
        setDraft(structuredClone(fetchedConfig));
        setCurrentUser(user);
      } catch (error) {
        console.error('Failed to load settings page context:', error);
        if (mounted) {
          setStatusError('Failed to load latest configuration. Showing cached/default values.');
          setCurrentUser(null);
        }
      } finally {
        if (mounted) {
          setAuthChecked(true);
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [config]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const setDraftNumber = (path: 'port' | 'concurrentConnections' | 'reconnectDelayMs' | 'primaryRecheckDelayMs' | 'retentionDays' | 'maxInMemoryRecords' | 'longCallMinutes' | 'repeatedBusyThreshold' | 'repeatedBusyWindowMinutes', value: string) => {
    const parsed = toInt(value);

    setDraft((prev) => {
      if (path === 'port' || path === 'concurrentConnections' || path === 'reconnectDelayMs' || path === 'primaryRecheckDelayMs') {
        return {
          ...prev,
          connection: {
            ...prev.connection,
            [path]: parsed
          }
        };
      }

      if (path === 'retentionDays') {
        return {
          ...prev,
          storage: {
            ...prev.storage,
            retentionDays: parsed
          }
        };
      }

      if (path === 'maxInMemoryRecords') {
        return {
          ...prev,
          maxInMemoryRecords: parsed
        };
      }

      return {
        ...prev,
        alerts: {
          ...prev.alerts,
          [path]: parsed
        }
      };
    });
  };

  const handleSave = async () => {
    if (!isAdmin) {
      setStatusError('Admin privileges are required to change settings.');
      return;
    }
    if (hasValidationErrors) {
      setStatusError('Fix validation errors before saving.');
      return;
    }

    try {
      setSaving(true);
      setStatusError(null);
      setStatusMessage(null);
      await saveConfig(draft);

      const latest = await api.getConfig();
      setSavedConfig(structuredClone(latest));
      setDraft(structuredClone(latest));
      setStatusMessage('Configuration saved successfully.');
    } catch (error) {
      console.error('Failed to save config:', error);
      setStatusError(error instanceof Error ? error.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    setDraft(structuredClone(savedConfig));
    setStatusError(null);
    setStatusMessage('Unsaved changes were reverted.');
  };

  const handleStartStream = async () => {
    if (!isAdmin) {
      setStatusError('Admin privileges are required to control the stream.');
      return;
    }

    try {
      setStreamAction('start');
      setStatusError(null);
      setStatusMessage(null);
      await startStream();
      setStatusMessage('Stream started.');
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to start stream.');
    } finally {
      setStreamAction(null);
    }
  };

  const handleStopStream = async () => {
    if (!isAdmin) {
      setStatusError('Admin privileges are required to control the stream.');
      return;
    }

    try {
      setStreamAction('stop');
      setStatusError(null);
      setStatusMessage(null);
      await stopStream();
      setStatusMessage('Stream stopped.');
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to stop stream.');
    } finally {
      setStreamAction(null);
    }
  };

  const openPurgeModal = async () => {
    if (!isAdmin) {
      setStatusError('Admin privileges are required to purge records.');
      return;
    }

    const days = toInt(purgeDays);
    if (days < 1 || days > 3650) {
      setStatusError('Purge days must be between 1 and 3650.');
      return;
    }

    try {
      setPurgeEstimateLoading(true);
      setStatusError(null);
      setStatusMessage(null);
      const estimate = await api.estimatePurgeRecords(days);
      setPurgeEstimate(estimate);
      setPurgeConfirmText('');
      setShowPurgeModal(true);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to estimate purge impact.');
    } finally {
      setPurgeEstimateLoading(false);
    }
  };

  const handlePurge = async () => {
    if (!isAdmin) {
      setStatusError('Admin privileges are required to purge records.');
      return;
    }

    const days = toInt(purgeDays);
    if (days < 1 || days > 3650) {
      setStatusError('Purge days must be between 1 and 3650.');
      return;
    }

    try {
      setPurging(true);
      setStatusError(null);
      setStatusMessage(null);
      const removed = await purgeRecords(days);
      setShowPurgeModal(false);
      setStatusMessage(`Purge complete. Removed ${removed} records older than ${days} days.`);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Purge failed.');
    } finally {
      setPurging(false);
    }
  };

  const handleRefreshParseErrors = async () => {
    try {
      setRefreshingParseErrors(true);
      setStatusError(null);
      await refreshParseErrors();
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to refresh parse errors.');
    } finally {
      setRefreshingParseErrors(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-3">
        <p style={{ color: 'var(--muted)' }}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-148px)] min-h-0 overflow-hidden flex flex-col gap-2">
      {statusError && (
        <div className="card p-3 bg-red-900/20 border border-red-700">
          <p className="text-sm font-semibold text-red-300">{statusError}</p>
        </div>
      )}
      {statusMessage && (
        <div className="card p-3 bg-emerald-900/20 border border-emerald-700">
          <p className="text-sm font-semibold text-emerald-300">{statusMessage}</p>
        </div>
      )}

      {!authChecked ? (
        <div className="card p-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Checking permissions...</p>
        </div>
      ) : !isAdmin ? (
        <div className="card p-3 border border-amber-700 bg-amber-900/20">
          <p className="text-sm font-semibold text-amber-300">Read-only mode</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            You are not an administrator. Settings changes, stream control, and data purge are disabled.
          </p>
        </div>
      ) : null}

      {hasUnsavedChanges && (
        <div className="card p-3 border border-blue-700 bg-blue-900/20">
          <p className="text-sm font-semibold text-blue-300">Unsaved changes detected</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Save or revert your changes before leaving this page.
          </p>
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2 min-h-0 flex-1 overflow-auto pr-1 content-start">
      <div className="card p-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Connection Settings</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Configure PBX connectivity and failover behavior.
        </p>

        <fieldset disabled={!isAdmin} className="mt-3 grid gap-3 lg:grid-cols-2 disabled:opacity-70">
          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Controller IPs (comma-separated)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={draft.connection.controllerIps.join(', ')}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                connection: { ...prev.connection, controllerIps: parseCsv(e.target.value) }
              }))}
              placeholder="192.168.1.100, 192.168.1.101"
            />
            {fieldErrors.controllerIps && <p className="mt-1 text-xs text-red-400">{fieldErrors.controllerIps}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Port
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.connection.port}
              onChange={(e) => setDraftNumber('port', e.target.value)}
            />
            {fieldErrors.port && <p className="mt-1 text-xs text-red-400">{fieldErrors.port}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Concurrent Connections
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              min={1}
              max={10}
              value={draft.connection.concurrentConnections}
              onChange={(e) => setDraftNumber('concurrentConnections', e.target.value)}
            />
            {fieldErrors.concurrentConnections && <p className="mt-1 text-xs text-red-400">{fieldErrors.concurrentConnections}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Auto Reconnect Delay (ms)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.connection.reconnectDelayMs}
              onChange={(e) => setDraftNumber('reconnectDelayMs', e.target.value)}
            />
            {fieldErrors.reconnectDelayMs && <p className="mt-1 text-xs text-red-400">{fieldErrors.reconnectDelayMs}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Primary Recheck Delay (ms)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.connection.primaryRecheckDelayMs}
              onChange={(e) => setDraftNumber('primaryRecheckDelayMs', e.target.value)}
            />
            {fieldErrors.primaryRecheckDelayMs && <p className="mt-1 text-xs text-red-400">{fieldErrors.primaryRecheckDelayMs}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            IP Whitelist (optional, comma-separated)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={draft.connection.ipWhitelist?.join(', ') ?? ''}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                connection: { ...prev.connection, ipWhitelist: parseCsv(e.target.value) }
              }))}
              placeholder="Leave empty to allow all"
            />
            {fieldErrors.ipWhitelist && <p className="mt-1 text-xs text-red-400">{fieldErrors.ipWhitelist}</p>}
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={draft.connection.autoReconnect}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                connection: { ...prev.connection, autoReconnect: e.target.checked }
              }))}
            />
            Auto Reconnect
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={draft.connection.autoReconnectPrimary}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                connection: { ...prev.connection, autoReconnectPrimary: e.target.checked }
              }))}
            />
            Auto Failback To Primary
          </label>
        </fieldset>
      </div>

      <div className="card p-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Storage & Runtime</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Control data retention and in-memory buffer size.
        </p>

        <fieldset disabled={!isAdmin} className="mt-3 grid gap-3 lg:grid-cols-2 disabled:opacity-70">
          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Retention Days
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.storage.retentionDays}
              onChange={(e) => setDraftNumber('retentionDays', e.target.value)}
            />
            {fieldErrors.retentionDays && <p className="mt-1 text-xs text-red-400">{fieldErrors.retentionDays}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Max In-memory Records
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.maxInMemoryRecords}
              onChange={(e) => setDraftNumber('maxInMemoryRecords', e.target.value)}
            />
            {fieldErrors.maxInMemoryRecords && <p className="mt-1 text-xs text-red-400">{fieldErrors.maxInMemoryRecords}</p>}
          </label>
        </fieldset>
      </div>

      <div className="card p-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Alert Rules</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Tune thresholds used for alert generation.
        </p>

        <fieldset disabled={!isAdmin} className="mt-3 grid gap-3 lg:grid-cols-2 disabled:opacity-70">
          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Long Call Alert (minutes)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.alerts.longCallMinutes}
              onChange={(e) => setDraftNumber('longCallMinutes', e.target.value)}
            />
            {fieldErrors.longCallMinutes && <p className="mt-1 text-xs text-red-400">{fieldErrors.longCallMinutes}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Repeated Busy Threshold
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.alerts.repeatedBusyThreshold}
              onChange={(e) => setDraftNumber('repeatedBusyThreshold', e.target.value)}
            />
            {fieldErrors.repeatedBusyThreshold && <p className="mt-1 text-xs text-red-400">{fieldErrors.repeatedBusyThreshold}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Repeated Busy Window (minutes)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              value={draft.alerts.repeatedBusyWindowMinutes}
              onChange={(e) => setDraftNumber('repeatedBusyWindowMinutes', e.target.value)}
            />
            {fieldErrors.repeatedBusyWindowMinutes && <p className="mt-1 text-xs text-red-400">{fieldErrors.repeatedBusyWindowMinutes}</p>}
          </label>

          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Watch Numbers (comma-separated)
            <input
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={draft.alerts.watchNumbers.join(', ')}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                alerts: { ...prev.alerts, watchNumbers: parseCsv(e.target.value) }
              }))}
              placeholder="911, 122, *98"
            />
            {fieldErrors.watchNumbers && <p className="mt-1 text-xs text-red-400">{fieldErrors.watchNumbers}</p>}
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={draft.alerts.detectTagCalls}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                alerts: { ...prev.alerts, detectTagCalls: e.target.checked }
              }))}
            />
            Detect TAG Calls
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={draft.alerts.detectTollDenied}
              onChange={(e) => setDraft((prev) => ({
                ...prev,
                alerts: { ...prev.alerts, detectTollDenied: e.target.checked }
              }))}
            />
            Detect Toll Denied
          </label>
        </fieldset>
      </div>

      <div className="card p-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Actions</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button
            className="rounded-2xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={handleSave}
            disabled={!isAdmin || saving || hasValidationErrors || !hasUnsavedChanges}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>

          <button
            className="rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={handleRevert}
            disabled={!isAdmin || !hasUnsavedChanges || saving}
          >
            Revert Changes
          </button>

          <button
            className="rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={handleStartStream}
            disabled={!isAdmin || streamAction !== null}
          >
            {streamAction === 'start' ? 'Starting...' : 'Start Stream'}
          </button>

          <button
            className="rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={handleStopStream}
            disabled={!isAdmin || streamAction !== null}
          >
            {streamAction === 'stop' ? 'Stopping...' : 'Stop Stream'}
          </button>

          <button
            className="rounded-2xl border border-red-700 px-3 py-2 text-sm font-semibold text-red-300 disabled:opacity-50"
            onClick={openPurgeModal}
            disabled={!isAdmin || purging || purgeEstimateLoading}
          >
            {purgeEstimateLoading ? 'Estimating...' : 'Purge Data'}
          </button>
        </div>
      </div>

      <div className="card p-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Danger Zone</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Records older than the selected threshold will be permanently deleted.
        </p>

        <div className="mt-3 max-w-sm">
          <label className="text-sm" style={{ color: 'var(--text)' }}>
            Purge Days
            <input
              value={purgeDays}
              onChange={(e) => setPurgeDays(e.target.value)}
              className="mt-1 w-full rounded-2xl border px-3 py-2"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              type="number"
              min={1}
              max={3650}
              disabled={!isAdmin}
            />
          </label>
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Recent Parse Errors
          </p>
          <button
            onClick={handleRefreshParseErrors}
            className="rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={refreshingParseErrors}
          >
            {refreshingParseErrors ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="space-y-2 max-h-[240px] overflow-auto pr-1">
          {parseErrors.slice(0, 10).map((error, index) => (
            <div key={`${error.createdAt ?? 'na'}-${index}`} className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                {error.reason}
              </p>
              <p className="mt-1 break-all text-xs" style={{ color: 'var(--muted)' }}>
                {error.line}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                {error.createdAt}
              </p>
            </div>
          ))}
          {parseErrors.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              No parse errors recorded.
            </p>
          ) : null}
        </div>
      </div>
      </div>

      {showPurgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold text-red-300">Confirm destructive purge</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
              {purgeEstimate
                ? `About ${purgeEstimate.count} records older than ${purgeEstimate.cutoffDate} will be deleted.`
                : 'This action permanently deletes old records.'}
            </p>

            <label className="mt-3 block text-sm" style={{ color: 'var(--text)' }}>
              Type <span className="font-bold">{DANGER_CONFIRM_TEXT}</span> to continue
              <input
                className="mt-1 w-full rounded-2xl border px-3 py-2"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                value={purgeConfirmText}
                onChange={(e) => setPurgeConfirmText(e.target.value)}
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-2xl border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => setShowPurgeModal(false)}
                disabled={purging}
              >
                Cancel
              </button>
              <button
                className="rounded-2xl border border-red-700 px-3 py-2 text-sm font-semibold text-red-300 disabled:opacity-50"
                onClick={handlePurge}
                disabled={purging || purgeConfirmText.trim().toUpperCase() !== DANGER_CONFIRM_TEXT}
              >
                {purging ? 'Purging...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
