import { z } from 'zod';

// ─── Authentication ──────────────────────────────────────────────────────────

export const authCredentialsSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100)
});

export const tokenSchema = z.object({
  token: z.string(),
  success: z.boolean()
});

// ─── Connection Config ───────────────────────────────────────────────────────

export const connectionConfigSchema = z.object({
  controllerIps: z.array(z.string().ip()).min(1),
  port: z.number().int().min(1).max(65535),
  concurrentConnections: z.number().int().min(1).max(10),
  autoReconnect: z.boolean(),
  reconnectDelayMs: z.number().int().min(100).max(3_600_000),
  autoReconnectPrimary: z.boolean(),
  primaryRecheckDelayMs: z.number().int().min(1_000).max(86_400_000),
  ipWhitelist: z.array(z.string().ip()).optional()
});

// ─── Storage Config ──────────────────────────────────────────────────────────

export const storageConfigSchema = z.object({
  dbPath: z.string().min(1),
  encryptionKey: z.string().optional(),
  retentionDays: z.number().int().min(1).max(3650),
  archiveDirectory: z.string().min(1)
});

// ─── Alert Rules ─────────────────────────────────────────────────────────────

export const alertRuleSetSchema = z.object({
  longCallMinutes: z.number().int().min(1).max(1440),
  watchNumbers: z.array(z.string().regex(/^[0-9*#]{2,20}$/)).max(100),
  repeatedBusyThreshold: z.number().int().min(1).max(100),
  repeatedBusyWindowMinutes: z.number().int().min(1).max(1440),
  detectTagCalls: z.boolean(),
  detectTollDenied: z.boolean()
});

// ─── App Config ──────────────────────────────────────────────────────────────

export const appConfigSchema = z.object({
  connection: connectionConfigSchema,
  storage: storageConfigSchema,
  alerts: alertRuleSetSchema,
  maxInMemoryRecords: z.number().int().min(50).max(50000)
});

// ─── Record Filters ──────────────────────────────────────────────────────────

export const recordFiltersSchema = z.object({
  date: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  dateFrom: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  dateTo: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  extension: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  accountCode: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  hour: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  callType: z.enum(['internal', 'external']).optional().or(z.literal('')).transform(d => d || undefined),
  completionStatus: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  transferFlag: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  callIdentifier: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  associatedCallIdentifier: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  networkOLI: z.string().optional().or(z.literal('')).transform(d => d || undefined),
  limit: z.coerce.number().int().min(1).max(50000).optional().default(500),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

// ─── Export Options ──────────────────────────────────────────────────────────

export const exportOptionsSchema = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  outputPath: z.string().min(1),
  filters: recordFiltersSchema.optional()
});

// ─── Billing: Call Category ──────────────────────────────────────────────────

export const callCategorySchema = z.enum(['local', 'national', 'mobile', 'international', 'unclassified']);

// ─── Billing: Prefix Rule ────────────────────────────────────────────────────

export const prefixRuleSchema = z.object({
  id: z.string().optional(),
  category: callCategorySchema,
  prefix: z.string().min(1).max(8),
  description: z.string().max(100),
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(999)
});

// ─── Billing: Rate Tier (for tiered pricing) ─────────────────────────────────

export const rateTierSchema = z.object({
  minMinutes: z.number().int().min(0),
  maxMinutes: z.number().int().min(0).optional(),
  ratePerMinute: z.number().nonnegative()
});

// ─── Billing: Rate Config ────────────────────────────────────────────────────

export const rateConfigSchema = z.object({
  category: callCategorySchema,
  ratePerMinute: z.number().nonnegative(),
  tiers: z.array(rateTierSchema).optional(),
  minimumCharge: z.number().int().min(0),
  blockSize: z.number().int().min(1),
  currency: z.string().length(3),
  weekendMultiplier: z.number().nonnegative().optional(),
  holidayMultiplier: z.number().nonnegative().optional()
});

// ─── Billing: Full Config ────────────────────────────────────────────────────

export const billingConfigSchema = z.object({
  enabled: z.boolean(),
  currency: z.string().length(3),
  prefixRules: z.array(prefixRuleSchema),
  rates: z.array(rateConfigSchema),
  taxRate: z.number().nonnegative().max(1).optional().default(0),
  updatedAt: z.string()
});

// ─── Billing: Test Request ───────────────────────────────────────────────────

export const billingTestRequestSchema = z.object({
  number: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  callDate: z.string().optional(),
  isHoliday: z.boolean().optional()
});

export const billingPrefixRuleCreateSchema = prefixRuleSchema.omit({ id: true });

export const billingPrefixRuleUpdateSchema = prefixRuleSchema
  .partial()
  .omit({ id: true })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

export const billingRatesUpdateSchema = z.object({
  rates: z.array(rateConfigSchema)
});

// ─── Billing: Report Request ─────────────────────────────────────────────────

export const billingReportRequestSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/, 'from must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/, 'to must be YYYY-MM-DD')
    .optional(),
  extension: z.string().trim().min(1).max(48).optional(),
  category: callCategorySchema.optional(),
  sortBy: z.enum(['cost', 'duration', 'date']).optional().default('cost'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  includeAllTopCalls: z.coerce.boolean().optional().default(false),
  topCallsLimit: z.coerce.number().int().min(1).max(5000).optional().default(1000)
}).superRefine((value, ctx) => {
  if (!value.from || !value.to) return;
  const fromDate = new Date(value.from.slice(0, 10));
  const toDate = new Date(value.to.slice(0, 10));
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return;
  if (fromDate > toDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'from must be on or before to',
      path: ['from']
    });
    return;
  }
  const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays > 366) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Date range cannot exceed 366 days',
      path: ['to']
    });
  }
});

// ─── Audit Log Entry ─────────────────────────────────────────────────────────

export const auditLogEntrySchema = z.object({
  action: z.string(),
  user: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  timestamp: z.string().optional()
});

// ─── Export type helpers ─────────────────────────────────────────────────────

export type AuthCredentials = z.infer<typeof authCredentialsSchema>;
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type AlertRuleSet = z.infer<typeof alertRuleSetSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type RecordFilters = z.infer<typeof recordFiltersSchema>;
export type ExportOptions = z.infer<typeof exportOptionsSchema>;
export type CallCategory = z.infer<typeof callCategorySchema>;
export type PrefixRule = z.infer<typeof prefixRuleSchema>;
export type RateTier = z.infer<typeof rateTierSchema>;
export type RateConfig = z.infer<typeof rateConfigSchema>;
export type BillingConfig = z.infer<typeof billingConfigSchema>;
export type BillingTestRequest = z.infer<typeof billingTestRequestSchema>;
export type BillingPrefixRuleCreate = z.infer<typeof billingPrefixRuleCreateSchema>;
export type BillingPrefixRuleUpdate = z.infer<typeof billingPrefixRuleUpdateSchema>;
export type BillingRatesUpdate = z.infer<typeof billingRatesUpdateSchema>;
export type BillingReportRequest = z.infer<typeof billingReportRequestSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
