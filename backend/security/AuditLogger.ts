import Database from 'better-sqlite3';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'config-change'
  | 'alert-rule-change'
  | 'billing-config-change'
  | 'export'
  | 'import'
  | 'purge'
  | 'user-create'
  | 'user-delete'
  | 'user-bulk-delete'
  | 'user-role-change'
  | 'user-bulk-role-change'
  | 'password-change'
  | 'password-reset'
  | 'stream-start'
  | 'stream-stop'
  | 'account-unlocked'
  | 'account-lock'
  | 'account-status-change';

export interface AuditEntry {
  id?: number;
  action: AuditAction;
  user?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt?: string;
}

export class AuditLogger {
  constructor(private readonly db: Database.Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        user TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user);
      CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);
    `);
  }

  log(entry: AuditEntry): void {
    this.db.prepare(`
      INSERT INTO audit_log (action, user, details, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(
      entry.action,
      entry.user || 'system',
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ipAddress || null
    );
  }

  getLogs(options?: {
    action?: AuditAction;
    user?: string;
    startDate?: string;
    endDate?: string;
    ipAddress?: string;
    limit?: number;
    offset?: number;
  }): { data: AuditEntry[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (options?.action) {
      where.push('action = ?');
      params.push(options.action);
    }

    if (options?.user) {
      where.push('user = ?');
      params.push(options.user);
    }

    if (options?.startDate) {
      where.push('created_at >= ?');
      params.push(options.startDate);
    }

    if (options?.endDate) {
      where.push('created_at <= ?');
      params.push(options.endDate);
    }

    if (options?.ipAddress) {
      where.push('ip_address LIKE ?');
      params.push(`%${options.ipAddress}%`);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    
    // Get total count
    const totalResult = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_log
      ${clause}
    `).get(...params) as { count: number };
    
    const limit = options?.limit ?? 1000;
    const offset = options?.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT id, action, user, details, ip_address, created_at
      FROM audit_log
      ${clause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
      id: number;
      action: string;
      user: string;
      details: string | null;
      ip_address: string | null;
      created_at: string;
    }>;

    return {
      total: totalResult.count,
      data: rows.map((row) => ({
        id: row.id,
        action: row.action as AuditAction,
        user: row.user,
        details: row.details ? JSON.parse(row.details) : undefined,
        ipAddress: row.ip_address ?? undefined,
        createdAt: row.created_at
      }))
    };
  }

  purgeOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff);
    return result.changes;
  }

  // Convenience methods for common actions
  logLogin(username: string, success: boolean, ipAddress?: string): void {
    this.log({
      action: 'login',
      user: username,
      details: { success },
      ipAddress
    });
  }

  logLogout(username: string, ipAddress?: string): void {
    this.log({
      action: 'logout',
      user: username,
      ipAddress
    });
  }

  logConfigChange(user: string, changes: Record<string, unknown>, ipAddress?: string): void {
    this.log({
      action: 'config-change',
      user,
      details: { changes },
      ipAddress
    });
  }

  logBillingConfigChange(user: string, changes: Record<string, unknown>, ipAddress?: string): void {
    this.log({
      action: 'billing-config-change',
      user,
      details: { changes },
      ipAddress
    });
  }

  logExport(user: string, format: string, recordCount: number, ipAddress?: string): void {
    this.log({
      action: 'export',
      user,
      details: { format, recordCount },
      ipAddress
    });
  }

  logImport(user: string, source: string, stats: Record<string, unknown>, ipAddress?: string): void {
    this.log({
      action: 'import',
      user,
      details: { source, ...stats },
      ipAddress
    });
  }

  logStreamControl(user: string, action: 'start' | 'stop', ipAddress?: string): void {
    this.log({
      action: action === 'start' ? 'stream-start' : 'stream-stop',
      user,
      ipAddress
    });
  }
}
