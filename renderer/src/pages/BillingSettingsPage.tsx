import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { BillingConfig, CallBilling, CallCategory, DEFAULT_BILLING_CONFIG, PrefixRule, RateConfig, RateTier } from '../../../shared/types';
import { api } from '../lib/api';

const CATEGORIES: CallCategory[] = ['local', 'national', 'mobile', 'international', 'unclassified'];
const CURRENCY_OPTIONS = ['PHP', 'USD'] as const;
type SupportedCurrency = (typeof CURRENCY_OPTIONS)[number];

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
}

function Badge({ cat }: { cat: CallCategory }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${CATEGORY_STYLE[cat]}`}>
      {cat}
    </span>
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

function validateBillingConfig(config: BillingConfig): BillingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shadowedRuleIds = new Set<string>();

  const duplicatePrefixMap = new Map<string, PrefixRule[]>();
  const ruleIdSet = new Set<string>();
  config.prefixRules.forEach((rule, index) => {
    const prefix = rule.prefix.trim();
    if (!rule.id) errors.push(`Rule #${index + 1}: missing id`);
    if (rule.id && ruleIdSet.has(rule.id)) errors.push(`Rule #${index + 1}: duplicate id "${rule.id}"`);
    if (rule.id) ruleIdSet.add(rule.id);
    if (!prefix) errors.push(`Rule #${index + 1}: prefix is required`);
    if (prefix.length > 8) errors.push(`Rule #${index + 1}: prefix must be 8 chars or fewer`);
    if (prefix && !/^[+0-9*#]+$/.test(prefix)) errors.push(`Rule #${index + 1}: invalid prefix "${prefix}"`);
    if (rule.priority < 1 || rule.priority > 999) errors.push(`Rule #${index + 1}: priority must be 1-999`);
    if ((rule.description ?? '').length > 100) errors.push(`Rule #${index + 1}: description must be <= 100 chars`);

    if (!duplicatePrefixMap.has(prefix)) duplicatePrefixMap.set(prefix, []);
    duplicatePrefixMap.get(prefix)?.push(rule);
  });

  for (const [prefix, rules] of duplicatePrefixMap.entries()) {
    if (!prefix || rules.length <= 1) continue;
    warnings.push(`Duplicate prefix "${prefix}" appears ${rules.length} times`);
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

  return { errors, warnings, shadowedRuleIds };
}

export function BillingSettingsPage() {
  const [serverConfig, setServerConfig] = useState<BillingConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<BillingConfig | null>(null);
  const [tab, setTab] = useState<'prefixes' | 'rates' | 'test'>('prefixes');
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
    try {
      const loaded = sanitizeBillingConfig((await api.getBillingConfig()) as BillingConfig);
      setServerConfig(loaded);
      setDraftConfig(cloneConfig(loaded));
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(`Failed to load billing config: ${formatRuntimeError(error)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, [load]);

  const hasUnsavedChanges = useMemo(() => {
    if (!serverConfig || !draftConfig) return false;
    return JSON.stringify(serverConfig) !== JSON.stringify(draftConfig);
  }, [draftConfig, serverConfig]);

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
    if (!draftConfig) return { errors: [], warnings: [], shadowedRuleIds: new Set<string>() };
    return validateBillingConfig(draftConfig);
  }, [draftConfig]);

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
      return updater(current);
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
    flashStatus('Changes reverted');
  };

  const addRule = () => {
    if (!draftConfig) return;
    const prefix = (newRule.prefix ?? '').trim();
    if (!prefix) {
      flashStatus('Prefix is required to add a rule.', true);
      return;
    }
    const category = (newRule.category ?? 'mobile') as CallCategory;
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
  };

  const updateRule = (ruleId: string, patch: Partial<PrefixRule>) => {
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: cfg.prefixRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    }));
  };

  const deleteRule = (ruleId: string) => {
    patchDraft((cfg) => ({
      ...cfg,
      prefixRules: cfg.prefixRules.filter((rule) => rule.id !== ruleId)
    }));
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

  const formatCurrency = (value: number, currency = 'PHP') =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: currency || 'PHP',
      minimumFractionDigits: 2
    }).format(value || 0);

  if (!draftConfig) {
    return <div className="card p-4" style={{ color: 'var(--muted)' }}>Loading billing config...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Billing & Rating</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Configure classification prefixes, rates, multipliers, and tiered pricing.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted2)' }}>
              Last saved: {serverConfig?.updatedAt ? dayjs(serverConfig.updatedAt).format('YYYY-MM-DD HH:mm:ss') : 'n/a'}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>
              Billing Enabled
              <button
                type="button"
                onClick={() => patchDraft((cfg) => ({ ...cfg, enabled: !cfg.enabled }))}
                className={`ml-2 inline-flex h-5 w-10 items-center rounded-full transition ${draftConfig.enabled ? 'bg-brand-600' : 'bg-gray-600'}`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition ${draftConfig.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>
            <label className="text-xs" style={{ color: 'var(--muted)' }}>
              Default Currency
              <select
                className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                value={draftConfig.currency}
                onChange={(event) => patchDraft((cfg) => ({ ...cfg, currency: normalizeCurrency(event.target.value) }))}
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
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
      </div>

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
        </div>
      )}

      <div className="flex gap-1">
        {(['prefixes', 'rates', 'test'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold capitalize transition ${tab === item ? 'bg-brand-600 text-white' : 'card border'}`}
            style={tab === item ? undefined : { borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {item === 'prefixes' ? 'Prefix Rules' : item === 'rates' ? 'Rates' : 'Test Number'}
          </button>
        ))}
      </div>

      {tab === 'prefixes' && (
        <div className="space-y-3">
          <div className="card p-4">
            <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text)' }}>Add Prefix Rule</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Category</p>
                <select
                  className="w-full rounded-xl border px-2 py-1.5 text-sm"
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
                  className="w-full rounded-xl border px-2 py-1.5 text-sm font-mono"
                  style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={newRule.prefix ?? ''}
                  onChange={(event) => setNewRule({ ...newRule, prefix: event.target.value })}
                  placeholder="e.g. 09"
                />
              </div>
              <div className="md:col-span-2">
                <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Description</p>
                <input
                  className="w-full rounded-xl border px-2 py-1.5 text-sm"
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
                  className="w-full rounded-xl border px-2 py-1.5 text-sm"
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
          </div>

          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                Rules are matched by priority (asc), then prefix length (desc).
              </p>
              <input
                className="w-full max-w-xs rounded-xl border px-2 py-1.5 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                placeholder="Search rules..."
                value={ruleFilter}
                onChange={(event) => setRuleFilter(event.target.value)}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {['Priority', 'Category', 'Prefix', 'Description', 'Enabled', ''].map((header) => (
                      <th key={header} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map((rule) => {
                    const shadowed = validation.shadowedRuleIds.has(rule.id);
                    return (
                      <tr key={rule.id} className={`border-b ${!rule.enabled ? 'opacity-55' : ''}`} style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            max={999}
                            className="w-20 rounded border px-1 py-0.5 text-xs text-right"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            value={rule.priority}
                            onChange={(event) => updateRule(rule.id, { priority: Math.floor(toFiniteNumber(event.target.value, 1)) })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="rounded border px-1.5 py-0.5 text-xs"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            value={rule.category}
                            onChange={(event) => updateRule(rule.id, { category: event.target.value as CallCategory })}
                          >
                            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-24 rounded border px-1.5 py-0.5 text-xs font-mono"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            value={rule.prefix}
                            onChange={(event) => updateRule(rule.id, { prefix: event.target.value })}
                          />
                          {shadowed && <p className="mt-1 text-[10px]" style={{ color: 'var(--orange)' }}>shadowed</p>}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full min-w-[180px] rounded border px-1.5 py-0.5 text-xs"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            value={rule.description}
                            onChange={(event) => updateRule(rule.id, { description: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs transition-colors ${rule.enabled ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-500'}`}
                          >
                            {rule.enabled && '✓'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => deleteRule(rule.id)} className="text-xs text-rose-400 hover:text-rose-300">
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRules.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                        No rules found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {tab === 'rates' && (
        <div className="space-y-3">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  {['Category', 'Rate / Min', 'Min Blocks', 'Block Size', 'Weekend x', 'Holiday x', 'Currency', 'Tiers'].map((header) => (
                    <th key={header} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftConfig.rates.map((rate) => (
                  <>
                    <tr key={rate.category} className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2"><Badge cat={rate.category} /></td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-24 rounded border px-2 py-1 text-xs text-right"
                          style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                          value={rate.ratePerMinute}
                          onChange={(event) => updateRateField(rate.category, 'ratePerMinute', toFiniteNumber(event.target.value, 0))}
                          disabled={rate.category === 'unclassified'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          className="w-20 rounded border px-2 py-1 text-xs text-right"
                          style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                          value={rate.minimumCharge}
                          onChange={(event) => updateRateField(rate.category, 'minimumCharge', Math.floor(toFiniteNumber(event.target.value, 0)))}
                          disabled={rate.category === 'unclassified'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="rounded border px-2 py-1 text-xs"
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
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-20 rounded border px-2 py-1 text-xs text-right"
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
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-20 rounded border px-2 py-1 text-xs text-right"
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
                      <td className="px-3 py-2">
                        <select
                          className="w-20 rounded border px-2 py-1 text-xs"
                          style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                          value={rate.currency}
                          onChange={(event) => updateRateField(rate.category, 'currency', normalizeCurrency(event.target.value))}
                        >
                          {CURRENCY_OPTIONS.map((currency) => (
                            <option key={currency} value={currency}>{currency}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                          onClick={() => setExpandedTierCategory(expandedTierCategory === rate.category ? null : rate.category)}
                        >
                          {expandedTierCategory === rate.category ? 'Hide' : 'Edit'} ({rate.tiers?.length ?? 0})
                        </button>
                      </td>
                    </tr>
                    {expandedTierCategory === rate.category && (
                      <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                        <td colSpan={8} className="px-3 py-3">
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-2xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!hasUnsavedChanges || saving}
              onClick={() => {
                void saveCurrent();
              }}
            >
              {saving ? 'Saving...' : 'Save Rates & Multipliers'}
            </button>
          </div>
        </div>
      )}

      {tab === 'test' && (
        <div className="card p-4 max-w-md space-y-3">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Test number classification and pricing with date/holiday inputs.
          </p>
          <label className="text-xs block" style={{ color: 'var(--text)' }}>
            Phone Number
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 font-mono text-sm"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              placeholder="e.g. 09171234567"
              value={testNum}
              onChange={(event) => setTestNum(event.target.value)}
            />
          </label>
          <label className="text-xs block" style={{ color: 'var(--text)' }}>
            Duration (seconds)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={testDur}
              onChange={(event) => setTestDur(Math.max(1, Math.floor(toFiniteNumber(event.target.value, 1))))}
            />
          </label>
          <label className="text-xs block" style={{ color: 'var(--text)' }}>
            Call Date
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              value={testCallDate}
              onChange={(event) => setTestCallDate(event.target.value)}
            />
          </label>
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
            className="rounded-2xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Run Test'}
          </button>
          {testError && <p className="text-xs" style={{ color: 'var(--red)' }}>{testError}</p>}
          {testResult && (
            <div className="rounded-2xl border p-3 space-y-1.5" style={{ borderColor: 'var(--border)' }}>
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
      )}
    </div>
  );
}
