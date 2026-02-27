// ─────────────────────────────────────────────────────────────────────────────
//  backend/billing/BillingEngine.ts
//  Core call rating / billing logic with tiered pricing, time-based rates, and tax
// ─────────────────────────────────────────────────────────────────────────────

import {
  BillingConfig,
  CallBilling,
  CallCategory,
  RateConfig,
  DEFAULT_BILLING_CONFIG,
} from '../../shared/types';
import { isWeekend } from '../../shared/utils/time.js';

export interface BillingOptions {
  callDate?: string;
  isHoliday?: boolean;
}

export class BillingEngine {
  private config: BillingConfig;

  constructor(config?: BillingConfig) {
    this.config = config ?? { ...DEFAULT_BILLING_CONFIG, updatedAt: new Date().toISOString() };
  }

  updateConfig(config: BillingConfig): void {
    this.config = { ...config, updatedAt: new Date().toISOString() };
  }

  getConfig(): BillingConfig {
    return this.config;
  }

  // ── Classification ──────────────────────────────────────────────────────────

  classifyNumber(dialledNumber: string): { category: CallCategory; matchedPrefix: string | null } {
    if (!dialledNumber || !this.config.enabled) {
      return { category: 'unclassified', matchedPrefix: null };
    }

    const clean = dialledNumber.trim();

    // Sort by priority asc, then prefix length desc (longer = more specific wins ties)
    const sorted = [...this.config.prefixRules]
      .filter((r) => r.enabled)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.prefix.length - a.prefix.length;
      });

    for (const rule of sorted) {
      if (clean.startsWith(rule.prefix)) {
        return { category: rule.category, matchedPrefix: rule.prefix };
      }
    }

    return { category: 'unclassified', matchedPrefix: null };
  }

  // ── Rating ──────────────────────────────────────────────────────────────────

  rateCall(
    dialledNumber: string,
    durationSeconds: number,
    options?: BillingOptions
  ): CallBilling {
    const { category, matchedPrefix } = this.classifyNumber(dialledNumber);
    const rate = this.getRateForCategory(category);
    const ratedAmount = this.calcRatedAmount(durationSeconds, rate);
    
    // Apply time-based multipliers
    const multiplier = this.getTimeMultiplier(rate, options);
    
    // Calculate billable amount before tax.
    const billableUnits = ratedAmount.billableUnits;
    const baseCost = ratedAmount.baseCost;
    
    // Apply time multiplier
    const adjustedCost = baseCost * multiplier;
    
    // Apply tax
    const taxAmount = 0;
    const totalWithTax = adjustedCost;

    return {
      category,
      matchedPrefix,
      durationSeconds,
      billableUnits,
      ratePerMinute: ratedAmount.effectiveRatePerMinute * multiplier,
      cost: Math.round(adjustedCost * 10000) / 10000,
      currency: rate.currency || this.config.currency,
      baseCost: Math.round(baseCost * 10000) / 10000,
      appliedMultiplier: multiplier,
      taxAmount: Math.round(taxAmount * 10000) / 10000,
      totalWithTax: Math.round(totalWithTax * 10000) / 10000,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private getTimeMultiplier(rate: RateConfig, options?: BillingOptions): number {
    if (!options?.callDate) return 1;

    const callDate = new Date(options.callDate);
    
    // Check for holiday first (highest priority)
    if (options.isHoliday && rate.holidayMultiplier !== undefined) {
      return rate.holidayMultiplier;
    }
    
    // Check for weekend
    if (isWeekend(callDate) && rate.weekendMultiplier !== undefined) {
      return rate.weekendMultiplier;
    }

    return 1;
  }

  private getRateForCategory(category: CallCategory): RateConfig {
    return (
      this.config.rates.find((r) => r.category === category) ??
      this.config.rates.find((r) => r.category === 'unclassified') ?? {
        category: 'unclassified',
        ratePerMinute: 0,
        minimumCharge: 0,
        blockSize: 60,
        currency: this.config.currency,
      }
    );
  }

  private calcRatedAmount(
    durationSeconds: number,
    rate: RateConfig
  ): { billableUnits: number; baseCost: number; effectiveRatePerMinute: number } {
    if (durationSeconds <= 0) {
      return {
        billableUnits: 0,
        baseCost: 0,
        effectiveRatePerMinute: rate.ratePerMinute
      };
    }

    if (rate.tiers && rate.tiers.length > 0) {
      return this.calcTieredCharge(durationSeconds, rate);
    }

    const billableUnits = this.calcUnits(durationSeconds, rate);
    const baseCost = this.calcCost(billableUnits, rate.ratePerMinute, rate.blockSize);
    const blocksPerMinute = 60 / rate.blockSize;
    const effectiveRatePerMinute =
      billableUnits > 0 ? (baseCost / billableUnits) * blocksPerMinute : rate.ratePerMinute;

    return {
      billableUnits,
      baseCost: Math.round(baseCost * 10000) / 10000,
      effectiveRatePerMinute: Math.round(effectiveRatePerMinute * 10000) / 10000
    };
  }

  private calcUnits(durationSeconds: number, rate: RateConfig): number {
    if (durationSeconds <= 0) return 0;

    // Simple block-based billing
    const raw = Math.ceil(durationSeconds / rate.blockSize);
    return Math.max(raw, rate.minimumCharge);
  }

  private calcTieredCharge(
    durationSeconds: number,
    rate: RateConfig
  ): { billableUnits: number; baseCost: number; effectiveRatePerMinute: number } {
    const totalMinutes = Math.ceil(durationSeconds / 60);
    let totalUnits = 0;
    let totalCost = 0;
    let remainingMinutes = totalMinutes;
    let cursor = 0;

    // Sort tiers by minMinutes ascending.
    const sortedTiers = [...rate.tiers!].sort((a, b) => a.minMinutes - b.minMinutes);

    for (const tier of sortedTiers) {
      if (remainingMinutes <= 0) break;

      const tierStart = Math.max(0, tier.minMinutes);
      const tierEnd = tier.maxMinutes !== undefined ? Math.max(tier.maxMinutes, tierStart) : Number.POSITIVE_INFINITY;

      if (cursor < tierStart) {
        const gapMinutes = Math.min(remainingMinutes, tierStart - cursor);
        if (gapMinutes > 0) {
          const gapUnits = Math.ceil((gapMinutes * 60) / rate.blockSize);
          totalUnits += gapUnits;
          totalCost += this.calcCost(gapUnits, rate.ratePerMinute, rate.blockSize);
          cursor += gapMinutes;
          remainingMinutes -= gapMinutes;
        }
      }

      if (remainingMinutes <= 0) break;

      const tierMinutes = Math.min(remainingMinutes, Math.max(0, tierEnd - cursor));
      if (tierMinutes > 0) {
        const tierUnits = Math.ceil((tierMinutes * 60) / rate.blockSize);
        totalUnits += tierUnits;
        totalCost += this.calcCost(tierUnits, tier.ratePerMinute, rate.blockSize);
        cursor += tierMinutes;
        remainingMinutes -= tierMinutes;
      }
    }

    if (remainingMinutes > 0) {
      const tailRate = sortedTiers[sortedTiers.length - 1]?.ratePerMinute ?? rate.ratePerMinute;
      const tailUnits = Math.ceil((remainingMinutes * 60) / rate.blockSize);
      totalUnits += tailUnits;
      totalCost += this.calcCost(tailUnits, tailRate, rate.blockSize);
    }

    if (totalUnits < rate.minimumCharge) {
      const addlUnits = rate.minimumCharge - totalUnits;
      totalUnits = rate.minimumCharge;
      totalCost += this.calcCost(addlUnits, rate.ratePerMinute, rate.blockSize);
    }

    const blocksPerMinute = 60 / rate.blockSize;
    const effectiveRatePerMinute =
      totalUnits > 0 ? (totalCost / totalUnits) * blocksPerMinute : rate.ratePerMinute;

    return {
      billableUnits: totalUnits,
      baseCost: Math.round(totalCost * 10000) / 10000,
      effectiveRatePerMinute: Math.round(effectiveRatePerMinute * 10000) / 10000
    };
  }

  /**
   * cost = billableUnits × (ratePerMinute / blocksPerMinute)
   * e.g. blockSize=60 → 1 block/min → ratePerBlock = ratePerMinute
   *      blockSize=6  → 10 blocks/min → ratePerBlock = ratePerMinute / 10
   */
  private calcCost(units: number, ratePerMinute: number, blockSize: number): number {
    if (units <= 0 || ratePerMinute <= 0) return 0;
    const blocksPerMinute = 60 / blockSize;
    const ratePerBlock = ratePerMinute / blocksPerMinute;
    return Math.round(units * ratePerBlock * 10000) / 10000;
  }

  /**
   * Calculate tax amount separately for reporting
   */
  calcTax(baseCost: number): number {
    void baseCost;
    return 0;
  }

  /**
   * Get the effective rate considering time multipliers
   */
  getEffectiveRate(category: CallCategory, options?: BillingOptions): number {
    const rate = this.getRateForCategory(category);
    const multiplier = this.getTimeMultiplier(rate, options);
    return rate.ratePerMinute * multiplier;
  }
}

// Singleton used by DatabaseService and billingRoutes
export const billingEngine = new BillingEngine();
