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
  SMDRRecord
} from '../shared/types';
import { ConnectionManager } from './connection/ConnectionManager';
import { DatabaseService } from './db/DatabaseService';
import { AlertEngine } from './alerts/AlertEngine';
import { AnalyticsService } from './analytics/AnalyticsService';
import { AuthService } from './security/AuthService';
import { SMDRParser } from './parser/SMDRParser';

interface ServiceEvent {
  type: 'status' | 'record' | 'alert' | 'connection-event' | 'parse-error';
  payload: unknown;
}

export class SMDRService extends EventEmitter {
  private readonly parser = new SMDRParser();
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
      const result = this.parser.parse(line);
      if (!result.record) {
        if (result.error) {
          this.db.insertParseError(result.error);
          this.emitServiceEvent('parse-error', result.error);
          if (this.debugLogging) console.warn('[SMDRService] Parse error:', result.error.reason);
        }
        return;
      }

      // Deduplication: Create a hash of the record's key fields
      const recordHash = `${result.record.date}|${result.record.startTime}|${result.record.duration}|${result.record.callingParty}|${result.record.calledParty}`;
      
      if (this.recentRecordHashes.has(recordHash)) {
        if (this.debugLogging) console.log('[SMDRService] Duplicate record detected, skipping');
        return;
      }

      this.db.insertRecord(result.record);
      this.recentRecords.unshift(result.record);
      this.recentRecords = this.recentRecords.slice(0, Math.max(50, this.config.maxInMemoryRecords));
      this.recentRecordHashes.add(recordHash);
      
      // Clean up old hashes (keep last 1000)
      if (this.recentRecordHashes.size > 1000) {
        const toDelete = Array.from(this.recentRecordHashes).slice(0, 500);
        toDelete.forEach(h => this.recentRecordHashes.delete(h));
      }
      
      this.emitServiceEvent('record', result.record);

      const alerts = this.alerts.evaluate(result.record);
      for (const alert of alerts) {
        this.db.insertAlert(alert);
        this.emitServiceEvent('alert', alert);
        if (this.debugLogging) console.log('[SMDRService] Alert:', alert.type);
      }
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
}
