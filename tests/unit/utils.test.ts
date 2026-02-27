import { describe, expect, it } from 'vitest';
import {
  durationToSeconds,
  secondsToDuration,
  formatDuration,
  isWeekend,
  getDayOfWeek
} from '../../shared/utils/time';

describe('time utilities', () => {
  // ─── durationToSeconds ─────────────────────────────────────────────────────

  describe('durationToSeconds', () => {
    it('converts HH:MM:SS format', () => {
      expect(durationToSeconds('01:30:45')).toBe(5445); // 1*3600 + 30*60 + 45
    });

    it('converts MM:SS format', () => {
      expect(durationToSeconds('05:30')).toBe(330); // 5*60 + 30
    });

    it('handles zero duration', () => {
      expect(durationToSeconds('00:00:00')).toBe(0);
    });

    it('handles invalid input', () => {
      expect(durationToSeconds('invalid')).toBe(0);
      expect(durationToSeconds('')).toBe(0);
    });
  });

  // ─── secondsToDuration ─────────────────────────────────────────────────────

  describe('secondsToDuration', () => {
    it('converts seconds to HH:MM:SS', () => {
      expect(secondsToDuration(5445)).toBe('01:30:45');
    });

    it('handles zero seconds', () => {
      expect(secondsToDuration(0)).toBe('00:00:00');
    });

    it('pads with zeros', () => {
      expect(secondsToDuration(61)).toBe('00:01:01');
    });

    it('handles large values', () => {
      expect(secondsToDuration(3661)).toBe('01:01:01');
    });
  });

  // ─── formatDuration ────────────────────────────────────────────────────────

  describe('formatDuration', () => {
    it('formats to human readable string', () => {
      expect(formatDuration(3661)).toBe('1h 1m');
    });

    it('omits zero hours', () => {
      expect(formatDuration(300)).toBe('5m 0s');
    });

    it('shows only minutes and seconds for short duration', () => {
      expect(formatDuration(45)).toBe('45s');
    });

    it('handles zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('handles negative', () => {
      expect(formatDuration(-100)).toBe('0s');
    });
  });

  // ─── isWeekend ─────────────────────────────────────────────────────────────

  describe('isWeekend', () => {
    it('returns true for Saturday', () => {
      expect(isWeekend('2026-02-21')).toBe(true); // Saturday
    });

    it('returns true for Sunday', () => {
      expect(isWeekend('2026-02-22')).toBe(true); // Sunday
    });

    it('returns false for weekday', () => {
      expect(isWeekend('2026-02-23')).toBe(false); // Monday
      expect(isWeekend('2026-02-24')).toBe(false); // Tuesday
    });

    it('handles Date objects', () => {
      expect(isWeekend(new Date('2026-02-21'))).toBe(true);
    });
  });

  // ─── getDayOfWeek ──────────────────────────────────────────────────────────

  describe('getDayOfWeek', () => {
    it('returns 0 for Sunday', () => {
      expect(getDayOfWeek('2026-02-22')).toBe(0);
    });

    it('returns 1 for Monday', () => {
      expect(getDayOfWeek('2026-02-23')).toBe(1);
    });

    it('returns 6 for Saturday', () => {
      expect(getDayOfWeek('2026-02-21')).toBe(6);
    });
  });
});
