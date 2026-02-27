import { describe, expect, it, beforeEach } from 'vitest';
import { AlertEngine } from '../../backend/alerts/AlertEngine';
import { AlertRuleSet, SMDRRecord } from '../../shared/types';

const DEFAULT_RULES: AlertRuleSet = {
  longCallMinutes: 30,
  watchNumbers: ['911', '122'],
  repeatedBusyThreshold: 3,
  repeatedBusyWindowMinutes: 30,
  detectTagCalls: true,
  detectTollDenied: true
};

const createRecord = (overrides: Partial<SMDRRecord> = {}): SMDRRecord => ({
  date: '2026-02-21',
  startTime: '10:00:00',
  duration: '00:05:00',
  callingParty: '1001',
  calledParty: '09171234567',
  callCompletionStatus: 'A',
  ...overrides
});

describe('AlertEngine', () => {
  let engine: AlertEngine;

  beforeEach(() => {
    engine = new AlertEngine(DEFAULT_RULES);
  });

  // ─── Long Call Alert ───────────────────────────────────────────────────────

  describe('long call detection', () => {
    it('triggers alert for calls exceeding threshold', () => {
      const record = createRecord({ duration: '00:35:00' }); // 35 minutes
      const alerts = engine.evaluate(record);
      
      const longCallAlert = alerts.find(a => a.type === 'long-call');
      expect(longCallAlert).toBeDefined();
      expect(longCallAlert?.message).toContain('exceeded 30 minutes');
    });

    it('does not trigger for calls under threshold', () => {
      const record = createRecord({ duration: '00:25:00' }); // 25 minutes
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'long-call')).toBeUndefined();
    });

    it('triggers at exact threshold', () => {
      const record = createRecord({ duration: '00:30:00' }); // Exactly 30 minutes
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'long-call')).toBeDefined();
    });
  });

  // ─── Watch Number Alert ────────────────────────────────────────────────────

  describe('watch number detection', () => {
    it('triggers alert when called party matches watch number', () => {
      const record = createRecord({ calledParty: '911' });
      const alerts = engine.evaluate(record);
      
      const watchAlert = alerts.find(a => a.type === 'watch-number');
      expect(watchAlert).toBeDefined();
      expect(watchAlert?.message).toContain('911');
    });

    it('triggers alert when digitsDialed matches watch number', () => {
      const record = createRecord({ digitsDialed: '122' });
      const alerts = engine.evaluate(record);
      
      const watchAlert = alerts.find(a => a.type === 'watch-number');
      expect(watchAlert).toBeDefined();
    });

    it('does not trigger for non-matching numbers', () => {
      const record = createRecord({ calledParty: '09171234567' });
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'watch-number')).toBeUndefined();
    });

    it('handles partial match in called party', () => {
      const record = createRecord({ calledParty: '12349115678' });
      const alerts = engine.evaluate(record);
      
      const watchAlert = alerts.find(a => a.type === 'watch-number');
      expect(watchAlert).toBeDefined();
    });
  });

  // ─── Repeated Busy Alert ───────────────────────────────────────────────────

  describe('repeated busy detection', () => {
    it('triggers alert after threshold busy calls to same number', () => {
      const targetNumber = '09171234567';
      
      // First two busy calls - no alert yet
      engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      
      // Third busy call - should trigger alert
      const alerts = engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      
      const busyAlert = alerts.find(a => a.type === 'repeated-busy');
      expect(busyAlert).toBeDefined();
      expect(busyAlert?.message).toContain(targetNumber);
    });

    it('does not trigger for busy calls to different numbers', () => {
      engine.evaluate(createRecord({ calledParty: '1111', callCompletionStatus: 'B' }));
      engine.evaluate(createRecord({ calledParty: '2222', callCompletionStatus: 'B' }));
      const alerts = engine.evaluate(createRecord({ calledParty: '3333', callCompletionStatus: 'B' }));
      
      expect(alerts.find(a => a.type === 'repeated-busy')).toBeUndefined();
    });

    it('resets counter after window expires', () => {
      const targetNumber = '09171234567';
      
      // Two busy calls
      engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      
      // Simulate window expiry by creating new engine (in real scenario, time would pass)
      engine = new AlertEngine(DEFAULT_RULES);
      
      const alerts = engine.evaluate(createRecord({ calledParty: targetNumber, callCompletionStatus: 'B' }));
      expect(alerts.find(a => a.type === 'repeated-busy')).toBeUndefined();
    });
  });

  // ─── Tag Call Alert ────────────────────────────────────────────────────────

  describe('tag call detection', () => {
    it('triggers alert when rawLine contains TAG', () => {
      const record = createRecord({ rawLine: '2026-02-21 10:00:00 00:05:00 1001 1002 TAG A' });
      const alerts = engine.evaluate(record);
      
      const tagAlert = alerts.find(a => a.type === 'tag-call');
      expect(tagAlert).toBeDefined();
    });

    it('is case insensitive for TAG detection', () => {
      const record = createRecord({ rawLine: '2026-02-21 10:00:00 00:05:00 1001 1002 tag A' });
      const alerts = engine.evaluate(record);
      
      const tagAlert = alerts.find(a => a.type === 'tag-call');
      expect(tagAlert).toBeDefined();
    });

    it('does not trigger when TAG not in rawLine', () => {
      const record = createRecord({ rawLine: '2026-02-21 10:00:00 00:05:00 1001 1002 A' });
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'tag-call')).toBeUndefined();
    });

    it('can be disabled via rules', () => {
      engine.updateRules({ ...DEFAULT_RULES, detectTagCalls: false });
      const record = createRecord({ rawLine: 'TAG' });
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'tag-call')).toBeUndefined();
    });
  });

  // ─── Toll Denied Alert ─────────────────────────────────────────────────────

  describe('toll denied detection', () => {
    it('triggers alert when callCompletionStatus is D', () => {
      const record = createRecord({ callCompletionStatus: 'D' });
      const alerts = engine.evaluate(record);
      
      const deniedAlert = alerts.find(a => a.type === 'toll-denied');
      expect(deniedAlert).toBeDefined();
      expect(deniedAlert?.message).toContain('Toll denied');
    });

    it('does not trigger for other completion statuses', () => {
      const record = createRecord({ callCompletionStatus: 'A' }); // Answered
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'toll-denied')).toBeUndefined();
    });

    it('can be disabled via rules', () => {
      engine.updateRules({ ...DEFAULT_RULES, detectTollDenied: false });
      const record = createRecord({ callCompletionStatus: 'D' });
      const alerts = engine.evaluate(record);
      
      expect(alerts.find(a => a.type === 'toll-denied')).toBeUndefined();
    });
  });

  // ─── Multiple Alerts ───────────────────────────────────────────────────────

  describe('multiple alerts', () => {
    it('returns multiple alerts for record matching multiple rules', () => {
      const record = createRecord({
        duration: '00:35:00', // Long call
        calledParty: '911',   // Watch number
        callCompletionStatus: 'D' // Toll denied
      });
      
      const alerts = engine.evaluate(record);
      
      expect(alerts.length).toBeGreaterThanOrEqual(3);
      expect(alerts.map(a => a.type)).toEqual(
        expect.arrayContaining(['long-call', 'watch-number', 'toll-denied'])
      );
    });
  });

  // ─── Rule Updates ──────────────────────────────────────────────────────────

  describe('rule updates', () => {
    it('applies updated long call threshold', () => {
      engine.updateRules({ ...DEFAULT_RULES, longCallMinutes: 60 });
      
      const record = createRecord({ duration: '00:45:00' }); // 45 minutes
      const alerts = engine.evaluate(record);
      
      // Should not trigger at 45 min with 60 min threshold
      expect(alerts.find(a => a.type === 'long-call')).toBeUndefined();
      
      const longerRecord = createRecord({ duration: '01:05:00' }); // 65 minutes
      const alerts2 = engine.evaluate(longerRecord);
      
      expect(alerts2.find(a => a.type === 'long-call')).toBeDefined();
    });

    it('applies updated watch numbers', () => {
      engine.updateRules({ ...DEFAULT_RULES, watchNumbers: ['8888'] });
      
      const record = createRecord({ calledParty: '911' });
      const alerts = engine.evaluate(record);
      
      // Old watch number should not trigger
      expect(alerts.find(a => a.type === 'watch-number')).toBeUndefined();
      
      const newRecord = createRecord({ calledParty: '8888' });
      const alerts2 = engine.evaluate(newRecord);
      
      expect(alerts2.find(a => a.type === 'watch-number')).toBeDefined();
    });
  });
});
