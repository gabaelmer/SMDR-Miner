import { describe, expect, it, beforeEach } from 'vitest';
import { BillingEngine } from '../../backend/billing/BillingEngine';
import { BillingConfig, DEFAULT_BILLING_CONFIG } from '../../shared/types';

describe('BillingEngine', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine({ ...DEFAULT_BILLING_CONFIG, updatedAt: new Date().toISOString() });
  });

  // ─── Classification Tests ──────────────────────────────────────────────────

  describe('classifyNumber', () => {
    it('classifies PH mobile number correctly', () => {
      const result = engine.classifyNumber('09171234567');
      expect(result.category).toBe('mobile');
      expect(result.matchedPrefix).toBe('09');
    });

    it('classifies international number with 00 prefix', () => {
      const result = engine.classifyNumber('001234567890');
      expect(result.category).toBe('international');
      expect(result.matchedPrefix).toBe('00');
    });

    it('classifies international number with + prefix', () => {
      const result = engine.classifyNumber('+1234567890');
      expect(result.category).toBe('international');
      expect(result.matchedPrefix).toBe('+');
    });

    it('classifies Metro Manila number', () => {
      const result = engine.classifyNumber('0212345678');
      expect(result.category).toBe('national');
      expect(result.matchedPrefix).toBe('02');
    });

    it('classifies local number with single 0', () => {
      const result = engine.classifyNumber('01234');
      expect(result.category).toBe('local');
      expect(result.matchedPrefix).toBe('0');
    });

    it('returns unclassified for unknown prefix', () => {
      const result = engine.classifyNumber('9991234567');
      expect(result.category).toBe('unclassified');
      expect(result.matchedPrefix).toBe(null);
    });

    it('handles empty number', () => {
      const result = engine.classifyNumber('');
      expect(result.category).toBe('unclassified');
      expect(result.matchedPrefix).toBe(null);
    });

    it('prioritizes longer prefixes with same priority', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        prefixRules: [
          { id: '1', category: 'national', prefix: '0', description: 'National', enabled: true, priority: 10 },
          { id: '2', category: 'mobile', prefix: '09', description: 'Mobile', enabled: true, priority: 10 },
        ]
      };
      engine.updateConfig(config);
      
      const result = engine.classifyNumber('09171234567');
      expect(result.category).toBe('mobile'); // Longer prefix wins
      expect(result.matchedPrefix).toBe('09');
    });
  });

  // ─── Rating Tests ──────────────────────────────────────────────────────────

  describe('rateCall', () => {
    it('calculates cost with 60-second blocks', () => {
      const billing = engine.rateCall('09171234567', 125); // 2min 5sec
      expect(billing.billableUnits).toBe(3); // ceil(125/60)
      // Cost = billableUnits × ratePerMinute (for 60s blocks, 1 block = 1 min)
      expect(billing.cost).toBeCloseTo(16.5, 4); // 3 * 5.50
    });

    it('applies minimum charge', () => {
      const billing = engine.rateCall('09171234567', 10); // 10 seconds
      expect(billing.billableUnits).toBe(1); // minimum charge
      expect(billing.cost).toBeCloseTo(5.50, 4); // 1 * 5.50
    });

    it('calculates local call cost', () => {
      const billing = engine.rateCall('01234', 300); // 5 minutes
      expect(billing.category).toBe('local');
      expect(billing.cost).toBeCloseTo(5, 4); // 5 * 1.00
    });

    it('calculates national call cost', () => {
      const billing = engine.rateCall('0212345678', 600); // 10 minutes
      expect(billing.category).toBe('national');
      expect(billing.cost).toBeCloseTo(30, 4); // 10 * 3.00
    });

    it('calculates international call cost', () => {
      const billing = engine.rateCall('001234567890', 180); // 3 minutes
      expect(billing.category).toBe('international');
      expect(billing.cost).toBeCloseTo(75, 4); // 3 * 25.00
    });

    it('handles zero duration', () => {
      const billing = engine.rateCall('09171234567', 0);
      expect(billing.billableUnits).toBe(0);
      expect(billing.cost).toBe(0);
    });

    it('returns zero tax and preserves total cost', () => {
      const billing = engine.rateCall('09171234567', 60); // 1 minute
      expect(billing.taxAmount).toBeDefined();
      expect(billing.totalWithTax).toBeDefined();
      expect(billing.taxAmount).toBe(0);
      expect(billing.totalWithTax).toBe(billing.cost);
      expect(billing.baseCost).toBeDefined();
      expect(billing.appliedMultiplier).toBeDefined();
    });

    it('applies weekend multiplier', () => {
      const billing = engine.rateCall('09171234567', 60, { callDate: '2026-02-21' }); // Saturday
      expect(billing.ratePerMinute).toBeCloseTo(2.75, 4); // 5.50 * 0.5
    });

    it('does not apply weekend multiplier on weekday', () => {
      const billing = engine.rateCall('09171234567', 60, { callDate: '2026-02-23' }); // Monday
      expect(billing.ratePerMinute).toBeCloseTo(5.50, 4);
    });
  });

  // ─── Tiered Pricing Tests ──────────────────────────────────────────────────

  describe('tiered pricing', () => {
    it('applies tiered rates when configured', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        rates: [
          {
            category: 'mobile',
            ratePerMinute: 5.50,
            minimumCharge: 1,
            blockSize: 60,
            currency: 'PHP',
            tiers: [
              { minMinutes: 0, maxMinutes: 10, ratePerMinute: 5.50 },
              { minMinutes: 10, maxMinutes: 60, ratePerMinute: 4.50 },
              { minMinutes: 60, ratePerMinute: 3.50 },
            ]
          },
          ...DEFAULT_BILLING_CONFIG.rates.filter(r => r.category !== 'mobile')
        ]
      };
      engine.updateConfig(config);

      const billing = engine.rateCall('09171234567', 1200); // 20 minutes
      expect(billing.category).toBe('mobile');
      // First 10 min at 5.50, next 10 min at 4.50
      expect(billing.billableUnits).toBe(20);
      expect(billing.cost).toBeCloseTo(100, 4);
    });
  });

  // ─── Tax Calculation Tests ─────────────────────────────────────────────────

  describe('tax calculation', () => {
    it('ignores configured tax rate and keeps zero tax', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        taxRate: 0.12 // 12% VAT
      };
      engine.updateConfig(config);

      const billing = engine.rateCall('09171234567', 60); // 1 minute
      expect(billing.taxAmount).toBe(0);
      expect(billing.totalWithTax).toBe(billing.cost);
    });

    it('handles zero tax rate', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        taxRate: 0
      };
      engine.updateConfig(config);

      const billing = engine.rateCall('09171234567', 60);
      expect(billing.taxAmount).toBe(0);
      expect(billing.totalWithTax).toBe(billing.cost);
    });
  });

  // ─── Time-based Rate Tests ─────────────────────────────────────────────────

  describe('time-based rates', () => {
    it('applies holiday multiplier when isHoliday is true', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        rates: DEFAULT_BILLING_CONFIG.rates.map(r => ({
          ...r,
          holidayMultiplier: 0.3 // 70% discount on holidays
        }))
      };
      engine.updateConfig(config);

      const billing = engine.rateCall('09171234567', 60, { 
        callDate: '2026-12-25', 
        isHoliday: true 
      });
      
      expect(billing.ratePerMinute).toBeCloseTo(1.65, 4); // 5.50 * 0.3
    });

    it('holiday multiplier takes precedence over weekend', () => {
      const config: BillingConfig = {
        ...DEFAULT_BILLING_CONFIG,
        rates: DEFAULT_BILLING_CONFIG.rates.map(r => ({
          ...r,
          weekendMultiplier: 0.5,
          holidayMultiplier: 0.3
        }))
      };
      engine.updateConfig(config);

      // Christmas on Saturday
      const billing = engine.rateCall('09171234567', 60, { 
        callDate: '2026-12-25', 
        isHoliday: true 
      });
      
      expect(billing.ratePerMinute).toBeCloseTo(1.65, 4); // Holiday rate, not weekend
    });
  });

  // ─── Helper Method Tests ───────────────────────────────────────────────────

  describe('getEffectiveRate', () => {
    it('returns base rate without date', () => {
      const rate = engine.getEffectiveRate('mobile');
      expect(rate).toBe(5.50);
    });

    it('returns adjusted rate for weekend', () => {
      const rate = engine.getEffectiveRate('mobile', { callDate: '2026-02-21' });
      expect(rate).toBeCloseTo(2.75, 4);
    });
  });

  describe('calcTax', () => {
    it('calculates tax amount', () => {
      const tax = engine.calcTax(100);
      expect(tax).toBe(0);
    });
  });
});
