import jwt from 'jsonwebtoken';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import { AuditEntry } from '../../shared/types';

const JWT_EXPIRY = '24h';
const AUTH_COOKIE_NAME = 'smdr_token';

interface JwtPayload {
  username: string;
  iat?: number;
  exp?: number;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  role?: string;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  username?: string;
  role?: string;
  error?: string;
}

export class AuthService {
  private readonly jwtSecret: string;

  constructor(private readonly db: Database.Database, jwtSecret?: string) {
    this.jwtSecret = resolveJwtSecret(jwtSecret);
  }

  init(): void {
    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        ip_address TEXT,
        success INTEGER NOT NULL,
        attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
    `);

    // Migration: Add security columns to users table if they don't exist
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const columnNames = userColumns.map(c => c.name);
    
    if (!columnNames.includes('failed_login_attempts')) {
      this.db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0');
      // Set existing rows to 0
      this.db.exec('UPDATE users SET failed_login_attempts = 0 WHERE failed_login_attempts IS NULL');
      console.log('[Auth] Migration: Added failed_login_attempts column');
    }
    if (!columnNames.includes('locked_until')) {
      this.db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
      console.log('[Auth] Migration: Added locked_until column');
    }
    if (!columnNames.includes('last_failed_login')) {
      this.db.exec('ALTER TABLE users ADD COLUMN last_failed_login TEXT');
      console.log('[Auth] Migration: Added last_failed_login column');
    }

    // Migration: Add IP and user agent to sessions table
    const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const sessionColumnNames = sessionColumns.map(c => c.name);
    
    if (!sessionColumnNames.includes('ip_address')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT');
      console.log('[Auth] Migration: Added ip_address column to sessions');
    }
    if (!sessionColumnNames.includes('user_agent')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT');
      console.log('[Auth] Migration: Added user_agent column to sessions');
    }

    const existing = this.db.prepare('SELECT COUNT(1) as count FROM users').get() as { count: number };
    if (existing.count === 0) {
      const bootstrapPassword =
        process.env.SMDR_BOOTSTRAP_ADMIN_PASSWORD?.trim() ||
        (process.env.NODE_ENV === 'test' ? 'admin123!' : undefined);
      const bootstrapUsername = process.env.SMDR_BOOTSTRAP_ADMIN_USERNAME?.trim() || 'admin';
      if (!bootstrapPassword) {
        throw new Error(
          '[Auth] No users exist and SMDR_BOOTSTRAP_ADMIN_PASSWORD is missing. Set it to securely bootstrap the first admin user.'
        );
      }
      if (bootstrapPassword.length < 12 && process.env.NODE_ENV !== 'test') {
        throw new Error('[Auth] SMDR_BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
      }
      this.createUser({ username: bootstrapUsername, password: bootstrapPassword }, 'admin');
      console.log(`[Auth] Bootstrap admin user created: ${bootstrapUsername}`);
    }
  }

  createUser(credentials: { username: string; password: string }, role: string = 'user'): void {
    const salt = randomBytes(16).toString('hex');
    const hash = this.hashPassword(credentials.password, salt);
    this.db
      .prepare('INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)')
      .run(credentials.username, hash, salt, role);
  }

  authenticate(credentials: { username: string; password: string }, ipAddress?: string, userAgent?: string): AuthResult {
    console.log(`[Auth] Login attempt for: ${credentials.username}`);
    
    const row = this.db
      .prepare('SELECT id, username, password_hash, salt, role, last_login, failed_login_attempts, locked_until FROM users WHERE username = ?')
      .get(credentials.username) as (UserRow & { failed_login_attempts: number; locked_until: string | null }) | undefined;

    if (!row) {
      console.log(`[Auth] User ${credentials.username} not found`);
      // Log failed attempt for non-existent user (prevents username enumeration)
      this.logLoginAttempt(credentials.username, ipAddress, false);
      return { success: false, error: 'Invalid credentials' };
    }

    console.log(`[Auth] User ${credentials.username} found, checking password...`);
    
    // Check if account is locked
    if (row.locked_until) {
      const lockExpiry = new Date(row.locked_until);
      if (lockExpiry > new Date()) {
        const minutesLeft = Math.ceil((lockExpiry.getTime() - Date.now()) / 60000);
        console.log(`[Auth] Account ${credentials.username} is LOCKED (${minutesLeft} min remaining)`);
        this.logLoginAttempt(credentials.username, ipAddress, false);
        return {
          success: false,
          error: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minutes.`
        };
      } else {
        // Lock expired, reset attempts
        console.log(`[Auth] Account ${credentials.username} lock expired, resetting`);
        this.db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);
      }
    }

    const provided = this.hashPassword(credentials.password, row.salt);
    console.log(`[Auth] Password hash comparison...`);
    console.log(`[Auth] Stored hash: ${row.password_hash.substring(0, 20)}...`);
    console.log(`[Auth] Provided hash: ${provided.substring(0, 20)}...`);
    const isValid = timingSafeEqual(Buffer.from(row.password_hash, 'hex'), Buffer.from(provided, 'hex'));
    console.log(`[Auth] Password valid: ${isValid}`);

    if (!isValid) {
      // Increment failed attempts (handle NULL as 0)
      const currentAttempts = row.failed_login_attempts || 0;
      const newAttempts = currentAttempts + 1;

      console.log(`[Auth] Failed login for ${credentials.username}: attempt ${newAttempts}`);

      // Lock account after 5 failed attempts
      if (newAttempts >= 5) {
        const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
        this.db.prepare(`
          UPDATE users
          SET failed_login_attempts = ?, locked_until = ?, last_failed_login = ?
          WHERE id = ?
        `).run(newAttempts, lockedUntil, new Date().toISOString(), row.id);

        console.log(`[Auth] Account ${credentials.username} LOCKED until ${lockedUntil}`);
        this.logLoginAttempt(credentials.username, ipAddress, false);
        return { success: false, error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' };
      }

      // Update failed attempts
      this.db.prepare(`
        UPDATE users
        SET failed_login_attempts = ?, last_failed_login = ?
        WHERE id = ?
      `).run(newAttempts, new Date().toISOString(), row.id);

      this.logLoginAttempt(credentials.username, ipAddress, false);
      return { success: false, error: 'Invalid credentials' };
    }

    // Successful login - reset failed attempts
    this.db.prepare(`
      UPDATE users 
      SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL, last_login = ? 
      WHERE id = ?
    `).run(new Date().toISOString(), row.id);
    
    this.logLoginAttempt(credentials.username, ipAddress, true);

    // Generate JWT token
    const payload: JwtPayload = { username: row.username };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: JWT_EXPIRY });

    // Store session with IP and user agent
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(row.id, tokenHash, expiresAt, ipAddress || null, userAgent || null);

    return {
      success: true,
      token,
      username: row.username,
      role: row.role || 'user'
    };
  }

  private logLoginAttempt(username: string, ipAddress: string | undefined, success: boolean): void {
    this.db.prepare(`
      INSERT INTO login_attempts (username, ip_address, success)
      VALUES (?, ?, ?)
    `).run(username, ipAddress || null, success ? 1 : 0);
  }

  verifyToken(token: string): { valid: boolean; username?: string; role?: string } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JwtPayload;
      
      // Check if session exists and is not revoked
      const tokenHash = this.hashToken(token);
      const session = this.db.prepare(`
        SELECT s.*, u.username, u.role 
        FROM sessions s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ?
      `).get(tokenHash, new Date().toISOString()) as { username: string; role: string } | undefined;

      if (!session) {
        return { valid: false };
      }

      return { valid: true, username: decoded.username, role: session.role };
    } catch {
      return { valid: false };
    }
  }

  logout(token: string): void {
    const tokenHash = this.hashToken(token);
    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
  }

  revokeAllSessions(username: string): void {
    const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (user) {
      this.db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(user.id);
    }
  }

  cleanupExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1')
      .run(new Date().toISOString());
  }

  getUserRole(username: string): string | undefined {
    const user = this.db.prepare('SELECT role FROM users WHERE username = ?').get(username) as { role: string } | undefined;
    return user?.role;
  }

  changePassword(username: string, oldPassword: string, newPassword: string): { success: boolean; error?: string } {
    // Verify old password first
    const authResult = this.authenticate({ username, password: oldPassword });
    if (!authResult.success) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Update password
    const salt = randomBytes(16).toString('hex');
    const hash = this.hashPassword(newPassword, salt);
    this.db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE username = ?')
      .run(hash, salt, username);

    // Revoke all sessions
    this.revokeAllSessions(username);

    return { success: true };
  }

  adminChangePassword(adminUsername: string, targetUsername: string, newPassword: string): { success: boolean; error?: string } {
    // Verify admin has permission
    const adminRole = this.getUserRole(adminUsername);
    if (adminRole !== 'admin') {
      return { success: false, error: 'Admin privileges required' };
    }

    // Check if target user exists
    const targetUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(targetUsername) as { id: number } | undefined;
    if (!targetUser) {
      return { success: false, error: 'User not found' };
    }

    // Update password
    const salt = randomBytes(16).toString('hex');
    const hash = this.hashPassword(newPassword, salt);
    this.db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE username = ?')
      .run(hash, salt, targetUsername);

    // Revoke all sessions for target user
    this.revokeAllSessions(targetUsername);

    return { success: true };
  }

  getUserSessions(username: string): Array<{
    id: number;
    created_at: string;
    expires_at: string;
    ip_address: string | null;
    user_agent: string | null;
  }> {
    const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (!user) return [];

    const sessions = this.db.prepare(`
      SELECT id, created_at, expires_at, ip_address, user_agent
      FROM sessions
      WHERE user_id = ? AND revoked = 0 AND expires_at > ?
      ORDER BY created_at DESC
    `).all(user.id, new Date().toISOString()) as Array<{
      id: number;
      created_at: string;
      expires_at: string;
      ip_address: string | null;
      user_agent: string | null;
    }>;

    return sessions;
  }

  revokeSession(username: string, sessionId: number): { success: boolean; error?: string } {
    const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (!user) return { success: false, error: 'User not found' };

    const adminRole = this.getUserRole(username);
    if (adminRole !== 'admin') {
      return { success: false, error: 'Admin privileges required' };
    }

    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(sessionId, user.id);
    return { success: true };
  }

  revokeAllUserSessions(username: string): { success: boolean; error?: string } {
    const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (!user) return { success: false, error: 'User not found' };

    const adminRole = this.getUserRole(username);
    if (adminRole !== 'admin') {
      return { success: false, error: 'Admin privileges required' };
    }

    this.revokeAllSessions(username);
    return { success: true };
  }

  getLoginHistory(username: string, limit: number = 50): Array<{
    ip_address: string | null;
    success: boolean;
    attempted_at: string;
  }> {
    const attempts = this.db.prepare(`
      SELECT ip_address, success, attempted_at
      FROM login_attempts
      WHERE username = ?
      ORDER BY attempted_at DESC
      LIMIT ?
    `).all(username, limit) as Array<{
      ip_address: string | null;
      success: boolean;
      attempted_at: string;
    }>;

    return attempts;
  }

  unlockAccount(adminUsername: string, targetUsername: string): { success: boolean; error?: string } {
    // Verify admin exists and has permission
    const adminRole = this.getUserRole(adminUsername);
    if (adminRole !== 'admin') {
      return { success: false, error: 'Admin privileges required' };
    }

    const user = this.db.prepare('SELECT id, locked_until FROM users WHERE username = ?').get(targetUsername) as { id: number; locked_until: string | null } | undefined;
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!user.locked_until) {
      return { success: false, error: 'Account is not locked' };
    }

    this.db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    
    // Log the unlock action
    this.logAction(adminUsername, 'account-unlocked', { targetUser: targetUsername });
    
    return { success: true };
  }

  private logAction(user: string, action: string, details: Record<string, unknown>): void {
    try {
      this.db.prepare(`
        INSERT INTO audit_log (action, user, details)
        VALUES (?, ?, ?)
      `).run(action, user, JSON.stringify(details));
    } catch {
      // Ignore audit logging errors
    }
  }

  listUsers(options?: {
    search?: string;
    role?: string;
    status?: string;
    createdAfter?: string;
    createdBefore?: string;
    lastLoginAfter?: string;
    lastLoginBefore?: string;
    neverLoggedIn?: boolean;
    inactiveDays?: number;
  }): Array<{ id: number; username: string; role: string; created_at: string; last_login?: string; locked_until?: string | null }> {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (options?.search) {
      where.push('username LIKE ?');
      params.push(`%${options.search}%`);
    }

    if (options?.role && options.role !== 'all') {
      where.push('role = ?');
      params.push(options.role);
    }

    if (options?.status && options.status !== 'all') {
      if (options.status === 'locked') {
        where.push('locked_until IS NOT NULL AND locked_until > datetime("now")');
      } else if (options.status === 'active') {
        where.push('(locked_until IS NULL OR locked_until <= datetime("now"))');
        if (options?.inactiveDays) {
          const cutoff = new Date(Date.now() - options.inactiveDays * 24 * 60 * 60 * 1000).toISOString();
          where.push('(last_login IS NULL OR last_login >= ?)');
          params.push(cutoff);
        }
      } else if (options.status === 'inactive') {
        where.push('(locked_until IS NULL OR locked_until <= datetime("now"))');
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        where.push('(last_login IS NULL OR last_login < ?)');
        params.push(cutoff);
      }
    }

    if (options?.createdAfter) {
      where.push('created_at >= ?');
      params.push(options.createdAfter);
    }

    if (options?.createdBefore) {
      where.push('created_at <= ?');
      params.push(options.createdBefore);
    }

    if (options?.lastLoginAfter) {
      where.push('last_login >= ?');
      params.push(options.lastLoginAfter);
    }

    if (options?.lastLoginBefore) {
      where.push('last_login <= ?');
      params.push(options.lastLoginBefore);
    }

    if (options?.neverLoggedIn) {
      where.push('last_login IS NULL');
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const users = this.db.prepare(`
      SELECT id, username, role, created_at, last_login, locked_until
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
    `).all(...params) as Array<{ 
      id: number; 
      username: string; 
      role: string; 
      created_at: string; 
      last_login: string | null;
      locked_until: string | null;
    }>;

    return users.map(u => ({ 
      ...u, 
      last_login: u.last_login || undefined,
      locked_until: u.locked_until || undefined
    }));
  }

  getUserDetails(username: string): { 
    success: boolean; 
    user?: {
      id: number;
      username: string;
      role: string;
      created_at: string;
      last_login?: string;
      locked_until?: string | null;
      failed_login_attempts: number;
      account_status: 'active' | 'locked' | 'disabled';
      login_count: number;
    };
    error?: string;
  } {
    const user = this.db.prepare(`
      SELECT id, username, role, created_at, last_login, locked_until, failed_login_attempts
      FROM users
      WHERE username = ?
    `).get(username) as { 
      id: number; 
      username: string; 
      role: string; 
      created_at: string; 
      last_login: string | null;
      locked_until: string | null;
      failed_login_attempts: number;
    } | undefined;

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Get login count from audit log
    const loginCount = this.db.prepare(`
      SELECT COUNT(1) as count
      FROM audit_log
      WHERE action = 'login' AND user = ?
    `).get(username) as { count: number } | undefined;

    // Determine account status
    let account_status: 'active' | 'locked' | 'disabled' = 'active';
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
      if (lockExpiry > new Date()) {
        account_status = 'locked';
      }
    }

    return {
      success: true,
      user: {
        ...user,
        last_login: user.last_login || undefined,
        locked_until: user.locked_until || undefined,
        account_status,
        login_count: loginCount?.count || 0
      }
    };
  }

  getUserAuditHistory(username: string, limit: number = 20): AuditEntry[] {
    const entries = this.db.prepare(`
      SELECT id, action, user, details, ip_address, created_at
      FROM audit_log
      WHERE user = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(username, limit) as Array<{
      id: number;
      action: string;
      user: string | null;
      details: string | null;
      ip_address: string | null;
      created_at: string;
    }>;

    return entries.map(e => ({
      id: e.id,
      action: e.action as any,
      user: e.user || undefined,
      details: e.details ? JSON.parse(e.details) : undefined,
      ipAddress: e.ip_address || undefined,
      createdAt: e.created_at
    }));
  }

  deleteUser(adminUsername: string, targetUsername: string): { success: boolean; error?: string } {
    // Verify admin has permission
    const adminRole = this.getUserRole(adminUsername);
    if (adminRole !== 'admin') {
      return { success: false, error: 'Admin privileges required' };
    }

    // Prevent deleting yourself
    if (adminUsername === targetUsername) {
      return { success: false, error: 'Cannot delete your own account' };
    }

    // Check if user exists
    const targetUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(targetUsername) as { id: number } | undefined;
    if (!targetUser) {
      return { success: false, error: 'User not found' };
    }

    // Delete user
    this.db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);

    // Revoke all sessions
    this.revokeAllSessions(targetUsername);

    return { success: true };
  }

  bulkDeleteUsers(adminUsername: string, usernames: string[]): { success: boolean; deleted: number; errors: string[] } {
    const adminRole = this.getUserRole(adminUsername);
    if (adminRole !== 'admin') {
      return { success: false, deleted: 0, errors: ['Admin privileges required'] };
    }

    // Prevent deleting yourself
    if (usernames.includes(adminUsername)) {
      return { success: false, deleted: 0, errors: ['Cannot delete your own account'] };
    }

    const errors: string[] = [];
    let deleted = 0;

    const deleteStmt = this.db.prepare('DELETE FROM users WHERE username = ?');
    
    for (const username of usernames) {
      try {
        const result = deleteStmt.run(username);
        if (result.changes > 0) {
          deleted++;
        } else {
          errors.push(`User "${username}" not found`);
        }
      } catch (error) {
        errors.push(`Failed to delete "${username}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { success: errors.length === 0, deleted, errors };
  }

  bulkUpdateRole(adminUsername: string, usernames: string[], newRole: 'admin' | 'user'): { success: boolean; updated: number; errors: string[] } {
    const adminRole = this.getUserRole(adminUsername);
    if (adminRole !== 'admin') {
      return { success: false, updated: 0, errors: ['Admin privileges required'] };
    }

    // Prevent changing your own role
    if (usernames.includes(adminUsername)) {
      return { success: false, updated: 0, errors: ['Cannot change your own role'] };
    }

    const errors: string[] = [];
    let updated = 0;

    const updateStmt = this.db.prepare('UPDATE users SET role = ? WHERE username = ?');
    
    for (const username of usernames) {
      try {
        const result = updateStmt.run(newRole, username);
        if (result.changes > 0) {
          updated++;
        } else {
          errors.push(`User "${username}" not found`);
        }
      } catch (error) {
        errors.push(`Failed to update "${username}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { success: errors.length === 0, updated, errors };
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 32).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

// Middleware factory for Express
export function createAuthMiddleware(authService: AuthService) {
  return (req: any, res: any, next: any) => {
    // Skip auth for explicit public paths only.
    const skipPaths = new Set(['/api/auth/login', '/api/health']);
    if (skipPaths.has(req.path)) {
      return next();
    }

    // Try header first, then HttpOnly session cookie.
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing authorization' });
    }

    const result = authService.verifyToken(token);

    if (!result.valid) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    // Attach user info to request
    req.user = { username: result.username, role: result.role };
    next();
  };
}

function resolveJwtSecret(provided?: string): string {
  if (provided?.trim()) return provided.trim();
  const envSecret = process.env.SMDR_JWT_SECRET?.trim();
  if (envSecret) return envSecret;
  if (process.env.NODE_ENV === 'test') return 'smdr-insight-test-secret';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[Auth] SMDR_JWT_SECRET is required in production.');
  }
  const ephemeral = randomBytes(32).toString('hex');
  console.warn('[Auth] SMDR_JWT_SECRET is unset; using ephemeral in-memory secret for this process.');
  return ephemeral;
}

function getTokenFromRequest(req: any): string | undefined {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7);
  }

  const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!cookieHeader) return undefined;

  const tokenCookie = cookieHeader
    .split(';')
    .map((item: string) => item.trim())
    .find((cookie: string) => cookie.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!tokenCookie) return undefined;
  return decodeURIComponent(tokenCookie.slice(AUTH_COOKIE_NAME.length + 1));
}
