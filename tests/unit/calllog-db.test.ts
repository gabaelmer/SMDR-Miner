import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../backend/db/DatabaseService';
import { SMDRRecord } from '../../shared/types';

function createRecord(overrides: Partial<SMDRRecord>): SMDRRecord {
  return {
    date: '2026-02-24',
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
  const dbPath = path.join(os.tmpdir(), `smdr-calllog-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseService(dbPath);
  db.init();
  cleanupEntries.push({ db, dbPath });
  return db;
}

describe('DatabaseService call log pagination and summary', () => {
  it('returns paginated rows with total count', () => {
    const db = createDb();
    db.insertRecord(createRecord({ startTime: '09:01:00', callingParty: '1001', calledParty: '1002' }));
    db.insertRecord(createRecord({ startTime: '09:02:00', callingParty: '1003', calledParty: '1004' }));
    db.insertRecord(createRecord({ startTime: '09:03:00', callingParty: '1005', calledParty: '1006' }));

    const firstPage = db.getRecordsPage({ limit: 2, offset: 0 });
    const secondPage = db.getRecordsPage({ limit: 2, offset: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.rows).toHaveLength(1);
  });

  it('builds summary from full filtered set', () => {
    const db = createDb();
    db.insertRecord(createRecord({ startTime: '10:00:00', duration: '00:02:00', callingParty: '1001', calledParty: '2001' }));
    db.insertRecord(createRecord({ startTime: '11:00:00', duration: '00:03:00', callingParty: '1001', calledParty: '2002' }));
    db.insertRecord(createRecord({ startTime: '12:00:00', duration: '00:01:30', callingParty: '1002', calledParty: '2002' }));

    const summary = db.getCallLogSummary({ dateFrom: '2026-02-24', dateTo: '2026-02-24' });

    expect(summary.totalCalls).toBe(3);
    expect(summary.totalDurationSeconds).toBe(390);
    expect(summary.topExtensionsMade[0]).toEqual({ extension: '1001', count: 2 });
    expect(summary.topExtensionsReceived[0]).toEqual({ extension: '2002', count: 2 });
  });

  it('filters by hour using hour index column', () => {
    const db = createDb();
    db.insertRecord(createRecord({ startTime: '08:10:00', callingParty: '1010', calledParty: '2010' }));
    db.insertRecord(createRecord({ startTime: '09:15:00', callingParty: '1011', calledParty: '2011' }));

    const rows = db.getRecords({ hour: '9' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startTime).toBe('09:15:00');
  });
});
