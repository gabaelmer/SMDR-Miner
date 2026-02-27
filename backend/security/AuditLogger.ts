import Database from 'better-sqlite3';

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
    limit?: number 
  }): AuditEntry[] {
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

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = options?.limit ?? 1000;

    const rows = this.db.prepare(`
      SELECT id, action, user, details, ip_address, created_at
      FROM audit_log
      ${clause}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params, limit) as Array<{
      id: number;
      action: string;
      user: string;
      details: string | null;
      ip_address: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      action: row.action as AuditAction,
      user: row.user,
      details: row.details ? JSON.parse(row.details) : undefined,
      ipAddress: row.ip_address ?? undefined,
      createdAt: row.created_at
    }));
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

  logStreamControl(user: string, action: 'start' | 'stop', ipAddress?: string): void {
    this.log({
      action: action === 'start' ? 'stream-start' : 'stream-stop',
      user,
      ipAddress
    });
  }
}
