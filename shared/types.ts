export type ConnectionStatus = 'connected' | 'disconnected' | 'retrying';

/**
 * SMDR Record Format Variant
 * Based on MiVoice Business 10.5 SMDR Data Parsing Specification
 */
export type SMDRFormatVariant =
  | 'standard'              // 90 chars
  | 'standard_ani_dnis'     // 112 chars
  | 'standard_network_oli'  // 131 chars
  | 'extended_digit'        // 101 chars
  | 'extended_ani_dnis'     // 120 chars
  | 'extended_network_oli'  // 139 chars
  | 'extended_reporting'    // Up to 207 chars
  | 'unknown';

/**
 * Long Call Duration Indicator
 * ' ' = <5 min, '-' = 5-9 min, '%' = 10-29 min, '+' = 30+ min
 */
export type LongCallIndicator = ' ' | '-' | '%' | '+';

/**
 * Call Completion Status Codes per Mitel Spec
 */
export type CallCompletionCode =
  | 'A'  // Answered (external outgoing) / Answered by attendant (incoming)
  | 'B'  // Busy (external incoming)
  | 'E'  // Error/Invalid number (external incoming)
  | 'T'  // Toll denial/TAFAS/Call Pickup answered
  | 'I'  // Internal call completed
  | 'O'  // Occupied/Busy (Extended Reporting L1)
  | 'D'  // Do Not Disturb (Extended Reporting L1)
  | 'S'  // Out of Service (Extended Reporting L1)
  | 'U'  // Attendant Unavailable (Extended Reporting L1)
  | 'C'  // Caller entered account code (during call)
  | 'R'  // Receiver entered account code (during call)
  | '';  // No supervision (external outgoing)

/**
 * Transfer/Conference Indicator
 */
export type TransferConferenceCode =
  | 'T'  // Supervised transfer
  | 'X'  // Unsupervised transfer
  | 'C'  // Conference
  | 'U'  // ACD: Unavailable
  | 'I'  // ACD: Incomplete
  | 'R'  // ACD: Redirected
  | '';  // No transfer

/**
 * Speed Call / Forward Flag
 */
export type SpeedCallForwardCode = 'S' | 'F' | '';

/**
 * Route Optimization Flag (IP Trunk)
 * 'r' = pre-optimization, 'R' = post-optimization
 */
export type RouteOptCode = 'r' | 'R' | '';

/**
 * Party Type Identifier
 */
export type PartyType =
  | { type: 'station'; value: string }           // 4 or 7 digit extension
  | { type: 'attendant'; value: string; id: number }  // ATTm or ATmm
  | { type: 'co_trunk'; value: string; number: number } // Tnnn or Tnnnn
  | { type: 'non_co_trunk'; value: string; number: number } // Xnnn or Xnnnn
  | { type: 'ip_trunk'; value: string }          // X999 or X9999
  | { type: 'unknown'; value: string };

export interface SMDRRecord {
  // === Core Fields (Always Present) ===
  /** Long call duration indicator: ' ' = <5 min, '-' = 5-9 min, '%' = 10-29 min, '+' = 30+ min */
  longCallIndicator?: LongCallIndicator;
  /** Call date in mm/dd or YYYY-MM-DD format */
  date: string;
  /** Call start time in hh:mm or hh:mmP (12-hour) or hh:mm (24-hour) format */
  startTime: string;
  /** Call duration in hh:mm:ss or hhhh:mm:ss (extended) format */
  duration: string;
  /** Duration in seconds (calculated) */
  durationSeconds?: number;
  /** Originator: Station (0-9999), ATTm (attendant), Tnnn (CO trunk), Xnnn (non-CO trunk), X999 (IP trunk) */
  callingParty: string;
  /** Parsed calling party type information */
  callingPartyType?: PartyType;
  /** Attendant involvement flag: '*' = attendant assisted */
  attendantFlag?: '*' | '';
  /** Time to answer in seconds (incoming calls only), null if unanswered (*?*) */
  timeToAnswer?: number | null;
  /** Dialed digits (max 26 digits, or 20 if meter pulses enabled) */
  digitsDialed?: string;
  /** Meter pulses / trunk reversals (0-64000), null if not enabled */
  meterPulses?: number | null;
  /** Call outcome: A=answered, B=busy, E=error, T=toll-denied/TAFAS/pickup, I=internal, etc. */
  callCompletionStatus?: CallCompletionCode;
  /** Speed call / Forward flag: S=speed call, F=forwarded */
  speedCallForwardFlag?: SpeedCallForwardCode;
  /** Destination: Same format as Calling Party */
  calledParty: string;
  /** Parsed called party type information */
  calledPartyType?: PartyType;
  /** Transfer/Conference indicator: T=supervised, X=unsupervised, C=conference, U/I/R=ACD events */
  transferConference?: TransferConferenceCode;
  /** @deprecated Use transferConference instead */
  transferFlag?: string;
  /** Transfer destination station number */
  thirdParty?: string;
  /** Billing code or Tag Call ID (2-12 digits or alphanumeric) */
  accountCode?: string;
  /** Trunk number (Tnnn or Xnnn format) */
  trunkNumber?: string;
  /** IP trunk optimization flag: r=pre-opt, R=post-opt */
  routeOptFlag?: RouteOptCode;
  /** System/Node identifier (001-999, 000=none) */
  systemId?: string;
  /** MLPP level (OBSOLETE - always blank per spec) */
  mlppLevel?: string;

  // === Optional Extended Fields: ANI/DNIS ===
  /** Automatic Number Identification (1-10 digits) */
  ani?: string;
  /** Dialed Number Identification (1-10 digits) */
  dnis?: string;

  // === Optional Extended Fields: Network OLI ===
  /** Unique call identifier across network (pssscccc format, 8 chars) */
  callIdentifier?: string;
  /** @deprecated Use callSequence instead */
  callSequenceIdentifier?: string;
  /** Event sequence (A-Z) */
  callSequence?: string;
  /** Related call ID for transfers/conferences (pssscccc format, 8 chars) */
  associatedCallIdentifier?: string;
  /** @deprecated Use networkOLI instead */
  networkOLI?: string;

  // === Optional Extended Fields: Extended Reporting Level 1 & 2 ===
  /** Suite pilot number (7 digits) - requires Suite Services enabled */
  suiteId?: string;
  /** CO Tag ID for Two B-Channel Transfer (6 digits) */
  twoBChannelTag?: string;
  /** External Hot Desk User - calling party (7 digits) */
  callingEHDU?: string;
  /** External Hot Desk User - called party (7 digits) */
  calledEHDU?: string;
  /** Calling party zone/location tag (5 chars) */
  callingLocation?: string;
  /** Called party location (5 chars) */
  calledLocation?: string;

  // === Call Classification ===
  /** Call type: internal or external */
  callType?: 'internal' | 'external';

  // === Billing Fields ===
  /** Call category for billing */
  call_category?: CallCategory;
  /** Calculated call cost */
  call_cost?: number;
  /** Currency code (e.g., 'PHP') */
  bill_currency?: string;
  /** Rate per minute applied */
  rate_per_minute?: number;
  /** Matched prefix rule ID */
  matched_prefix?: string;
  /** Billable units (based on block size) */
  billable_units?: number;
  /** Tax amount applied */
  tax_amount?: number;

  // === Metadata ===
  /** Detected record format variant */
  recordFormat?: SMDRFormatVariant;
  /** Actual record length in characters */
  recordLength?: number;
  /** Original raw line as received */
  rawLine?: string;
  /** Parsing errors encountered */
  parsingErrors?: string[];
  /** Whether this record was assembled from multiple lines */
  isMultiLine?: boolean;
  /** Timestamp when record was parsed/inserted */
  parsedAt?: string;
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

/**
 * SMDR Parser Configuration Options
 * Based on MiVoice Business 10.5 SMDR Data Parsing Specification
 * These options directly affect record format and field positions
 */
export interface SMDRParserConfig {
  /** Extended Digit Length: Duration becomes hhhh:mm:ss (max 9999:59:59), parties become 7 digits */
  extendedDigitLength: boolean;
  /** ANI/DNIS Reporting: Adds 22 chars for Automatic Number ID and Dialed Number ID */
  aniDnisReporting: boolean;
  /** Standardized Network OLI: Adds 19 chars for Call Identifier and Associated Call ID */
  networkOLI: boolean;
  /** Extended Reporting Level 1: Adds Suite ID, 2B Transfer, EHDU fields */
  extendedReportingL1: boolean;
  /** Extended Reporting Level 2: Adds Location Information fields */
  extendedReportingL2: boolean;
  /** Extended Time to Answer: Time to answer field expanded */
  extendedTimeToAnswer: boolean;
  /** Network Format: DPNSS calls with Node ID + Extension in digits dialed */
  networkFormat: boolean;
  /** Report Meter Pulses: Includes trunk reversal count in record */
  reportMeterPulses: boolean;
  /** Suite Services Reporting: Enables Suite Identifier field */
  suiteServices: boolean;
  /** Two B-Channel Transfer Reporting: Enables CO Tag ID field */
  twoBChannelTransfer: boolean;
  /** External Hot Desk User Reporting: Enables EHDU fields */
  externalHotDesk: boolean;
  /** Location Information Reporting: Enables location fields */
  locationReporting: boolean;
  /** 24-Hour Time Format: Time displayed as 24-hour vs 12-hour with P suffix */
  twentyFourHourTime: boolean;
}

export const DEFAULT_SMDR_PARSER_CONFIG: SMDRParserConfig = {
  extendedDigitLength: false,
  aniDnisReporting: false,
  networkOLI: false,
  extendedReportingL1: false,
  extendedReportingL2: false,
  extendedTimeToAnswer: false,
  networkFormat: false,
  reportMeterPulses: false,
  suiteServices: false,
  twoBChannelTransfer: false,
  externalHotDesk: false,
  locationReporting: false,
  twentyFourHourTime: true,
};

export interface AppConfig {
  connection: ConnectionConfig;
  storage: StorageConfig;
  alerts: AlertRuleSet;
  smdrParser: SMDRParserConfig;
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
  longCallIndicator?: string;
  ani?: string;
  dnis?: string;
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

export interface SMDRImportResult {
  sourceName: string;
  totalLines: number;
  logicalRecords: number;
  parsedRecords: number;
  insertedRecords: number;
  duplicateRecords: number;
  parseErrors: number;
  skippedLines: number;
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
    // Local calls (same area code) - Free
    { id: 'pr-local-1', category: 'local', prefix: '02', description: 'Metro Manila Local', enabled: true, priority: 10 },
    { id: 'pr-local-2', category: 'local', prefix: '032', description: 'Cebu Local', enabled: true, priority: 10 },
    { id: 'pr-local-3', category: 'local', prefix: '033', description: 'Negros Local', enabled: true, priority: 10 },
    { id: 'pr-local-4', category: 'local', prefix: '034', description: 'Bacolod Local', enabled: true, priority: 10 },
    { id: 'pr-local-5', category: 'local', prefix: '035', description: 'Dumaguete Local', enabled: true, priority: 10 },
    { id: 'pr-local-6', category: 'local', prefix: '036', description: 'Iloilo Local', enabled: true, priority: 10 },
    { id: 'pr-local-7', category: 'local', prefix: '038', description: 'Bohol Local', enabled: true, priority: 10 },
    { id: 'pr-local-8', category: 'local', prefix: '042', description: 'Leyte Local', enabled: true, priority: 10 },
    { id: 'pr-local-9', category: 'local', prefix: '043', description: 'Batangas Local', enabled: true, priority: 10 },
    { id: 'pr-local-10', category: 'local', prefix: '044', description: 'Bulacan Local', enabled: true, priority: 10 },
    { id: 'pr-local-11', category: 'local', prefix: '045', description: 'Pampanga Local', enabled: true, priority: 10 },
    { id: 'pr-local-12', category: 'local', prefix: '046', description: 'Cavite Local', enabled: true, priority: 10 },
    { id: 'pr-local-13', category: 'local', prefix: '047', description: 'Bataan Local', enabled: true, priority: 10 },
    { id: 'pr-local-14', category: 'local', prefix: '048', description: 'Aurora Local', enabled: true, priority: 10 },
    { id: 'pr-local-15', category: 'local', prefix: '049', description: 'Laguna Local', enabled: true, priority: 10 },
    { id: 'pr-local-16', category: 'local', prefix: '052', description: 'Albay Local', enabled: true, priority: 10 },
    { id: 'pr-local-17', category: 'local', prefix: '053', description: 'Eastern Samar Local', enabled: true, priority: 10 },
    { id: 'pr-local-18', category: 'local', prefix: '054', description: 'Camarines Sur Local', enabled: true, priority: 10 },
    { id: 'pr-local-19', category: 'local', prefix: '055', description: 'Samar Local', enabled: true, priority: 10 },
    { id: 'pr-local-20', category: 'local', prefix: '056', description: 'Masbate Local', enabled: true, priority: 10 },
    { id: 'pr-local-21', category: 'local', prefix: '062', description: 'Zamboanga Local', enabled: true, priority: 10 },
    { id: 'pr-local-22', category: 'local', prefix: '063', description: 'Misamis Oriental Local', enabled: true, priority: 10 },
    { id: 'pr-local-23', category: 'local', prefix: '064', description: 'Cotabato Local', enabled: true, priority: 10 },
    { id: 'pr-local-24', category: 'local', prefix: '065', description: 'Surigao Local', enabled: true, priority: 10 },
    { id: 'pr-local-25', category: 'local', prefix: '067', description: 'Antique Local', enabled: true, priority: 10 },
    { id: 'pr-local-26', category: 'local', prefix: '068', description: 'Negros Oriental Local', enabled: true, priority: 10 },
    { id: 'pr-local-27', category: 'local', prefix: '072', description: 'Ilocos Sur Local', enabled: true, priority: 10 },
    { id: 'pr-local-28', category: 'local', prefix: '074', description: 'Benguet Local', enabled: true, priority: 10 },
    { id: 'pr-local-29', category: 'local', prefix: '075', description: 'Ilocos Norte Local', enabled: true, priority: 10 },
    { id: 'pr-local-30', category: 'local', prefix: '077', description: 'La Union Local', enabled: true, priority: 10 },
    { id: 'pr-local-31', category: 'local', prefix: '078', description: 'Cagayan Local', enabled: true, priority: 10 },
    { id: 'pr-local-32', category: 'local', prefix: '082', description: 'Davao Local', enabled: true, priority: 10 },
    { id: 'pr-local-33', category: 'local', prefix: '083', description: 'South Cotabato Local', enabled: true, priority: 10 },
    { id: 'pr-local-34', category: 'local', prefix: '084', description: 'Lanao del Norte Local', enabled: true, priority: 10 },
    { id: 'pr-local-35', category: 'local', prefix: '085', description: 'Misamis Oriental Local', enabled: true, priority: 10 },
    { id: 'pr-local-36', category: 'local', prefix: '086', description: 'Kalinga Local', enabled: true, priority: 10 },
    { id: 'pr-local-37', category: 'local', prefix: '087', description: 'Lanao del Sur Local', enabled: true, priority: 10 },
    { id: 'pr-local-38', category: 'local', prefix: '088', description: 'Bukidnon Local', enabled: true, priority: 10 },
    // NDD - National Direct Dialing (0 + area code)
    { id: 'pr-ndd-1', category: 'national', prefix: '0', description: 'NDD National Calls', enabled: true, priority: 100 },
    // Mobile calls (09 prefix)
    { id: 'pr-mobile-1', category: 'mobile', prefix: '09', description: 'Mobile Calls', enabled: true, priority: 50 },
    // IDD - International Direct Dialing
    { id: 'pr-idd-1', category: 'international', prefix: '00', description: 'IDD International Calls', enabled: true, priority: 1 },
    { id: 'pr-idd-2', category: 'international', prefix: '+', description: 'IDD International (+)', enabled: true, priority: 1 },
  ],
  rates: [
    // Local calls - Free
    { category: 'local', ratePerMinute: 0.00, minimumCharge: 0, blockSize: 60, currency: 'PHP', weekendMultiplier: 1.0 },
    // NDD - National Direct Dialing: ₱5.10/min
    { category: 'national', ratePerMinute: 5.10, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 1.0 },
    // Mobile calls: ₱14.00/min
    { category: 'mobile', ratePerMinute: 14.00, minimumCharge: 1, blockSize: 60, currency: 'PHP', weekendMultiplier: 1.0 },
    // IDD - International: $0.40/min (will use USD)
    { category: 'international', ratePerMinute: 0.40, minimumCharge: 1, blockSize: 60, currency: 'USD', weekendMultiplier: 1.0 },
    // Unclassified - Free fallback
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

// ─── Billing Audit Trail & Impact Analysis Types ─────────────────────────────

export type BillingChangeType =
  | 'config-saved'
  | 'rule-added'
  | 'rule-updated'
  | 'rule-deleted'
  | 'rule-bulk-action'
  | 'rate-updated'
  | 'tier-added'
  | 'tier-updated'
  | 'tier-removed';

export interface BillingChangeEntry {
  id?: number;
  changeType: BillingChangeType;
  category?: CallCategory;
  ruleId?: string;
  rulePrefix?: string;
  previousValue?: string;
  newValue?: string;
  affectedCalls?: number;
  costImpact?: number;
  user?: string;
  createdAt?: string;
}

export interface BillingChangeHistory {
  entries: BillingChangeEntry[];
  total: number;
  summary: {
    totalChanges: number;
    rulesAdded: number;
    rulesDeleted: number;
    ratesChanged: number;
    lastChangedAt?: string;
  };
}

export interface BulkRuleAction {
  action: 'enable' | 'disable' | 'delete';
  ruleIds: string[];
}

export interface BulkOperationResult {
  success: boolean;
  affectedCount: number;
  errors?: string[];
}

export interface RateImpactAnalysis {
  category: CallCategory;
  currentRate: number;
  proposedRate: number;
  rateChange: number;
  rateChangePercent: number;
  affectedCalls: number;
  currentRevenue: number;
  projectedRevenue: number;
  revenueChange: number;
  revenueChangePercent: number;
  periodDays: number;
}

export interface BillingImpactAnalysis {
  overall: {
    currentRevenue: number;
    projectedRevenue: number;
    revenueChange: number;
    revenueChangePercent: number;
    totalAffectedCalls: number;
  };
  byCategory: RateImpactAnalysis[];
  periodDays: number;
  generatedAt: string;
}

export interface ImpactAnalysisOptions {
  periodDays?: number;
  includeCategories?: CallCategory[];
}
