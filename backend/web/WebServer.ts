import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SMDRService } from '../SMDRService';
import { SMDRRecord, AppConfig, BillingConfig, BillingReportData, CallCategory, PrefixRule } from '../../shared/types';
import { BillingConfigManager } from '../billing/BillingConfigManager';
import { billingEngine } from '../billing/BillingEngine';
import { BillingAuditService } from '../billing/BillingAuditService';
import { AuthService, createAuthMiddleware } from '../security/AuthService';
import { AuditAction, AuditLogger } from '../security/AuditLogger';
import {
    alertRuleSetSchema,
    appConfigSchema,
    authCredentialsSchema,
    billingConfigSchema,
    billingPrefixRuleCreateSchema,
    billingPrefixRuleUpdateSchema,
    billingReportRequestSchema,
    billingRatesUpdateSchema,
    billingTestRequestSchema,
    recordFiltersSchema,
    smdrTextImportSchema
} from '../../shared/validators';

export class WebServer {
    private readonly app = express();
    private readonly port = (() => {
        const parsed = Number.parseInt(process.env.SMDR_PORT ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 61593;
    })();
    private static readonly MAX_CONNECTION_EVENTS_LIMIT = 200;
    private static readonly AUTH_COOKIE_NAME = 'smdr_token';
    private static readonly AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    private readonly billingConfig: BillingConfigManager;
    private readonly authService: AuthService;
    private readonly auditLogger: AuditLogger;
    private readonly authMiddleware: ReturnType<typeof createAuthMiddleware>;

    constructor(private readonly service: SMDRService, private readonly configDir: string) {
        this.billingConfig = new BillingConfigManager(configDir);

        // Initialize auth and audit with raw DB
        const db = service.getRawDb();
        this.authService = new AuthService(db);
        this.authService.init();

        this.auditLogger = new AuditLogger(db);
        this.auditLogger.init();

        // Initialize billing audit service
        const billingAuditService = new BillingAuditService();
        billingAuditService.setDatabase(db);
        billingEngine.setAuditService(billingAuditService);

        this.authMiddleware = createAuthMiddleware(this.authService);

        // Middleware
        const allowedOrigins = (process.env.SMDR_ALLOWED_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);
        this.app.use(cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error('CORS origin rejected'));
            },
            credentials: true,
            exposedHeaders: ['Content-Length', 'Content-Disposition', 'X-Billing-Top-Calls-Truncated', 'X-Billing-Top-Calls-Count']
        }));
        this.app.use(express.json({ limit: '35mb' }));
        this.app.use((_req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'no-referrer');
            next();
        });
        
        // Request logging
        this.app.use(morgan('combined', {
            skip: (req) => req.path === '/api/health'
        }));

        // Rate limiting
        this.setupRateLimiting();
        
        this.setupRoutes();
        this.setupStatic();
    }

    private setupRateLimiting(): void {
        // Relaxed limit for login attempts (allow more tries)
        const loginLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 20, // Increased from 5 to 20 attempts
            message: { success: false, error: 'Too many login attempts, please try again later' },
            standardHeaders: true,
            legacyHeaders: false,
        });

        // Relaxed general API limit
        const apiLimiter = rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: 200, // Increased from 100 to 200
            message: { success: false, error: 'Too many requests, please slow down' },
            standardHeaders: true,
            legacyHeaders: false,
        });

        // Export limit (expensive operation) - DISABLED for better UX
        // const exportLimiter = rateLimit({
        //     windowMs: 5 * 60 * 1000, // 5 minutes
        //     max: 10,
        //     message: { success: false, error: 'Export limit reached' },
        //     standardHeaders: true,
        //     legacyHeaders: false,
        // });

        this.app.use('/api/auth/login', loginLimiter);
        this.app.use('/api/', apiLimiter);
        // Disabled export rate limiter
        // this.app.use('/api/records/export', exportLimiter);
    }

    start(): void {
        const tls = this.resolveTlsPaths();
        this.ensureTlsCertificate(tls);

        const key = fs.readFileSync(tls.keyPath, 'utf8');
        const cert = fs.readFileSync(tls.certPath, 'utf8');

        const httpsServer = https.createServer({ key, cert }, this.app);
        httpsServer.listen(this.port, '0.0.0.0', () => {
            console.log(`[Web] HTTPS server listening on https://0.0.0.0:${this.port}`);
            console.log(`[Web] TLS cert: ${tls.certPath}`);
            console.log(`[Web] TLS key: ${tls.keyPath}`);
        });

        const redirectPortRaw = process.env.SMDR_HTTP_REDIRECT_PORT;
        if (!redirectPortRaw) return;

        const redirectPort = Number.parseInt(redirectPortRaw, 10);
        if (!Number.isFinite(redirectPort) || redirectPort <= 0 || redirectPort === this.port) {
            console.warn(`[Web] Ignoring invalid SMDR_HTTP_REDIRECT_PORT: ${redirectPortRaw}`);
            return;
        }

        const redirectServer = http.createServer((req, res) => {
            const hostHeader = req.headers.host || `localhost:${redirectPort}`;
            const host = hostHeader.split(':')[0];
            const targetPort = this.port === 443 ? '' : `:${this.port}`;
            const location = `https://${host}${targetPort}${req.url || '/'}`;
            res.statusCode = 308;
            res.setHeader('Location', location);
            res.end();
        });

        redirectServer.listen(redirectPort, '0.0.0.0', () => {
            console.log(`[Web] HTTP redirect enabled on http://0.0.0.0:${redirectPort} -> https://0.0.0.0:${this.port}`);
        });
    }

    private resolveTlsPaths(): { certDir: string; keyPath: string; certPath: string; commonName: string } {
        const certDir = process.env.SMDR_TLS_DIR?.trim() || path.join(this.configDir, 'tls');
        const keyPath = process.env.SMDR_TLS_KEY_PATH?.trim() || path.join(certDir, 'server.key');
        const certPath = process.env.SMDR_TLS_CERT_PATH?.trim() || path.join(certDir, 'server.crt');
        const commonName = process.env.SMDR_TLS_CN?.trim() || os.hostname() || 'localhost';
        return { certDir, keyPath, certPath, commonName };
    }

    private ensureTlsCertificate(tls: { certDir: string; keyPath: string; certPath: string; commonName: string }): void {
        if (fs.existsSync(tls.keyPath) && fs.existsSync(tls.certPath)) return;

        fs.mkdirSync(tls.certDir, { recursive: true });
        const daysRaw = Number.parseInt(process.env.SMDR_TLS_DAYS ?? '825', 10);
        const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 825;
        const san = `subjectAltName=DNS:${tls.commonName},DNS:localhost,IP:127.0.0.1`;

        const result = spawnSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-sha256',
                '-nodes',
                '-days',
                String(days),
                '-keyout',
                tls.keyPath,
                '-out',
                tls.certPath,
                '-subj',
                `/CN=${tls.commonName}`,
                '-addext',
                san
            ],
            { encoding: 'utf8' }
        );

        if (result.status !== 0 || !fs.existsSync(tls.keyPath) || !fs.existsSync(tls.certPath)) {
            throw new Error(
                `[Web] Failed to create TLS certificate. ` +
                `Install openssl or set SMDR_TLS_KEY_PATH/SMDR_TLS_CERT_PATH. ` +
                `${result.stderr || result.error?.message || 'unknown error'}`
            );
        }

        console.log(`[Web] Generated self-signed TLS certificate for CN=${tls.commonName}`);
    }

    private sanitizeConfigForClient(config: AppConfig): AppConfig {
        const clone = structuredClone(config);
        if (clone.storage && 'encryptionKey' in clone.storage) {
            delete clone.storage.encryptionKey;
        }
        return clone;
    }

    private normalizeDateTimeFilter(value: string | undefined): string | undefined {
        if (!value) return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return `${trimmed} 00:00:00`;
        }
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
            return trimmed;
        }
        const date = new Date(trimmed);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString().slice(0, 19).replace('T', ' ');
        }
        return undefined;
    }

    private requireAdmin(req: express.Request, res: express.Response): boolean {
        if (req.user?.role === 'admin') return true;
        res.status(403).json({ success: false, error: 'Admin privileges required' });
        return false;
    }

    private getRequestToken(req: express.Request): string | undefined {
        const headerToken = req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.substring(7)
            : undefined;
        if (headerToken) return headerToken;

        const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
        if (!cookieHeader) return undefined;
        const tokenCookie = cookieHeader
            .split(';')
            .map((item) => item.trim())
            .find((cookie) => cookie.startsWith(`${WebServer.AUTH_COOKIE_NAME}=`));
        if (!tokenCookie) return undefined;
        return decodeURIComponent(tokenCookie.slice(WebServer.AUTH_COOKIE_NAME.length + 1));
    }

    private setAuthCookie(res: express.Response, token: string): void {
        const secure = process.env.NODE_ENV === 'production';
        const parts = [
            `${WebServer.AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
            'Path=/',
            `Max-Age=${Math.floor(WebServer.AUTH_COOKIE_MAX_AGE_MS / 1000)}`,
            'HttpOnly',
            'SameSite=Lax'
        ];
        if (secure) parts.push('Secure');
        res.setHeader('Set-Cookie', parts.join('; '));
    }

    private clearAuthCookie(res: express.Response): void {
        const secure = process.env.NODE_ENV === 'production';
        const parts = [
            `${WebServer.AUTH_COOKIE_NAME}=`,
            'Path=/',
            'Max-Age=0',
            'HttpOnly',
            'SameSite=Lax'
        ];
        if (secure) parts.push('Secure');
        res.setHeader('Set-Cookie', parts.join('; '));
    }

    private setupRoutes(): void {
        // Public liveness check with minimal exposure.
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        // Authenticated diagnostics endpoint with operational detail.
        this.app.get('/api/health/details', this.authMiddleware, (req, res) => {
            const status = this.service.getState();
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                connectionStatus: status.connectionStatus,
                uptime: process.uptime(),
                authenticated: true
            });
        });

        // ─── Authentication ────────────────────────────────────────────────────
        this.app.post('/api/auth/login', (req, res) => {
            console.log('[WebServer] Login request received');
            
            const result = authCredentialsSchema.safeParse(req.body);
            if (!result.success) {
                console.log('[WebServer] Invalid credentials format');
                return res.status(400).json({ success: false, error: 'Invalid credentials format' });
            }

            const { username, password } = result.data;
            console.log(`[WebServer] Login attempt for user: ${username}`);
            
            const ipAddress = req.ip || req.socket.remoteAddress;
            const userAgent = req.get('user-agent');
            const authResult = this.authService.authenticate({ username, password }, ipAddress || undefined, userAgent);

            console.log(`[WebServer] Auth result: success=${authResult.success}, error=${authResult.error}`);
            
            this.auditLogger.logLogin(username, authResult.success, ipAddress || undefined);

            if (authResult.success) {
                if (!authResult.token) {
                    console.log('[WebServer] Token generation failed');
                    return res.status(500).json({ success: false, error: 'Authentication token generation failed' });
                }
                console.log(`[WebServer] Login successful for ${username}`);
                this.setAuthCookie(res, authResult.token);
                res.json({
                    success: true,
                    token: authResult.token,
                    username: authResult.username,
                    role: authResult.role
                });
            } else {
                console.log(`[WebServer] Login failed: ${authResult.error}`);
                res.status(401).json({ success: false, error: authResult.error });
            }
        });

        this.app.post('/api/auth/logout', this.authMiddleware, (req, res) => {
            const token = this.getRequestToken(req);
            if (token) {
                this.authService.logout(token);
                this.auditLogger.logLogout(req.user?.username || 'unknown', req.ip || undefined);
            }
            this.clearAuthCookie(res);
            res.json({ success: true });
        });

        this.app.get('/api/auth/verify', this.authMiddleware, (req, res) => {
            res.json({ success: true, user: req.user });
        });

        // Unlock locked account (Admin only)
        this.app.post('/api/auth/unlock-account', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                
                const result = authCredentialsSchema.safeParse(req.body);
                if (!result.success) {
                    return res.status(400).json({ success: false, error: 'Invalid request' });
                }
                
                const unlockResult = this.authService.unlockAccount(req.user!.username, result.data.username);
                if (unlockResult.success) {
                    this.auditLogger.log({
                        action: 'account-unlocked',
                        user: req.user!.username,
                        details: { targetUser: result.data.username },
                        ipAddress: req.ip || undefined
                    });
                    res.json({ success: true });
                } else {
                    res.status(400).json({ success: false, error: unlockResult.error });
                }
            } catch (error) {
                res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to unlock account' });
            }
        });

        this.app.get('/api/users', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;

                const pageRaw = Number.parseInt(String(req.query.page ?? '1'), 10);
                const pageSizeRaw = Number.parseInt(String(req.query.pageSize ?? '20'), 10);
                const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
                const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 5), 100) : 20;
                
                // Basic filters
                const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
                const role = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : '';
                
                // Advanced filters
                const status = typeof req.query.status === 'string' ? req.query.status : '';
                const createdAfter = typeof req.query.createdAfter === 'string' ? req.query.createdAfter : '';
                const createdBefore = typeof req.query.createdBefore === 'string' ? req.query.createdBefore : '';
                const lastLoginAfter = typeof req.query.lastLoginAfter === 'string' ? req.query.lastLoginAfter : '';
                const lastLoginBefore = typeof req.query.lastLoginBefore === 'string' ? req.query.lastLoginBefore : '';
                const neverLoggedIn = req.query.neverLoggedIn === 'true';
                const inactiveDays = typeof req.query.inactiveDays === 'string' ? Number.parseInt(req.query.inactiveDays, 10) : undefined;
                
                const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'created_at';
                const sortDirRaw = typeof req.query.sortDir === 'string' ? req.query.sortDir : 'desc';

                if (role && role !== 'admin' && role !== 'user') {
                    return res.status(400).json({ success: false, error: 'Invalid role filter' });
                }

                const sortColumnMap: Record<string, string> = {
                    username: 'username',
                    role: 'role',
                    created_at: 'created_at',
                    last_login: 'last_login'
                };
                const sortColumn = sortColumnMap[sortByRaw] || 'created_at';
                const sortDir = sortDirRaw.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

                // Use AuthService for filtering with advanced options
                const users = this.authService.listUsers({
                    search: search || undefined,
                    role: role || undefined,
                    status: status || undefined,
                    createdAfter: createdAfter || undefined,
                    createdBefore: createdBefore || undefined,
                    lastLoginAfter: lastLoginAfter || undefined,
                    lastLoginBefore: lastLoginBefore || undefined,
                    neverLoggedIn: neverLoggedIn || undefined,
                    inactiveDays: inactiveDays
                });

                // Apply sorting in memory
                const sortKey = sortByRaw as keyof typeof users[0];
                const sortedUsers = [...users].sort((a, b) => {
                    const aVal = a[sortKey] || '';
                    const bVal = b[sortKey] || '';
                    const cmp = String(aVal).localeCompare(String(bVal));
                    return sortDir === 'ASC' ? cmp : -cmp;
                });

                // Apply pagination
                const total = sortedUsers.length;
                const offset = (page - 1) * pageSize;
                const paginatedUsers = sortedUsers.slice(offset, offset + pageSize);

                res.json({
                    success: true,
                    data: {
                        items: paginatedUsers.map((user) => ({ 
                            ...user, 
                            last_login: user.last_login || undefined,
                            locked_until: user.locked_until || undefined
                        })),
                        total,
                        page,
                        pageSize
                    }
                });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/users', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;

                const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
                const password = typeof req.body?.password === 'string' ? req.body.password : '';
                const role = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : 'user';

                if (!username || !password) {
                    return res.status(400).json({ success: false, error: 'Username and password required' });
                }
                if (username.length < 3 || username.length > 50) {
                    return res.status(400).json({ success: false, error: 'Username must be 3-50 characters' });
                }
                if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
                    return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, dots, underscores, and hyphens' });
                }
                if (password.length < 6 || password.length > 100) {
                    return res.status(400).json({ success: false, error: 'Password must be 6-100 characters' });
                }
                if (role !== 'admin' && role !== 'user') {
                    return res.status(400).json({ success: false, error: 'Invalid role' });
                }

                // Check if user already exists
                const db = this.service.getRawDb();
                const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
                if (existing) {
                    return res.status(400).json({ success: false, error: 'User already exists' });
                }

                this.authService.createUser({ username, password }, role);
                this.auditLogger.log({ action: 'user-create', user: req.user?.username, details: { createdUser: username, role } });
                res.json({ success: true, message: 'User created successfully' });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.put('/api/users/:username/password', this.authMiddleware, (req, res) => {
            try {
                const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
                const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
                const oldPassword = typeof req.body?.oldPassword === 'string' ? req.body.oldPassword : '';
                const requesterUsername = req.user?.username;
                const requesterRole = req.user?.role;

                if (!requesterUsername) {
                    return res.status(401).json({ success: false, error: 'Unauthorized' });
                }
                if (!username) {
                    return res.status(400).json({ success: false, error: 'Target username required' });
                }
                if (newPassword.length < 6 || newPassword.length > 100) {
                    return res.status(400).json({ success: false, error: 'Password must be 6-100 characters' });
                }
                if (requesterRole !== 'admin' && requesterUsername !== username) {
                    return res.status(403).json({ success: false, error: 'You can only change your own password' });
                }

                // Admin changing another user's password
                if (requesterRole === 'admin' && username !== requesterUsername) {
                    const result = this.authService.adminChangePassword(requesterUsername, username, newPassword);
                    if (!result.success) {
                        return res.status(400).json({ success: false, error: result.error });
                    }
                    this.auditLogger.log({ action: 'password-change', user: req.user?.username, details: { targetUser: username } });
                    return res.json({ success: true, message: 'Password changed successfully' });
                }
                
                // User changing their own password
                if (!oldPassword) {
                    return res.status(400).json({ success: false, error: 'Current password required' });
                }
                
                const result = this.authService.changePassword(requesterUsername, oldPassword, newPassword);
                if (!result.success) {
                    return res.status(400).json({ success: false, error: result.error });
                }
                
                this.auditLogger.log({ action: 'password-change', user: req.user?.username, details: { targetUser: username } });
                res.json({ success: true, message: 'Password changed successfully' });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.delete('/api/users/:username', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const { username } = req.params;
                const result = this.authService.deleteUser(req.user?.username || '', username);
                if (!result.success) {
                    return res.status(400).json({ success: false, error: result.error });
                }
                this.auditLogger.log({ action: 'user-delete', user: req.user?.username, details: { deletedUser: username } });
                res.json({ success: true, message: 'User deleted successfully' });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // User Details
        this.app.get('/api/users/:username/details', this.authMiddleware, (req, res) => {
            console.log('[UserDetails] Request for username:', req.params.username);
            console.log('[UserDetails] User:', req.user?.username);
            
            try {
                if (!this.requireAdmin(req, res)) return;
                const { username } = req.params;
                const result = this.authService.getUserDetails(username);
                console.log('[UserDetails] Result:', result);
                
                if (!result.success) {
                    return res.status(404).json({ success: false, error: result.error });
                }
                res.json({ success: true, data: result.user });
            } catch (err: any) {
                console.error('[UserDetails] Error:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/users/:username/audit', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const { username } = req.params;
                const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 20;
                const entries = this.authService.getUserAuditHistory(username, limit);
                res.json({ success: true, data: entries });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // Bulk Operations
        this.app.post('/api/users/bulk-delete', this.authMiddleware, (req, res) => {
            console.log('[BulkDelete] Request received:', req.body);
            console.log('[BulkDelete] User:', req.user?.username);
            
            try {
                if (!this.requireAdmin(req, res)) return;
                const { usernames } = req.body as { usernames: string[] };
                console.log('[BulkDelete] Usernames to delete:', usernames);
                
                if (!Array.isArray(usernames) || usernames.length === 0) {
                    console.log('[BulkDelete] Invalid usernames array');
                    return res.status(400).json({ success: false, error: 'Usernames array required' });
                }
                const result = this.authService.bulkDeleteUsers(req.user?.username || '', usernames);
                console.log('[BulkDelete] Result:', result);
                
                this.auditLogger.log({ action: 'user-bulk-delete', user: req.user?.username, details: { deletedCount: result.deleted } });
                // Always return 200 OK, let frontend handle partial failures
                res.json({ success: result.errors.length === 0, deleted: result.deleted, errors: result.errors });
            } catch (err: any) {
                console.error('[BulkDelete] Error:', err.message);
                res.status(500).json({ success: false, deleted: 0, errors: [err.message] });
            }
        });

        this.app.post('/api/users/bulk-update-role', this.authMiddleware, (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const { usernames, role } = req.body as { usernames: string[]; role: 'admin' | 'user' };
                if (!Array.isArray(usernames) || usernames.length === 0) {
                    return res.status(400).json({ success: false, error: 'Usernames array required' });
                }
                if (role !== 'admin' && role !== 'user') {
                    return res.status(400).json({ success: false, error: 'Invalid role' });
                }
                const result = this.authService.bulkUpdateRole(req.user?.username || '', usernames, role);
                this.auditLogger.log({ action: 'user-bulk-role-change', user: req.user?.username, details: { updatedCount: result.updated, newRole: role } });
                // Always return 200 OK, let frontend handle partial failures
                res.json({ success: result.errors.length === 0, updated: result.updated, errors: result.errors });
            } catch (err: any) {
                res.status(500).json({ success: false, updated: 0, errors: [err.message] });
            }
        });

        // Real-time Events (SSE) - Must be before auth middleware
        this.app.get('/api/events', this.authMiddleware, (req, res) => {
            console.log('[SSE] Client connected to events stream');
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            // Send the current connection status immediately so renderer refreshes
            // can rehydrate live state without waiting for the next status transition.
            const state = this.service.getState();
            res.write(`data: ${JSON.stringify({ type: 'status', payload: String(state.connectionStatus ?? 'disconnected') })}\n\n`);

            const handler = (event: any) => {
                const data = `data: ${JSON.stringify(event)}\n\n`;
                res.write(data);
            };

            this.service.on('event', handler);

            const heartbeat = setInterval(() => {
                res.write(':heartbeat\n\n');
            }, 30000);

            req.on('close', () => {
                clearInterval(heartbeat);
                this.service.off('event', handler);
                res.end();
            });

            req.on('error', (err) => {
                console.error('[SSE] Stream error:', err.message);
                clearInterval(heartbeat);
                this.service.off('event', handler);
            });
        });

        // Apply auth middleware to all other API routes
        this.app.use('/api', this.authMiddleware);

        // Config & State
        this.app.get('/api/config', (req, res) => {
            res.json(this.sanitizeConfigForClient(this.service.getConfig()));
        });

        this.app.post('/api/config/update', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;

                const parsed = appConfigSchema.safeParse(req.body);
                if (!parsed.success) {
                    return res.status(400).json({ success: false, error: 'Invalid configuration payload', details: parsed.error.errors });
                }

                const nextConfig = parsed.data as AppConfig;
                nextConfig.connection.controllerIps = Array.from(new Set(nextConfig.connection.controllerIps.map((ip) => ip.trim())));
                if (nextConfig.connection.ipWhitelist) {
                    nextConfig.connection.ipWhitelist = Array.from(new Set(nextConfig.connection.ipWhitelist.map((ip) => ip.trim())));
                }
                nextConfig.alerts.watchNumbers = Array.from(
                    new Set(nextConfig.alerts.watchNumbers.map((item) => item.trim()).filter(Boolean))
                );

                this.service.updateConfig(nextConfig);
                this.auditLogger.logConfigChange(
                    req.user?.username || 'unknown',
                    this.sanitizeConfigForClient(nextConfig) as unknown as Record<string, unknown>,
                    req.ip || undefined
                );
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/alerts/update-rules', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const parsed = alertRuleSetSchema.safeParse(req.body);
                if (!parsed.success) {
                    return res.status(400).json({ success: false, error: 'Invalid alert rules payload', details: parsed.error.errors });
                }
                const normalizedRules = {
                    ...parsed.data,
                    watchNumbers: Array.from(new Set(parsed.data.watchNumbers.map((item) => item.trim()).filter(Boolean)))
                };
                this.service.updateAlertRules(normalizedRules);
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/state', (req, res) => {
            res.json(this.service.getState());
        });

        // Data
        this.app.get('/api/dashboard', (req, res) => {
            const { date } = req.query;
            res.json(this.service.getDashboard(date as string));
        });

        this.app.get('/api/records', (req, res) => {
            const result = recordFiltersSchema.safeParse(req.query);
            if (!result.success) {
                return res.status(400).json({ success: false, error: 'Invalid filter parameters', details: result.error.errors });
            }
            res.json(this.service.getRecords(result.data));
        });

        this.app.get('/api/records/page', (req, res) => {
            const result = recordFiltersSchema.safeParse(req.query);
            if (!result.success) {
                return res.status(400).json({ success: false, error: 'Invalid filter parameters', details: result.error.errors });
            }
            res.json(this.service.getRecordsPage(result.data));
        });

        this.app.get('/api/records/summary', (req, res) => {
            const result = recordFiltersSchema.safeParse(req.query);
            if (!result.success) {
                return res.status(400).json({ success: false, error: 'Invalid filter parameters', details: result.error.errors });
            }
            res.json(this.service.getCallLogSummary(result.data));
        });

        this.app.post('/api/records/import-text', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;

                const parsed = smdrTextImportSchema.safeParse(req.body);
                if (!parsed.success) {
                    return res.status(400).json({ success: false, error: 'Invalid import payload', details: parsed.error.errors });
                }

                const result = this.service.importSmdrText(parsed.data.content, parsed.data.fileName);
                this.auditLogger.logImport(
                    req.user?.username || 'unknown',
                    parsed.data.fileName || 'manual upload',
                    {
                        totalLines: result.totalLines,
                        logicalRecords: result.logicalRecords,
                        parsedRecords: result.parsedRecords,
                        insertedRecords: result.insertedRecords,
                        duplicateRecords: result.duplicateRecords,
                        parseErrors: result.parseErrors,
                        skippedLines: result.skippedLines
                    },
                    req.ip || undefined
                );

                res.json({ success: true, data: result });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/analytics', (req, res) => {
            const { startDate, endDate } = req.query;
            res.json(this.service.getAnalytics(startDate as string, endDate as string));
        });

        this.app.get('/api/alerts', (req, res) => {
            const { limit } = req.query;
            res.json(this.service.getAlerts(Number(limit) || 100));
        });

        this.app.get('/api/parse-errors', (req, res) => {
            const { limit } = req.query;
            res.json(this.service.getParseErrors(Number(limit) || 100));
        });

        this.app.get('/api/connection-events', (req, res) => {
            if (!this.requireAdmin(req, res)) return;

            const { level, startDate, endDate, limit, offset } = req.query as Record<string, string>;
            if (level && !['info', 'warn', 'error'].includes(level)) {
                return res.status(400).json({ success: false, error: 'Invalid level filter' });
            }
            const normalizedStartDate = this.normalizeDateTimeFilter(startDate);
            const normalizedEndDate = this.normalizeDateTimeFilter(endDate);
            if (startDate && !normalizedStartDate) {
                return res.status(400).json({ success: false, error: 'Invalid startDate filter' });
            }
            if (endDate && !normalizedEndDate) {
                return res.status(400).json({ success: false, error: 'Invalid endDate filter' });
            }
            const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
            const parsedOffset = offset ? Number.parseInt(offset, 10) : 0;
            const safeLimit = Number.isFinite(parsedLimit)
                ? Math.min(Math.max(parsedLimit, 1), WebServer.MAX_CONNECTION_EVENTS_LIMIT)
                : 100;
            const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
            const data = this.service.getConnectionEvents({
                level: level as 'info' | 'warn' | 'error' | undefined,
                startDate: normalizedStartDate,
                endDate: normalizedEndDate,
                limit: safeLimit,
                offset: safeOffset
            });
            res.json({ success: true, data });
        });

        this.app.get('/api/audit-logs', (req, res) => {
            if (!this.requireAdmin(req, res)) return;
            const { action, user, startDate, endDate, limit, offset, ipAddress } = req.query as Record<string, string>;
            const allowedActions: AuditAction[] = [
                'login',
                'logout',
                'config-change',
                'alert-rule-change',
                'billing-config-change',
                'export',
                'import',
                'purge',
                'user-create',
                'user-delete',
                'user-bulk-delete',
                'user-role-change',
                'user-bulk-role-change',
                'password-change',
                'password-reset',
                'stream-start',
                'stream-stop',
                'account-unlocked',
                'account-lock',
                'account-status-change'
            ];
            const actionFilter = action && allowedActions.includes(action as AuditAction) ? (action as AuditAction) : undefined;
            if (action && !actionFilter) {
                return res.status(400).json({ success: false, error: 'Invalid audit action filter' });
            }
            const parsedLimit = limit ? Number.parseInt(limit, 10) : 500;
            const parsedOffset = offset ? Number.parseInt(offset, 10) : 0;
            const result = this.auditLogger.getLogs({
                action: actionFilter,
                user,
                startDate,
                endDate,
                ipAddress,
                limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 10000) : 500,
                offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0
            });

            res.json({ success: true, data: result.data, total: result.total });
        });

        // ── Billing Config ───────────────────────────────────────────────────
        this.app.get('/api/billing/config', (_req, res) => {
            res.json({ success: true, data: this.billingConfig.get() });
        });

        this.app.put('/api/billing/config', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const result = billingConfigSchema.safeParse(req.body);
                if (!result.success) {
                    return res.status(400).json({ success: false, error: 'Invalid billing config', details: result.error.errors });
                }
                const config = result.data as BillingConfig;
                // Ensure all prefix rules have IDs
                config.prefixRules = config.prefixRules.map(r => ({
                    ...r,
                    id: r.id || `pr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                    prefix: r.prefix.trim(),
                    description: r.description.trim()
                })) as PrefixRule[];
                config.currency = config.currency.toUpperCase();
                config.rates = config.rates.map((rate) => ({
                    ...rate,
                    currency: rate.currency.toUpperCase(),
                    tiers: rate.tiers?.map((tier) => ({
                        ...tier,
                        minMinutes: Number(tier.minMinutes),
                        maxMinutes: tier.maxMinutes !== undefined ? Number(tier.maxMinutes) : undefined,
                        ratePerMinute: Number(tier.ratePerMinute)
                    }))
                }));
                this.billingConfig.save(config);
                this.auditLogger.logBillingConfigChange(req.user?.username || 'unknown', result.data, req.ip || undefined);
                res.json({ success: true, data: this.billingConfig.get() });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/billing/prefix-rules', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const result = billingPrefixRuleCreateSchema.safeParse(req.body);
                if (!result.success) {
                    return res.status(400).json({ success: false, error: 'Invalid prefix rule', details: result.error.errors });
                }
                const config = this.billingConfig.get();
                const rule = {
                    ...result.data,
                    id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    prefix: result.data.prefix.trim(),
                    description: result.data.description.trim()
                };
                config.prefixRules.push(rule);
                this.billingConfig.save(config);
                this.auditLogger.logBillingConfigChange(req.user?.username || 'unknown', { op: 'add-prefix-rule', rule }, req.ip || undefined);
                res.json({ success: true, data: rule });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.put('/api/billing/prefix-rules/:id', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const parsedUpdate = billingPrefixRuleUpdateSchema.safeParse(req.body);
                if (!parsedUpdate.success) {
                    return res.status(400).json({ success: false, error: 'Invalid prefix rule update', details: parsedUpdate.error.errors });
                }
                const config = this.billingConfig.get();
                const idx = config.prefixRules.findIndex((r) => r.id === req.params.id);
                if (idx === -1) return res.status(404).json({ success: false, error: 'Rule not found' });
                const updateData = parsedUpdate.data;
                config.prefixRules[idx] = {
                    ...config.prefixRules[idx],
                    ...updateData,
                    id: req.params.id,
                    prefix: updateData.prefix !== undefined ? updateData.prefix.trim() : config.prefixRules[idx].prefix,
                    description: updateData.description !== undefined ? updateData.description.trim() : config.prefixRules[idx].description
                };
                this.billingConfig.save(config);
                this.auditLogger.logBillingConfigChange(
                    req.user?.username || 'unknown',
                    { op: 'update-prefix-rule', id: req.params.id, update: updateData },
                    req.ip || undefined
                );
                res.json({ success: true, data: config.prefixRules[idx] });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.delete('/api/billing/prefix-rules/:id', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const config = this.billingConfig.get();
                const existing = config.prefixRules.find((r) => r.id === req.params.id);
                if (!existing) return res.status(404).json({ success: false, error: 'Rule not found' });
                config.prefixRules = config.prefixRules.filter((r) => r.id !== req.params.id);
                this.billingConfig.save(config);
                this.auditLogger.logBillingConfigChange(
                    req.user?.username || 'unknown',
                    { op: 'delete-prefix-rule', id: req.params.id },
                    req.ip || undefined
                );
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.put('/api/billing/rates', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const parsedRates = billingRatesUpdateSchema.safeParse(req.body);
                if (!parsedRates.success) {
                    return res.status(400).json({ success: false, error: 'Invalid rates payload', details: parsedRates.error.errors });
                }
                const config = this.billingConfig.get();
                config.rates = parsedRates.data.rates.map((rate) => ({
                    ...rate,
                    currency: rate.currency.toUpperCase(),
                    tiers: rate.tiers?.map((tier) => ({
                        ...tier,
                        minMinutes: Number(tier.minMinutes),
                        maxMinutes: tier.maxMinutes !== undefined ? Number(tier.maxMinutes) : undefined,
                        ratePerMinute: Number(tier.ratePerMinute)
                    }))
                }));
                this.billingConfig.save(config);
                this.auditLogger.logBillingConfigChange(
                    req.user?.username || 'unknown',
                    { op: 'update-rates', count: config.rates.length },
                    req.ip || undefined
                );
                res.json({ success: true, data: config.rates });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/billing/test', (req, res) => {
            const parsed = billingTestRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ success: false, error: 'Invalid test request', details: parsed.error.errors });
            }
            const { number, durationSeconds, callDate, isHoliday } = parsed.data;
            const result = billingEngine.rateCall(String(number), Number(durationSeconds) || 60, {
                callDate,
                isHoliday
            });
            res.json({ success: true, data: result });
        });

        // ── Bulk Operations ───────────────────────────────────────────────────
        this.app.post('/api/billing/bulk', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const { action, ruleIds } = req.body as { action: 'enable' | 'disable' | 'delete'; ruleIds: string[] };
                if (!action || !ruleIds || !Array.isArray(ruleIds)) {
                    return res.status(400).json({ success: false, error: 'Invalid bulk action request' });
                }
                const result = billingEngine.bulkRuleAction({ action, ruleIds }, req.user?.username);
                if (result.success) {
                    this.billingConfig.save(billingEngine.getConfig());
                }
                res.json({ success: result.success, data: result });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // ── Audit History ─────────────────────────────────────────────────────
        this.app.get('/api/billing/audit', (req, res) => {
            try {
                const limit = Math.min(Number(req.query.limit) || 100, 500);
                const offset = Number(req.query.offset) || 0;
                const auditService = (billingEngine as any).auditService;
                if (!auditService) {
                    return res.json({ success: true, data: { entries: [], total: 0, summary: { totalChanges: 0, rulesAdded: 0, rulesDeleted: 0, ratesChanged: 0 } } });
                }
                const history = auditService.getChangeHistory(limit, offset);
                res.json({ success: true, data: history });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // ── Impact Analysis ───────────────────────────────────────────────────
        this.app.post('/api/billing/impact', async (req, res) => {
            try {
                const { category, currentRate, proposedRate, periodDays = 30 } = req.body;
                if (!category || currentRate === undefined || proposedRate === undefined) {
                    return res.status(400).json({ success: false, error: 'Missing required fields' });
                }
                const { BillingImpactService } = await import('../billing/BillingImpactService.js');
                const impactService = new BillingImpactService(this.service.getRawDb());
                const analysis = impactService.analyzeProposedRateChange(category, currentRate, proposedRate, periodDays);
                res.json({ success: true, data: analysis });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // ── Billing Report ───────────────────────────────────────────────────
        this.app.get('/api/billing/report', (req, res) => {
            try {
                const parsed = billingReportRequestSchema.safeParse(req.query);
                if (!parsed.success) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid billing report query',
                        details: parsed.error.errors
                    });
                }

                const from = parsed.data.from?.slice(0, 10);
                const to = parsed.data.to?.slice(0, 10);
                const report = this.service.getBillingReport({
                    ...parsed.data,
                    from,
                    to
                });
                res.json({ success: true, data: report });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/billing/report/export-pdf', (req, res) => {
            try {
                const parsed = billingReportRequestSchema.safeParse(req.body ?? {});
                if (!parsed.success) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid billing report export request',
                        details: parsed.error.errors
                    });
                }

                const from = parsed.data.from?.slice(0, 10);
                const to = parsed.data.to?.slice(0, 10);
                const report = this.service.getBillingReport({
                    ...parsed.data,
                    from,
                    to,
                    includeAllTopCalls: true
                });

                const generatedAt = new Date();
                const pdfBuffer = this.buildBillingReportPdf(report, { from, to }, generatedAt);
                const fileName = `billing-report-${generatedAt.toISOString().slice(0, 10)}.pdf`;

                this.auditLogger.logExport(req.user?.username || 'unknown', 'billing-pdf', report.topCostCalls.length, req.ip || undefined);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.setHeader('Content-Length', String(pdfBuffer.length));
                res.setHeader('X-Billing-Top-Calls-Truncated', String(report.topCostCallsTruncated === true));
                res.setHeader('X-Billing-Top-Calls-Count', String(report.topCostCalls.length));
                res.send(pdfBuffer);
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // Stream control
        this.app.post('/api/stream/start', (req, res) => {
            if (!this.requireAdmin(req, res)) return;
            this.service.start();
            this.auditLogger.logStreamControl(req.user?.username || 'unknown', 'start', req.ip || undefined);
            res.json({ success: true });
        });

        this.app.post('/api/stream/stop', (req, res) => {
            if (!this.requireAdmin(req, res)) return;
            this.service.stop();
            this.auditLogger.logStreamControl(req.user?.username || 'unknown', 'stop', req.ip || undefined);
            res.json({ success: true });
        });

        // Export
        this.app.get('/api/records/export', (req, res) => {
            // Set no-cache headers
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');

            // Check authentication
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required', message: 'Please log in and try again' });
            }

            const formatRaw = typeof req.query.format === 'string' ? req.query.format : 'csv';
            const format = formatRaw === 'pdf' || formatRaw === 'xlsx' || formatRaw === 'csv' ? formatRaw : 'csv';
            const parsedFilters = recordFiltersSchema.safeParse(req.query);
            if (!parsedFilters.success) {
                return res.status(400).json({ success: false, error: 'Invalid filter parameters', details: parsedFilters.error.errors });
            }
            const filters = parsedFilters.data;

            try {
                const records = this.service.getRecords(filters);

                if (records.length === 0) {
                    // Return appropriate empty file based on format
                    if (format === 'pdf') {
                        const { jsPDF } = require('jspdf');
                        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
                        doc.setFontSize(16);
                        doc.text('SMDR Call Log Report', 14, 15);
                        doc.setFontSize(10);
                        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 21);
                        doc.text('Total Records: 0', 14, 26);
                        doc.text('No records found for the selected filters', 14, 32);
                        res.setHeader('Content-Type', 'application/pdf');
                        res.setHeader('Content-Disposition', `attachment; filename="smdr-export-${Date.now()}.pdf"`);
                        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
                        res.send(pdfBuffer);
                    } else if (format === 'xlsx') {
                        const workbook = XLSX.utils.book_new();
                        const worksheet = XLSX.utils.json_to_sheet([]);
                        XLSX.utils.book_append_sheet(workbook, worksheet, 'SMDR');
                        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                        res.setHeader('Content-Disposition', `attachment; filename="smdr-export-${Date.now()}.xlsx"`);
                        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
                        res.send(buffer);
                    } else {
                        // CSV
                        res.setHeader('Content-Type', 'text/csv');
                        res.setHeader('Content-Disposition', `attachment; filename="smdr-export-${Date.now()}.csv"`);
                        const csvContent = 'date,startTime,duration,callingParty,calledParty,duration_seconds,callType\n';
                        res.send(csvContent);
                    }
                    return;
                }

                this.auditLogger.logExport(req.user?.username || 'unknown', format, records.length, req.ip || undefined);

                if (format === 'pdf') {
                    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

                    // Title
                    doc.setFontSize(16);
                    doc.text('SMDR Call Log Report', 14, 15);
                    doc.setFontSize(10);
                    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 21);
                    doc.text(`Total Records: ${records.length}`, 14, 26);

                    // Prepare table data
                    const tableData = records.map((r) => [
                        r.date || '',
                        r.startTime || '',
                        r.callingParty || '',
                        r.calledParty || '',
                        r.duration || '',
                        r.callType || '',
                        r.callCompletionStatus || ''
                    ]);

                    // Create table
                    autoTable(doc, {
                        head: [['Date', 'Time', 'From', 'To', 'Duration', 'Type', 'Status']],
                        body: tableData,
                        startY: 32,
                        theme: 'striped',
                        headStyles: { fillColor: [36, 132, 235], textColor: [255, 255, 255], fontSize: 9 },
                        bodyStyles: { fontSize: 8 },
                        columnStyles: {
                            0: { cellWidth: 25 },
                            1: { cellWidth: 20 },
                            2: { cellWidth: 30 },
                            3: { cellWidth: 30 },
                            4: { cellWidth: 25 },
                            5: { cellWidth: 20 },
                            6: { cellWidth: 20 }
                        },
                        margin: { top: 32, left: 14, right: 14 }
                    });

                    const fileName = `smdr-export-${Date.now()}.pdf`;
                    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                    res.setHeader('Content-Length', String(pdfBuffer.length));
                    res.send(pdfBuffer);

                } else if (format === 'xlsx') {
                    // Export as Excel
                    const worksheet = XLSX.utils.json_to_sheet(records);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, 'SMDR Records');

                    const fileName = `smdr-export-${Date.now()}.xlsx`;
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

                    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
                    res.send(buffer);
                } else {
                    // Export as CSV
                    const csv = this.toCsv(records);

                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename=smdr-export-${Date.now()}.csv`);
                    res.send(csv);
                }
            } catch (err: any) {
                // Return error as the expected format (not JSON for blob requests)
                res.status(500).send(`Export failed: ${err.message}`);
            }
        });

        // Purge (admin only)
        this.app.post('/api/records/purge', (req, res) => {
            if (!this.requireAdmin(req, res)) return;
            const rawDays = req.body?.days ?? req.query?.days;
            const parsedDays = Number.parseInt(String(rawDays ?? ''), 10);
            if (!Number.isFinite(parsedDays)) {
                return res.status(400).json({ success: false, error: 'days parameter required' });
            }
            if (parsedDays < 1 || parsedDays > 3650) {
                return res.status(400).json({ success: false, error: 'days must be between 1 and 3650' });
            }
            const removed = this.service.purgeRecords(parsedDays);
            res.json({ success: true, removed });
        });

        this.app.get('/api/records/purge-estimate', (req, res) => {
            if (!this.requireAdmin(req, res)) return;

            const parsedDays = Number.parseInt(String(req.query.days ?? ''), 10);
            if (!Number.isFinite(parsedDays)) {
                return res.status(400).json({ success: false, error: 'days query parameter required' });
            }
            if (parsedDays < 1 || parsedDays > 3650) {
                return res.status(400).json({ success: false, error: 'days must be between 1 and 3650' });
            }

            const data = this.service.estimatePurgeRecords(parsedDays);
            res.json({ success: true, data });
        });

        // ── Maintenance ──────────────────────────────────────────────────────
        this.app.get('/api/maintenance/stats', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                const stats = this.service.getDatabaseStats();
                res.json({ success: true, data: stats });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/maintenance/optimize', (req, res) => {
            try {
                if (!this.requireAdmin(req, res)) return;
                this.service.optimizeDatabase();
                res.json({ success: true, message: 'Database optimization completed' });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }

    private setupStatic(): void {
        const pathsToTry = [
            path.join(__dirname, '../../../renderer'),
            path.join(process.cwd(), 'dist/renderer'),
            path.join(__dirname, '../../../../renderer'),
        ];

        let rendererPath = '';
        for (const p of pathsToTry) {
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
                rendererPath = p;
                break;
            }
        }

        if (!rendererPath) {
            console.error('[Web] FATAL: Could not find renderer assets');
            rendererPath = pathsToTry[0];
        } else {
            console.log(`[Web] Serving static files from: ${rendererPath}`);
        }

        this.app.use(express.static(rendererPath));

        // For SPA routing - must come AFTER all API routes
        this.app.get(/(.*)/, (req, res) => {
            if (!req.path.startsWith('/api')) {
                const indexFile = path.join(rendererPath, 'index.html');
                if (fs.existsSync(indexFile)) {
                    res.sendFile(indexFile);
                } else {
                    res.status(404).send(`Renderer not found. Please run build.`);
                }
            } else {
                res.status(404).json({ error: 'API endpoint not found' });
            }
        });

        // Global error handler
        this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction): void => {
            console.error('[Web] Server Error:', err);
            res.status(500).json({ 
                success: false, 
                error: 'Internal Server Error', 
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        });
    }

    private buildBillingReportPdf(
        report: BillingReportData,
        period: { from?: string; to?: string },
        generatedAt: Date
    ): Buffer {
        const summaryRows = report.summary ?? [];
        const topCostCalls = report.topCostCalls ?? [];
        const totalsByCurrency = new Map<string, number>();
        for (const row of summaryRows) {
            const currency = row.currency || 'PHP';
            totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + Number(row.total_cost || 0));
        }
        const currencies = Array.from(totalsByCurrency.keys());
        const primaryCurrency = currencies.length === 1 ? currencies[0] : null;
        const totalCostNumeric = Array.from(totalsByCurrency.values()).reduce((sum, amount) => sum + amount, 0);
        const totalDisplay = primaryCurrency
            ? this.formatCurrency(totalCostNumeric, primaryCurrency)
            : 'Multiple currencies';
        const grandCalls = summaryRows.reduce((sum, row) => sum + Number(row.call_count || 0), 0);
        const grandDuration = summaryRows.reduce((sum, row) => sum + Number(row.total_duration_secs || 0), 0);

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const m = 14;

        doc.setFillColor(...this.hexToRgb('#06101e'));
        doc.rect(0, 0, W, 38, 'F');
        doc.setFillColor(...this.hexToRgb('#2484eb'));
        doc.rect(0, 0, 4, 38, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(...this.hexToRgb('#e9f1ff'));
        doc.text('SMDR Insight', m, 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...this.hexToRgb('#5f6e88'));
        doc.text('MiVoice Business Edition  ·  Billing Report', m, 20);
        doc.text(`Period: ${(period.from || '-') + ' - ' + (period.to || '-')}`, m, 28);
        doc.text(`Generated: ${generatedAt.toLocaleString()}`, m, 33);

        let y = 47;
        doc.setFillColor(...this.hexToRgb('#0d2248'));
        doc.roundedRect(m, y, W - m * 2, 22, 3, 3, 'F');
        doc.setDrawColor(...this.hexToRgb('#1e3464'));
        doc.setLineWidth(0.3);
        doc.roundedRect(m, y, W - m * 2, 22, 3, 3, 'S');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...this.hexToRgb('#e9f1ff'));
        doc.text(totalDisplay, m + 8, y + 13.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...this.hexToRgb('#5f6e88'));
        doc.text('Total Call Charges', m + 8, y + 19);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...this.hexToRgb('#e9f1ff'));
        doc.text(grandCalls.toLocaleString(), W - m - 8, y + 10, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...this.hexToRgb('#5f6e88'));
        doc.text('total calls', W - m - 8, y + 15, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...this.hexToRgb('#e9f1ff'));
        doc.text(this.formatDuration(grandDuration), W - m - 8, y + 21, { align: 'right' });

        y += 30;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...this.hexToRgb('#5f6e88'));
        doc.text('COST BY CATEGORY', m, y);
        doc.setDrawColor(...this.hexToRgb('#22345e'));
        doc.line(m + 60, y - 1, W - m, y - 1);
        y += 5;

        const summary = summaryRows.map((row) => [
            this.toCategoryLabel(row.call_category),
            Number(row.call_count || 0).toLocaleString(),
            this.formatDuration(Number(row.total_duration_secs || 0)),
            this.formatCurrency(Number(row.avg_cost || 0), row.currency || 'PHP'),
            this.formatCurrency(Number(row.total_cost || 0), row.currency || 'PHP')
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left: m, right: m },
            head: [['Category', 'Calls', 'Talk Time', 'Avg Cost', 'Total Cost']],
            body: summary.length ? summary : [['-', '0', '0s', this.formatCurrency(0), this.formatCurrency(0)]],
            foot: [['TOTAL', grandCalls.toLocaleString(), this.formatDuration(grandDuration), '', totalDisplay]],
            styles: {
                font: 'helvetica',
                fontSize: 8.5,
                cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
                lineColor: [34, 52, 94],
                lineWidth: 0.25,
                textColor: [233, 241, 255],
                fillColor: [13, 23, 48]
            },
            headStyles: {
                fillColor: [22, 32, 64],
                textColor: [107, 116, 138],
                fontStyle: 'bold',
                fontSize: 7.5
            },
            footStyles: {
                fillColor: [13, 34, 72],
                textColor: [233, 241, 255],
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { cellWidth: 36 },
                1: { halign: 'right', cellWidth: 18 },
                2: { halign: 'right', cellWidth: 24 },
                3: { halign: 'right', cellWidth: 26 },
                4: { halign: 'right', fontStyle: 'bold' }
            },
            alternateRowStyles: { fillColor: [16, 20, 44] }
        });

        y = (doc as any).lastAutoTable.finalY + 9;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...this.hexToRgb('#5f6e88'));
        doc.text('TOP COST CALLS', m, y);
        doc.setDrawColor(...this.hexToRgb('#22345e'));
        doc.line(m + 48, y - 1, W - m, y - 1);
        y += 5;

        const topCalls = topCostCalls.map((call) => [
            `${call.date} ${call.start_time}`,
            call.calling_party,
            call.digits_dialed || call.called_party,
            this.toCategoryLabel(call.call_category),
            this.formatDuration(call.duration_seconds),
            this.formatCurrency(call.rate_per_minute, call.bill_currency),
            this.formatCurrency(call.call_cost, call.bill_currency)
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left: m, right: m },
            head: [['Date / Time', 'From', 'Dialled Number', 'Category', 'Duration', 'Rate/min', 'Cost']],
            body: topCalls.length ? topCalls : [['-', '-', '-', '-', '-', '-', '-']],
            styles: {
                font: 'helvetica',
                fontSize: 7.8,
                cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
                lineColor: [34, 52, 94],
                lineWidth: 0.25,
                textColor: [233, 241, 255],
                fillColor: [13, 23, 48]
            },
            headStyles: {
                fillColor: [22, 32, 64],
                textColor: [107, 116, 138],
                fontStyle: 'bold',
                fontSize: 7.5
            },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 14, halign: 'center' },
                2: { cellWidth: 36, font: 'courier', fontSize: 7 },
                3: { cellWidth: 26 },
                4: { cellWidth: 18, halign: 'right' },
                5: { halign: 'right', cellWidth: 22 },
                6: { halign: 'right', fontStyle: 'bold' }
            },
            alternateRowStyles: { fillColor: [16, 20, 44] }
        });

        if (report.topCostCallsTruncated) {
            const noteY = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...this.hexToRgb('#f59e0b'));
            doc.text(`Top-cost call list truncated to ${topCostCalls.length.toLocaleString()} rows by export limit.`, m, noteY);
        }

        const pc = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= pc; i++) {
            doc.setPage(i);
            doc.setFillColor(...this.hexToRgb('#06101e'));
            doc.rect(0, H - 11, W, 11, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...this.hexToRgb('#4a5068'));
            doc.text('SMDR Insight  ·  elmertech  ·  Confidential', m, H - 4.5);
            doc.text('Page ' + i + ' of ' + pc, W - m - 8, H - 4.5, { align: 'right' });
        }

        return Buffer.from(doc.output('arraybuffer'));
    }

    private hexToRgb(value: string): [number, number, number] {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
        if (!result) return [0, 0, 0];
        return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
    }

    private formatDuration(seconds: number): string {
        const s = Math.max(0, Number(seconds || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${sec}s`;
        return `${sec}s`;
    }

    private formatCurrency(value: number, currency = 'PHP'): string {
        try {
            return new Intl.NumberFormat('en-PH', {
                style: 'currency',
                currency,
                minimumFractionDigits: 2
            }).format(Number(value || 0));
        } catch {
            return `${currency} ${Number(value || 0).toFixed(2)}`;
        }
    }

    private toCategoryLabel(category: CallCategory): string {
        return category === 'unclassified'
            ? 'Unclassified'
            : category.charAt(0).toUpperCase() + category.slice(1);
    }

    private toCsv(records: SMDRRecord[]): string {
        if (records.length === 0) return '';
        const headers = Object.keys(records[0]) as Array<keyof SMDRRecord>;
        const lines = [headers.join(',')];
        for (const record of records) {
            const row = headers.map((header) => {
                const value = String(record[header] ?? '');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            lines.push(row.join(','));
        }
        return `${lines.join('\n')}\n`;
    }
}
