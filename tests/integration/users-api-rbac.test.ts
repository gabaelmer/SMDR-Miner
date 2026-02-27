import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebServer } from '../../backend/web/WebServer';

interface RunningContext {
  server: http.Server;
  baseUrl: string;
  db: Database.Database;
  configDir: string;
}

interface JsonResponse {
  success?: boolean;
  error?: string;
  data?: {
    items?: Array<{ username: string; role: string }>;
    total?: number;
    page?: number;
    pageSize?: number;
  };
  token?: string;
}

async function listenOnEphemeralPort(app: any): Promise<http.Server> {
  return await new Promise<http.Server>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

function createMockService(db: Database.Database): Record<string, unknown> {
  return {
    getRawDb: () => db,
    getState: () => ({ connectionStatus: 'disconnected' }),
    getConfig: () => ({}),
    updateConfig: () => undefined,
    updateAlertRules: () => undefined,
    getRecords: () => [],
    getRecordsPage: () => ({ rows: [], total: 0, limit: 50, offset: 0 }),
    getCallLogSummary: () => ({ totalCalls: 0, totalDurationSeconds: 0, topExtensionsMade: [], topExtensionsReceived: [] }),
    getDashboard: () => ({}),
    getAnalytics: () => ({}),
    getAlerts: () => [],
    getParseErrors: () => [],
    on: () => undefined,
    off: () => undefined,
    startStream: () => undefined,
    stopStream: () => undefined,
    purgeRecords: () => 0
  };
}

async function startServer(): Promise<RunningContext> {
  const db = new Database(':memory:');
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smdr-users-test-'));
  const webServer = new WebServer(createMockService(db) as any, configDir);
  const app = (webServer as any).app;

  const server = await listenOnEphemeralPort(app);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    db,
    configDir
  };
}

async function stopServer(ctx: RunningContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ctx.server.close((err) => (err ? reject(err) : resolve()));
  });
  ctx.db.close();
  fs.rmSync(ctx.configDir, { recursive: true, force: true });
}

async function requestJson(ctx: RunningContext, route: string, options: RequestInit = {}): Promise<{ status: number; body: JsonResponse }> {
  const response = await fetch(`${ctx.baseUrl}${route}`, options);
  const body = (await response.json()) as JsonResponse;
  return { status: response.status, body };
}

async function login(ctx: RunningContext, username: string, password: string): Promise<string> {
  const { status, body } = await requestJson(ctx, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  expect(status).toBe(200);
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function createUser(ctx: RunningContext, token: string, username: string, password: string, role: 'admin' | 'user' = 'user'): Promise<void> {
  const { status, body } = await requestJson(ctx, '/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ username, password, role })
  });
  expect(status).toBe(200);
  expect(body.success).toBe(true);
}

describe('Users API RBAC and pagination', () => {
  let ctx: RunningContext | undefined;
  let canBindSocket = true;

  beforeEach(async () => {
    if (!canBindSocket) return;
    try {
      ctx = await startServer();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EPERM') {
        canBindSocket = false;
        ctx = undefined;
        console.warn('[integration] Skipping users-api-rbac tests: local socket bind not permitted');
        return;
      }
      throw error;
    }
  });

  afterEach(async () => {
    if (!ctx) return;
    await stopServer(ctx);
    ctx = undefined;
  });

  it('blocks non-admin access to user-management and audit-log endpoints', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');
    await createUser(ctx, adminToken, 'rbac_user', 'rbac-pass-1', 'user');

    const userToken = await login(ctx, 'rbac_user', 'rbac-pass-1');
    const auth = { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' };

    const listRes = await requestJson(ctx, '/api/users', { headers: auth });
    const createRes = await requestJson(ctx, '/api/users', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ username: 'should_fail', password: 'pass-123', role: 'admin' })
    });
    const deleteRes = await requestJson(ctx, '/api/users/admin', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const auditRes = await requestJson(ctx, '/api/audit-logs', {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    expect(listRes.status).toBe(403);
    expect(createRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    expect(auditRes.status).toBe(403);
    expect(listRes.body.error).toContain('Admin privileges required');
    expect(auditRes.body.error).toContain('Admin privileges required');
  });

  it('prevents non-admin users from changing other users passwords', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');
    await createUser(ctx, adminToken, 'alice_pwd', 'alice-pass-1', 'user');
    await createUser(ctx, adminToken, 'bob_pwd', 'bob-pass-1', 'user');

    const aliceToken = await login(ctx, 'alice_pwd', 'alice-pass-1');
    const result = await requestJson(ctx, '/api/users/bob_pwd/password', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldPassword: 'alice-pass-1', newPassword: 'new-pass-999' })
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toContain('only change your own password');
  });

  it('returns sorted and paginated users for admins with search and role filtering', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');
    await createUser(ctx, adminToken, 'pg_alpha', 'alpha-pass-1', 'user');
    await createUser(ctx, adminToken, 'pg_beta', 'beta-pass-1', 'admin');
    await createUser(ctx, adminToken, 'pg_gamma', 'gamma-pass-1', 'user');
    await createUser(ctx, adminToken, 'pg_delta', 'delta-pass-1', 'user');
    await createUser(ctx, adminToken, 'pg_epsilon', 'epsilon-pass-1', 'user');
    await createUser(ctx, adminToken, 'pg_zeta', 'zeta-pass-1', 'user');

    const pageOne = await requestJson(
      ctx,
      '/api/users?page=1&pageSize=5&search=pg_&sortBy=username&sortDir=asc',
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(pageOne.status).toBe(200);
    expect(pageOne.body.data?.total).toBe(6);
    expect(pageOne.body.data?.items?.map((row) => row.username)).toEqual([
      'pg_alpha',
      'pg_beta',
      'pg_delta',
      'pg_epsilon',
      'pg_gamma'
    ]);

    const pageTwo = await requestJson(
      ctx,
      '/api/users?page=2&pageSize=5&search=pg_&sortBy=username&sortDir=asc',
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.data?.items?.map((row) => row.username)).toEqual(['pg_zeta']);

    const usersOnly = await requestJson(
      ctx,
      '/api/users?page=1&pageSize=10&search=pg_&role=user&sortBy=username&sortDir=asc',
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(usersOnly.status).toBe(200);
    expect(usersOnly.body.data?.total).toBe(5);
    expect(usersOnly.body.data?.items?.every((row) => row.role === 'user')).toBe(true);
    expect(usersOnly.body.data?.items?.map((row) => row.username)).toEqual([
      'pg_alpha',
      'pg_delta',
      'pg_epsilon',
      'pg_gamma',
      'pg_zeta'
    ]);
  });
});
