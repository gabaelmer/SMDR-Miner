import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import {
  AlertEvent,
  BillingReportData,
  BillingReportQuery,
  BillingReportSortBy,
  BillingReportTopCostCall,
  CallLogSummary,
  AnalyticsSummary,
  AnalyticsSnapshot,
  ConnectionEvent,
  ConnectionEventsPage,
  DashboardMetrics,
  ExportOptions,
  ParseError,
  RecordFilters,
  RecordsPage,
  SMDRRecord,
  CallCompletionCode,
  TransferConferenceCode,
  LongCallIndicator,
  SpeedCallForwardCode,
  RouteOptCode,
  SMDRFormatVariant
} from '../../shared/types';
import { CryptoUtil } from '../security/CryptoUtil';
import { billingEngine } from '../billing/BillingEngine';

interface DbRecordRow {
  date: string;
  start_time: string;
  duration: string;
  calling_party: string;
  called_party: string;
  third_party?: string;
  trunk_number?: string;
  digits_dialed?: string;
  account_code?: string;
  call_completion_status?: string;
  transfer_flag?: string;
  call_identifier?: string;
  call_sequence_identifier?: string;
  associated_call_identifier?: string;
  network_oli?: string;
  call_type?: 'internal' | 'external';
  raw_line?: string;
  // New Mitel spec fields
  long_call_indicator?: string;
  attendant_flag?: string;
  time_to_answer?: number | null;
  meter_pulses?: number | null;
  speed_call_forward_flag?: string;
  route_opt_flag?: string;
  system_id?: string;
  mlpp_level?: string;
  ani?: string;
  dnis?: string;
  call_sequence?: string;
  suite_id?: string;
  two_b_channel_tag?: string;
  calling_ehdu?: string;
  called_ehdu?: string;
  calling_location?: string;
  called_location?: string;
  record_format?: string;
  record_length?: number;
  is_multi_line?: number;  // SQLite stores boolean as 0/1
  parsed_at?: string;
}

export class DatabaseService {
  private readonly db: Database.Database;
  private readonly crypto: CryptoUtil;
  private readonly analyticsSnapshotCache = new Map<string, { expiresAt: number; snapshot: AnalyticsSnapshot }>();

  constructor(private readonly dbPath: string, encryptionKey?: string) {
    console.log(`[DB] Opening database at ${dbPath}`);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    console.log('[DB] Database opened and PRAGMA set');
    this.crypto = new CryptoUtil(encryptionKey);
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smdr_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        start_hour INTEGER NOT NULL DEFAULT 0,
        duration TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        calling_party TEXT NOT NULL,
        called_party TEXT NOT NULL,
        third_party TEXT,
        trunk_number TEXT,
        digits_dialed TEXT,
        account_code TEXT,
        call_completion_status TEXT,
        transfer_flag TEXT,
        call_identifier TEXT,
        call_sequence_identifier TEXT,
        associated_call_identifier TEXT,
        network_oli TEXT,
        call_type TEXT,
        raw_line TEXT,
        calling_party_hash TEXT,
        called_party_hash TEXT,
        account_code_hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS parse_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS connection_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        record_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_smdr_date ON smdr_records(date);
      CREATE INDEX IF NOT EXISTS idx_smdr_calling ON smdr_records(calling_party_hash);
      CREATE INDEX IF NOT EXISTS idx_smdr_called ON smdr_records(called_party_hash);
      CREATE INDEX IF NOT EXISTS idx_smdr_call_identifier ON smdr_records(call_identifier);
      CREATE INDEX IF NOT EXISTS idx_smdr_account ON smdr_records(account_code_hash);
      CREATE INDEX IF NOT EXISTS idx_smdr_calling_plain ON smdr_records(calling_party);
      CREATE INDEX IF NOT EXISTS idx_smdr_called_plain ON smdr_records(called_party);
      CREATE INDEX IF NOT EXISTS idx_smdr_third_plain ON smdr_records(third_party);
      CREATE INDEX IF NOT EXISTS idx_smdr_account_plain ON smdr_records(account_code);
      CREATE INDEX IF NOT EXISTS idx_smdr_completion ON smdr_records(call_completion_status);
      CREATE INDEX IF NOT EXISTS idx_smdr_call_type ON smdr_records(call_type);
      CREATE INDEX IF NOT EXISTS idx_smdr_transfer_flag ON smdr_records(transfer_flag);
      CREATE INDEX IF NOT EXISTS idx_smdr_assoc_call_identifier ON smdr_records(associated_call_identifier);
      CREATE INDEX IF NOT EXISTS idx_smdr_network_oli ON smdr_records(network_oli);
      CREATE INDEX IF NOT EXISTS idx_parse_errors_created_at ON parse_errors(created_at);
      CREATE INDEX IF NOT EXISTS idx_connection_events_level_created_at ON connection_events(level, created_at);
      CREATE INDEX IF NOT EXISTS idx_connection_events_created_at ON connection_events(created_at);
    `);
    this.runBillingMigration();
    this.runCallLogQueryMigration();
    this.runAnalyticsAggregationMigration();
    this.runMitelSpecMigration();
    this.runRecordIdempotencyMigration();
  }


  private runBillingMigration(): void {
    const existing = (this.db.prepare('PRAGMA table_info(smdr_records)').all() as any[]).map((c) => c.name as string);
    const billingCols: Array<{ name: string; type: string; def: string }> = [
      { name: 'call_category',   type: 'TEXT',    def: "'unclassified'" },
      { name: 'matched_prefix',  type: 'TEXT',    def: 'NULL' },
      { name: 'rate_per_minute', type: 'REAL',    def: '0' },
      { name: 'billable_units',  type: 'INTEGER', def: '0' },
      { name: 'call_cost',       type: 'REAL',    def: '0' },
      { name: 'bill_currency',   type: 'TEXT',    def: "'PHP'" },
      { name: 'tax_amount',      type: 'REAL',    def: '0' },
    ];
    for (const col of billingCols) {
      if (!existing.includes(col.name)) {
        this.db.exec(`ALTER TABLE smdr_records ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.def}`);
        console.log(`[DB] Billing migration: added column ${col.name}`);
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_smdr_call_category ON smdr_records(call_category);
      CREATE INDEX IF NOT EXISTS idx_smdr_call_cost ON smdr_records(call_cost);
      CREATE INDEX IF NOT EXISTS idx_smdr_tax_amount ON smdr_records(tax_amount);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_date_category_cost ON smdr_records(date, call_category, call_cost DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_date_duration ON smdr_records(date, duration_seconds DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_date_time ON smdr_records(date, start_time DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_calling_hash_date ON smdr_records(calling_party_hash, date);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_called_hash_date ON smdr_records(called_party_hash, date);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_calling_plain_date ON smdr_records(calling_party, date);
      CREATE INDEX IF NOT EXISTS idx_smdr_billing_called_plain_date ON smdr_records(called_party, date);
    `);
  }

  private runCallLogQueryMigration(): void {
    const existing = (this.db.prepare('PRAGMA table_info(smdr_records)').all() as Array<{ name: string }>).map((column) => column.name);
    if (!existing.includes('start_hour')) {
      this.db.exec('ALTER TABLE smdr_records ADD COLUMN start_hour INTEGER DEFAULT 0');
      this.db.exec(`
        UPDATE smdr_records
        SET start_hour = COALESCE(CAST(substr(start_time, 1, 2) AS INTEGER), 0)
      `);
      console.log('[DB] Call log migration: added and backfilled start_hour');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_smdr_date_hour ON smdr_records(date, start_hour);
      CREATE INDEX IF NOT EXISTS idx_smdr_start_hour ON smdr_records(start_hour);
    `);
  }

  private runAnalyticsAggregationMigration(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_hourly_stats (
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        total_duration_seconds INTEGER NOT NULL DEFAULT 0,
        answered_calls INTEGER NOT NULL DEFAULT 0,
        transfer_conference_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, hour)
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_hourly_date ON analytics_hourly_stats(date);
      CREATE INDEX IF NOT EXISTS idx_analytics_hourly_hour ON analytics_hourly_stats(hour);
    `);

    const aggCount = (this.db.prepare('SELECT COUNT(1) as count FROM analytics_hourly_stats').get() as { count: number }).count;
    const recordsCount = (this.db.prepare('SELECT COUNT(1) as count FROM smdr_records').get() as { count: number }).count;
    if (aggCount === 0 && recordsCount > 0) {
      this.db.exec(`
        INSERT INTO analytics_hourly_stats (
          date,
          hour,
          calls,
          total_duration_seconds,
          answered_calls,
          transfer_conference_calls
        )
        SELECT
          date,
          COALESCE(start_hour, CAST(substr(start_time, 1, 2) AS INTEGER), 0) as hour,
          COUNT(1) as calls,
          COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
          SUM(CASE WHEN call_completion_status = 'A' THEN 1 ELSE 0 END) as answered_calls,
          SUM(CASE WHEN transfer_flag IN ('T', 'X', 'C') THEN 1 ELSE 0 END) as transfer_conference_calls
        FROM smdr_records
        GROUP BY date, hour
      `);
      console.log('[DB] Analytics aggregation backfill complete');
    }
  }

  /**
   * Migration for Mitel SMDR Spec Compliance - adds all missing fields
   */
  private runMitelSpecMigration(): void {
    const existing = (this.db.prepare('PRAGMA table_info(smdr_records)').all() as any[]).map((c) => c.name as string);
    
    const mitelCols: Array<{ name: string; type: string; def: string }> = [
      // Core fields
      { name: 'long_call_indicator', type: 'TEXT', def: 'NULL' },
      { name: 'attendant_flag', type: 'TEXT', def: 'NULL' },
      { name: 'time_to_answer', type: 'INTEGER', def: 'NULL' },
      { name: 'meter_pulses', type: 'INTEGER', def: 'NULL' },
      { name: 'speed_call_forward_flag', type: 'TEXT', def: 'NULL' },
      { name: 'route_opt_flag', type: 'TEXT', def: 'NULL' },
      { name: 'system_id', type: 'TEXT', def: 'NULL' },
      { name: 'mlpp_level', type: 'TEXT', def: 'NULL' },
      // ANI/DNIS fields
      { name: 'ani', type: 'TEXT', def: 'NULL' },
      { name: 'dnis', type: 'TEXT', def: 'NULL' },
      // Network OLI fields
      { name: 'call_sequence', type: 'TEXT', def: 'NULL' },
      // Extended Reporting fields
      { name: 'suite_id', type: 'TEXT', def: 'NULL' },
      { name: 'two_b_channel_tag', type: 'TEXT', def: 'NULL' },
      { name: 'calling_ehdu', type: 'TEXT', def: 'NULL' },
      { name: 'called_ehdu', type: 'TEXT', def: 'NULL' },
      { name: 'calling_location', type: 'TEXT', def: 'NULL' },
      { name: 'called_location', type: 'TEXT', def: 'NULL' },
      // Metadata fields
      { name: 'record_format', type: 'TEXT', def: 'NULL' },
      { name: 'record_length', type: 'INTEGER', def: 'NULL' },
      { name: 'is_multi_line', type: 'INTEGER', def: '0' },
      { name: 'parsed_at', type: 'TEXT', def: 'NULL' },
    ];

    for (const col of mitelCols) {
      if (!existing.includes(col.name)) {
        this.db.exec(`ALTER TABLE smdr_records ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.def}`);
        console.log(`[DB] Mitel spec migration: added column ${col.name}`);
      }
    }

    // Add indexes for new fields
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_smdr_long_call ON smdr_records(long_call_indicator);
      CREATE INDEX IF NOT EXISTS idx_smdr_completion_full ON smdr_records(call_completion_status, call_type, date);
      CREATE INDEX IF NOT EXISTS idx_smdr_ani ON smdr_records(ani);
      CREATE INDEX IF NOT EXISTS idx_smdr_dnis ON smdr_records(dnis);
      CREATE INDEX IF NOT EXISTS idx_smdr_call_sequence ON smdr_records(call_sequence);
      CREATE INDEX IF NOT EXISTS idx_smdr_system_id ON smdr_records(system_id);
      CREATE INDEX IF NOT EXISTS idx_smdr_record_format ON smdr_records(record_format);
      CREATE INDEX IF NOT EXISTS idx_smdr_attendant ON smdr_records(attendant_flag);
      CREATE INDEX IF NOT EXISTS idx_smdr_transfer_conf ON smdr_records(transfer_flag, third_party);
    `);
  }

  /**
   * Prevent duplicate record ingestion when upstream sends replayed lines
   * or multiple service instances write concurrently.
   */
  private runRecordIdempotencyMigration(): void {
    // Remove existing duplicates first to allow unique index creation.
    const deleted = this.db.prepare(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (PARTITION BY date, raw_line ORDER BY id ASC) AS rn
        FROM smdr_records
        WHERE raw_line IS NOT NULL AND TRIM(raw_line) <> ''
      )
      DELETE FROM smdr_records
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `).run().changes;

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_smdr_unique_date_raw_line
      ON smdr_records(date, raw_line)
      WHERE raw_line IS NOT NULL AND TRIM(raw_line) <> ''
    `);

    if (deleted > 0) {
      this.db.exec('DELETE FROM analytics_hourly_stats');
      this.db.exec(`
        INSERT INTO analytics_hourly_stats (
          date,
          hour,
          calls,
          total_duration_seconds,
          answered_calls,
          transfer_conference_calls
        )
        SELECT
          date,
          start_hour,
          COUNT(*) AS calls,
          COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds,
          SUM(CASE WHEN call_completion_status = 'A' THEN 1 ELSE 0 END) AS answered_calls,
          SUM(CASE WHEN COALESCE(transfer_flag, '') IN ('T', 'X', 'C') THEN 1 ELSE 0 END) AS transfer_conference_calls
        FROM smdr_records
        GROUP BY date, start_hour
      `);
      this.analyticsSnapshotCache.clear();
      console.log(`[DB] Deduplicated ${deleted} historical SMDR record(s) by (date, raw_line)`);
    }
  }

  getRawDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  insertRecord(record: SMDRRecord): boolean {
    // Rate the call — use digitsDialed (outgoing) or calledParty as fallback
    const dialledNumber = record.digitsDialed?.trim() || record.calledParty?.trim() || '';
    const durationSecs = durationToSeconds(record.duration);
    const billing = billingEngine.rateCall(dialledNumber, durationSecs, {
      callDate: record.date
    });
    const hourRaw = Number(record.startTime?.slice(0, 2));
    const startHour = Number.isFinite(hourRaw) ? Math.min(23, Math.max(0, hourRaw)) : 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO smdr_records (
        date,
        start_time,
        start_hour,
        duration,
        duration_seconds,
        calling_party,
        called_party,
        third_party,
        trunk_number,
        digits_dialed,
        account_code,
        call_completion_status,
        transfer_flag,
        call_identifier,
        call_sequence_identifier,
        associated_call_identifier,
        network_oli,
        call_type,
        raw_line,
        calling_party_hash,
        called_party_hash,
        account_code_hash,
        call_category,
        matched_prefix,
        rate_per_minute,
        billable_units,
        call_cost,
        bill_currency,
        tax_amount,
        -- Mitel spec fields
        long_call_indicator,
        attendant_flag,
        time_to_answer,
        meter_pulses,
        speed_call_forward_flag,
        route_opt_flag,
        system_id,
        mlpp_level,
        ani,
        dnis,
        call_sequence,
        suite_id,
        two_b_channel_tag,
        calling_ehdu,
        called_ehdu,
        calling_location,
        called_location,
        record_format,
        record_length,
        is_multi_line,
        parsed_at
      ) VALUES (
        @date,
        @start_time,
        @start_hour,
        @duration,
        @duration_seconds,
        @calling_party,
        @called_party,
        @third_party,
        @trunk_number,
        @digits_dialed,
        @account_code,
        @call_completion_status,
        @transfer_flag,
        @call_identifier,
        @call_sequence_identifier,
        @associated_call_identifier,
        @network_oli,
        @call_type,
        @raw_line,
        @calling_party_hash,
        @called_party_hash,
        @account_code_hash,
        @call_category,
        @matched_prefix,
        @rate_per_minute,
        @billable_units,
        @call_cost,
        @bill_currency,
        @tax_amount,
        -- Mitel spec fields
        @long_call_indicator,
        @attendant_flag,
        @time_to_answer,
        @meter_pulses,
        @speed_call_forward_flag,
        @route_opt_flag,
        @system_id,
        @mlpp_level,
        @ani,
        @dnis,
        @call_sequence,
        @suite_id,
        @two_b_channel_tag,
        @calling_ehdu,
        @called_ehdu,
        @calling_location,
        @called_location,
        @record_format,
        @record_length,
        @is_multi_line,
        @parsed_at
      );
    `);

    const result = insert.run({
      date: record.date,
      start_time: record.startTime,
      start_hour: startHour,
      duration: record.duration,
      duration_seconds: durationSecs,
      calling_party: this.crypto.encrypt(record.callingParty) ?? '',
      called_party: this.crypto.encrypt(record.calledParty) ?? '',
      third_party: this.crypto.encrypt(record.thirdParty),
      trunk_number: record.trunkNumber,
      digits_dialed: this.crypto.encrypt(record.digitsDialed),
      account_code: this.crypto.encrypt(record.accountCode),
      call_completion_status: record.callCompletionStatus as string | undefined,
      transfer_flag: record.transferConference as string | undefined,
      call_identifier: record.callIdentifier,
      call_sequence_identifier: record.callSequenceIdentifier,
      associated_call_identifier: record.associatedCallIdentifier,
      network_oli: record.networkOLI,
      call_type: record.callType,
      raw_line: record.rawLine,
      calling_party_hash: this.crypto.hashForIndex(record.callingParty),
      called_party_hash: this.crypto.hashForIndex(record.calledParty),
      account_code_hash: this.crypto.hashForIndex(record.accountCode),
      call_category: billing.category,
      matched_prefix: billing.matchedPrefix,
      rate_per_minute: billing.ratePerMinute,
      billable_units: billing.billableUnits,
      call_cost: billing.cost,
      bill_currency: billing.currency,
      tax_amount: billing.taxAmount ?? 0,
      // Mitel spec fields
      long_call_indicator: record.longCallIndicator ?? null,
      attendant_flag: record.attendantFlag ?? null,
      time_to_answer: record.timeToAnswer ?? null,
      meter_pulses: record.meterPulses ?? null,
      speed_call_forward_flag: record.speedCallForwardFlag ?? null,
      route_opt_flag: record.routeOptFlag ?? null,
      system_id: record.systemId ?? null,
      mlpp_level: record.mlppLevel ?? null,
      ani: record.ani ?? null,
      dnis: record.dnis ?? null,
      call_sequence: record.callSequence ?? null,
      suite_id: record.suiteId ?? null,
      two_b_channel_tag: record.twoBChannelTag ?? null,
      calling_ehdu: record.callingEHDU ?? null,
      called_ehdu: record.calledEHDU ?? null,
      calling_location: record.callingLocation ?? null,
      called_location: record.calledLocation ?? null,
      record_format: record.recordFormat ?? null,
      record_length: record.recordLength ?? null,
      is_multi_line: record.isMultiLine ? 1 : 0,
      parsed_at: record.parsedAt ?? null,
    });

    if (result.changes === 0) {
      return false;
    }

    const answered = record.callCompletionStatus === 'A' ? 1 : 0;
    const transferConference = ['T', 'X', 'C'].includes((record.transferConference ?? record.transferFlag ?? '')) ? 1 : 0;
    this.db.prepare(
      `INSERT INTO analytics_hourly_stats (
         date,
         hour,
         calls,
         total_duration_seconds,
         answered_calls,
         transfer_conference_calls
       ) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(date, hour) DO UPDATE SET
         calls = calls + 1,
         total_duration_seconds = total_duration_seconds + excluded.total_duration_seconds,
         answered_calls = answered_calls + excluded.answered_calls,
         transfer_conference_calls = transfer_conference_calls + excluded.transfer_conference_calls`
    ).run(record.date, startHour, durationSecs, answered, transferConference);

    this.analyticsSnapshotCache.clear();
    return true;
  }

  insertParseError(error: ParseError): void {
    this.db
      .prepare('INSERT INTO parse_errors (line, reason) VALUES (?, ?)')
      .run(error.line, error.reason);
  }

  getParseErrors(limit = 100): ParseError[] {
    const rows = this.db
      .prepare('SELECT line, reason, created_at FROM parse_errors ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ line: string; reason: string; created_at: string }>;

    return rows.map((row) => ({
      line: row.line,
      reason: row.reason,
      createdAt: row.created_at
    }));
  }

  insertConnectionEvent(event: ConnectionEvent): void {
    this.db
      .prepare('INSERT INTO connection_events (level, message) VALUES (?, ?)')
      .run(event.level, event.message);
  }

  getConnectionEvents(options?: {
    level?: ConnectionEvent['level'];
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): ConnectionEventsPage {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.level) {
      where.push('level = ?');
      params.push(options.level);
    }
    if (options?.startDate) {
      where.push('created_at >= ?');
      params.push(options.startDate);
    }
    if (options?.endDate) {
      where.push('created_at <= ?');
      params.push(options.endDate);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = options?.limit ? Math.min(Math.max(options.limit, 1), 1000) : 100;
    const offset = options?.offset ? Math.max(options.offset, 0) : 0;

    const totalRow = this.db.prepare(`SELECT COUNT(1) as count FROM connection_events ${clause}`).get(...params) as { count: number };
    const rows = this.db.prepare(`
      SELECT id, level, message, created_at
      FROM connection_events
      ${clause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{ id: number; level: ConnectionEvent['level']; message: string; created_at: string }>;

    return {
      items: rows.map((row) => ({
        id: row.id,
        level: row.level,
        message: row.message,
        createdAt: row.created_at
      })),
      total: totalRow.count,
      limit,
      offset
    };
  }

  insertAlert(event: AlertEvent): void {
    this.db
      .prepare('INSERT INTO alert_events (type, message, record_json) VALUES (?, ?, ?)')
      .run(event.type, event.message, JSON.stringify(event.record ?? null));
  }

  getAlerts(limit = 100): AlertEvent[] {
    const rows = this.db
      .prepare('SELECT id, type, message, record_json, created_at FROM alert_events ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ id: number; type: string; message: string; record_json: string | null; created_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      record: row.record_json ? (JSON.parse(row.record_json) as SMDRRecord) : undefined,
      createdAt: row.created_at
    }));
  }

  private buildRecordClause(filters: RecordFilters): {
    where: string[];
    params: Array<string | number>;
    clause: string;
  } {
    const where: string[] = [];
    const params: Array<string | number> = [];

    const dateFrom = filters.dateFrom?.trim();
    const dateTo = filters.dateTo?.trim();
    if (dateFrom || dateTo) {
      const from = (dateFrom && dateTo ? (dateFrom <= dateTo ? dateFrom : dateTo) : dateFrom ?? dateTo) as string;
      const to = (dateFrom && dateTo ? (dateFrom <= dateTo ? dateTo : dateFrom) : dateTo ?? dateFrom) as string;
      where.push('date >= ? AND date <= ?');
      params.push(from, to);
    } else if (filters.date) {
      where.push('date = ?');
      params.push(filters.date);
    }

    const extension = filters.extension?.trim();
    if (extension) {
      if (this.crypto.isEnabled()) {
        where.push('(calling_party_hash = ? OR called_party_hash = ?)');
        const hash = this.crypto.hashForIndex(extension) ?? '';
        params.push(hash, hash);
      } else {
        const exactExtension = /^[A-Za-z0-9*#_-]{2,24}$/.test(extension);
        if (exactExtension) {
          where.push('(calling_party = ? OR called_party = ? OR third_party = ?)');
          params.push(extension, extension, extension);
        } else {
          where.push('(calling_party LIKE ? OR called_party LIKE ? OR third_party LIKE ?)');
          const pattern = `%${extension}%`;
          params.push(pattern, pattern, pattern);
        }
      }
    }

    const accountCode = filters.accountCode?.trim();
    if (accountCode) {
      if (this.crypto.isEnabled()) {
        where.push('account_code_hash = ?');
        params.push(this.crypto.hashForIndex(accountCode) ?? '');
      } else {
        const exactAccountCode = /^[A-Za-z0-9*#_-]{2,32}$/.test(accountCode);
        if (exactAccountCode) {
          where.push('account_code = ?');
          params.push(accountCode);
        } else {
          where.push('account_code LIKE ?');
          params.push(`%${accountCode}%`);
        }
      }
    }

    const hour = Number.parseInt(String(filters.hour ?? '').trim(), 10);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      where.push('start_hour = ?');
      params.push(hour);
    }

    if (filters.callType) {
      where.push('call_type = ?');
      params.push(filters.callType);
    }

    if (filters.completionStatus) {
      where.push('call_completion_status = ?');
      params.push(filters.completionStatus);
    }

    if (filters.transferFlag) {
      where.push("COALESCE(transfer_flag, 'none') = ?");
      params.push(filters.transferFlag);
    }

    if (filters.callIdentifier) {
      where.push('call_identifier = ?');
      params.push(filters.callIdentifier);
    }

    if (filters.associatedCallIdentifier) {
      where.push('associated_call_identifier = ?');
      params.push(filters.associatedCallIdentifier);
    }

    if (filters.networkOLI) {
      where.push('network_oli = ?');
      params.push(filters.networkOLI);
    }

    if (filters.longCallIndicator) {
      where.push("COALESCE(long_call_indicator, ' ') = ?");
      params.push(filters.longCallIndicator);
    }

    if (filters.ani) {
      where.push('ani LIKE ?');
      params.push(`%${filters.ani}%`);
    }

    if (filters.dnis) {
      where.push('dnis LIKE ?');
      params.push(`%${filters.dnis}%`);
    }

    return {
      where,
      params,
      clause: where.length ? `WHERE ${where.join(' AND ')}` : ''
    };
  }

  getRecords(filters: RecordFilters = {}): SMDRRecord[] {
    const { clause, params } = this.buildRecordClause(filters);
    const limit = Math.min(Math.max(filters.limit ?? 50_000, 1), 50_000);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT
          date,
          start_time,
          duration,
          calling_party,
          called_party,
          third_party,
          trunk_number,
          digits_dialed,
          account_code,
          call_completion_status,
          transfer_flag,
          call_identifier,
          call_sequence_identifier,
          associated_call_identifier,
          network_oli,
          call_type,
          raw_line,
          -- Mitel spec fields
          long_call_indicator,
          attendant_flag,
          time_to_answer,
          meter_pulses,
          speed_call_forward_flag,
          route_opt_flag,
          system_id,
          mlpp_level,
          ani,
          dnis,
          call_sequence,
          suite_id,
          two_b_channel_tag,
          calling_ehdu,
          called_ehdu,
          calling_location,
          called_location,
          record_format,
          record_length,
          is_multi_line,
          parsed_at
        FROM smdr_records
        ${clause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DbRecordRow[];

    return rows.map((row) => this.mapRecord(row));
  }

  getRecordsPage(filters: RecordFilters = {}): RecordsPage {
    const { clause, params } = this.buildRecordClause(filters);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    const total = (
      this.db.prepare(`SELECT COUNT(1) as count FROM smdr_records ${clause}`).get(...params) as { count: number }
    ).count;

    const rows = this.db
      .prepare(
        `SELECT
          date,
          start_time,
          duration,
          calling_party,
          called_party,
          third_party,
          trunk_number,
          digits_dialed,
          account_code,
          call_completion_status,
          transfer_flag,
          call_identifier,
          call_sequence_identifier,
          associated_call_identifier,
          network_oli,
          call_type,
          raw_line,
          -- Mitel spec fields
          long_call_indicator,
          attendant_flag,
          time_to_answer,
          meter_pulses,
          speed_call_forward_flag,
          route_opt_flag,
          system_id,
          mlpp_level,
          ani,
          dnis,
          call_sequence,
          suite_id,
          two_b_channel_tag,
          calling_ehdu,
          called_ehdu,
          calling_location,
          called_location,
          record_format,
          record_length,
          is_multi_line,
          parsed_at
        FROM smdr_records
        ${clause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DbRecordRow[];

    return {
      rows: rows.map((row) => this.mapRecord(row)),
      total,
      limit,
      offset
    };
  }

  getCallLogSummary(filters: RecordFilters = {}): CallLogSummary {
    const { clause, params, where } = this.buildRecordClause(filters);
    const summaryRow = this.db
      .prepare(
        `SELECT
          COUNT(1) as total_calls,
          COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
         FROM smdr_records
         ${clause}`
      )
      .get(...params) as {
        total_calls: number;
        total_duration_seconds: number;
      };

    const topMadeRows = this.crypto.isEnabled()
      ? this.db
          .prepare(
            `SELECT
              MIN(calling_party) as extension,
              COUNT(1) as count
             FROM smdr_records
             ${clause}
             GROUP BY calling_party_hash
             ORDER BY count DESC
             LIMIT 50`
          )
          .all(...params) as Array<{ extension: string; count: number }>
      : this.db
          .prepare(
            `SELECT
              calling_party as extension,
              COUNT(1) as count
             FROM smdr_records
             ${clause}
             GROUP BY calling_party
             ORDER BY count DESC
             LIMIT 50`
          )
          .all(...params) as Array<{ extension: string; count: number }>;

    const topReceivedRows = this.crypto.isEnabled()
      ? (this.db
          .prepare(
            `SELECT
              MIN(called_party) as extension,
              COUNT(1) as count
             FROM smdr_records
             ${clause}
             GROUP BY called_party_hash
             ORDER BY count DESC
             LIMIT 500`
          )
          .all(...params) as Array<{ extension: string; count: number }>)
          .map((row) => ({
            extension: this.crypto.decrypt(row.extension) ?? row.extension,
            count: row.count
          }))
          .filter((row) => /^[0-9][0-9][0-9]+$/.test(row.extension) && row.extension.length >= 3 && row.extension.length <= 6)
          .slice(0, 50)
      : (() => {
          const receivedWhere = [...where, "called_party GLOB '[0-9][0-9][0-9]*'", 'LENGTH(called_party) BETWEEN 3 AND 6'];
          const receivedClause = receivedWhere.length > 0 ? `WHERE ${receivedWhere.join(' AND ')}` : '';
          return this.db
            .prepare(
              `SELECT
                called_party as extension,
                COUNT(1) as count
               FROM smdr_records
               ${receivedClause}
               GROUP BY called_party
               ORDER BY count DESC
               LIMIT 50`
            )
            .all(...params) as Array<{ extension: string; count: number }>;
        })();

    return {
      totalCalls: summaryRow.total_calls,
      totalDurationSeconds: summaryRow.total_duration_seconds,
      topExtensionsMade: topMadeRows.map((row) => ({
        extension: this.crypto.decrypt(row.extension) ?? row.extension,
        count: row.count
      })),
      topExtensionsReceived: topReceivedRows.map((row) => ({
        extension: this.crypto.decrypt(row.extension) ?? row.extension,
        count: row.count
      }))
    };
  }

  getDashboardMetrics(date = dayjs().format('YYYY-MM-DD')): DashboardMetrics {
    const summaryRow = this.db
      .prepare(
        `SELECT
          COUNT(1) as total_calls,
          COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
          SUM(CASE WHEN digits_dialed IS NOT NULL AND digits_dialed <> '' THEN 1 ELSE 0 END) as outgoing_calls,
          SUM(CASE WHEN call_type = 'internal' THEN 1 ELSE 0 END) as internal_calls,
          COALESCE(SUM(CASE WHEN call_type = 'internal' THEN duration_seconds ELSE 0 END), 0) as internal_duration_seconds,
          SUM(CASE WHEN call_type = 'external' AND (digits_dialed IS NULL OR digits_dialed = '') THEN 1 ELSE 0 END) as inbound_calls,
          COALESCE(SUM(CASE WHEN call_type = 'external' AND (digits_dialed IS NULL OR digits_dialed = '') THEN duration_seconds ELSE 0 END), 0) as inbound_duration_seconds,
          SUM(CASE WHEN call_type = 'external' AND digits_dialed IS NOT NULL AND digits_dialed <> '' THEN 1 ELSE 0 END) as outbound_calls,
          COALESCE(SUM(CASE WHEN call_type = 'external' AND digits_dialed IS NOT NULL AND digits_dialed <> '' THEN duration_seconds ELSE 0 END), 0) as outbound_duration_seconds,
          COALESCE(SUM(call_cost), 0) as total_cost_today,
          SUM(CASE WHEN COALESCE(call_cost, 0) > 50 THEN 1 ELSE 0 END) as high_cost_calls
        FROM smdr_records
        WHERE date = ?`
      )
      .get(date) as {
      total_calls: number;
      total_duration_seconds: number;
      outgoing_calls: number;
      internal_calls: number;
      internal_duration_seconds: number;
      inbound_calls: number;
      inbound_duration_seconds: number;
      outbound_calls: number;
      outbound_duration_seconds: number;
      total_cost_today: number;
      high_cost_calls: number;
    };

    const totalCallsToday = summaryRow.total_calls ?? 0;
    const totalDurationSeconds = summaryRow.total_duration_seconds ?? 0;
    const outgoingCalls = summaryRow.outgoing_calls ?? 0;
    const incomingCalls = Math.max(totalCallsToday - outgoingCalls, 0);
    const internalCalls = summaryRow.internal_calls ?? 0;
    const internalDurationSeconds = summaryRow.internal_duration_seconds ?? 0;
    const inboundCalls = summaryRow.inbound_calls ?? 0;
    const inboundDurationSeconds = summaryRow.inbound_duration_seconds ?? 0;
    const outboundCalls = summaryRow.outbound_calls ?? 0;
    const outboundDurationSeconds = summaryRow.outbound_duration_seconds ?? 0;
    const totalCostToday = Number(summaryRow.total_cost_today ?? 0);
    const highCostCalls = summaryRow.high_cost_calls ?? 0;

    const trendStart = dayjs(date).subtract(6, 'day').format('YYYY-MM-DD');
    const trendRows = this.db
      .prepare(
        `SELECT
          date,
          COUNT(1) as call_count,
          COALESCE(SUM(call_cost), 0) as total_cost
        FROM smdr_records
        WHERE date >= ? AND date <= ?
        GROUP BY date
        ORDER BY date ASC`
      )
      .all(trendStart, date) as Array<{ date: string; call_count: number; total_cost: number }>;
    const trendMap = new Map(trendRows.map((row) => [row.date, row]));
    const sevenDayTrend = buildDateRange(trendStart, date).map((day) => {
      const row = trendMap.get(day);
      return {
        date: day,
        callCount: row?.call_count ?? 0,
        totalCost: Number(row?.total_cost ?? 0)
      };
    });

    const callDistributionRows = this.db
      .prepare(
        `SELECT
          COALESCE(NULLIF(call_category, ''), 'unclassified') as category,
          COUNT(1) as count,
          COALESCE(SUM(call_cost), 0) as total_cost
        FROM smdr_records
        WHERE date = ? AND (call_type IS NULL OR call_type <> 'internal')
        GROUP BY COALESCE(NULLIF(call_category, ''), 'unclassified')`
      )
      .all(date) as Array<{ category: string; count: number; total_cost: number }>;
    const distributionMap = new Map<string, { count: number; totalCost: number }>();
    for (const row of callDistributionRows) {
      distributionMap.set(row.category, {
        count: row.count ?? 0,
        totalCost: Number(row.total_cost ?? 0)
      });
    }
    if (internalCalls > 0) {
      distributionMap.set('internal', { count: internalCalls, totalCost: 0 });
    }
    const distributionOrder = ['local', 'national', 'mobile', 'international', 'internal', 'unclassified'];
    const extraCategories = Array.from(distributionMap.keys()).filter((key) => !distributionOrder.includes(key)).sort();
    const callDistribution = [...distributionOrder, ...extraCategories].map((category) => {
      const entry = distributionMap.get(category) ?? { count: 0, totalCost: 0 };
      return {
        category,
        count: entry.count,
        percentage: totalCallsToday > 0 ? roundToOneDecimal((entry.count / totalCallsToday) * 100) : 0,
        totalCost: entry.totalCost
      };
    });

    const topExtensionCostRows = this.crypto.isEnabled()
      ? this.db
          .prepare(
            `SELECT
              MIN(calling_party) as extension,
              COUNT(1) as count,
              COALESCE(SUM(call_cost), 0) as total_cost
            FROM smdr_records
            WHERE date = ? AND calling_party IS NOT NULL AND calling_party <> ''
            GROUP BY calling_party_hash
            ORDER BY total_cost DESC, count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ extension: string; count: number; total_cost: number }>
      : this.db
          .prepare(
            `SELECT
              calling_party as extension,
              COUNT(1) as count,
              COALESCE(SUM(call_cost), 0) as total_cost
            FROM smdr_records
            WHERE date = ? AND calling_party IS NOT NULL AND calling_party <> ''
            GROUP BY calling_party
            ORDER BY total_cost DESC, count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ extension: string; count: number; total_cost: number }>;

    const topExtensionsRows = this.crypto.isEnabled()
      ? this.db
          .prepare(
            `SELECT
              MIN(calling_party) as calling_party,
              COUNT(1) as count
            FROM smdr_records
            WHERE date = ?
            GROUP BY calling_party_hash
            ORDER BY count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ calling_party: string; count: number }>
      : this.db
          .prepare(
            `SELECT
              calling_party,
              COUNT(1) as count
            FROM smdr_records
            WHERE date = ?
            GROUP BY calling_party
            ORDER BY count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ calling_party: string; count: number }>;

    const topDialedRows = this.crypto.isEnabled()
      ? this.db
          .prepare(
            `SELECT
              MIN(called_party) as called_party,
              COUNT(1) as count
            FROM smdr_records
            WHERE date = ?
            GROUP BY called_party_hash
            ORDER BY count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ called_party: string; count: number }>
      : this.db
          .prepare(
            `SELECT
              called_party,
              COUNT(1) as count
            FROM smdr_records
            WHERE date = ?
            GROUP BY called_party
            ORDER BY count DESC
            LIMIT 25`
          )
          .all(date) as Array<{ called_party: string; count: number }>;

    const longCallRows = this.db
      .prepare(
        `SELECT
          date,
          start_time,
          duration,
          calling_party,
          called_party,
          third_party,
          trunk_number,
          digits_dialed,
          account_code,
          call_completion_status,
          transfer_flag,
          call_identifier,
          call_sequence_identifier,
          associated_call_identifier,
          network_oli,
          call_type,
          raw_line
        FROM smdr_records
        WHERE date = ? AND duration_seconds >= 1800
        ORDER BY duration_seconds DESC
        LIMIT 100`
      )
      .all(date) as DbRecordRow[];

    return {
      date,
      lastUpdatedAt: new Date().toISOString(),
      totalCallsToday,
      totalDurationSeconds,
      incomingCalls,
      outgoingCalls,
      internalCalls,
      internalDurationSeconds,
      inboundCalls,
      inboundDurationSeconds,
      outboundCalls,
      outboundDurationSeconds,
      totalCostToday,
      avgCallDurationSeconds: totalCallsToday > 0 ? Math.round(totalDurationSeconds / totalCallsToday) : 0,
      highCostCalls,
      sevenDayTrend,
      callDistribution,
      topExtensionsByCostAndVolume: topExtensionCostRows.map((row) => ({
        extension: this.crypto.decrypt(row.extension) ?? row.extension,
        count: row.count,
        totalCost: Number(row.total_cost ?? 0)
      })),
      topExtensions: topExtensionsRows.map((row) => ({
        extension: this.crypto.decrypt(row.calling_party) ?? row.calling_party,
        count: row.count
      })),
      topDialedNumbers: topDialedRows.map((row) => ({
        number: this.crypto.decrypt(row.called_party) ?? row.called_party,
        count: row.count
      })),
      longCalls: longCallRows.map((row) => this.mapRecord(row)),
      activeStream: false
    };
  }

  getBillingReport(query: BillingReportQuery = {}): BillingReportData {
    const where: string[] = [];
    const params: Array<string | number> = [];

    const from = query.from?.trim();
    const to = query.to?.trim();
    if (from && to) {
      const normalizedFrom = from <= to ? from : to;
      const normalizedTo = from <= to ? to : from;
      where.push('date >= ? AND date <= ?');
      params.push(normalizedFrom, normalizedTo);
    } else if (from) {
      where.push('date >= ?');
      params.push(from);
    } else if (to) {
      where.push('date <= ?');
      params.push(to);
    }

    const extension = query.extension?.trim();
    if (extension) {
      if (this.crypto.isEnabled()) {
        const hash = this.crypto.hashForIndex(extension) ?? '';
        where.push('(calling_party_hash = ? OR called_party_hash = ?)');
        params.push(hash, hash);
      } else {
        const exactExtension = /^[A-Za-z0-9*#_-]{2,24}$/.test(extension);
        if (exactExtension) {
          where.push('(calling_party = ? OR called_party = ? OR third_party = ?)');
          params.push(extension, extension, extension);
        } else {
          where.push('(calling_party LIKE ? OR called_party LIKE ? OR third_party LIKE ?)');
          const pattern = `%${extension}%`;
          params.push(pattern, pattern, pattern);
        }
      }
    }

    if (query.category) {
      where.push("COALESCE(NULLIF(call_category, ''), 'unclassified') = ?");
      params.push(query.category);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const summary = this.db.prepare(
      `SELECT
         COALESCE(NULLIF(call_category, ''), 'unclassified') AS call_category,
         COUNT(*) AS call_count,
         COALESCE(SUM(duration_seconds), 0) AS total_duration_secs,
         COALESCE(SUM(call_cost), 0) AS total_cost,
         COALESCE(SUM(tax_amount), 0) AS total_tax,
         COALESCE(AVG(call_cost), 0) AS avg_cost,
         COALESCE(MAX(call_cost), 0) AS max_cost,
         COALESCE(NULLIF(bill_currency, ''), 'PHP') AS currency
       FROM smdr_records ${clause}
       GROUP BY COALESCE(NULLIF(call_category, ''), 'unclassified'), COALESCE(NULLIF(bill_currency, ''), 'PHP')
       ORDER BY total_cost DESC`
    ).all(...params) as BillingReportData['summary'];

    const trend = this.db.prepare(
      `SELECT
         date,
         COUNT(*) AS call_count,
         COALESCE(SUM(call_cost), 0) AS total_cost,
         COALESCE(NULLIF(bill_currency, ''), 'PHP') AS currency
       FROM smdr_records ${clause}
       GROUP BY date, COALESCE(NULLIF(bill_currency, ''), 'PHP')
       ORDER BY date ASC, currency ASC`
    ).all(...params) as BillingReportData['dailyTrend'];

    const includeAllTopCalls = query.includeAllTopCalls === true;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(Math.max(1, query.pageSize ?? 20), 100);
    const topCallsLimit = Math.min(Math.max(1, query.topCallsLimit ?? 1000), 5000);
    const offset = (page - 1) * pageSize;
    const sortBy: BillingReportSortBy = query.sortBy ?? 'cost';
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const orderSql = sortBy === 'date'
      ? `date ${sortDir}, start_time ${sortDir}, id ${sortDir}`
      : sortBy === 'duration'
        ? `duration_seconds ${sortDir}, id ${sortDir}`
        : `call_cost ${sortDir}, id ${sortDir}`;

    const totalRow = this.db.prepare(`SELECT COUNT(1) as count FROM smdr_records ${clause}`).get(...params) as { count: number };
    const topCallsSql = includeAllTopCalls
      ? `SELECT
           id,
           date,
           start_time,
           calling_party,
           called_party,
           digits_dialed,
           duration_seconds,
           COALESCE(NULLIF(call_category, ''), 'unclassified') AS call_category,
           COALESCE(call_cost, 0) AS call_cost,
           COALESCE(tax_amount, 0) AS tax_amount,
           COALESCE(NULLIF(bill_currency, ''), 'PHP') AS bill_currency,
           matched_prefix,
           COALESCE(rate_per_minute, 0) AS rate_per_minute
         FROM smdr_records ${clause}
         ORDER BY ${orderSql}
         LIMIT ?`
      : `SELECT
           id,
           date,
           start_time,
           calling_party,
           called_party,
           digits_dialed,
           duration_seconds,
           COALESCE(NULLIF(call_category, ''), 'unclassified') AS call_category,
           COALESCE(call_cost, 0) AS call_cost,
           COALESCE(tax_amount, 0) AS tax_amount,
           COALESCE(NULLIF(bill_currency, ''), 'PHP') AS bill_currency,
           matched_prefix,
           COALESCE(rate_per_minute, 0) AS rate_per_minute
         FROM smdr_records ${clause}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`;

    const rawTopCostCalls = this.db.prepare(
      topCallsSql
    ).all(...params, ...(includeAllTopCalls ? [topCallsLimit] : [pageSize, offset])) as Array<{
      id: number;
      date: string;
      start_time: string;
      calling_party: string;
      called_party: string;
      digits_dialed?: string | null;
      duration_seconds: number;
      call_category: BillingReportTopCostCall['call_category'];
      call_cost: number;
      tax_amount: number;
      bill_currency: string;
      matched_prefix: string | null;
      rate_per_minute: number;
    }>;

    const topCostCalls: BillingReportTopCostCall[] = rawTopCostCalls.map((row) => {
      // Show full extension numbers in billing report (no masking)
      const callingParty = this.crypto.decrypt(row.calling_party) ?? row.calling_party;
      const calledParty = this.crypto.decrypt(row.called_party) ?? row.called_party;
      const digitsDialed = this.crypto.decrypt(row.digits_dialed ?? undefined) ?? row.digits_dialed ?? undefined;
      return {
        ...row,
        calling_party: callingParty ?? '',
        called_party: calledParty ?? '',
        digits_dialed: digitsDialed ?? null
      };
    });

    return {
      summary,
      dailyTrend: trend,
      topCostCalls,
      topCostCallsTotal: totalRow.count ?? 0,
      topCostCallsTruncated: includeAllTopCalls ? rawTopCostCalls.length < (totalRow.count ?? 0) : false
    };
  }

  getAnalyticsSnapshot(startDate?: string, endDate?: string): AnalyticsSnapshot {
    const latest = this.db
      .prepare('SELECT MAX(date) as max_date FROM analytics_hourly_stats')
      .get() as { max_date?: string };

    let effectiveStart = startDate;
    let effectiveEnd = endDate;
    if (!effectiveStart && !effectiveEnd && latest.max_date) {
      effectiveEnd = latest.max_date;
      effectiveStart = dayjs(latest.max_date).subtract(6, 'day').format('YYYY-MM-DD');
    }
    if (effectiveStart && !effectiveEnd) effectiveEnd = effectiveStart;
    if (!effectiveStart && effectiveEnd) effectiveStart = effectiveEnd;
    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      const tmp = effectiveStart;
      effectiveStart = effectiveEnd;
      effectiveEnd = tmp;
    }

    const cacheKey = `${effectiveStart ?? ''}|${effectiveEnd ?? ''}`;
    const cached = this.analyticsSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }

    const where: string[] = [];
    const params: string[] = [];
    if (effectiveStart) {
      where.push('date >= ?');
      params.push(effectiveStart);
    }
    if (effectiveEnd) {
      where.push('date <= ?');
      params.push(effectiveEnd);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const hourlyRows = this.db
      .prepare(
        `SELECT hour, SUM(calls) as count
         FROM analytics_hourly_stats ${clause}
         GROUP BY hour
         ORDER BY hour ASC`
      )
      .all(...params) as Array<{ hour: number; count: number }>;
    const hourMap = new Map<number, number>();
    for (const row of hourlyRows) hourMap.set(row.hour, row.count);
    const volumeByHour = Array.from({ length: 24 }, (_, hour) => ({
      hour: String(hour).padStart(2, '0'),
      count: hourMap.get(hour) ?? 0
    }));

    const dayList = effectiveStart && effectiveEnd
      ? buildDateRange(effectiveStart, effectiveEnd)
      : [];

    const heatRows = this.db
      .prepare(
        `SELECT date as day, hour, calls as count
         FROM analytics_hourly_stats ${clause}
         ORDER BY day ASC, hour ASC`
      )
      .all(...params) as Array<{ day: string; hour: number; count: number }>;

    const dayHourMap = new Map<string, number>();
    const discoveredDays: string[] = [];
    for (const row of heatRows) {
      dayHourMap.set(`${row.day}|${row.hour}`, row.count);
      if (!discoveredDays.includes(row.day)) discoveredDays.push(row.day);
    }
    const heatmapDays = dayList.length ? dayList : discoveredDays;
    const heatmap = heatmapDays.flatMap((day) =>
      Array.from({ length: 24 }, (_, hour) => ({
        day,
        hour,
        count: dayHourMap.get(`${day}|${hour}`) ?? 0
      }))
    );

    const summaryRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(calls), 0) as total_calls,
           COALESCE(SUM(total_duration_seconds), 0) as total_duration_seconds,
           COALESCE(SUM(answered_calls), 0) as answered_calls,
           COALESCE(SUM(transfer_conference_calls), 0) as transfer_conference_calls
         FROM analytics_hourly_stats ${clause}`
      )
      .get(...params) as {
        total_calls: number;
        total_duration_seconds: number;
        answered_calls: number;
        transfer_conference_calls: number;
      };

    const peakHourEntry = volumeByHour.reduce((best, current) => (current.count > best.count ? current : best), volumeByHour[0] ?? { hour: '00', count: 0 });
    const summary: AnalyticsSummary = {
      totalCalls: summaryRow.total_calls,
      totalDurationSeconds: summaryRow.total_duration_seconds,
      answeredCalls: summaryRow.answered_calls,
      answeredRate: summaryRow.total_calls > 0 ? roundToOneDecimal((summaryRow.answered_calls / summaryRow.total_calls) * 100) : 0,
      avgDurationSeconds: summaryRow.total_calls > 0 ? Math.round(summaryRow.total_duration_seconds / summaryRow.total_calls) : 0,
      peakHour: peakHourEntry.hour,
      transferConferenceCalls: summaryRow.transfer_conference_calls,
      transferConferenceRate:
        summaryRow.total_calls > 0
          ? roundToOneDecimal((summaryRow.transfer_conference_calls / summaryRow.total_calls) * 100)
          : 0
    };

    const extensionUsageRows = this.crypto.isEnabled()
      ? this.db
          .prepare(
            `SELECT MIN(calling_party) as extension, COUNT(1) as calls, COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
             FROM smdr_records ${clause}
             GROUP BY calling_party_hash
             ORDER BY calls DESC
             LIMIT 100`
          )
          .all(...params) as Array<{ extension: string; calls: number; total_duration_seconds: number }>
      : this.db
          .prepare(
            `SELECT calling_party as extension, COUNT(1) as calls, COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
             FROM smdr_records ${clause}
             GROUP BY extension
             ORDER BY calls DESC
             LIMIT 100`
          )
          .all(...params) as Array<{ extension: string; calls: number; total_duration_seconds: number }>;

    const transferRows = this.db
      .prepare(
        `SELECT COALESCE(transfer_flag, 'none') as flag, COUNT(1) as count
         FROM smdr_records ${clause}
         GROUP BY COALESCE(transfer_flag, 'none')`
      )
      .all(...params) as Array<{ flag: string; count: number }>;
    const transferMap = new Map<string, number>();
    for (const row of transferRows) transferMap.set(row.flag, row.count);
    const defaultTransferFlags = ['none', 'T', 'X', 'C'];
    const extraFlags = Array.from(transferMap.keys()).filter((flag) => !defaultTransferFlags.includes(flag)).sort();
    const transferConference = [...defaultTransferFlags, ...extraFlags].map((flag) => ({
      flag,
      count: transferMap.get(flag) ?? 0
    }));

    const correlationsWhere = [
      ...where,
      '(call_identifier IS NOT NULL OR associated_call_identifier IS NOT NULL OR network_oli IS NOT NULL)'
    ];
    const correlationsClause = correlationsWhere.length ? `WHERE ${correlationsWhere.join(' AND ')}` : '';
    const correlationRows = this.db
      .prepare(
        `SELECT
          call_identifier,
          associated_call_identifier,
          network_oli,
          COUNT(1) as count
         FROM smdr_records ${correlationsClause}
         GROUP BY call_identifier, associated_call_identifier, network_oli
         HAVING COUNT(1) >= 2
         ORDER BY count DESC
         LIMIT 300`
      )
      .all(...params) as Array<{
        call_identifier?: string;
        associated_call_identifier?: string;
        network_oli?: string;
        count: number;
      }>;
    const avgCorrelationCount =
      correlationRows.length > 0 ? correlationRows.reduce((sum, row) => sum + row.count, 0) / correlationRows.length : 0;
    const variance =
      correlationRows.length > 0
        ? correlationRows.reduce((sum, row) => sum + (row.count - avgCorrelationCount) ** 2, 0) / correlationRows.length
        : 0;
    const stdDev = Math.sqrt(variance);

    const correlations = correlationRows
      .map((row) => {
        const anomalyScore = stdDev > 0 ? (row.count - avgCorrelationCount) / stdDev : 0;
        const severity: 'low' | 'medium' | 'high' | 'critical' =
          row.count >= 12 || anomalyScore >= 3
            ? 'critical'
            : row.count >= 8 || anomalyScore >= 2
              ? 'high'
              : row.count >= 4 || anomalyScore >= 1
                ? 'medium'
                : 'low';
        return {
          key: `${row.call_identifier ?? '-'}|${row.associated_call_identifier ?? '-'}|${row.network_oli ?? '-'}`,
          callIdentifier: row.call_identifier,
          associatedCallIdentifier: row.associated_call_identifier,
          networkOLI: row.network_oli,
          count: row.count,
          anomalyScore: roundToTwoDecimals(anomalyScore),
          severity
        };
      })
      .sort((a, b) => {
        if (a.severity === b.severity) return b.count - a.count;
        return severityRank(b.severity) - severityRank(a.severity);
      })
      .slice(0, 100);

    const snapshot: AnalyticsSnapshot = {
      volumeByHour,
      heatmap,
      extensionUsage: extensionUsageRows.map((row) => ({
        extension: this.crypto.decrypt(row.extension) ?? row.extension,
        calls: row.calls,
        totalDurationSeconds: row.total_duration_seconds,
        avgHandleTime: row.calls > 0 ? Math.round(row.total_duration_seconds / row.calls) : 0
      })),
      transferConference,
      summary,
      correlations
    };

    this.analyticsSnapshotCache.set(cacheKey, {
      expiresAt: Date.now() + 15_000,
      snapshot
    });
    return snapshot;
  }

  export(options: ExportOptions): string {
    const records = this.getRecords({
      ...(options.filters ?? {}),
      limit: 75_000,
      offset: 0
    });

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });

    if (options.format === 'csv') {
      const csv = toCsv(records);
      fs.writeFileSync(options.outputPath, csv, 'utf8');
    } else if (options.format === 'pdf') {
      // PDF export - use jsPDF (same as WebServer)
      const { jsPDF } = require('jspdf');
      const autoTable = require('jspdf-autotable');
      
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.setFontSize(16);
      doc.text('SMDR Call Log Report', 14, 15);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 21);
      doc.text(`Total Records: ${records.length}`, 14, 26);

      const tableData = records.map((r: any) => [
        r.date || '',
        r.startTime || '',
        r.callingParty || '',
        r.calledParty || '',
        r.duration || '',
        r.callType || '',
        r.call_completion_status || ''
      ]);

      autoTable(doc, {
        head: [['Date', 'Time', 'From', 'To', 'Duration', 'Type', 'Status']],
        body: tableData,
        startY: 32,
        theme: 'striped',
        headStyles: { fillColor: [36, 132, 235], textColor: [255, 255, 255], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 20 },
          2: { cellWidth: 30 },
          3: { cellWidth: 30 },
          4: { cellWidth: 25 },
          5: { cellWidth: 20 },
          6: { cellWidth: 20 }
        },
        margin: { top: 32, left: 14, right: 14 }
      });

      const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
      fs.writeFileSync(options.outputPath, pdfBuffer);
    } else {
      // xlsx
      const sheet = XLSX.utils.json_to_sheet(records);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'SMDR');
      XLSX.writeFile(workbook, options.outputPath);
    }

    return options.outputPath;
  }

  purgeOlderThan(days: number): number {
    const cutoff = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const info = this.db.prepare('DELETE FROM smdr_records WHERE date < ?').run(cutoff);
    this.db.prepare('DELETE FROM analytics_hourly_stats WHERE date < ?').run(cutoff);
    this.analyticsSnapshotCache.clear();
    return info.changes;
  }

  countOlderThan(days: number): number {
    const cutoff = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const row = this.db.prepare('SELECT COUNT(1) as count FROM smdr_records WHERE date < ?').get(cutoff) as { count: number };
    return row.count;
  }

  runDailyRollover(archiveDirectory: string, retentionDays: number): { archivedFile?: string; purged: number } {
    fs.mkdirSync(archiveDirectory, { recursive: true });
    const previousDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const count = (this.db.prepare('SELECT COUNT(1) as count FROM smdr_records WHERE date = ?').get(previousDate) as { count: number }).count;

    let archivedFile: string | undefined;
    if (count > 0) {
      const outputPath = path.join(archiveDirectory, `smdr-${previousDate}.csv`);
      if (!fs.existsSync(outputPath)) {
        this.export({ format: 'csv', outputPath, filters: { date: previousDate, limit: 75_000 } });
        archivedFile = outputPath;
      }
    }

    const purged = this.purgeOlderThan(retentionDays);
    return { archivedFile, purged };
  }

  private mapRecord(row: DbRecordRow): SMDRRecord {
    return {
      // Core fields
      date: row.date,
      startTime: row.start_time,
      duration: row.duration,
      callingParty: this.crypto.decrypt(row.calling_party) ?? row.calling_party,
      calledParty: this.crypto.decrypt(row.called_party) ?? row.called_party,
      thirdParty: this.crypto.decrypt(row.third_party),
      trunkNumber: row.trunk_number,
      digitsDialed: this.crypto.decrypt(row.digits_dialed),
      accountCode: this.crypto.decrypt(row.account_code),
      callCompletionStatus: row.call_completion_status as CallCompletionCode | undefined,
      transferConference: row.transfer_flag as TransferConferenceCode | undefined,
      transferFlag: row.transfer_flag,
      callIdentifier: row.call_identifier,
      callSequenceIdentifier: row.call_sequence_identifier,
      associatedCallIdentifier: row.associated_call_identifier,
      networkOLI: row.network_oli,
      callType: row.call_type,
      rawLine: row.raw_line,
      // Mitel spec fields
      longCallIndicator: row.long_call_indicator as LongCallIndicator | undefined,
      attendantFlag: row.attendant_flag as '*' | '' | undefined,
      timeToAnswer: row.time_to_answer ?? null,
      meterPulses: row.meter_pulses ?? null,
      speedCallForwardFlag: row.speed_call_forward_flag as SpeedCallForwardCode | undefined,
      routeOptFlag: row.route_opt_flag as RouteOptCode | undefined,
      systemId: row.system_id,
      mlppLevel: row.mlpp_level,
      ani: row.ani,
      dnis: row.dnis,
      callSequence: row.call_sequence,
      suiteId: row.suite_id,
      twoBChannelTag: row.two_b_channel_tag,
      callingEHDU: row.calling_ehdu,
      calledEHDU: row.called_ehdu,
      callingLocation: row.calling_location,
      calledLocation: row.called_location,
      recordFormat: row.record_format as SMDRFormatVariant | undefined,
      recordLength: row.record_length,
      isMultiLine: row.is_multi_line === 1,
      parsedAt: row.parsed_at,
    };
  }

  private maskParty(value?: string): string | undefined {
    if (!value) return value;
    const normalized = value.trim();
    if (!normalized) return normalized;
    if (normalized.length <= 2) return normalized;
    if (normalized.length <= 4) {
      return `${normalized[0]}${'*'.repeat(Math.max(0, normalized.length - 2))}${normalized[normalized.length - 1]}`;
    }
    const keepStart = normalized.length <= 6 ? 1 : 2;
    const keepEnd = 2;
    const hidden = Math.max(1, normalized.length - keepStart - keepEnd);
    return `${normalized.slice(0, keepStart)}${'*'.repeat(hidden)}${normalized.slice(-keepEnd)}`;
  }

  /**
   * Run database optimization (VACUUM and ANALYZE)
   * Should be run periodically for performance maintenance
   */
  optimize(): void {
    console.log('[DB] Running database optimization...');
    
    // Run ANALYZE to update query planner statistics
    this.db.exec('ANALYZE');
    console.log('[DB] ANALYZE completed');

    // Run VACUUM to reclaim space (only if WAL is small)
    const walSize = this.getWalSize();
    if (walSize > 10 * 1024 * 1024) { // Only if WAL > 10MB
      console.log(`[DB] Skipping VACUUM - WAL file is too large (${(walSize / 1024 / 1024).toFixed(2)} MB)`);
      console.log('[DB] Consider running backup instead to checkpoint WAL');
    } else {
      this.db.exec('VACUUM');
      console.log('[DB] VACUUM completed');
    }
  }

  /**
   * Get WAL file size
   */
  private getWalSize(): number {
    try {
      const walPath = `${this.dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        return fs.statSync(walPath).size;
      }
    } catch {
      // Ignore errors
    }
    return 0;
  }

  /**
   * Get database statistics
   */
  getStats(): {
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    walSize: number;
    totalSize: number;
  } {
    const stats = this.db.pragma('page_count') as { page_count: number }[];
    const pageSize = this.db.pragma('page_size') as { page_size: number }[];
    const freelist = this.db.pragma('freelist_count') as { freelist_count: number }[];
    const walSize = this.getWalSize();

    const pageCount = stats[0]?.page_count ?? 0;
    const size = pageSize[0]?.page_size ?? 4096;
    const freelistCount = freelist[0]?.freelist_count ?? 0;

    return {
      pageCount,
      pageSize: size,
      freelistCount,
      walSize,
      totalSize: pageCount * size + walSize
    };
  }
}

function durationToSeconds(duration: string): number {
  const chunks = duration.split(':').map((chunk) => Number(chunk));
  if (chunks.some(Number.isNaN)) return 0;
  if (chunks.length === 2) return chunks[0] * 60 + chunks[1];
  return chunks[0] * 3600 + chunks[1] * 60 + chunks[2];
}

function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = dayjs(startDate);
  const end = dayjs(endDate);
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    dates.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }
  return dates;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function severityRank(value: 'low' | 'medium' | 'high' | 'critical'): number {
  switch (value) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

function toCsv(records: SMDRRecord[]): string {
  if (records.length === 0) return '';

  const headers = Object.keys(records[0]) as Array<keyof SMDRRecord>;
  const lines = [headers.join(',')];

  for (const record of records) {
    const row = headers.map((header) => {
      const value = String(record[header] ?? '');
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    lines.push(row.join(','));
  }

  return `${lines.join('\n')}\n`;
}
