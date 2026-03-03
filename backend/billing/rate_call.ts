import { ParsedCallRecord } from '../parser/parseSmdrRecord';

export type BillingType = 'outgoing' | 'incoming' | 'internal';

export interface RatePolicy {
  rate_per_minute?: number;
  rate_per_second?: number;
  minimum_billable_seconds?: number;
  increment_seconds?: number;
}

export interface RateRule extends RatePolicy {
  id?: string;
  billing_type?: BillingType;
  trunk?: string;
  destination_prefix?: string;
}

export interface RateTable extends RatePolicy {
  free_internal?: boolean;
  defaults?: Partial<Record<BillingType, RatePolicy>>;
  trunk_rates?: Record<string, RatePolicy>;
  prefix_rates?: Record<string, RatePolicy>;
  rules?: RateRule[];
}

export interface RatedCallResult {
  billable_seconds: number;
  rate_applied: number;
  total_cost: number;
  billing_type: BillingType;
}

function normalizeToken(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

function isTrunk(value?: string | null): boolean {
  return /^[TX]\d{1,4}$/i.test((value ?? '').trim());
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function determineBillingType(parsedRecord: ParsedCallRecord): BillingType {
  const calling = normalizeToken(parsedRecord.calling_party);
  const called = normalizeToken(parsedRecord.called_party);
  const hasDigitsDialed = Boolean((parsedRecord.digits_dialed ?? '').trim());

  if (!isTrunk(calling) && !isTrunk(called) && !hasDigitsDialed) {
    return 'internal';
  }
  if (isTrunk(calling) && !isTrunk(called)) {
    return 'incoming';
  }
  if (!isTrunk(calling) && (isTrunk(called) || hasDigitsDialed)) {
    return 'outgoing';
  }
  if (isTrunk(calling) && isTrunk(called)) {
    return hasDigitsDialed ? 'incoming' : 'outgoing';
  }
  return 'outgoing';
}

function selectTrunkToken(parsedRecord: ParsedCallRecord): string | null {
  if (isTrunk(parsedRecord.calling_party)) return normalizeToken(parsedRecord.calling_party);
  if (isTrunk(parsedRecord.called_party)) return normalizeToken(parsedRecord.called_party);
  return null;
}

function pickBestPrefixPolicy(destination: string, prefixRates?: Record<string, RatePolicy>): RatePolicy | undefined {
  if (!prefixRates || !destination) return undefined;
  let bestPrefix = '';
  let bestPolicy: RatePolicy | undefined;

  for (const [prefix, policy] of Object.entries(prefixRates)) {
    if (!prefix) continue;
    if (destination.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestPolicy = policy;
    }
  }

  return bestPolicy;
}

function pickBestRule(
  parsedRecord: ParsedCallRecord,
  billingType: BillingType,
  destination: string,
  trunkToken: string | null,
  rules?: RateRule[]
): RateRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  let bestScore = -1;
  let bestRule: RateRule | undefined;

  for (const rule of rules) {
    if (rule.billing_type && rule.billing_type !== billingType) continue;
    if (rule.trunk && normalizeToken(rule.trunk) !== trunkToken) continue;
    if (rule.destination_prefix && !destination.startsWith(rule.destination_prefix)) continue;

    const score =
      (rule.trunk ? 1_000 : 0) +
      (rule.destination_prefix ? rule.destination_prefix.length * 10 : 0) +
      (rule.billing_type ? 5 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  return bestRule;
}

function computeBillableSeconds(durationSeconds: number, policy: RatePolicy): number {
  const safeDuration = Math.max(0, Math.floor(durationSeconds));
  const minimum = Math.max(0, Math.floor(policy.minimum_billable_seconds ?? 0));
  const billedBase = Math.max(safeDuration, minimum);

  const increment = Math.max(
    1,
    Math.floor(policy.increment_seconds ?? (policy.rate_per_second !== undefined ? 1 : 60))
  );

  return Math.ceil(billedBase / increment) * increment;
}

export function rate_call(parsed_record: ParsedCallRecord, rate_table: RateTable): RatedCallResult {
  const billingType = determineBillingType(parsed_record);
  if (billingType === 'internal' && rate_table.free_internal !== false) {
    return {
      billable_seconds: 0,
      rate_applied: 0,
      total_cost: 0,
      billing_type: 'internal'
    };
  }

  const destination = (parsed_record.digits_dialed ?? parsed_record.called_party ?? '').trim();
  const trunkToken = selectTrunkToken(parsed_record);

  const matchedRule = pickBestRule(parsed_record, billingType, destination, trunkToken, rate_table.rules);
  const matchedTrunkPolicy = trunkToken ? rate_table.trunk_rates?.[trunkToken] : undefined;
  const matchedPrefixPolicy = pickBestPrefixPolicy(destination, rate_table.prefix_rates);
  const defaultPolicy = rate_table.defaults?.[billingType];

  const policy: RatePolicy = {
    ...rate_table,
    ...defaultPolicy,
    ...matchedPrefixPolicy,
    ...matchedTrunkPolicy,
    ...matchedRule
  };

  const durationSeconds = Math.max(0, Math.floor(parsed_record.duration_seconds ?? 0));
  const billableSeconds = computeBillableSeconds(durationSeconds, policy);

  const ratePerSecond = policy.rate_per_second;
  const ratePerMinute = policy.rate_per_minute ?? 0;

  const totalCost = ratePerSecond !== undefined
    ? billableSeconds * ratePerSecond
    : (billableSeconds / 60) * ratePerMinute;

  return {
    billable_seconds: billableSeconds,
    rate_applied: ratePerSecond !== undefined ? ratePerSecond : ratePerMinute,
    total_cost: roundCurrency(totalCost),
    billing_type: billingType
  };
}
