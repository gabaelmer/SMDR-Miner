import Database from 'better-sqlite3';
import { BillingChangeEntry, BillingChangeHistory, BulkRuleAction, BulkOperationResult, CallCategory, PrefixRule, RateConfig } from '../../shared/types';

export class BillingAuditService {
  private db: Database.Database | null = null;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
      this.init();
    }
  }

  setDatabase(db: Database.Database): void {
    this.db = db;
    this.init();
  }

  private init(): void {
    if (!this.db) return;
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS billing_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_type TEXT NOT NULL,
        category TEXT,
        rule_id TEXT,
        rule_prefix TEXT,
        previous_value TEXT,
        new_value TEXT,
        affected_calls INTEGER DEFAULT 0,
        cost_impact REAL DEFAULT 0,
        user TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_billing_audit_type ON billing_audit_log(change_type);
      CREATE INDEX IF NOT EXISTS idx_billing_audit_category ON billing_audit_log(category);
      CREATE INDEX IF NOT EXISTS idx_billing_audit_rule ON billing_audit_log(rule_id);
      CREATE INDEX IF NOT EXISTS idx_billing_audit_created ON billing_audit_log(created_at);
    `);
  }

  logChange(entry: Omit<BillingChangeEntry, 'id' | 'createdAt'>): void {
    if (!this.db) return;
    
    const insert = this.db.prepare(`
      INSERT INTO billing_audit_log (
        change_type, category, rule_id, rule_prefix, previous_value, new_value, affected_calls, cost_impact, user
      ) VALUES (
        @changeType, @category, @ruleId, @rulePrefix, @previousValue, @newValue, @affectedCalls, @costImpact, @user
      )
    `);
    insert.run({
      changeType: entry.changeType,
      category: entry.category || null,
      ruleId: entry.ruleId || null,
      rulePrefix: entry.rulePrefix || null,
      previousValue: entry.previousValue || null,
      newValue: entry.newValue || null,
      affectedCalls: entry.affectedCalls || 0,
      costImpact: entry.costImpact || 0,
      user: entry.user || 'system'
    });
  }

  getChangeHistory(limit = 100, offset = 0): BillingChangeHistory {
    if (!this.db) return { entries: [], total: 0, summary: { totalChanges: 0, rulesAdded: 0, rulesDeleted: 0, ratesChanged: 0 } };
    
    const totalResult = this.db.prepare('SELECT COUNT(*) as count FROM billing_audit_log').get() as { count: number };
    
    const rows = this.db.prepare(`
      SELECT 
        id, change_type, category, rule_id, rule_prefix, previous_value, new_value, 
        affected_calls, cost_impact, user, created_at
      FROM billing_audit_log
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<{
      id: number;
      change_type: string;
      category: string | null;
      rule_id: string | null;
      rule_prefix: string | null;
      previous_value: string | null;
      new_value: string | null;
      affected_calls: number;
      cost_impact: number;
      user: string;
      created_at: string;
    }>;

    const summaryResult = this.db.prepare(`
      SELECT 
        COUNT(*) as totalChanges,
        SUM(CASE WHEN change_type = 'rule-added' THEN 1 ELSE 0 END) as rulesAdded,
        SUM(CASE WHEN change_type = 'rule-deleted' THEN 1 ELSE 0 END) as rulesDeleted,
        SUM(CASE WHEN change_type IN ('rate-updated', 'tier-added', 'tier-updated', 'tier-removed') THEN 1 ELSE 0 END) as ratesChanged,
        MAX(created_at) as lastChangedAt
      FROM billing_audit_log
    `).get() as {
      totalChanges: number;
      rulesAdded: number;
      rulesDeleted: number;
      ratesChanged: number;
      lastChangedAt: string | null;
    };

    return {
      entries: rows.map(row => ({
        id: row.id,
        changeType: row.change_type as BillingChangeEntry['changeType'],
        category: row.category as CallCategory | undefined,
        ruleId: row.rule_id || undefined,
        rulePrefix: row.rule_prefix || undefined,
        previousValue: row.previous_value || undefined,
        newValue: row.new_value || undefined,
        affectedCalls: row.affected_calls,
        costImpact: row.cost_impact,
        user: row.user,
        createdAt: row.created_at
      })),
      total: totalResult.count,
      summary: {
        totalChanges: summaryResult.totalChanges,
        rulesAdded: summaryResult.rulesAdded,
        rulesDeleted: summaryResult.rulesDeleted,
        ratesChanged: summaryResult.ratesChanged,
        lastChangedAt: summaryResult.lastChangedAt || undefined
      }
    };
  }

  clearOlderThan(days: number): number {
    if (!this.db) return 0;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const result = this.db.prepare(`
      DELETE FROM billing_audit_log WHERE created_at < ?
    `).run(cutoffDate.toISOString());
    return result.changes;
  }

  logBulkAction(action: BulkRuleAction, rules: PrefixRule[], user?: string): void {
    if (!this.db) return;
    
    const affectedCount = rules.length;
    this.logChange({
      changeType: 'rule-bulk-action',
      previousValue: `${action.action === 'delete' ? 'enabled' : action.action === 'enable' ? 'disabled' : 'enabled'}`,
      newValue: action.action,
      affectedCalls: affectedCount,
      user: user || 'system'
    });
  }

  logRateChange(category: CallCategory, oldRate: number, newRate: number, user?: string): void {
    this.logChange({
      changeType: 'rate-updated',
      category,
      previousValue: `₱${oldRate.toFixed(2)}/min`,
      newValue: `₱${newRate.toFixed(2)}/min`,
      user: user || 'system'
    });
  }

  logRuleChange(changeType: 'rule-added' | 'rule-updated' | 'rule-deleted', rule: PrefixRule, previousRule?: PrefixRule, user?: string): void {
    this.logChange({
      changeType,
      category: rule.category,
      ruleId: rule.id,
      rulePrefix: rule.prefix,
      previousValue: previousRule ? `${previousRule.prefix} → ${previousRule.category}` : undefined,
      newValue: `${rule.prefix} → ${rule.category}`,
      user: user || 'system'
    });
  }
}

export const billingAuditService = new BillingAuditService();

export function initializeBillingAudit(db: Database.Database): BillingAuditService {
  const service = new BillingAuditService();
  service.setDatabase(db);
  return service;
}
