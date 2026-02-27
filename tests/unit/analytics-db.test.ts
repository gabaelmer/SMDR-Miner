import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../backend/db/DatabaseService';
import { SMDRRecord } from '../../shared/types';

function createRecord(overrides: Partial<SMDRRecord>): SMDRRecord {
  return {
    date: '2026-02-20',
    startTime: '09:00:00',
    duration: '00:01:00',
    callingParty: '1001',
    calledParty: '1002',
    ...overrides
  };
}

function hourCount(snapshot: ReturnType<DatabaseService['getAnalyticsSnapshot']>, hour: string): number {
  return snapshot.volumeByHour.find((item) => item.hour === hour)?.count ?? -1;
}

const cleanupEntries: Array<{ db: DatabaseService; dbPath: string }> = [];

afterEach(() => {
  for (const entry of cleanupEntries.splice(0, cleanupEntries.length)) {
    entry.db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${entry.dbPath}${suffix}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
});

function createDb(): DatabaseService {
  const dbPath = path.join(os.tmpdir(), `smdr-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseService(dbPath);
  db.init();
  cleanupEntries.push({ db, dbPath });
  return db;
}

describe('DatabaseService analytics snapshot', () => {
  it('fills missing hours and day-hour bins', () => {
    const db = createDb();
    db.insertRecord(createRecord({ startTime: '09:15:00' }));
    db.insertRecord(createRecord({ startTime: '11:40:00', callingParty: '1003', calledParty: '1004' }));

    const snapshot = db.getAnalyticsSnapshot('2026-02-20', '2026-02-20');
    expect(snapshot.volumeByHour).toHaveLength(24);
    expect(hourCount(snapshot, '09')).toBe(1);
    expect(hourCount(snapshot, '10')).toBe(0);
    expect(hourCount(snapshot, '11')).toBe(1);

    expect(snapshot.heatmap).toHaveLength(24);
    const zeroCell = snapshot.heatmap.find((item) => item.day === '2026-02-20' && item.hour === 10);
    expect(zeroCell?.count).toBe(0);
  });

  it('computes summary metrics from pre-aggregated data', () => {
    const db = createDb();
    db.insertRecord(createRecord({ startTime: '10:00:00', duration: '00:01:00', callCompletionStatus: 'A', transferFlag: 'T' }));
    db.insertRecord(createRecord({ startTime: '10:20:00', duration: '00:02:00', callCompletionStatus: 'A' }));
    db.insertRecord(createRecord({ startTime: '11:00:00', duration: '00:03:00', callCompletionStatus: 'B', transferFlag: 'X' }));

    const snapshot = db.getAnalyticsSnapshot('2026-02-20', '2026-02-20');
    expect(snapshot.summary.totalCalls).toBe(3);
    expect(snapshot.summary.totalDurationSeconds).toBe(360);
    expect(snapshot.summary.avgDurationSeconds).toBe(120);
    expect(snapshot.summary.answeredCalls).toBe(2);
    expect(snapshot.summary.answeredRate).toBe(66.7);
    expect(snapshot.summary.transferConferenceCalls).toBe(2);
    expect(snapshot.summary.transferConferenceRate).toBe(66.7);
    expect(snapshot.summary.peakHour).toBe('10');
  });

  it('assigns anomaly score and severity to correlation clusters', () => {
    const db = createDb();
    for (let i = 0; i < 12; i += 1) {
      db.insertRecord(
        createRecord({
          startTime: `12:${String(i).padStart(2, '0')}:00`,
          callIdentifier: 'CID-A',
          associatedCallIdentifier: 'ASSOC-A',
          networkOLI: 'PSTN',
          callingParty: `20${String(i).padStart(2, '0')}`,
          calledParty: '3000'
        })
      );
    }
    for (let i = 0; i < 4; i += 1) {
      db.insertRecord(
        createRecord({
          startTime: `13:${String(i).padStart(2, '0')}:00`,
          callIdentifier: 'CID-B',
          associatedCallIdentifier: 'ASSOC-B',
          networkOLI: 'VOIP',
          callingParty: `30${String(i).padStart(2, '0')}`,
          calledParty: '4000'
        })
      );
    }

    const snapshot = db.getAnalyticsSnapshot('2026-02-20', '2026-02-20');
    const cidA = snapshot.correlations.find((item) => item.callIdentifier === 'CID-A');
    const cidB = snapshot.correlations.find((item) => item.callIdentifier === 'CID-B');

    expect(cidA).toBeDefined();
    expect(cidA?.count).toBe(12);
    expect(cidA?.severity).toBe('critical');
    expect(typeof cidA?.anomalyScore).toBe('number');

    expect(cidB).toBeDefined();
    expect(cidB?.count).toBe(4);
    expect(['medium', 'high', 'critical']).toContain(cidB?.severity);
  });
});
