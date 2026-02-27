import jwt from 'jsonwebtoken';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

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

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);

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

  authenticate(credentials: { username: string; password: string }): AuthResult {
    const row = this.db
      .prepare('SELECT id, username, password_hash, salt, role, last_login FROM users WHERE username = ?')
      .get(credentials.username) as UserRow | undefined;

    if (!row) {
      return { success: false, error: 'Invalid credentials' };
    }

    const provided = this.hashPassword(credentials.password, row.salt);
    const isValid = timingSafeEqual(Buffer.from(row.password_hash, 'hex'), Buffer.from(provided, 'hex'));

    if (!isValid) {
      return { success: false, error: 'Invalid credentials' };
    }

    // Generate JWT token
    const payload: JwtPayload = { username: row.username };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: JWT_EXPIRY });

    // Store session
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    this.db.prepare(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(row.id, tokenHash, expiresAt);

    // Update last login
    this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
      .run(new Date().toISOString(), row.id);

    return {
      success: true,
      token,
      username: row.username,
      role: row.role || 'user'
    };
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

  listUsers(): Array<{ id: number; username: string; role: string; created_at: string; last_login?: string }> {
    const users = this.db.prepare(`
      SELECT id, username, role, created_at, last_login 
      FROM users 
      ORDER BY created_at DESC
    `).all() as Array<{ id: number; username: string; role: string; created_at: string; last_login: string | null }>;
    
    return users.map(u => ({ ...u, last_login: u.last_login || undefined }));
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
