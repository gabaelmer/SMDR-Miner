export type ConnectionStatus = 'connected' | 'disconnected' | 'retrying';

export interface SMDRRecord {
  date: string;
  startTime: string;
  duration: string;
  callingParty: string;
  calledParty: string;
  thirdParty?: string;
  trunkNumber?: string;
  digitsDialed?: string;
  accountCode?: string;
  callCompletionStatus?: string;
  transferFlag?: string;
  callIdentifier?: string;
  callSequenceIdentifier?: string;
  associatedCallIdentifier?: string;
  networkOLI?: string;
  callType?: 'internal' | 'external';
  call_category?: CallCategory;
  call_cost?: number;
  bill_currency?: string;
  rate_per_minute?: number;
  rawLine?: string;
}

export interface ConnectionConfig {
  controllerIps: string[];
  port: number;
  concurrentConnections: number;
  autoReconnect: boolean;
  reconnectDelayMs: number;
  autoReconnectPrimary: boolean;
  primaryRecheckDelayMs: number;
  ipWhitelist?: string[];
}

export interface StorageConfig {
  dbPath: string;
  encryptionKey?: string;
  retentionDays: number;
  archiveDirectory: string;
}

export interface AlertRuleSet {
  longCallMinutes: number;
  watchNumbers: string[];
  repeatedBusyThreshold: number;
  repeatedBusyWindowMinutes: number;
  detectTagCalls: boolean;
  detectTollDenied: boolean;
}

export interface AppConfig {
  connection: ConnectionConfig;
  storage: StorageConfig;
  alerts: AlertRuleSet;
  maxInMemoryRecords: number;
}

export interface DashboardMetrics {
  date: string;
  lastUpdatedAt: string;
  totalCallsToday: number;
  totalDurationSeconds: number;
  incomingCalls: number;
  outgoingCalls: number;
  internalCalls: number;
  internalDurationSeconds: number;
  inboundCalls: number;
  inboundDurationSeconds: number;
  outboundCalls: number;
  outboundDurationSeconds: number;
  totalCostToday: number;
  avgCallDurationSeconds: number;
  highCostCalls: number;
  sevenDayTrend: Array<{ date: string; callCount: number; totalCost: number }>;
  callDistribution: Array<{ category: string; count: number; percentage: number; totalCost: number }>;
  topExtensionsByCostAndVolume: Array<{ extension: string; count: number; totalCost: number }>;
  topExtensions: Array<{ extension: string; count: number }>;
  topDialedNumbers: Array<{ number: string; count: number }>;
  longCalls: SMDRRecord[];
  activeStream: boolean;
}

export interface AnalyticsSnapshot {
  volumeByHour: Array<{ hour: string; count: number }>;
  heatmap: Array<{ day: string; hour: number; count: number }>;
  extensionUsage: Array<{ extension: string; calls: number; totalDurationSeconds: number; avgHandleTime: number }>;
  transferConference: Array<{ flag: string; count: number }>;
  summary: AnalyticsSummary;
  correlations: Array<{
    key: string;
    callIdentifier?: string;
    associatedCallIdentifier?: string;
    networkOLI?: string;
    count: number;
    anomalyScore: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export interface AnalyticsSummary {
  totalCalls: number;
  totalDurationSeconds: number;
  answeredCalls: number;
  answeredRate: number;
  avgDurationSeconds: number;
  peakHour: string;
  transferConferenceCalls: number;
  transferConferenceRate: number;
}

export interface RecordFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  extension?: string;
  accountCode?: string;
  hour?: string;
  callType?: 'internal' | 'external';
  completionStatus?: string;
  transferFlag?: string;
  callIdentifier?: string;
  associatedCallIdentifier?: string;
  networkOLI?: string;
  limit?: number;
  offset?: number;
}

export interface RecordsPage {
  rows: SMDRRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface CallLogSummary {
  totalCalls: number;
  totalDurationSeconds: number;
  topExtensionsMade: Array<{ extension: string; count: number }>;
  topExtensionsReceived: Array<{ extension: string; count: number }>;
}

export interface AlertEvent {
  id?: number;
  type: string;
  message: string;
  record?: SMDRRecord;
  createdAt?: string;
}

export interface ParseError {
  line: string;
  reason: string;
  createdAt?: string;
}

export type ConnectionEventLevel = 'info' | 'warn' | 'error';

export interface ConnectionEvent {
  id?: number;
  level: ConnectionEventLevel;
  message: string;
  createdAt?: string;
}

export interface ConnectionEventsPage {
  items: ConnectionEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
  connectionStatus: ConnectionStatus;
  uptime: number;
  remoteIp?: string;
}

export interface ServiceState {
  connectionStatus: ConnectionStatus;
  activeController?: string;
  parserOptions: unknown;
  recentRecordsCount: number;
  maxInMemoryRecords: number;
}

export interface ExportOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  outputPath: string;
  filters?: RecordFilters;
}

export interface ExportDialogOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  filters?: RecordFilters;
}

export interface AuthCredentials {
  username: string;
  password: string;
}

// ─── Billing / Rating Types ───────────────────────────────────────────────────

export type CallCategory = 'local' | 'national' | 'mobile' | 'international' | 'unclassified';

export interface PrefixRule {
  id: string;
  category: CallCategory;
  prefix: string;
  description: string;
  enabled: boolean;
  priority: number;
}

export interface RateTier {
  minMinutes: number;
  maxMinutes?: number;
  ratePerMinute: number;
}

export interface RateConfig {
  category: CallCategory;
  ratePerMinute: number;
  tiers?: RateTier[];
  minimumCharge: number;
  blockSize: number;
  currency: string;
  weekendMultiplier?: number;
  holidayMultiplier?: number;
}

export interface BillingConfig {
  enabled: boolean;
  currency: string;
  prefixRules: PrefixRule[];
  rates: RateConfig[];
  taxRate?: number;
  updatedAt: string;
}

export interface CallBilling {
  category: CallCategory;
  matchedPrefix: string | null;
  durationSeconds: number;
  billableUnits: number;
  ratePerMinute: number;
  cost: number;
  currency: string;
  baseCost?: number;
  appliedMultiplier?: number;
  taxAmount?: number;
  totalWithTax?: number;
}

export type BillingReportSortBy = 'cost' | 'duration' | 'date';
export type BillingReportSortDir = 'asc' | 'desc';

export interface BillingReportQuery {
  from?: string;
  to?: string;
  extension?: string;
  category?: CallCategory;
  sortBy?: BillingReportSortBy;
  sortDir?: BillingReportSortDir;
  page?: number;
  pageSize?: number;
  includeAllTopCalls?: boolean;
  topCallsLimit?: number;
}

export interface BillingReportSummaryRow {
  call_category: CallCategory;
  call_count: number;
  total_duration_secs: number;
  total_cost: number;
  total_tax: number;
  avg_cost: number;
  max_cost: number;
  currency: string;
}

export interface BillingReportTopCostCall {
  id: number;
  date: string;
  start_time: string;
  calling_party: string;
  called_party: string;
  digits_dialed: string | null;
  duration_seconds: number;
  call_category: CallCategory;
  call_cost: number;
  tax_amount: number;
  bill_currency: string;
  matched_prefix: string | null;
  rate_per_minute: number;
}

export interface BillingReportDailyTrendRow {
  date: string;
  call_count: number;
  total_cost: number;
  currency: string;
}

export interface BillingReportData {
  summary: BillingReportSummaryRow[];
  topCostCalls: BillingReportTopCostCall[];
  topCostCallsTotal: number;
  topCostCallsTruncated?: boolean;
  dailyTrend: BillingReportDailyTrendRow[];
}

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  enabled: true,
  currency: 'PHP',
  prefixRules: [
    { id: 'pr-1', category: 'international', prefix: '00', description: 'International IDD', enabled: true, priority: 5 },
    { id: 'pr-2', category: 'international', prefix: '+', description: 'International (+)', enabled: true, priority: 5 },
    { id: 'pr-3', category: 'mobile', prefix: '09', description: 'PH Mobile (09xx)', enabled: true, priority: 10 },
    { id: 'pr-4', category: 'national', prefix: '02', description: 'Metro Manila', enabled: true, priority: 20 },
    { id: 'pr-5', category: 'national', prefix: '03', description: 'National (03x)', enabled: true, priority: 20 },
    { id: 'pr-6', category: 'national', prefix: '04', description: 'National (04x)', enabled: true, priority: 20 },
    { id: 'pr-7', category: 'national', prefix: '05', description: 'National (05x)', enabled: true, priority: 20 },
    { id: 'pr-8', category: 'national', prefix: '06', description: 'National (06x)', enabled: true, priority: 20 },
    { id: 'pr-9', category: 'national', prefix: '07', description: 'National (07x)', enabled: true, priority: 20 },
    { id: 'pr-10', category: 'national', prefix: '08', description: 'National (08x)', enabled: true, priority: 20 },
    { id: 'pr-11', category: 'local', prefix: '0', description: 'Local (0x)', enabled: true, priority: 100 },
  ],
  rates: [
    { category: 'local', ratePerMinute: 1.00, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 0.5 },
    { category: 'national', ratePerMinute: 3.00, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 0.5 },
    { category: 'mobile', ratePerMinute: 5.50, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 0.5 },
    { category: 'international', ratePerMinute: 25.00, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 0.5 },
    { category: 'unclassified', ratePerMinute: 0.00, minimumCharge: 0, blockSize: 60, currency: 'PHP' },
  ],
  taxRate: 0,
  updatedAt: new Date().toISOString(),
};

export type AuditAction =
  | 'login'
  | 'logout'
  | 'config-change'
  | 'alert-rule-change'
  | 'billing-config-change'
  | 'export'
  | 'purge'
  | 'user-create'
  | 'user-delete'
  | 'password-change'
  | 'stream-start'
  | 'stream-stop';

export interface AuditEntry {
  id?: number;
  action: AuditAction;
  user?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt?: string;
}

export interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
  last_login?: string;
}
