import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebServer } from '../../backend/web/WebServer';

interface MockState {
  startCalls: number;
  stopCalls: number;
  lastConnectionEventsQuery?: {
    level?: 'info' | 'warn' | 'error';
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  };
}

interface RunningContext {
  server: http.Server;
  baseUrl: string;
  db: Database.Database;
  configDir: string;
  mockState: MockState;
}

interface JsonResponse {
  success?: boolean;
  error?: string;
  token?: string;
  status?: string;
  timestamp?: string;
  connectionStatus?: string;
  uptime?: number;
  authenticated?: boolean;
  [key: string]: unknown;
  data?: {
    items?: Array<{ level: string; message: string }>;
    total?: number;
    limit?: number;
    offset?: number;
  };
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

function createMockService(db: Database.Database, mockState: MockState): Record<string, unknown> {
  return {
    getRawDb: () => db,
    getState: () => ({
      connectionStatus: 'disconnected',
      activeController: undefined,
      parserOptions: {},
      recentRecordsCount: 0,
      maxInMemoryRecords: 2000
    }),
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
    getConnectionEvents: (options?: MockState['lastConnectionEventsQuery']) => {
      mockState.lastConnectionEventsQuery = options;
      return {
        items: [{ id: 1, level: 'warn', message: 'Mock warning', createdAt: '2026-02-27 10:00:00' }],
        total: 1,
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0
      };
    },
    getBillingReport: () => ({ summary: [], dailyTrend: [], topCostCalls: [], totals: { calls: 0, durationSeconds: 0, cost: 0, tax: 0, currency: 'PHP' }, pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, topCostCallsTruncated: false }),
    start: () => {
      mockState.startCalls += 1;
    },
    stop: () => {
      mockState.stopCalls += 1;
    },
    on: () => undefined,
    off: () => undefined,
    exportRecords: () => '/tmp/mock-export.csv',
    purgeRecords: () => 0
  };
}

async function startServer(): Promise<RunningContext> {
  const db = new Database(':memory:');
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smdr-diagnostics-test-'));
  const mockState: MockState = {
    startCalls: 0,
    stopCalls: 0,
    lastConnectionEventsQuery: undefined
  };

  const webServer = new WebServer(createMockService(db, mockState) as any, configDir);
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
    configDir,
    mockState
  };
}

async function stopServer(ctx: RunningContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ctx.server.close((err) => (err ? reject(err) : resolve()));
  });
  ctx.db.close();
  fs.rmSync(ctx.configDir, { recursive: true, force: true });
}

async function requestJson(
  ctx: RunningContext,
  route: string,
  options: RequestInit = {}
): Promise<{ status: number; body: JsonResponse }> {
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

async function createUser(
  ctx: RunningContext,
  token: string,
  username: string,
  password: string,
  role: 'admin' | 'user' = 'user'
): Promise<void> {
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

describe('Diagnostics API RBAC', () => {
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
        console.warn('[integration] Skipping diagnostics-api-rbac tests: local socket bind not permitted');
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

  it('blocks non-admin users from stream controls and connection-events history', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');
    await createUser(ctx, adminToken, 'diag_user', 'diag-pass-1', 'user');

    const userToken = await login(ctx, 'diag_user', 'diag-pass-1');

    const startRes = await requestJson(ctx, '/api/stream/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const stopRes = await requestJson(ctx, '/api/stream/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const eventsRes = await requestJson(ctx, '/api/connection-events', {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    expect(startRes.status).toBe(403);
    expect(stopRes.status).toBe(403);
    expect(eventsRes.status).toBe(403);
    expect(startRes.body.error).toContain('Admin privileges required');
    expect(stopRes.body.error).toContain('Admin privileges required');
    expect(eventsRes.body.error).toContain('Admin privileges required');
    expect(ctx.mockState.startCalls).toBe(0);
    expect(ctx.mockState.stopCalls).toBe(0);
  });

  it('allows admin stream controls and filtered connection-events access', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');

    const startRes = await requestJson(ctx, '/api/stream/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const stopRes = await requestJson(ctx, '/api/stream/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const eventsRes = await requestJson(
      ctx,
      '/api/connection-events?level=warn&startDate=2026-02-01T00:00:00.000Z&endDate=2026-02-28T23:59:59.000Z&limit=5000&offset=-10',
      {
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );

    expect(startRes.status).toBe(200);
    expect(stopRes.status).toBe(200);
    expect(eventsRes.status).toBe(200);

    expect(startRes.body.success).toBe(true);
    expect(stopRes.body.success).toBe(true);
    expect(eventsRes.body.success).toBe(true);
    expect(eventsRes.body.data?.total).toBe(1);
    expect(eventsRes.body.data?.items?.[0]?.level).toBe('warn');

    expect(ctx.mockState.startCalls).toBe(1);
    expect(ctx.mockState.stopCalls).toBe(1);
    expect(ctx.mockState.lastConnectionEventsQuery).toEqual({
      level: 'warn',
      startDate: '2026-02-01 00:00:00',
      endDate: '2026-02-28 23:59:59',
      limit: 200,
      offset: 0
    });
  });

  it('requires authentication for SSE event stream', async () => {
    if (!ctx) return;
    const unauthRes = await fetch(`${ctx.baseUrl}/api/events`);
    expect(unauthRes.status).toBe(401);

    const adminToken = await login(ctx, 'admin', 'admin123!');
    const controller = new AbortController();
    const authRes = await fetch(`${ctx.baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: controller.signal
    });

    expect(authRes.status).toBe(200);
    controller.abort();
  });

  it('exposes minimal public health info and authenticated diagnostics details', async () => {
    if (!ctx) return;
    const publicHealth = await requestJson(ctx, '/api/health');
    expect(publicHealth.status).toBe(200);
    expect(publicHealth.body.status).toBe('ok');
    expect(publicHealth.body.connectionStatus).toBeUndefined();
    expect(publicHealth.body.remoteIp).toBeUndefined();

    const adminToken = await login(ctx, 'admin', 'admin123!');
    const detailRes = await requestJson(ctx, '/api/health/details', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.status).toBe('ok');
    expect(detailRes.body.connectionStatus).toBe('disconnected');
  });
});
