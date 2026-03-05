import { useEffect, useMemo, useState } from 'react';
import { AppConfig, User } from '../../../shared/types';
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
  smdrParser: {
    extendedDigitLength: false,
    aniDnisReporting: false,
    networkOLI: false,
    extendedReportingL1: false,
    extendedReportingL2: false,
    extendedTimeToAnswer: false,
    networkFormat: false,
    reportMeterPulses: false,
    suiteServices: false,
    twoBChannelTransfer: false,
    externalHotDesk: false,
    locationReporting: false,
    twentyFourHourTime: true
  },
  maxInMemoryRecords: 2000
};

const DANGER_CONFIRM_TEXT = 'PURGE';

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
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
  if (draft.connection.port < 1 || draft.connection.port > 65535) errors.port = 'Port must be between 1 and 65535.';
  if (draft.connection.concurrentConnections < 1 || draft.connection.concurrentConnections > 10) errors.concurrentConnections = 'Concurrent connections must be between 1 and 10.';
  if (draft.connection.reconnectDelayMs < 100 || draft.connection.reconnectDelayMs > 3600000) errors.reconnectDelayMs = 'Reconnect delay must be between 100 and 3,600,000 ms.';
  if (draft.connection.primaryRecheckDelayMs < 1000 || draft.connection.primaryRecheckDelayMs > 86400000) errors.primaryRecheckDelayMs = 'Primary recheck delay must be between 1,000 and 86,400,000 ms.';
  const whitelist = draft.connection.ipWhitelist ?? [];
  const badWhitelistIp = whitelist.find((ip) => !isValidIp(ip));
  if (badWhitelistIp) errors.ipWhitelist = `Invalid whitelist IP: ${badWhitelistIp}`;
  if (draft.storage.retentionDays < 1 || draft.storage.retentionDays > 3650) errors.retentionDays = 'Retention days must be between 1 and 3650.';
  if (draft.maxInMemoryRecords < 50 || draft.maxInMemoryRecords > 50000) errors.maxInMemoryRecords = 'Max in-memory records must be between 50 and 50,000.';
  if (draft.alerts.longCallMinutes < 1 || draft.alerts.longCallMinutes > 1440) errors.longCallMinutes = 'Long call alert must be between 1 and 1440 minutes.';
  if (draft.alerts.repeatedBusyThreshold < 1 || draft.alerts.repeatedBusyThreshold > 100) errors.repeatedBusyThreshold = 'Busy threshold must be between 1 and 100.';
  if (draft.alerts.repeatedBusyWindowMinutes < 1 || draft.alerts.repeatedBusyWindowMinutes > 1440) errors.repeatedBusyWindowMinutes = 'Busy window must be between 1 and 1440 minutes.';
  const invalidWatch = draft.alerts.watchNumbers.find((n) => !/^[0-9*#]{2,20}$/.test(n));
  if (invalidWatch) errors.watchNumbers = `Invalid watch number: ${invalidWatch}. Use 2-20 digits/*/#.`;
  return errors;
}

function msToReadable(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)} min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

// S3/S4: Tag/chip input component
function ChipInput({
  values,
  onChange,
  placeholder,
  disabled,
  validator,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  validator?: (v: string) => boolean;
}) {
  const [inputVal, setInputVal] = useState('');
  const [inputError, setInputError] = useState('');

  const addChip = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (validator && !validator(trimmed)) {
      setInputError(`Invalid: ${trimmed}`);
      return;
    }
    if (values.includes(trimmed)) {
      setInputError('Already added.');
      return;
    }
    onChange([...values, trimmed]);
    setInputVal('');
    setInputError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(inputVal);
    } else if (e.key === 'Backspace' && inputVal === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const removeChip = (index: number) => onChange(values.filter((_, i) => i !== index));

  return (
    <div>
      <div
        className="mt-1 w-full rounded-2xl border px-2 py-1.5 flex flex-wrap gap-1.5 min-h-[40px]"
        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)' }}
      >
        {values.map((v, i) => (
          <span
            key={i}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: 'var(--brand)', color: '#fff', opacity: disabled ? 0.6 : 1 }}
          >
            {v}
            {!disabled && (
              <button onClick={() => removeChip(i)} style={{ lineHeight: 1, fontSize: 12 }}>✕</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={inputVal}
            onChange={(e) => { setInputVal(e.target.value); setInputError(''); }}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (inputVal.trim()) addChip(inputVal); }}
            placeholder={values.length === 0 ? placeholder : 'Add more…'}
            className="flex-1 min-w-[100px] bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
        )}
      </div>
      {inputError && <p className="mt-1 text-xs text-red-400">{inputError}</p>}
      <p className="mt-1 text-xs" style={{ color: 'var(--muted2)' }}>Press Enter or comma to add</p>
    </div>
  );
}

// S1: Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
  const isConnected = status === 'connected';
  const isRetrying = status === 'retrying';
  const color = isConnected ? '#22c55e' : isRetrying ? '#f59e0b' : '#ef4444';
  const label = isConnected ? 'Connected' : isRetrying ? 'Retrying…' : 'Disconnected';

  return (
    <span
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: `${color}22`, border: `1px solid ${color}66`, color }}
    >
      <span
        style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}`,
          animation: isRetrying ? 'pulse 1.4s ease-in-out infinite' : 'none'
        }}
      />
      {label}
    </span>
  );
}

export function SettingsPage() {
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const startStream = useAppStore((state) => state.startStream);
  const stopStream = useAppStore((state) => state.stopStream);
  const purgeRecords = useAppStore((state) => state.purgeRecords);
  const connectionStatus = useAppStore((state) => state.connectionStatus);

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
        if (mounted) { setSavedConfig(fallback); setDraft(fallback); }
        const [fetchedConfig, user] = await Promise.all([api.getConfig(), api.getCurrentUser()]);
        if (!mounted) return;
        setSavedConfig(structuredClone(fetchedConfig));
        setDraft(structuredClone(fetchedConfig));
        setCurrentUser(user);
      } catch (error) {
        console.error('Failed to load settings page context:', error);
        if (mounted) { setStatusError('Failed to load latest configuration. Showing cached/default values.'); setCurrentUser(null); }
      } finally {
        if (mounted) { setAuthChecked(true); setLoading(false); }
      }
    };
    void bootstrap();
    return () => { mounted = false; };
  }, [config]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const setDraftNumber = (path: 'port' | 'concurrentConnections' | 'reconnectDelayMs' | 'primaryRecheckDelayMs' | 'retentionDays' | 'maxInMemoryRecords' | 'longCallMinutes' | 'repeatedBusyThreshold' | 'repeatedBusyWindowMinutes', value: string) => {
    const parsed = toInt(value);
    setDraft((prev) => {
      if (['port', 'concurrentConnections', 'reconnectDelayMs', 'primaryRecheckDelayMs'].includes(path)) {
        return { ...prev, connection: { ...prev.connection, [path]: parsed } };
      }
      if (path === 'retentionDays') return { ...prev, storage: { ...prev.storage, retentionDays: parsed } };
      if (path === 'maxInMemoryRecords') return { ...prev, maxInMemoryRecords: parsed };
      return { ...prev, alerts: { ...prev.alerts, [path]: parsed } };
    });
  };

  const handleSave = async () => {
    if (!isAdmin) { setStatusError('Admin privileges are required to change settings.'); return; }
    if (hasValidationErrors) { setStatusError('Fix validation errors before saving.'); return; }
    try {
      setSaving(true); setStatusError(null); setStatusMessage(null);
      await saveConfig(draft);
      const latest = await api.getConfig();
      setSavedConfig(structuredClone(latest)); setDraft(structuredClone(latest));
      setStatusMessage('Configuration saved successfully.');
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to save configuration.');
    } finally { setSaving(false); }
  };

  const handleRevert = () => { setDraft(structuredClone(savedConfig)); setStatusError(null); setStatusMessage('Unsaved changes were reverted.'); };

  const handleStartStream = async () => {
    if (!isAdmin) { setStatusError('Admin privileges are required to control the stream.'); return; }
    try {
      setStreamAction('start'); setStatusError(null); setStatusMessage(null);
      await startStream(); setStatusMessage('Stream started.');
    } catch (error) { setStatusError(error instanceof Error ? error.message : 'Failed to start stream.'); }
    finally { setStreamAction(null); }
  };

  const handleStopStream = async () => {
    if (!isAdmin) { setStatusError('Admin privileges are required to control the stream.'); return; }
    try {
      setStreamAction('stop'); setStatusError(null); setStatusMessage(null);
      await stopStream(); setStatusMessage('Stream stopped.');
    } catch (error) { setStatusError(error instanceof Error ? error.message : 'Failed to stop stream.'); }
    finally { setStreamAction(null); }
  };

  const openPurgeModal = async () => {
    if (!isAdmin) { setStatusError('Admin privileges are required to purge records.'); return; }
    const days = toInt(purgeDays);
    if (days < 1 || days > 3650) { setStatusError('Purge days must be between 1 and 3650.'); return; }
    try {
      setPurgeEstimateLoading(true); setStatusError(null); setStatusMessage(null);
      const estimate = await api.estimatePurgeRecords(days);
      setPurgeEstimate(estimate); setPurgeConfirmText(''); setShowPurgeModal(true);
    } catch (error) { setStatusError(error instanceof Error ? error.message : 'Failed to estimate purge impact.'); }
    finally { setPurgeEstimateLoading(false); }
  };

  const handlePurge = async () => {
    if (!isAdmin) return;
    const days = toInt(purgeDays);
    try {
      setPurging(true); setStatusError(null); setStatusMessage(null);
      const removed = await purgeRecords(days);
      setShowPurgeModal(false);
      setStatusMessage(`Purge complete. Removed ${removed} records older than ${days} days.`);
    } catch (error) { setStatusError(error instanceof Error ? error.message : 'Purge failed.'); }
    finally { setPurging(false); }
  };

  if (loading) {
    return (
      <div className="card p-3">
        <p style={{ color: 'var(--muted)' }}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="app-page gap-2">
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
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Save or revert your changes before leaving this page.</p>
        </div>
      )}

      {/* System Control - Full width row at top */}
      <div className="card p-3">
        <div className="flex items-center justify-between mb-3 min-h-[28px]">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>System Control</p>
          <ConnectionStatusBadge status={connectionStatus} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Configuration Actions - Left Side */}
          <div>
            <div className="flex items-center mb-2 min-h-[28px]">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Configuration</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="h-9 rounded-2xl border px-3 text-lg font-semibold tracking-tight text-white disabled:opacity-50"
                style={{
                  borderColor: 'rgba(38, 182, 127, 0.95)',
                  background: 'linear-gradient(180deg, #24c983 0%, #1ea86e 100%)',
                  boxShadow: '0 0 0 1px rgba(38, 182, 127, 0.35), 0 6px 16px rgba(38, 182, 127, 0.25)'
                }}
                onClick={handleSave}
                disabled={!isAdmin || saving || hasValidationErrors || !hasUnsavedChanges}
              >
                {saving ? 'Saving…' : 'Save Config'}
              </button>
              <button
                className="h-9 rounded-2xl border bg-transparent px-3 text-lg font-semibold tracking-tight disabled:opacity-50"
                style={{
                  borderColor: 'rgba(122, 138, 168, 0.75)',
                  color: 'var(--text-muted)',
                  boxShadow: 'inset 0 0 0 1px rgba(122, 138, 168, 0.08)'
                }}
                onClick={handleRevert}
                disabled={!isAdmin || !hasUnsavedChanges || saving}
              >
                Revert
              </button>
            </div>
          </div>

          {/* Stream Control - Right Side */}
          <div>
            <div className="flex items-center mb-2 min-h-[28px]">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Stream Control</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="h-9 rounded-2xl border bg-transparent px-3 text-lg font-semibold tracking-tight disabled:opacity-50"
                style={{
                  borderColor: 'rgba(38, 182, 127, 0.95)',
                  color: '#22e08e',
                  boxShadow: 'inset 0 0 0 1px rgba(38, 182, 127, 0.08)'
                }}
                onClick={handleStartStream}
                disabled={!isAdmin || streamAction !== null}
              >
                {streamAction === 'start' ? 'Starting…' : 'Start Stream'}
              </button>
              <button
                className="h-9 rounded-2xl border bg-transparent px-3 text-lg font-semibold tracking-tight disabled:opacity-50"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.95)',
                  color: '#ff4f67',
                  boxShadow: 'inset 0 0 0 1px rgba(239, 68, 68, 0.08)'
                }}
                onClick={handleStopStream}
                disabled={!isAdmin || streamAction !== null}
              >
                {streamAction === 'stop' ? 'Stopping…' : 'Stop Stream'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Grid - 2 columns */}
      <div className="grid gap-2 lg:grid-cols-2 min-h-0 flex-1 overflow-auto pr-1 content-start">

        {/* Connection Settings — S1 status badge header */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Connection Settings</p>
            <ConnectionStatusBadge status={connectionStatus} />
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>Configure PBX connectivity and failover behavior.</p>

          <fieldset disabled={!isAdmin} className="grid gap-3 lg:grid-cols-2 disabled:opacity-70">
            {/* S3: Chip input for Controller IPs */}
            <div className="lg:col-span-2">
              <label className="text-sm" style={{ color: 'var(--text)' }}>Controller IPs</label>
              <ChipInput
                values={draft.connection.controllerIps}
                onChange={(ips) => setDraft((prev) => ({ ...prev, connection: { ...prev.connection, controllerIps: ips } }))}
                placeholder="Add IP address..."
                disabled={!isAdmin}
                validator={isValidIp}
              />
              {fieldErrors.controllerIps && <p className="mt-1 text-xs text-red-400">{fieldErrors.controllerIps}</p>}
            </div>

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
                type="number" min={1} max={10}
                value={draft.connection.concurrentConnections}
                onChange={(e) => setDraftNumber('concurrentConnections', e.target.value)}
              />
              {fieldErrors.concurrentConnections && <p className="mt-1 text-xs text-red-400">{fieldErrors.concurrentConnections}</p>}
            </label>

            {/* S2: Reconnect delay with human-readable helper */}
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Auto Reconnect Delay (ms)
              <input
                className="mt-1 w-full rounded-2xl border px-3 py-2"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                type="number"
                value={draft.connection.reconnectDelayMs}
                onChange={(e) => setDraftNumber('reconnectDelayMs', e.target.value)}
              />
              <p className="mt-0.5 text-xs" style={{ color: 'var(--brand)' }}>= {msToReadable(draft.connection.reconnectDelayMs)}</p>
              {fieldErrors.reconnectDelayMs && <p className="mt-1 text-xs text-red-400">{fieldErrors.reconnectDelayMs}</p>}
            </label>

            {/* S2: Primary recheck delay with human-readable helper */}
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Primary Recheck Delay (ms)
              <input
                className="mt-1 w-full rounded-2xl border px-3 py-2"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                type="number"
                value={draft.connection.primaryRecheckDelayMs}
                onChange={(e) => setDraftNumber('primaryRecheckDelayMs', e.target.value)}
              />
              <p className="mt-0.5 text-xs" style={{ color: 'var(--brand)' }}>= {msToReadable(draft.connection.primaryRecheckDelayMs)}</p>
              {fieldErrors.primaryRecheckDelayMs && <p className="mt-1 text-xs text-red-400">{fieldErrors.primaryRecheckDelayMs}</p>}
            </label>

            <div className="lg:col-span-2">
              <label className="text-sm" style={{ color: 'var(--text)' }}>IP Whitelist (optional)</label>
              <ChipInput
                values={draft.connection.ipWhitelist ?? []}
                onChange={(ips) => setDraft((prev) => ({ ...prev, connection: { ...prev.connection, ipWhitelist: ips } }))}
                placeholder="Leave empty to allow all"
                disabled={!isAdmin}
                validator={isValidIp}
              />
              {fieldErrors.ipWhitelist && <p className="mt-1 text-xs text-red-400">{fieldErrors.ipWhitelist}</p>}
            </div>

            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
              <input type="checkbox" checked={draft.connection.autoReconnect} onChange={(e) => setDraft((prev) => ({ ...prev, connection: { ...prev.connection, autoReconnect: e.target.checked } }))} />
              Auto Reconnect
            </label>

            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
              <input type="checkbox" checked={draft.connection.autoReconnectPrimary} onChange={(e) => setDraft((prev) => ({ ...prev, connection: { ...prev.connection, autoReconnectPrimary: e.target.checked } }))} />
              Auto Failback To Primary
            </label>
          </fieldset>
        </div>

        {/* SMDR Parser Configuration - Mitel Spec Compliance */}
        <div className="card p-4">
          <p className="text-base font-bold" style={{ color: 'var(--text)' }}>SMDR Parser Configuration</p>
          <p className="mt-2 text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Configure parsing options for MiVoice Business SMDR records. These options affect how records are interpreted.
          </p>
          <fieldset disabled={!isAdmin} className="grid gap-4 lg:grid-cols-2 disabled:opacity-70">
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.extendedDigitLength}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, extendedDigitLength: e.target.checked } }))}
                className="w-5 h-5"
              />
              Extended Digit Length
              <span className="text-sm" style={{ color: 'var(--muted)' }}>(Duration hhhh:mm:ss, 7-digit parties)</span>
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.aniDnisReporting}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, aniDnisReporting: e.target.checked } }))}
                className="w-5 h-5"
              />
              ANI/DNIS Reporting
              <span className="text-sm" style={{ color: 'var(--muted)' }}>(Caller ID & Dialed Number)</span>
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.networkOLI}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, networkOLI: e.target.checked } }))}
                className="w-5 h-5"
              />
              Network OLI
              <span className="text-sm" style={{ color: 'var(--muted)' }}>(Call Identifier & Sequence)</span>
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.extendedReportingL1}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, extendedReportingL1: e.target.checked } }))}
                className="w-5 h-5"
              />
              Extended Reporting L1
              <span className="text-sm" style={{ color: 'var(--muted)' }}>(Suite ID, EHDU, 2B Transfer)</span>
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.extendedReportingL2}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, extendedReportingL2: e.target.checked } }))}
                className="w-5 h-5"
              />
              Extended Reporting L2
              <span className="text-sm" style={{ color: 'var(--muted)' }}>(Location Information)</span>
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.extendedTimeToAnswer}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, extendedTimeToAnswer: e.target.checked } }))}
                className="w-5 h-5"
              />
              Extended Time to Answer
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.networkFormat}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, networkFormat: e.target.checked } }))}
                className="w-5 h-5"
              />
              Network Format (DPNSS)
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.reportMeterPulses}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, reportMeterPulses: e.target.checked } }))}
                className="w-5 h-5"
              />
              Report Meter Pulses
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.suiteServices}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, suiteServices: e.target.checked } }))}
                className="w-5 h-5"
              />
              Suite Services
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.twoBChannelTransfer}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, twoBChannelTransfer: e.target.checked } }))}
                className="w-5 h-5"
              />
              Two B-Channel Transfer
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.externalHotDesk}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, externalHotDesk: e.target.checked } }))}
                className="w-5 h-5"
              />
              External Hot Desk User
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.locationReporting}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, locationReporting: e.target.checked } }))}
                className="w-5 h-5"
              />
              Location Reporting
            </label>
            <label className="flex items-center gap-3 text-base" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={draft.smdrParser.twentyFourHourTime}
                onChange={(e) => setDraft((prev) => ({ ...prev, smdrParser: { ...prev.smdrParser, twentyFourHourTime: e.target.checked } }))}
                className="w-5 h-5"
              />
              24-Hour Time Format
            </label>
          </fieldset>
          <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              <strong>Auto-detection:</strong> The parser automatically detects the record format. Enable options that match your MiVoice Business configuration.
            </p>
          </div>
        </div>

        {/* Storage & Runtime */}
        <div className="card p-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Storage & Runtime</p>
          <p className="mt-1 text-sm mb-3" style={{ color: 'var(--muted)' }}>Control data retention, in-memory buffer size, and stream control.</p>
          <fieldset disabled={!isAdmin} className="grid gap-3 lg:grid-cols-2 disabled:opacity-70">
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Retention Days
              <input className="mt-1 w-full rounded-2xl border px-3 py-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }} type="number" value={draft.storage.retentionDays} onChange={(e) => setDraftNumber('retentionDays', e.target.value)} />
              {fieldErrors.retentionDays && <p className="mt-1 text-xs text-red-400">{fieldErrors.retentionDays}</p>}
            </label>
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Max In-memory Records
              <input className="mt-1 w-full rounded-2xl border px-3 py-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }} type="number" value={draft.maxInMemoryRecords} onChange={(e) => setDraftNumber('maxInMemoryRecords', e.target.value)} />
              {fieldErrors.maxInMemoryRecords && <p className="mt-1 text-xs text-red-400">{fieldErrors.maxInMemoryRecords}</p>}
            </label>
          </fieldset>

          {/* Danger Zone */}
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: '#ef4444', fontSize: 16 }}>⚠</span>
              <p className="text-sm font-semibold text-red-400">Danger Zone</p>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
              Records older than the selected threshold will be permanently deleted.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-sm" style={{ color: 'var(--text)' }}>
                Purge older than (days)
                <input
                  value={purgeDays}
                  onChange={(e) => setPurgeDays(e.target.value)}
                  className="mt-1 w-full rounded-2xl border px-3 py-2"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)', maxWidth: 160 }}
                  type="number" min={1} max={3650}
                  disabled={!isAdmin}
                />
              </label>
              <div className="ml-auto">
                <button
                  className="rounded-2xl border border-red-700 px-3 py-2 text-sm font-semibold text-red-300 disabled:opacity-50"
                  onClick={openPurgeModal}
                  disabled={!isAdmin || purging || purgeEstimateLoading}
                >
                  {purgeEstimateLoading ? 'Estimating…' : 'Purge Data'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Rules — S4: Watch Numbers chip input */}
        <div className="card p-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Alert Rules</p>
          <p className="mt-1 text-sm mb-3" style={{ color: 'var(--muted)' }}>Tune thresholds used for alert generation.</p>
          <fieldset disabled={!isAdmin} className="grid gap-3 lg:grid-cols-2 disabled:opacity-70">
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Long Call Alert (minutes)
              <input className="mt-1 w-full rounded-2xl border px-3 py-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }} type="number" value={draft.alerts.longCallMinutes} onChange={(e) => setDraftNumber('longCallMinutes', e.target.value)} />
              {fieldErrors.longCallMinutes && <p className="mt-1 text-xs text-red-400">{fieldErrors.longCallMinutes}</p>}
            </label>
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Repeated Busy Threshold
              <input className="mt-1 w-full rounded-2xl border px-3 py-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }} type="number" value={draft.alerts.repeatedBusyThreshold} onChange={(e) => setDraftNumber('repeatedBusyThreshold', e.target.value)} />
              {fieldErrors.repeatedBusyThreshold && <p className="mt-1 text-xs text-red-400">{fieldErrors.repeatedBusyThreshold}</p>}
            </label>
            <label className="text-sm" style={{ color: 'var(--text)' }}>
              Repeated Busy Window (minutes)
              <input className="mt-1 w-full rounded-2xl border px-3 py-2" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }} type="number" value={draft.alerts.repeatedBusyWindowMinutes} onChange={(e) => setDraftNumber('repeatedBusyWindowMinutes', e.target.value)} />
              {fieldErrors.repeatedBusyWindowMinutes && <p className="mt-1 text-xs text-red-400">{fieldErrors.repeatedBusyWindowMinutes}</p>}
            </label>
            <div>
              <label className="text-sm" style={{ color: 'var(--text)' }}>Watch Numbers</label>
              <ChipInput
                values={draft.alerts.watchNumbers}
                onChange={(numbers) => setDraft((prev) => ({ ...prev, alerts: { ...prev.alerts, watchNumbers: numbers } }))}
                placeholder="e.g. 911, *98"
                disabled={!isAdmin}
                validator={(v) => /^[0-9*#]{2,20}$/.test(v)}
              />
              {fieldErrors.watchNumbers && <p className="mt-1 text-xs text-red-400">{fieldErrors.watchNumbers}</p>}
            </div>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
              <input type="checkbox" checked={draft.alerts.detectTagCalls} onChange={(e) => setDraft((prev) => ({ ...prev, alerts: { ...prev.alerts, detectTagCalls: e.target.checked } }))} />
              Detect TAG Calls
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
              <input type="checkbox" checked={draft.alerts.detectTollDenied} onChange={(e) => setDraft((prev) => ({ ...prev, alerts: { ...prev.alerts, detectTollDenied: e.target.checked } }))} />
              Detect Toll Denied
            </label>
          </fieldset>
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
                {purging ? 'Purging…' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
