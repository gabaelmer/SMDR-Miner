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

function createDb(encryptionKey?: string): DatabaseService {
  const dbPath = path.join(os.tmpdir(), `smdr-billing-report-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseService(dbPath, encryptionKey);
  db.init();
  cleanupEntries.push({ db, dbPath });
  return db;
}

describe('DatabaseService billing report', () => {
  it('filters by extension correctly when encryption is enabled and returns decrypted parties in top calls', () => {
    const db = createDb('unit-test-secret');

    db.insertRecord(createRecord({
      callingParty: '1001',
      calledParty: '09171234567',
      digitsDialed: '09171234567',
      duration: '00:05:00',
      startTime: '09:00:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '1002',
      calledParty: '1001',
      digitsDialed: '0212345678',
      duration: '00:03:00',
      startTime: '09:05:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '1003',
      calledParty: '1004',
      digitsDialed: '001122334455',
      duration: '00:08:00',
      startTime: '09:10:00'
    }));

    const report = db.getBillingReport({
      from: '2026-02-26',
      to: '2026-02-26',
      extension: '1001',
      page: 1,
      pageSize: 20
    });

    expect(report.topCostCallsTotal).toBe(2);
    expect(report.topCostCalls).toHaveLength(2);
    expect(report.topCostCalls[0]?.calling_party).not.toContain(':');
    expect(report.topCostCalls[0]?.called_party).not.toContain(':');
    expect(report.topCostCalls[0]?.calling_party).toBe('1001');
  });

  it('supports category filter, sorting, and pagination for top cost calls', () => {
    const db = createDb();

    db.insertRecord(createRecord({
      callingParty: '2001',
      calledParty: '09180000001',
      digitsDialed: '09180000001',
      duration: '00:06:00',
      startTime: '10:00:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '2001',
      calledParty: '09180000002',
      digitsDialed: '09180000002',
      duration: '00:02:00',
      startTime: '10:05:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '2001',
      calledParty: '0212345678',
      digitsDialed: '0212345678',
      duration: '00:09:00',
      startTime: '10:10:00'
    }));

    const page1 = db.getBillingReport({
      from: '2026-02-26',
      to: '2026-02-26',
      category: 'mobile',
      sortBy: 'duration',
      sortDir: 'desc',
      page: 1,
      pageSize: 1
    });

    const page2 = db.getBillingReport({
      from: '2026-02-26',
      to: '2026-02-26',
      category: 'mobile',
      sortBy: 'duration',
      sortDir: 'desc',
      page: 2,
      pageSize: 1
    });

    expect(page1.topCostCallsTotal).toBe(2);
    expect(page1.topCostCalls).toHaveLength(1);
    expect(page1.topCostCalls[0]?.duration_seconds).toBe(360);
    expect(page2.topCostCalls).toHaveLength(1);
    expect(page2.topCostCalls[0]?.duration_seconds).toBe(120);
    expect(page1.dailyTrend).toHaveLength(1);
    expect(page1.dailyTrend[0]?.date).toBe('2026-02-26');
    expect(page1.dailyTrend[0]?.currency).toBe('PHP');
  });

  it('supports export mode and reports truncation when top calls exceed export limit', () => {
    const db = createDb();

    db.insertRecord(createRecord({
      callingParty: '3001',
      calledParty: '09180000011',
      digitsDialed: '09180000011',
      duration: '00:10:00',
      startTime: '11:00:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '3002',
      calledParty: '09180000012',
      digitsDialed: '09180000012',
      duration: '00:09:00',
      startTime: '11:05:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '3003',
      calledParty: '09180000013',
      digitsDialed: '09180000013',
      duration: '00:08:00',
      startTime: '11:10:00'
    }));

    const report = db.getBillingReport({
      from: '2026-02-26',
      to: '2026-02-26',
      sortBy: 'duration',
      sortDir: 'desc',
      includeAllTopCalls: true,
      topCallsLimit: 2
    });

    expect(report.topCostCallsTotal).toBe(3);
    expect(report.topCostCalls).toHaveLength(2);
    expect(report.topCostCallsTruncated).toBe(true);
  });

  it('splits daily trend by currency to avoid mixed-currency totals', () => {
    const db = createDb();

    db.insertRecord(createRecord({
      callingParty: '4001',
      calledParty: '09180000021',
      digitsDialed: '09180000021',
      duration: '00:03:00',
      startTime: '12:00:00'
    }));
    db.insertRecord(createRecord({
      callingParty: '4002',
      calledParty: '09180000022',
      digitsDialed: '09180000022',
      duration: '00:02:00',
      startTime: '12:05:00'
    }));

    const raw = db.getRawDb();
    raw.prepare("UPDATE smdr_records SET bill_currency = 'USD' WHERE calling_party = ?").run('4002');

    const report = db.getBillingReport({
      from: '2026-02-26',
      to: '2026-02-26'
    });

    expect(report.dailyTrend).toHaveLength(2);
    expect(report.dailyTrend.map((row) => row.currency).sort()).toEqual(['PHP', 'USD']);
  });
});
