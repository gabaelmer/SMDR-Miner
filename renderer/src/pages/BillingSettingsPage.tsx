import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { BillingConfig, CallBilling, CallCategory, DEFAULT_BILLING_CONFIG, PrefixRule, RateConfig, RateTier } from '../../../shared/types';
import { api } from '../lib/api';

const CATEGORIES: CallCategory[] = ['local', 'national', 'mobile', 'international', 'unclassified'];
const CURRENCY_OPTIONS = ['PHP', 'USD'] as const;
type SupportedCurrency = (typeof CURRENCY_OPTIONS)[number];
type ImpactTarget = { category: string; currentRate: number; currency: SupportedCurrency };
type DeletedRulesSnapshot = { rules: PrefixRule[]; label: string };

const CATEGORY_STYLE: Record<CallCategory, string> = {
  local: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  national: 'bg-blue-900/40 text-blue-300 border-blue-700',
  mobile: 'bg-purple-900/40 text-purple-300 border-purple-700',
  international: 'bg-orange-900/40 text-orange-300 border-orange-700',
  unclassified: 'bg-gray-800 text-gray-400 border-gray-600'
};

interface BillingValidationResult {
  errors: string[];
  warnings: string[];
  shadowedRuleIds: Set<string>;
  fieldErrors: Record<string, string>;
}

function Badge({ cat }: { cat: CallCategory }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${CATEGORY_STYLE[cat]}`}>
      {cat}
    </span>
  );
}

// Delete Confirmation Modal Component
function DeleteConfirmModal({ 
  isOpen, 
  rule,
  onConfirm, 
  onCancel 
}: { 
  isOpen: boolean; 
  rule?: PrefixRule;
  onConfirm: () => void; 
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalFocusTrap(dialogRef, cancelRef, onCancel, isOpen);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-rule-title"
        aria-describedby="delete-rule-desc"
        className="bg-[#0d1a36] border border-gray-700 p-6 rounded-2xl max-w-sm w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="delete-rule-title" className="text-base font-bold mb-2" style={{ color: 'var(--text)' }}>
          Delete Rule "{rule?.prefix || ''}"?
        </h3>
        <p id="delete-rule-desc" className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
          This will remove the classification rule. This action cannot be undone.
        </p>
        <p className="text-xs mb-6" style={{ color: 'var(--muted2)' }}>
          {rule ? `${rule.category} • Priority ${rule.priority}${rule.description ? ` • ${rule.description}` : ''}` : ''}
        </p>
        <div className="flex gap-2 justify-end">
          <button ref={cancelRef} onClick={onCancel} className="rounded-2xl border px-4 py-2 text-sm h-9 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
          <button onClick={onConfirm} className="rounded-2xl bg-red-600 px-4 py-2 text-sm h-9 font-semibold text-white">Delete</button>
        </div>
      </div>
    </div>
  );
}

// Loading Overlay Component
function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#0d1a36] border border-brand-600/30 p-6 rounded-2xl shadow-2xl text-center">
        <div className="animate-spin text-4xl mb-4" style={{ color: 'var(--brand)' }}>⟳</div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{message}</p>
      </div>
    </div>
  );
}

// Bulk Action Confirmation Modal
function BulkActionModal({
  isOpen,
  action,
  count,
  onConfirm,
  onCancel
}: {
  isOpen: boolean;
  action?: 'enable' | 'disable' | 'delete';
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalFocusTrap(dialogRef, cancelRef, onCancel, isOpen && !!action);
  if (!isOpen || !action) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-action-title"
        aria-describedby="bulk-action-desc"
        className="bg-[#0d1a36] border border-gray-700 p-6 rounded-2xl max-w-sm w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="bulk-action-title" className="text-base font-bold mb-2" style={{ color: 'var(--text)' }}>Bulk {action === 'delete' ? 'Delete' : action === 'enable' ? 'Enable' : 'Disable'}?</h3>
        <p id="bulk-action-desc" className="text-sm mb-6" style={{ color: 'var(--muted)' }}>Apply {action} to {count} rule(s)?{action === 'delete' ? ' This action cannot be undone.' : ''}</p>
        <div className="flex gap-2 justify-end">
          <button ref={cancelRef} onClick={onCancel} className="rounded-2xl border px-4 py-2 text-sm h-9 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
          <button onClick={onConfirm} className={`rounded-2xl px-4 py-2 text-sm h-9 font-semibold text-white ${action === 'delete' ? 'bg-red-600' : 'bg-brand-600'}`}>{action === 'delete' ? 'Delete All' : `${action === 'enable' ? 'Enable' : 'Disable'} All`}</button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_RULE: Partial<PrefixRule> = {
  category: 'mobile',
  prefix: '',
  description: '',
  enabled: true,
  priority: 50
};

function createRuleId(): string {
  return `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneConfig(config: BillingConfig): BillingConfig {
  return JSON.parse(JSON.stringify(config)) as BillingConfig;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(value: string | undefined): SupportedCurrency {
  const upper = (value || 'PHP').toUpperCase();
  return CURRENCY_OPTIONS.includes(upper as SupportedCurrency) ? (upper as SupportedCurrency) : 'PHP';
}

function normalizeTiers(tiers: RateTier[] | undefined): RateTier[] | undefined {
  if (!tiers || tiers.length === 0) return undefined;
  const normalized = tiers
    .map((tier) => ({
      minMinutes: Math.max(0, Math.floor(toFiniteNumber(tier.minMinutes))),
      maxMinutes:
        tier.maxMinutes === undefined || tier.maxMinutes === null || `${tier.maxMinutes}` === ''
          ? undefined
          : Math.max(0, Math.floor(toFiniteNumber(tier.maxMinutes))),
      ratePerMinute: Math.max(0, toFiniteNumber(tier.ratePerMinute))
    }))
    .sort((a, b) => a.minMinutes - b.minMinutes);
  return normalized;
}

function sanitizeBillingConfig(input: BillingConfig): BillingConfig {
  const normalizedRules = input.prefixRules.map((rule) => ({
    ...rule,
    id: rule.id || createRuleId(),
    prefix: rule.prefix.trim(),
    description: (rule.description ?? '').trim(),
    priority: Math.max(1, Math.min(999, Math.floor(toFiniteNumber(rule.priority, 50)))),
    enabled: Boolean(rule.enabled)
  }));

  const sourceRateMap = new Map<CallCategory, RateConfig>(
    input.rates.map((rate) => [
      rate.category,
      {
        ...rate,
        ratePerMinute: Math.max(0, toFiniteNumber(rate.ratePerMinute)),
        minimumCharge: Math.max(0, Math.floor(toFiniteNumber(rate.minimumCharge))),
        blockSize: Math.max(1, Math.floor(toFiniteNumber(rate.blockSize, 60))),
        currency: normalizeCurrency(rate.currency || input.currency || 'PHP'),
        weekendMultiplier: rate.weekendMultiplier === undefined ? undefined : Math.max(0, toFiniteNumber(rate.weekendMultiplier)),
        holidayMultiplier: rate.holidayMultiplier === undefined ? undefined : Math.max(0, toFiniteNumber(rate.holidayMultiplier)),
        tiers: normalizeTiers(rate.tiers)
      }
    ])
  );

  const normalizedRates = CATEGORIES.map((category) => {
    const fallback = DEFAULT_BILLING_CONFIG.rates.find((rate) => rate.category === category)!;
    const source = sourceRateMap.get(category) ?? fallback;
    return {
      ...source,
      category,
      currency: normalizeCurrency(source.currency || input.currency || 'PHP'),
      tiers: normalizeTiers(source.tiers)
    };
  });

  return {
    ...input,
    enabled: Boolean(input.enabled),
    currency: normalizeCurrency(input.currency || 'PHP'),
    taxRate: 0,
    prefixRules: normalizedRules,
    rates: normalizedRates,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function sortRulesByPrecedence(rules: PrefixRule[]): PrefixRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

function formatCurrency(value: number, currency = 'PHP') {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: currency || 'PHP',
    minimumFractionDigits: 2
  }).format(value || 0);
}

function useModalFocusTrap(
  containerRef: { current: HTMLElement | null },
  initialFocusRef: { current: HTMLElement | null },
  onClose?: () => void,
  active = true
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusFirst = () => {
      if (initialFocusRef.current) {
        initialFocusRef.current.focus();
        return;
      }
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
      focusables[0]?.focus();
    };

    const frame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onClose) onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      if (previousActive && typeof previousActive.focus === 'function') previousActive.focus();
    };
  }, [containerRef, initialFocusRef, onClose, active]);
}

function ImpactAnalysisModal({
  target,
  proposedRate,
  onProposedRateChange,
  onAnalyze,
  analyzing,
  impactAnalysis,
  onClose
}: {
  target: ImpactTarget | null;
  proposedRate: string;
  onProposedRateChange: (value: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  impactAnalysis: any;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocusTrap(dialogRef, closeRef, onClose, !!target);
  if (!target) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="impact-analysis-title"
        className="bg-[#0d1a36] border border-gray-700 p-6 rounded-2xl max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 id="impact-analysis-title" className="text-base font-bold" style={{ color: 'var(--text)' }}>Impact Analysis: {target.category}</h3>
          <button ref={closeRef} onClick={onClose} className="text-xs" style={{ color: 'var(--muted)' }} aria-label="Close impact analysis">✕</button>
        </div>

        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Current Rate</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{formatCurrency(target.currentRate, target.currency)}/min</p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Proposed Rate</p>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl border px-2 py-1 text-sm h-9"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                value={proposedRate}
                onChange={e => onProposedRateChange(e.target.value)}
              />
            </div>
          </div>

          <button
            className="w-full rounded-2xl bg-brand-600 px-4 py-2 text-sm h-9 font-semibold text-white disabled:opacity-50"
            disabled={analyzing || !proposedRate}
            onClick={onAnalyze}
          >
            {analyzing ? 'Analyzing...' : 'Calculate Impact'}
          </button>
        </div>

        {impactAnalysis && (
          <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--brand)', background: 'rgba(36,132,235,0.1)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>30-Day Projection</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p style={{ color: 'var(--muted)' }}>Affected Calls</p>
                <p className="font-semibold" style={{ color: 'var(--text)' }}>{impactAnalysis.overall?.totalAffectedCalls || 0}</p>
              </div>
              <div>
                <p style={{ color: 'var(--muted)' }}>Current Revenue</p>
                <p className="font-semibold" style={{ color: 'var(--text)' }}>{formatCurrency(impactAnalysis.overall?.currentRevenue || 0, target.currency)}</p>
              </div>
              <div>
                <p style={{ color: 'var(--muted)' }}>Projected Revenue</p>
                <p className="font-semibold" style={{ color: 'var(--text)' }}>{formatCurrency(impactAnalysis.overall?.projectedRevenue || 0, target.currency)}</p>
              </div>
              <div>
                <p style={{ color: 'var(--muted)' }}>Change</p>
                <p className={`font-semibold ${(impactAnalysis.overall?.revenueChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(impactAnalysis.overall?.revenueChange || 0, target.currency)} ({(impactAnalysis.overall?.revenueChangePercent || 0).toFixed(1)}%)
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function validateBillingConfig(config: BillingConfig): BillingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shadowedRuleIds = new Set<string>();
  const fieldErrors: Record<string, string> = {};

  const duplicatePrefixMap = new Map<string, PrefixRule[]>();
  const ruleIdSet = new Set<string>();
  config.prefixRules.forEach((rule, index) => {
    const prefix = rule.prefix.trim();
    if (!rule.id) errors.push(`Rule #${index + 1}: missing id`);
    if (rule.id && ruleIdSet.has(rule.id)) {
      errors.push(`Rule #${index + 1}: duplicate id "${rule.id}"`);
      fieldErrors[`rule-${rule.id}-id`] = 'Duplicate ID';
    }
    if (rule.id) ruleIdSet.add(rule.id);
    if (!prefix) {
      errors.push(`Rule #${index + 1}: prefix is required`);
      fieldErrors[`rule-${rule.id || index}-prefix`] = 'Required';
    }
    if (prefix.length > 8) errors.push(`Rule #${index + 1}: prefix must be 8 chars or fewer`);
    if (prefix && !/^[+0-9*#]+$/.test(prefix)) {
      errors.push(`Rule #${index + 1}: invalid prefix "${prefix}"`);
      fieldErrors[`rule-${rule.id || index}-prefix`] = 'Invalid chars';
    }
    if (rule.priority < 1 || rule.priority > 999) {
      errors.push(`Rule #${index + 1}: priority must be 1-999`);
      fieldErrors[`rule-${rule.id || index}-priority`] = '1-999';
    }
    if ((rule.description ?? '').length > 100) errors.push(`Rule #${index + 1}: description must be <= 100 chars`);

    if (!duplicatePrefixMap.has(prefix)) duplicatePrefixMap.set(prefix, []);
    duplicatePrefixMap.get(prefix)?.push(rule);
  });

  for (const [prefix, rules] of duplicatePrefixMap.entries()) {
    if (!prefix || rules.length <= 1) continue;
    warnings.push(`Duplicate prefix "${prefix}" appears ${rules.length} times`);
    rules.forEach((rule, i) => {
      if (i > 0) fieldErrors[`rule-${rule.id}-prefix`] = `Duplicate`;
    });
  }

  const enabledRules = sortRulesByPrecedence(config.prefixRules.filter((rule) => rule.enabled));
  for (let i = 0; i < enabledRules.length; i += 1) {
    const current = enabledRules[i];
    for (let j = 0; j < i; j += 1) {
      const blocker = enabledRules[j];
      if (!current.prefix.startsWith(blocker.prefix)) continue;
      const stronger =
        blocker.priority < current.priority ||
        (blocker.priority === current.priority && blocker.prefix.length >= current.prefix.length);
      if (stronger) {
        shadowedRuleIds.add(current.id);
        warnings.push(`Rule ${current.prefix} is shadowed by ${blocker.prefix}`);
        fieldErrors[`rule-${current.id}-prefix`] = `Shadowed by ${blocker.prefix}`;
        break;
      }
    }
  }

  const rateByCategory = new Map(config.rates.map((rate) => [rate.category, rate]));
  for (const category of CATEGORIES) {
    if (!rateByCategory.has(category)) errors.push(`Missing rate for ${category}`);
  }

  config.rates.forEach((rate) => {
    if (rate.ratePerMinute < 0) errors.push(`Rate ${rate.category}: rate per minute must be >= 0`);
    if (rate.minimumCharge < 0) errors.push(`Rate ${rate.category}: minimum charge must be >= 0`);
    if (rate.blockSize <= 0) errors.push(`Rate ${rate.category}: block size must be > 0`);
    if (rate.blockSize > 0 && 60 % rate.blockSize !== 0) warnings.push(`Rate ${rate.category}: block size ${rate.blockSize}s does not evenly divide 60s`);
    if (!CURRENCY_OPTIONS.includes(normalizeCurrency(rate.currency))) errors.push(`Rate ${rate.category}: currency must be PHP or USD`);
    if (rate.weekendMultiplier !== undefined && rate.weekendMultiplier < 0) errors.push(`Rate ${rate.category}: weekend multiplier must be >= 0`);
    if (rate.holidayMultiplier !== undefined && rate.holidayMultiplier < 0) errors.push(`Rate ${rate.category}: holiday multiplier must be >= 0`);

    const tiers = rate.tiers ?? [];
    let previousMax: number | undefined;
    tiers.forEach((tier, index) => {
      if (tier.minMinutes < 0) errors.push(`Rate ${rate.category}: tier #${index + 1} min minutes must be >= 0`);
      if (tier.maxMinutes !== undefined && tier.maxMinutes < tier.minMinutes) {
        errors.push(`Rate ${rate.category}: tier #${index + 1} max minutes must be >= min minutes`);
      }
      if (tier.ratePerMinute < 0) errors.push(`Rate ${rate.category}: tier #${index + 1} rate per minute must be >= 0`);
      if (previousMax !== undefined && tier.minMinutes < previousMax) {
        errors.push(`Rate ${rate.category}: tiers overlap at #${index + 1}`);
      }
      previousMax = tier.maxMinutes ?? previousMax;
    });
  });

  if (!CURRENCY_OPTIONS.includes(normalizeCurrency(config.currency))) errors.push('Default currency must be PHP or USD');

  return { errors, warnings, shadowedRuleIds, fieldErrors };
}

export function BillingSettingsPage() {
  const [serverConfig, setServerConfig] = useState<BillingConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<BillingConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [newRule, setNewRule] = useState<Partial<PrefixRule>>({ ...EMPTY_RULE });
  const [ruleFilter, setRuleFilter] = useState('');
  const [expandedTierCategory, setExpandedTierCategory] = useState<CallCategory | null>(null);
  const [testNum, setTestNum] = useState('');
  const [testDur, setTestDur] = useState(60);
  const [testCallDate, setTestCallDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [testHoliday, setTestHoliday] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState<CallBilling | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; ruleId?: string }>({ isOpen: false });
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [bulkActionConfirm, setBulkActionConfirm] = useState<{ isOpen: boolean; action?: 'enable' | 'disable' | 'delete' }>({ isOpen: false });
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [impactAnalysis, setImpactAnalysis] = useState<any>(null);
  const [analyzingImpact, setAnalyzingImpact] = useState(false);
  const [showImpactFor, setShowImpactFor] = useState<ImpactTarget | null>(null);
  const [proposedRate, setProposedRate] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastDeletedRules, setLastDeletedRules] = useState<DeletedRulesSnapshot | null>(null);

  const saveQueueRef = useRef(Promise.resolve());
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flashStatus = useCallback((message: string, isError = false) => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    if (isError) {
      setErrorMsg(message);
      setStatusMsg('');
    } else {
      setStatusMsg(message);
      setErrorMsg('');
    }
    messageTimerRef.current = setTimeout(() => {
      setStatusMsg('');
      setErrorMsg('');
    }, 5000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loaded, audit] = await Promise.all([
        api.getBillingConfig(),
        api.getBillingAuditHistory(50, 0).catch(() => ({ entries: [] }))
      ]);
      const sanitized = sanitizeBillingConfig(loaded as BillingConfig);
      setServerConfig(sanitized);
      setDraftConfig(cloneConfig(sanitized));
      setHasUnsavedChanges(false);
      setLastDeletedRules(null);
      if (audit && audit.entries) setAuditHistory(audit.entries);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(`Failed to load billing config: ${formatRuntimeError(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, [load]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: Close modals
      if (e.key === 'Escape') {
        if (deleteConfirm.isOpen) setDeleteConfirm({ isOpen: false });
        if (bulkActionConfirm.isOpen) setBulkActionConfirm({ isOpen: false });
        if (showImpactFor) setShowImpactFor(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirm.isOpen, bulkActionConfirm.isOpen, showImpactFor]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const validation = useMemo(() => {
    if (!draftConfig) return { errors: [], warnings: [], shadowedRuleIds: new Set<string>(), fieldErrors: {} as Record<string, string> };
    return validateBillingConfig(draftConfig);
  }, [draftConfig]);

  const fieldIssues = useMemo(() => Object.entries(validation.fieldErrors), [validation.fieldErrors]);

  const focusFieldByKey = useCallback((fieldKey: string) => {
    const target = document.getElementById(fieldKey);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (target instanceof HTMLElement) target.focus();
  }, []);

  const sortedRules = useMemo(() => {
    if (!draftConfig) return [];
    return sortRulesByPrecedence(draftConfig.prefixRules);
  }, [draftConfig]);

  const filteredRules = useMemo(() => {
    const needle = ruleFilter.trim().toLowerCase();
    if (!needle) return sortedRules;
    return sortedRules.filter((rule) =>
      [rule.prefix, rule.description, rule.category].some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [ruleFilter, sortedRules]);

  const patchDraft = (updater: (current: BillingConfig) => BillingConfig) => {
    setDraftConfig((current) => {
      if (!current) return current;
      const next = updater(current);
      if (next !== current) setHasUnsavedChanges(true);
      return next;
    });
  };

  const queueSave = useCallback(
    (payload: BillingConfig) => {
      setSaving(true);
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const updated = sanitizeBillingConfig((await api.saveBillingConfig(payload)) as BillingConfig);
          setServerConfig(updated);
          setDraftConfig(cloneConfig(updated));
          setHasUnsavedChanges(false);
          setLastDeletedRules(null);
          flashStatus(`Saved at ${dayjs().format('HH:mm:ss')}`);
        })
        .catch((error) => {
          flashStatus(`Save failed: ${formatRuntimeError(error)}`, true);
        })
        .finally(() => {
          setSaving(false);
        });

      return saveQueueRef.current;
    },
    [flashStatus]
  );

  const saveCurrent = async () => {
    if (!draftConfig) return;
    const normalized = sanitizeBillingConfig(draftConfig);
    const validationResult = validateBillingConfig(normalized);
    if (validationResult.errors.length > 0) {
      flashStatus(`Fix ${validationResult.errors.length} validation error(s) before saving.`, true);
      return;
    }
    await queueSave(normalized);
  };

  const revertChanges = () => {
    if (!serverConfig) return;
    setDraftConfig(cloneConfig(serverConfig));
    setNewRule({ ...EMPTY_RULE });
    setExpandedTierCategory(null);
    setHasUnsavedChanges(false);
    setLastDeletedRules(null);
    flashStatus('Changes reverted');
  };

  const addRule = () => {
    if (!draftConfig) return;
    const prefix = (newRule.prefix ?? '').trim();
    if (!prefix) {
      flashStatus('Prefix is required to add a rule.', true);
      return;
    }
    
    // Check for duplicates
    const category = (newRule.category ?? 'mobile') as CallCategory;
    const exists = draftConfig.prefixRules.some(r => r.prefix === prefix && r.category === category);
    if (exists) {
      setDuplicateWarning(`A rule with prefix "${prefix}" for ${category} already exists!`);
      return;
    }
    
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: [
        ...cfg.prefixRules,
        {
          id: createRuleId(),
          category,
          prefix,
          description: (newRule.description ?? '').trim(),
          enabled: Boolean(newRule.enabled ?? true),
          priority: Math.max(1, Math.min(999, Math.floor(toFiniteNumber(newRule.priority, 50))))
        }
      ]
    }));
    setNewRule({ ...EMPTY_RULE });
    setDuplicateWarning('');
  };

  const updateRule = (ruleId: string, patch: Partial<PrefixRule>) => {
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: cfg.prefixRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    }));
  };

  const deleteRule = () => {
    if (!deleteConfirm.ruleId) return;
    const removed = draftConfig?.prefixRules.find((rule) => rule.id === deleteConfirm.ruleId);
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: cfg.prefixRules.filter((rule) => rule.id !== deleteConfirm.ruleId)
    }));
    setDeleteConfirm({ isOpen: false });
    if (removed) {
      setLastDeletedRules({ rules: [removed], label: removed.prefix });
      flashStatus(`Deleted rule ${removed.prefix}.`);
    }
    setSelectedRuleIds(prev => { const next = new Set(prev); next.delete(deleteConfirm.ruleId!); return next; });
  };

  const undoDeleteRule = () => {
    if (!lastDeletedRules || lastDeletedRules.rules.length === 0) return;
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: [
        ...cfg.prefixRules,
        ...lastDeletedRules.rules.filter((rule) => !cfg.prefixRules.some((existing) => existing.id === rule.id))
      ]
    }));
    flashStatus(`Restored ${lastDeletedRules.label}.`);
    setLastDeletedRules(null);
  };

  // Bulk operations
  const toggleRuleSelection = (ruleId: string) => {
    setSelectedRuleIds(prev => { const next = new Set(prev); if (next.has(ruleId)) next.delete(ruleId); else next.add(ruleId); return next; });
  };

  const selectAllVisible = () => setSelectedRuleIds(new Set(filteredRules.map(r => r.id)));
  const clearSelection = () => setSelectedRuleIds(new Set());

  const handleBulkAction = (action: 'enable' | 'disable' | 'delete') => {
    if (selectedRuleIds.size === 0) return;
    setBulkActionConfirm({ isOpen: true, action });
  };

  const confirmBulkAction = () => {
    if (!bulkActionConfirm.action || selectedRuleIds.size === 0) return;
    const action = bulkActionConfirm.action;
    const selectedIds = new Set(selectedRuleIds);
    const removedRules = action === 'delete'
      ? (draftConfig?.prefixRules.filter((rule) => selectedIds.has(rule.id)) ?? [])
      : [];
    patchDraft((cfg) => {
      if (action === 'delete') {
        return { ...cfg, prefixRules: cfg.prefixRules.filter(r => !selectedIds.has(r.id)) };
      }
      return {
        ...cfg,
        prefixRules: cfg.prefixRules.map(r =>
          selectedIds.has(r.id) ? { ...r, enabled: action === 'enable' } : r
        )
      };
    });
    setBulkActionConfirm({ isOpen: false });
    setSelectedRuleIds(new Set());
    if (action === 'delete' && removedRules.length > 0) {
      const label = removedRules.length === 1 ? removedRules[0].prefix : `${removedRules.length} rules`;
      setLastDeletedRules({ rules: removedRules, label });
      flashStatus(`Deleted ${removedRules.length} rule(s).`);
      return;
    }
    flashStatus(`${selectedIds.size} rule(s) ${action}d`);
  };

  const analyzeImpact = async (category: string, currentRate: number, proposedRateVal: number) => {
    setAnalyzingImpact(true);
    try {
      const result = await api.analyzeBillingImpact(category, currentRate, proposedRateVal, 30) as any;
      setImpactAnalysis(result.data);
    } catch (error) {
      flashStatus(`Analysis failed: ${formatRuntimeError(error)}`, true);
    } finally {
      setAnalyzingImpact(false);
    }
  };

  const updateRateField = <K extends keyof RateConfig>(category: CallCategory, field: K, value: RateConfig[K]) => {
    patchDraft((cfg) => ({
      ...cfg,
      rates: cfg.rates.map((rate) => (rate.category === category ? { ...rate, [field]: value } : rate))
    }));
  };

  const addTier = (category: CallCategory) => {
    const currentRate = draftConfig?.rates.find((rate) => rate.category === category);
    const defaultRate = currentRate?.ratePerMinute ?? 0;
    updateRateField(category, 'tiers', [...(currentRate?.tiers ?? []), { minMinutes: 0, ratePerMinute: defaultRate }]);
  };

  const removeTier = (category: CallCategory, index: number) => {
    const currentRate = draftConfig?.rates.find((rate) => rate.category === category);
    if (!currentRate) return;
    updateRateField(
      category,
      'tiers',
      currentRate.tiers?.filter((_, tierIndex) => tierIndex !== index)
    );
  };

  const updateTier = (category: CallCategory, index: number, patch: Partial<RateTier>) => {
    const currentRate = draftConfig?.rates.find((rate) => rate.category === category);
    if (!currentRate) return;
    const nextTiers = [...(currentRate.tiers ?? [])];
    nextTiers[index] = { ...nextTiers[index], ...patch };
    updateRateField(category, 'tiers', nextTiers);
  };

  const runTest = async () => {
    if (!testNum.trim()) {
      setTestError('Phone number is required.');
      return;
    }
    setTesting(true);
    setTestError('');
    try {
      const result = (await api.testBillingNumber(testNum.trim(), Math.max(1, Math.floor(testDur)), {
        callDate: testCallDate || undefined,
        isHoliday: testHoliday
      })) as CallBilling;
      setTestResult(result);
    } catch (error) {
      setTestError(formatRuntimeError(error));
    } finally {
      setTesting(false);
    }
  };

  const renderRatesEditor = (embedded = false) => (
    <div className={embedded ? 'h-full flex flex-col' : undefined}>
      <div className="card p-4" style={embedded ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
        <div
          className="grid gap-3 flex-1 min-h-0"
          style={{
            gridTemplateRows: embedded ? 'minmax(240px, 1fr) minmax(300px, 1.35fr)' : 'minmax(240px, auto) minmax(300px, auto)'
          }}
        >
          <div className="rounded-xl border min-h-0" style={{ borderColor: 'var(--border)', overflow: 'auto' }}>
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b sticky top-0 z-[2]" style={{ borderColor: 'var(--border)', background: 'var(--surface-alt)' }}>
                {['Category', 'Rate / Min', 'Min Blocks', 'Block Size', 'Weekend x', 'Holiday x', 'Currency', 'Tiers', 'Impact'].map((header) => (
                  <th key={header} className="text-center px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draftConfig.rates.map((rate) => (
                <Fragment key={rate.category}>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 text-center"><div className="flex justify-center"><Badge cat={rate.category} /></div></td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-24 rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.ratePerMinute}
                        onChange={(event) => updateRateField(rate.category, 'ratePerMinute', toFiniteNumber(event.target.value, 0))}
                        disabled={rate.category === 'unclassified'}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.minimumCharge}
                        onChange={(event) => updateRateField(rate.category, 'minimumCharge', Math.floor(toFiniteNumber(event.target.value, 0)))}
                        disabled={rate.category === 'unclassified'}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        className="rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.blockSize}
                        onChange={(event) => updateRateField(rate.category, 'blockSize', Math.floor(toFiniteNumber(event.target.value, 60)))}
                        disabled={rate.category === 'unclassified'}
                      >
                        <option value={1}>1 sec</option>
                        <option value={6}>6 sec</option>
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-20 rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.weekendMultiplier ?? ''}
                        placeholder="1.00"
                        onChange={(event) =>
                          updateRateField(
                            rate.category,
                            'weekendMultiplier',
                            event.target.value === '' ? undefined : toFiniteNumber(event.target.value, 1)
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-20 rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.holidayMultiplier ?? ''}
                        placeholder="1.00"
                        onChange={(event) =>
                          updateRateField(
                            rate.category,
                            'holidayMultiplier',
                            event.target.value === '' ? undefined : toFiniteNumber(event.target.value, 1)
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        className="w-20 rounded border px-2 py-1 text-xs text-center mx-auto block"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        value={rate.currency}
                        onChange={(event) =>
                          patchDraft((cfg) => {
                            const nextCurrency = normalizeCurrency(event.target.value);
                            const rates = cfg.rates.map((entry) =>
                              entry.category === rate.category ? { ...entry, currency: nextCurrency } : entry
                            );
                            const currencies = new Set(rates.map((entry) => normalizeCurrency(entry.currency)));
                            return {
                              ...cfg,
                              rates,
                              currency: currencies.size === 1 ? Array.from(currencies)[0] : cfg.currency
                            };
                          })
                        }
                      >
                        {CURRENCY_OPTIONS.map((currency) => (
                          <option key={currency} value={currency}>{currency}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs mx-auto block"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                        onClick={() => setExpandedTierCategory(expandedTierCategory === rate.category ? null : rate.category)}
                      >
                        {expandedTierCategory === rate.category ? 'Hide' : 'Edit'} ({rate.tiers?.length ?? 0})
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        className="rounded-2xl bg-purple-600 px-3 py-1.5 text-xs h-8 font-semibold text-white mx-auto block"
                        onClick={() => { setShowImpactFor({ category: rate.category, currentRate: rate.ratePerMinute, currency: normalizeCurrency(rate.currency) }); setProposedRate(String(rate.ratePerMinute)); setImpactAnalysis(null); }}
                      >
                        Analyze
                      </button>
                    </td>
                  </tr>
                  {expandedTierCategory === rate.category && (
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <td colSpan={9} className="px-3 py-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                              Tiered Pricing for {rate.category}
                            </p>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-xs"
                              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                              onClick={() => addTier(rate.category)}
                            >
                              + Add Tier
                            </button>
                          </div>
                          {(rate.tiers ?? []).map((tier, index) => (
                            <div key={`${rate.category}-tier-${index}`} className="grid grid-cols-4 gap-2">
                              <input
                                type="number"
                                min={0}
                                className="rounded border px-2 py-1 text-xs"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                value={tier.minMinutes}
                                placeholder="Min minutes"
                                onChange={(event) => updateTier(rate.category, index, { minMinutes: Math.floor(toFiniteNumber(event.target.value, 0)) })}
                              />
                              <input
                                type="number"
                                min={0}
                                className="rounded border px-2 py-1 text-xs"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                value={tier.maxMinutes ?? ''}
                                placeholder="Max minutes (optional)"
                                onChange={(event) =>
                                  updateTier(rate.category, index, {
                                    maxMinutes: event.target.value === '' ? undefined : Math.floor(toFiniteNumber(event.target.value, 0))
                                  })
                                }
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="rounded border px-2 py-1 text-xs"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                value={tier.ratePerMinute}
                                placeholder="Rate per minute"
                                onChange={(event) => updateTier(rate.category, index, { ratePerMinute: toFiniteNumber(event.target.value, 0) })}
                              />
                              <button
                                type="button"
                                className="rounded border px-2 py-1 text-xs text-rose-400"
                                style={{ borderColor: 'var(--border)' }}
                                onClick={() => removeTier(rate.category, index)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          {(rate.tiers ?? []).length === 0 && (
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>
                              No tiers configured. Calls use base rate.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
            <div className="min-h-0 overflow-auto">
              {renderTestPanel()}
            </div>
            <div className="min-h-0 overflow-auto">
              {renderHistoryPanel()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHistoryPanel = () => (
    <div className="card p-3 md:p-4 h-full flex flex-col">
      <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>Change History</p>
      {auditHistory.length === 0 ? (
        <div className="flex-1 grid place-items-center text-center py-6">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No changes yet</p>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Changes to billing configuration will appear here</p>
        </div>
      ) : (
        <div className="space-y-2 flex-1 min-h-0 overflow-auto pr-1">
          {auditHistory.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                  {entry.changeType}{entry.category && ` (${entry.category})`}
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>
                  {entry.previousValue || '—'} → {entry.newValue || '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px]" style={{ color: 'var(--muted2)' }}>{entry.user || 'system'}</p>
                <p className="text-[10px]" style={{ color: 'var(--muted2)' }}>{entry.createdAt ? dayjs(entry.createdAt).format('MMM D, HH:mm') : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTestPanel = () => (
    <div className="card p-3 md:p-4 h-full flex flex-col">
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Test Number</p>
      <p className="text-xs mt-1 mb-2" style={{ color: 'var(--muted)' }}>
        Test number classification and pricing with date/holiday inputs.
      </p>
      <div className="space-y-2.5">
        <label className="text-xs block" style={{ color: 'var(--text)' }}>
          Phone Number
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 font-mono text-sm h-9"
            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            placeholder="e.g. 09171234567"
            value={testNum}
            onChange={(event) => setTestNum(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <label className="text-xs block" style={{ color: 'var(--text)' }}>
            Duration (seconds)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm h-9"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={testDur}
              onChange={(event) => setTestDur(Math.max(1, Math.floor(toFiniteNumber(event.target.value, 1))))}
            />
          </label>
          <label className="text-xs block" style={{ color: 'var(--text)' }}>
            Call Date
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm h-9"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={testCallDate}
              onChange={(event) => setTestCallDate(event.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={testHoliday} onChange={(event) => setTestHoliday(event.target.checked)} />
            Treat as holiday
          </label>
          <button
            type="button"
            onClick={() => {
              void runTest();
            }}
            disabled={testing}
            className="rounded-xl bg-brand-600 px-4 py-1.5 h-8 text-xs font-semibold text-white disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Run Test'}
          </button>
        </div>
      </div>
      {testError && <p className="text-xs" style={{ color: 'var(--red)' }}>{testError}</p>}
      {testResult && (
        <div className="mt-2 rounded-2xl border p-3 space-y-1.5 min-h-[170px] max-h-[360px] overflow-auto flex-1" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Category</span>
            <Badge cat={testResult.category} />
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Matched Prefix</span>
            <span className="font-mono font-bold" style={{ color: 'var(--text)' }}>{testResult.matchedPrefix ?? '(none)'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Billable Units</span>
            <span style={{ color: 'var(--text)' }}>{testResult.billableUnits}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Effective Rate / min</span>
            <span style={{ color: 'var(--text)' }}>{formatCurrency(testResult.ratePerMinute, testResult.currency)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Base Cost</span>
            <span style={{ color: 'var(--text)' }}>{formatCurrency(testResult.baseCost ?? testResult.cost, testResult.currency)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Multiplier</span>
            <span style={{ color: 'var(--text)' }}>{(testResult.appliedMultiplier ?? 1).toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2 font-bold" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text)' }}>Total Cost</span>
            <span className="text-brand-400">{formatCurrency(testResult.totalWithTax ?? testResult.cost, testResult.currency)}</span>
          </div>
        </div>
      )}
    </div>
  );

  if (!draftConfig) {
    return <div className="card p-4" style={{ color: 'var(--muted)' }}>Loading billing config...</div>;
  }

  const rulePendingDelete = deleteConfirm.ruleId
    ? draftConfig.prefixRules.find((rule) => rule.id === deleteConfirm.ruleId)
    : undefined;

  return (
    <>
      {loading && <LoadingOverlay message="Loading billing configuration..." />}
      {saving && <LoadingOverlay message="Saving changes..." />}
      <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[260px] max-w-xl">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Billing & Rating</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Configure classification prefixes, rates, multipliers, and tiered pricing.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted2)' }}>
              Last saved: {serverConfig?.updatedAt ? dayjs(serverConfig.updatedAt).format('YYYY-MM-DD HH:mm:ss') : 'n/a'}
            </p>
          </div>
          <div className="flex-1" />
          <div className="grid gap-2 sm:grid-cols-2 self-start">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>
              Default Currency
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm h-9"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                value={draftConfig.currency}
                onChange={(event) => {
                  const nextCurrency = normalizeCurrency(event.target.value);
                  patchDraft((cfg) => ({
                    ...cfg,
                    currency: nextCurrency,
                    rates: cfg.rates.map((rate) => ({ ...rate, currency: nextCurrency }))
                  }));
                }}
              >
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="rounded-2xl border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                disabled={!hasUnsavedChanges || saving}
                onClick={revertChanges}
              >
                Revert
              </button>
              <button
                type="button"
                className="rounded-2xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                disabled={!hasUnsavedChanges || saving}
                onClick={() => {
                  void saveCurrent();
                }}
              >
                {saving ? 'Saving...' : 'Save All'}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {hasUnsavedChanges ? (
              <span className="rounded-full border px-2 py-0.5" style={{ color: '#f59e0b', borderColor: '#f59e0b44' }}>
                Unsaved changes
              </span>
            ) : (
              <span className="rounded-full border px-2 py-0.5" style={{ color: 'var(--green)', borderColor: 'rgba(38,182,127,0.35)' }}>
                All changes saved
              </span>
            )}
            {statusMsg && <span style={{ color: 'var(--green)' }}>{statusMsg}</span>}
            {errorMsg && <span style={{ color: 'var(--red)' }}>{errorMsg}</span>}
          </div>
          {lastDeletedRules && (
            <button
              type="button"
              className="rounded-full border px-3 py-1 font-semibold"
              style={{ borderColor: 'rgba(245,158,11,0.45)', color: '#fbbf24' }}
              onClick={undoDeleteRule}
            >
              Undo delete: {lastDeletedRules.label}
            </button>
          )}
        </div>
      </div>

      {/* Validation - Inside main card */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="card p-4 space-y-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Validation & Rule Conflicts</p>
          {validation.errors.length > 0 && (
            <div className="rounded-xl border p-2 text-xs space-y-1" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
              <p style={{ color: 'var(--red)', fontWeight: 700 }}>Errors ({validation.errors.length})</p>
              {validation.errors.map((error) => <p key={error} style={{ color: 'var(--text)' }}>{error}</p>)}
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded-xl border p-2 text-xs space-y-1" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)' }}>
              <p style={{ color: 'var(--orange)', fontWeight: 700 }}>Warnings ({validation.warnings.length})</p>
              {validation.warnings.map((warning) => <p key={warning} style={{ color: 'var(--text)' }}>{warning}</p>)}
            </div>
          )}
          {fieldIssues.length > 0 && (
            <div className="rounded-xl border p-2 text-xs space-y-1" style={{ borderColor: 'rgba(36,132,235,0.35)', background: 'rgba(36,132,235,0.08)' }}>
              <p style={{ color: 'var(--brand)', fontWeight: 700 }}>Jump to field ({fieldIssues.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {fieldIssues.map(([fieldKey, message]) => (
                  <button
                    key={fieldKey}
                    type="button"
                    onClick={() => focusFieldByKey(fieldKey)}
                    className="rounded-full border px-2 py-0.5"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    {fieldKey.endsWith('-prefix')
                      ? 'Prefix'
                      : fieldKey.endsWith('-priority')
                      ? 'Priority'
                      : fieldKey.endsWith('-description')
                      ? 'Description'
                      : fieldKey.endsWith('-category')
                      ? 'Category'
                      : 'Field'}
                    : {message}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="space-y-3">
          <div className="card p-4">
            <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text)' }}>Add Prefix Rule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Category</p>
                <select
                  className="w-full rounded-xl border px-3 py-2 text-sm h-9"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={newRule.category}
                  onChange={(event) => setNewRule({ ...newRule, category: event.target.value as CallCategory })}
                >
                  {CATEGORIES.filter((category) => category !== 'unclassified').map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Prefix</p>
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm h-9 font-mono"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={newRule.prefix ?? ''}
                  onChange={(event) => setNewRule({ ...newRule, prefix: event.target.value })}
                  placeholder="e.g. 09"
                />
              </div>
              <div className="md:col-span-2">
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Description</p>
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm h-9"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={newRule.description ?? ''}
                  onChange={(event) => setNewRule({ ...newRule, description: event.target.value })}
                  placeholder="e.g. Mobile calls"
                />
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Priority</p>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="w-full rounded-xl border px-3 py-2 text-sm h-9"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={newRule.priority ?? 50}
                  onChange={(event) => setNewRule({ ...newRule, priority: Math.floor(toFiniteNumber(event.target.value, 50)) })}
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="w-full rounded-2xl bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
                  onClick={addRule}
                >
                  + Add
                </button>
              </div>
            </div>
            {duplicateWarning && (
              <p className="mt-2 text-xs" style={{ color: 'var(--orange)' }}>⚠️ {duplicateWarning}</p>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="card p-4" style={{ height: 'clamp(420px, calc(70vh - 24px), 860px)', display: 'flex', flexDirection: 'column' }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2" style={{ flexShrink: 0 }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                  Rules are matched by priority (asc), then prefix length (desc). Showing {filteredRules.length} of {sortedRules.length}.
                </p>
                <div className="flex gap-2 items-center">
                  <input
                    className="w-full max-w-xs rounded-xl border px-3 py-2 text-sm h-9"
                    style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    placeholder="Search rules..."
                    value={ruleFilter}
                    onChange={(event) => setRuleFilter(event.target.value)}
                  />
                  <button className="rounded-2xl border px-3 py-2 text-xs h-9 font-semibold whitespace-nowrap" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={selectAllVisible}>Select Filtered</button>
                </div>
              </div>

              {/* Bulk Action Toolbar */}
              {selectedRuleIds.size > 0 && (
                <div className="mb-3 p-3 rounded-xl border flex items-center justify-between" style={{ borderColor: 'var(--brand)', background: 'rgba(36,132,235,0.1)', flexShrink: 0 }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{selectedRuleIds.size} selected</span>
                  <div className="flex gap-2">
                    <button className="rounded-2xl border px-3 py-1.5 text-xs h-8 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => handleBulkAction('enable')}>Enable</button>
                    <button className="rounded-2xl border px-3 py-1.5 text-xs h-8 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => handleBulkAction('disable')}>Disable</button>
                    <button className="rounded-2xl bg-red-600 px-3 py-1.5 text-xs h-8 font-semibold text-white" onClick={() => handleBulkAction('delete')}>Delete</button>
                    <button className="rounded-2xl border px-3 py-1.5 text-xs h-8 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={clearSelection}>Clear</button>
                  </div>
                </div>
              )}

              <div style={{ overflow: 'auto', flex: 1 }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b sticky top-0 z-[2]" style={{ borderColor: 'var(--border)', background: 'var(--surface-alt)' }}>
                      <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>✓</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Priority</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Category</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Prefix</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Description</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Enabled</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRules.map((rule) => {
                      const shadowed = validation.shadowedRuleIds.has(rule.id);
                      return (
                        <tr key={rule.id} className={`border-b ${!rule.enabled ? 'opacity-55' : ''}`} style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedRuleIds.has(rule.id)}
                              onChange={() => toggleRuleSelection(rule.id)}
                              className="w-4 h-4"
                              style={{ accentColor: 'var(--brand)' }}
                              aria-label={`Select rule ${rule.prefix}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              max={999}
                              id={`rule-${rule.id}-priority`}
                              className="w-20 rounded border px-2 py-1 text-xs h-8 text-center"
                              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                              value={rule.priority}
                              onChange={(event) => updateRule(rule.id, { priority: Math.floor(toFiniteNumber(event.target.value, 1)) })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              id={`rule-${rule.id}-category`}
                              className="rounded border px-2 py-1 text-xs h-8"
                              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                              value={rule.category}
                              onChange={(event) => updateRule(rule.id, { category: event.target.value as CallCategory })}
                            >
                              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              id={`rule-${rule.id}-prefix`}
                              className={`w-24 rounded border px-2 py-1 text-xs h-8 font-mono ${validation.fieldErrors[`rule-${rule.id}-prefix`] ? 'border-red-500' : ''}`}
                              style={{ background: 'var(--surface-alt)', borderColor: validation.fieldErrors[`rule-${rule.id}-prefix`] ? 'var(--red)' : 'var(--border)', color: 'var(--text)' }}
                              value={rule.prefix}
                              onChange={(event) => updateRule(rule.id, { prefix: event.target.value })}
                            />
                            {shadowed && <p className="mt-1 text-[10px]" style={{ color: 'var(--orange)' }}>shadowed</p>}
                            {validation.fieldErrors[`rule-${rule.id}-prefix`] && !shadowed && (
                              <p className="mt-1 text-[10px]" style={{ color: 'var(--red)' }}>{validation.fieldErrors[`rule-${rule.id}-prefix`]}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              id={`rule-${rule.id}-description`}
                              className="w-full min-w-[180px] rounded border px-2 py-1 text-xs h-8"
                              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                              value={rule.description}
                              onChange={(event) => updateRule(rule.id, { description: event.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs transition-colors ${rule.enabled ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-500'}`}
                              aria-pressed={rule.enabled}
                              aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.prefix}`}
                            >
                              {rule.enabled && '✓'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm({ isOpen: true, ruleId: rule.id })}
                              className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRules.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                          No rules found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              className="hidden xl:flex flex-col"
              style={{ height: 'clamp(420px, calc(70vh - 24px), 860px)' }}
            >
              {renderRatesEditor(true)}
            </div>
          </div>

          <div className="xl:hidden">
            {renderRatesEditor(false)}
          </div>

        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={deleteConfirm.isOpen}
        rule={rulePendingDelete}
        onConfirm={deleteRule}
        onCancel={() => setDeleteConfirm({ isOpen: false })}
      />
      
      {/* Bulk Action Confirmation Modal */}
      <BulkActionModal
        isOpen={bulkActionConfirm.isOpen}
        action={bulkActionConfirm.action}
        count={selectedRuleIds.size}
        onConfirm={confirmBulkAction}
        onCancel={() => setBulkActionConfirm({ isOpen: false })}
      />
      
      <ImpactAnalysisModal
        target={showImpactFor}
        proposedRate={proposedRate}
        onProposedRateChange={setProposedRate}
        onAnalyze={() => {
          if (!showImpactFor) return;
          void analyzeImpact(showImpactFor.category, showImpactFor.currentRate, parseFloat(proposedRate));
        }}
        analyzing={analyzingImpact}
        impactAnalysis={impactAnalysis}
        onClose={() => setShowImpactFor(null)}
      />
    </>
  );
}
