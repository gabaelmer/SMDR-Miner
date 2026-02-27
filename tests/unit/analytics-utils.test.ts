import { describe, expect, it } from 'vitest';
import { deltaBadge, formatSeconds, normalizeTransferLabel, safePercent, toCsv } from '../../renderer/src/lib/analyticsUtils';

describe('analytics ui helpers', () => {
  it('normalizes transfer labels', () => {
    expect(normalizeTransferLabel('T')).toBe('T - Transfer');
    expect(normalizeTransferLabel('X')).toBe('X - Conference');
    expect(normalizeTransferLabel('C')).toBe('C - Conference');
    expect(normalizeTransferLabel('none')).toBe('None');
  });

  it('formats seconds for analytics cards', () => {
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(43)).toBe('43s');
    expect(formatSeconds(65)).toBe('1m 5s');
    expect(formatSeconds(3660)).toBe('1h 1m');
  });

  it('computes safe percentages and deltas', () => {
    expect(safePercent(2, 3)).toBe(66.7);
    expect(safePercent(1, 0)).toBe(0);
    expect(deltaBadge(120, 100)?.text).toContain('+20');
    expect(deltaBadge(100, 120)?.text).toContain('-20');
  });

  it('builds escaped csv content', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['hello,world', 'x"y']
    ]);
    expect(csv).toContain('"hello,world"');
    expect(csv).toContain('"x""y"');
  });
});
