import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import dayjs from 'dayjs';
import {
  AlertEvent,
  AlertRuleSet,
  AnalyticsSnapshot,
  AppConfig,
  AuthCredentials,
  BillingReportData,
  BillingReportQuery,
  CallLogSummary,
  ConnectionEvent,
  ConnectionEventsPage,
  DashboardMetrics,
  ExportOptions,
  ParseError,
  RecordFilters,
  RecordsPage,
  ServiceState,
  SMDRImportResult,
  SMDRRecord
} from '../shared/types';
import { ConnectionManager } from './connection/ConnectionManager';
import { DatabaseService } from './db/DatabaseService';
import { AlertEngine } from './alerts/AlertEngine';
import { AnalyticsService } from './analytics/AnalyticsService';
import { AuthService } from './security/AuthService';
import { SMDRParser } from './parser/SMDRParser';
import { InputSanitizer } from './security/InputSanitizer';

interface ServiceEvent {
  type: 'status' | 'record' | 'alert' | 'connection-event' | 'parse-error';
  payload: unknown;
}

type IngestStatus = 'inserted' | 'duplicate' | 'parse-error';

interface IngestOptions {
  emitRecordEvent?: boolean;
  emitAlertEvents?: boolean;
  emitParseErrorEvent?: boolean;
}

const RECORD_HEADER_PATTERN = /^(?:@\d{8}@\s+)?(?:[%+\-])?(?:\d{2}[/-]\d{2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{6}|\d{8})\s+(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?P?|(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?P?)\b/;
const CONTINUATION_HINT_PATTERN = /^(?:\d{1,3}\b|[A-Z]\d{3,}\b|[*#0-9A-Za-z]+\s+\d{1,3}\b|\d+\s+[A-Z]\b)/;

export class SMDRService extends EventEmitter {
  private readonly parser: SMDRParser;
  private readonly db: DatabaseService;
  private readonly connection: ConnectionManager;
  private readonly alerts: AlertEngine;
  private readonly analytics: AnalyticsService;
  private readonly auth: AuthService;
  private rolloverTimer: NodeJS.Timeout | null = null;
  private recentRecords: SMDRRecord[] = [];
  private recentRecordHashes = new Set<string>(); // For deduplication
  private readonly debugLogging = process.env.SMDR_DEBUG === '1';

  constructor(private config: AppConfig) {
    super();

    this.db = new DatabaseService(config.storage.dbPath, config.storage.encryptionKey);
    this.db.init();
    this.auth = new AuthService(this.db.getRawDb());
    this.auth.init();

    // Initialize parser with config
    this.parser = new SMDRParser(config.smdrParser);

    this.connection = new ConnectionManager(config.connection);
    this.alerts = new AlertEngine(config.alerts);
    this.analytics = new AnalyticsService(this.db);

    this.registerConnectionHandlers();
  }

  start(): void {
    this.connection.start();
    this.scheduleRollover();
  }

  stop(): void {
    this.connection.stop();
    if (this.rolloverTimer) clearInterval(this.rolloverTimer);
    this.rolloverTimer = null;
  }

  close(): void {
    this.stop();
    this.db.close();
  }

  verifyLogin(credentials: AuthCredentials): boolean {
    const result = this.auth.authenticate(credentials);
    return result.success;
  }

  createUser(credentials: AuthCredentials): void {
    this.auth.createUser(credentials);
  }

  updateConfig(next: AppConfig): void {
    const preservedEncryptionKey = next.storage.encryptionKey ?? this.config.storage.encryptionKey;
    const normalizedConfig: AppConfig = {
      ...next,
      storage: {
        ...next.storage,
        encryptionKey: preservedEncryptionKey
      }
    };

    this.config = normalizedConfig;
    this.connection.updateConfig(normalizedConfig.connection);
    this.alerts.updateRules(normalizedConfig.alerts);
    // Update parser config
    this.parser.updateConfig(normalizedConfig.smdrParser);
    this.emit('config-change', normalizedConfig);
  }

  updateAlertRules(rules: AlertRuleSet): void {
    this.config.alerts = rules;
    this.alerts.updateRules(rules);
    this.emit('config-change', this.config);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getState(): ServiceState {
    return {
      connectionStatus: this.connection.getStatus(),
      activeController: this.connection.getActiveController(),
      parserOptions: this.parser.getDetectedOptions(),
      recentRecordsCount: this.recentRecords.length,
      maxInMemoryRecords: Math.max(50, this.config.maxInMemoryRecords)
    };
  }

  getRawDb() {
    return this.db.getRawDb();
  }

  getDatabaseStats(): {
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    walSize: number;
    totalSize: number;
  } {
    return this.db.getStats();
  }

  optimizeDatabase(): void {
    this.db.optimize();
  }

  getRecords(filters: RecordFilters): SMDRRecord[] {
    return this.db.getRecords(filters);
  }

  getRecordsPage(filters: RecordFilters): RecordsPage {
    return this.db.getRecordsPage(filters);
  }

  getCallLogSummary(filters: RecordFilters): CallLogSummary {
    return this.db.getCallLogSummary(filters);
  }

  getRecentRecords(): SMDRRecord[] {
    return this.recentRecords;
  }

  importSmdrText(content: string, sourceName?: string): SMDRImportResult {
    const safeContent = typeof content === 'string' ? content : '';
    const rawLines = safeContent.split(/\r?\n/);
    const { records, skippedLines } = this.buildLogicalRecords(rawLines);
    const source = sourceName?.trim() || 'manual upload';

    let parsedRecords = 0;
    let insertedRecords = 0;
    let duplicateRecords = 0;
    let parseErrors = 0;

    for (const logicalLine of records) {
      const outcome = this.ingestLine(logicalLine, {
        emitRecordEvent: false,
        emitAlertEvents: false,
        emitParseErrorEvent: false
      });

      if (outcome === 'parse-error') {
        parseErrors += 1;
        continue;
      }

      parsedRecords += 1;
      if (outcome === 'inserted') {
        insertedRecords += 1;
      } else {
        duplicateRecords += 1;
      }
    }

    const summary: SMDRImportResult = {
      sourceName: source,
      totalLines: rawLines.length,
      logicalRecords: records.length,
      parsedRecords,
      insertedRecords,
      duplicateRecords,
      parseErrors,
      skippedLines
    };

    this.emitServiceEvent('connection-event', {
      level: 'info',
      message: `Imported ${insertedRecords}/${records.length} SMDR records from ${source}${duplicateRecords > 0 ? ` (${duplicateRecords} duplicates skipped)` : ''}`,
      createdAt: new Date().toISOString()
    } satisfies ConnectionEvent);

    return summary;
  }

  getDashboard(date?: string): DashboardMetrics {
    const metrics = this.db.getDashboardMetrics(date);
    metrics.activeStream = this.connection.getStatus() === 'connected';
    return metrics;
  }

  getAnalytics(startDate?: string, endDate?: string): AnalyticsSnapshot {
    return this.analytics.getSnapshot(startDate, endDate);
  }

  getBillingReport(query: BillingReportQuery = {}): BillingReportData {
    return this.db.getBillingReport(query);
  }

  getAlerts(limit?: number): AlertEvent[] {
    return this.db.getAlerts(limit);
  }

  getParseErrors(limit?: number): ParseError[] {
    return this.db.getParseErrors(limit);
  }

  getConnectionEvents(options?: {
    level?: ConnectionEvent['level'];
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): ConnectionEventsPage {
    return this.db.getConnectionEvents(options);
  }

  exportRecords(options: ExportOptions): string {
    return this.db.export({
      ...options,
      outputPath: this.buildTimestampedExportPath(options.outputPath, options.format)
    });
  }

  purge(days: number): number {
    return this.db.purgeOlderThan(days);
  }

  purgeRecords(days: number): number {
    return this.purge(days);
  }

  estimatePurgeRecords(days: number): { count: number; cutoffDate: string } {
    const cutoffDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const count = this.db.countOlderThan(days);
    return { count, cutoffDate };
  }

  private registerConnectionHandlers(): void {
    this.connection.on('status', (status) => {
      this.emitServiceEvent('status', status);
    });

    this.connection.on('event', (event: ConnectionEvent) => {
      this.db.insertConnectionEvent(event);
      this.emitServiceEvent('connection-event', event);
    });

    this.connection.on('line', (line) => {
      this.ingestLine(line, {
        emitRecordEvent: true,
        emitAlertEvents: true,
        emitParseErrorEvent: true
      });
    });
  }

  private emitServiceEvent(type: ServiceEvent['type'], payload: unknown): void {
    const event: ServiceEvent = { type, payload };
    this.emit('event', event);
  }

  private scheduleRollover(): void {
    if (this.rolloverTimer) clearInterval(this.rolloverTimer);

    this.rolloverTimer = setInterval(() => {
      const outcome = this.db.runDailyRollover(this.config.storage.archiveDirectory, this.config.storage.retentionDays);
      if (outcome.archivedFile) {
        this.emitServiceEvent('connection-event', {
          level: 'info',
          message: `Daily rollover archive generated: ${outcome.archivedFile}`,
          createdAt: new Date().toISOString()
        } satisfies ConnectionEvent);
      }
      if (outcome.purged > 0) {
        this.emitServiceEvent('connection-event', {
          level: 'info',
          message: `Purged ${outcome.purged} records beyond retention policy`,
          createdAt: new Date().toISOString()
        } satisfies ConnectionEvent);
      }
    }, 60 * 60 * 1000);
  }

  private buildTimestampedExportPath(outputPath: string, format: 'csv' | 'xlsx' | 'pdf'): string {
    const expectedExt = format === 'csv' ? '.csv' : format === 'pdf' ? '.pdf' : '.xlsx';
    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const normalizedPath = outputPath.trim();

    const isDirectoryTarget =
      normalizedPath.endsWith(path.sep) || (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isDirectory());

    if (isDirectoryTarget) {
      return path.join(normalizedPath, `smdr-export-${timestamp}${expectedExt}`);
    }

    const parsed = path.parse(normalizedPath);
    const name = parsed.name || 'smdr-export';
    return path.join(parsed.dir || '.', `${name}-${timestamp}${expectedExt}`);
  }

  private buildRecordHash(record: SMDRRecord): string {
    return [
      record.date,
      record.startTime,
      record.duration,
      record.callingParty,
      record.calledParty,
      record.thirdParty ?? '',
      record.trunkNumber ?? '',
      record.digitsDialed ?? '',
      record.accountCode ?? '',
      record.callCompletionStatus ?? '',
      record.transferConference ?? '',
      record.callIdentifier ?? '',
      record.callSequence ?? '',
      record.associatedCallIdentifier ?? '',
      record.ani ?? '',
      record.dnis ?? '',
      record.recordLength ?? '',
      record.rawLine ?? ''
    ].join('|');
  }

  private ingestLine(line: string, options: IngestOptions): IngestStatus {
    const result = this.parser.parse(line);
    if (!result.record) {
      if (result.error) {
        this.db.insertParseError(result.error);
        if (options.emitParseErrorEvent !== false) {
          this.emitServiceEvent('parse-error', result.error);
        }
        if (this.debugLogging) console.warn('[SMDRService] Parse error:', result.error.reason);
      }
      return 'parse-error';
    }

    const record = result.record;
    const recordHash = this.buildRecordHash(record);

    if (this.recentRecordHashes.has(recordHash)) {
      if (this.debugLogging) console.log('[SMDRService] Duplicate record detected, skipping');
      return 'duplicate';
    }

    const inserted = this.db.insertRecord(record);
    if (!inserted) {
      if (this.debugLogging) console.log('[SMDRService] DB dedupe rejected duplicate record');
      return 'duplicate';
    }

    this.recentRecords.unshift(record);
    this.recentRecords = this.recentRecords.slice(0, Math.max(50, this.config.maxInMemoryRecords));
    this.recentRecordHashes.add(recordHash);

    if (this.recentRecordHashes.size > 1000) {
      const toDelete = Array.from(this.recentRecordHashes).slice(0, 500);
      toDelete.forEach((hash) => this.recentRecordHashes.delete(hash));
    }

    if (options.emitRecordEvent !== false) {
      this.emitServiceEvent('record', record);
    }

    const alerts = this.alerts.evaluate(record);
    for (const alert of alerts) {
      this.db.insertAlert(alert);
      if (options.emitAlertEvents !== false) {
        this.emitServiceEvent('alert', alert);
      }
      if (this.debugLogging) console.log('[SMDRService] Alert:', alert.type);
    }

    return 'inserted';
  }

  private buildLogicalRecords(lines: string[]): { records: string[]; skippedLines: number } {
    const records: string[] = [];
    let pendingRecord: string | null = null;
    let skippedLines = 0;

    const flushPending = () => {
      if (pendingRecord) {
        records.push(pendingRecord);
        pendingRecord = null;
      }
    };

    for (const rawLine of lines) {
      const sanitized = InputSanitizer.sanitizeLine(rawLine);
      const trimmed = sanitized.trim();

      if (!trimmed) {
        skippedLines += 1;
        flushPending();
        continue;
      }

      if (this.isRecordHeader(sanitized)) {
        flushPending();
        pendingRecord = sanitized;
        continue;
      }

      if (pendingRecord && this.isLikelyContinuation(sanitized)) {
        pendingRecord = `${pendingRecord} ${trimmed}`;
        continue;
      }

      flushPending();
      records.push(sanitized);
    }

    flushPending();
    return { records, skippedLines };
  }

  private isRecordHeader(line: string): boolean {
    return RECORD_HEADER_PATTERN.test(line.trimStart());
  }

  private isLikelyContinuation(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || this.isRecordHeader(trimmed)) return false;
    return CONTINUATION_HINT_PATTERN.test(trimmed);
  }
}
