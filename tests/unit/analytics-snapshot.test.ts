import { describe, expect, it } from 'vitest';
import { normalizeAnalyticsSnapshot } from '../../renderer/src/lib/analyticsSnapshot';

describe('analytics snapshot normalization', () => {
  it('handles malformed payload shapes without throwing', () => {
    const snapshot = normalizeAnalyticsSnapshot({
      volumeByHour: { hour: 9, count: 12 } as unknown as Array<{ hour: string; count: number }>,
      heatmap: [{ day: '2026-02-26', hour: 9, count: 3 }, null] as unknown as Array<{ day: string; hour: number; count: number }>,
      extensionUsage: null as unknown as Array<{ extension: string; calls: number; totalDurationSeconds: number; avgHandleTime: number }>,
      transferConference: [{ flag: 'T', count: 1 }, undefined] as unknown as Array<{ flag: string; count: number }>,
      correlations: [null, { count: 5, callIdentifier: 'cid-1' }] as unknown as Array<{
        key: string;
        count: number;
        anomalyScore: number;
        severity: 'low' | 'medium' | 'high' | 'critical';
      }>
    });

    expect(snapshot.volumeByHour).toHaveLength(24);
    expect(snapshot.volumeByHour.find((row) => row.hour === '09')?.count).toBe(0);
    expect(snapshot.heatmap).toHaveLength(24);
    expect(snapshot.transferConference[0]?.flag).toBe('T');
    expect(snapshot.correlations).toHaveLength(2);
    expect(snapshot.correlations[0]?.severity).toBe('low');
    expect(snapshot.correlations[1]?.severity).toBe('medium');
  });
});
