import { describe, expect, it } from 'vitest';
import {
  billingPrefixRuleCreateSchema,
  billingPrefixRuleUpdateSchema,
  billingReportRequestSchema,
  billingRatesUpdateSchema,
  billingTestRequestSchema
} from '../../shared/validators';

describe('billing validators', () => {
  it('validates prefix rule create payload', () => {
    const result = billingPrefixRuleCreateSchema.safeParse({
      category: 'mobile',
      prefix: '09',
      description: 'Mobile calls',
      enabled: true,
      priority: 10
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty prefix rule updates', () => {
    const result = billingPrefixRuleUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('validates rates update payload shape', () => {
    const result = billingRatesUpdateSchema.safeParse({
      rates: [
        {
          category: 'local',
          ratePerMinute: 1,
          minimumCharge: 1,
          blockSize: 60,
          currency: 'PHP'
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('accepts billing test payload with date and holiday flag', () => {
    const result = billingTestRequestSchema.safeParse({
      number: '09171234567',
      durationSeconds: 120,
      callDate: '2026-02-26',
      isHoliday: true
    });
    expect(result.success).toBe(true);
  });

  it('accepts billing report query with paging and sorting', () => {
    const result = billingReportRequestSchema.safeParse({
      from: '2026-02-01',
      to: '2026-02-26',
      extension: '1001',
      category: 'mobile',
      sortBy: 'duration',
      sortDir: 'asc',
      page: '2',
      pageSize: '50',
      includeAllTopCalls: 'true',
      topCallsLimit: '500'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(50);
      expect(result.data.includeAllTopCalls).toBe(true);
      expect(result.data.topCallsLimit).toBe(500);
    }
  });

  it('rejects billing report query where from is after to', () => {
    const result = billingReportRequestSchema.safeParse({
      from: '2026-02-20',
      to: '2026-02-10'
    });
    expect(result.success).toBe(false);
  });

  it('rejects billing report query with excessive date range', () => {
    const result = billingReportRequestSchema.safeParse({
      from: '2024-01-01',
      to: '2026-02-26'
    });
    expect(result.success).toBe(false);
  });
});
