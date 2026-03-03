import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../backend/db/DatabaseService';
import { SMDRRecord } from '../../shared/types';

function createRecord(overrides: Partial<SMDRRecord>): SMDRRecord {
  return {
    date: '2026-02-26',
    startTime: '09:00:00',
    duration: '00:01:00',
    callingParty: '1001',
    calledParty: '1002',
    ...overrides
  };
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
  const dbPath = path.join(os.tmpdir(), `smdr-dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseService(dbPath);
  db.init();
  cleanupEntries.push({ db, dbPath });
  return db;
}

describe('DatabaseService dashboard metrics', () => {
  it('computes expanded day metrics from full-day records', () => {
    const db = createDb();

    db.insertRecord(createRecord({ callType: 'internal', duration: '00:05:00', callingParty: '1001', calledParty: '1002' }));
    db.insertRecord(
      createRecord({
        callType: 'external',
        duration: '00:03:00',
        callingParty: '1001',
        calledParty: '09171234567',
        digitsDialed: '09171234567'
      })
    );
    db.insertRecord(
      createRecord({
        callType: 'external',
        duration: '00:02:00',
        callingParty: '+639171234567',
        calledParty: '1001'
      })
    );
    db.insertRecord(
      createRecord({
        callType: 'external',
        duration: '00:03:00',
        callingParty: '1002',
        calledParty: '001234567890',
        digitsDialed: '001234567890'
      })
    );
    db.insertRecord(
      createRecord({
        date: '2026-02-25',
        startTime: '11:00:00',
        duration: '00:02:00',
        callType: 'external',
        callingParty: '1003',
        calledParty: '021234567',
        digitsDialed: '021234567'
      })
    );

    const dashboard = db.getDashboardMetrics('2026-02-26');

    expect(dashboard.date).toBe('2026-02-26');
    expect(dashboard.totalCallsToday).toBe(4);
    expect(dashboard.totalDurationSeconds).toBe(780);
    expect(dashboard.avgCallDurationSeconds).toBe(195);
    expect(dashboard.internalCalls).toBe(1);
    expect(dashboard.internalDurationSeconds).toBe(300);
    expect(dashboard.outgoingCalls).toBe(2);
    expect(dashboard.incomingCalls).toBe(2);
    expect(dashboard.inboundCalls).toBe(1);
    expect(dashboard.outboundCalls).toBe(2);
    expect(dashboard.highCostCalls).toBe(0);
    expect(dashboard.totalCostToday).toBeGreaterThan(40);
    expect(dashboard.topExtensionsByCostAndVolume[0]?.extension).toBe('1001');
    expect(dashboard.topExtensionsByCostAndVolume[0]?.totalCost).toBeGreaterThan(40);

    const internalSlice = dashboard.callDistribution.find((item) => item.category === 'internal');
    const mobileSlice = dashboard.callDistribution.find((item) => item.category === 'mobile');
    const intlSlice = dashboard.callDistribution.find((item) => item.category === 'international');
    expect(internalSlice?.count).toBe(1);
    expect(mobileSlice?.count).toBe(1);
    expect(intlSlice?.count).toBe(1);
  });

  it('returns complete seven-day trend range and long call list', () => {
    const db = createDb();

    db.insertRecord(
      createRecord({
        date: '2026-02-20',
        startTime: '08:00:00',
        duration: '00:01:00',
        callType: 'external',
        callingParty: '1100',
        calledParty: '09170000000',
        digitsDialed: '09170000000'
      })
    );
    db.insertRecord(
      createRecord({
        date: '2026-02-26',
        startTime: '12:15:00',
        duration: '00:31:00',
        callType: 'external',
        callingParty: '1200',
        calledParty: '0011223344',
        digitsDialed: '0011223344'
      })
    );

    const dashboard = db.getDashboardMetrics('2026-02-26');

    expect(dashboard.sevenDayTrend).toHaveLength(7);
    expect(dashboard.sevenDayTrend[0]?.date).toBe('2026-02-20');
    expect(dashboard.sevenDayTrend[6]?.date).toBe('2026-02-26');
    expect(dashboard.sevenDayTrend[6]?.callCount).toBe(1);
    expect(dashboard.longCalls).toHaveLength(1);
    expect(dashboard.longCalls[0]?.duration).toBe('00:31:00');
  });
});
