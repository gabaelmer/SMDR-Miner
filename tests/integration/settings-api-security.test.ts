import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebServer } from '../../backend/web/WebServer';
import { AppConfig } from '../../shared/types';

interface MockState {
  updateConfigCalls: AppConfig[];
  updateAlertRulesCalls: Array<Record<string, unknown>>;
  purgeDaysCalls: number[];
  estimateDaysCalls: number[];
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
  details?: unknown;
  removed?: number;
  data?: {
    count?: number;
    cutoffDate?: string;
  };
  storage?: {
    encryptionKey?: string;
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

const baseConfig: AppConfig = {
  connection: {
    controllerIps: ['192.168.10.10', '192.168.10.11'],
    port: 1752,
    concurrentConnections: 1,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    autoReconnectPrimary: true,
    primaryRecheckDelayMs: 60000,
    ipWhitelist: []
  },
  storage: {
    dbPath: './config/smdr-insight.sqlite',
    retentionDays: 60,
    archiveDirectory: './config/archive',
    encryptionKey: 'super-secret-key'
  },
  alerts: {
    longCallMinutes: 30,
    watchNumbers: ['911'],
    repeatedBusyThreshold: 3,
    repeatedBusyWindowMinutes: 30,
    detectTagCalls: true,
    detectTollDenied: true
  },
  maxInMemoryRecords: 2000
};

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
    getConfig: () => structuredClone(baseConfig),
    updateConfig: (config: AppConfig) => {
      mockState.updateConfigCalls.push(structuredClone(config));
    },
    updateAlertRules: (rules: Record<string, unknown>) => {
      mockState.updateAlertRulesCalls.push(structuredClone(rules));
    },
    getRecords: () => [],
    getRecordsPage: () => ({ rows: [], total: 0, limit: 50, offset: 0 }),
    getCallLogSummary: () => ({ totalCalls: 0, totalDurationSeconds: 0, topExtensionsMade: [], topExtensionsReceived: [] }),
    getDashboard: () => ({}),
    getAnalytics: () => ({}),
    getAlerts: () => [],
    getParseErrors: () => [],
    getConnectionEvents: () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    getBillingReport: () => ({
      summary: [],
      dailyTrend: [],
      topCostCalls: [],
      totals: { calls: 0, durationSeconds: 0, cost: 0, tax: 0, currency: 'PHP' },
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
      topCostCallsTruncated: false
    }),
    start: () => undefined,
    stop: () => undefined,
    on: () => undefined,
    off: () => undefined,
    exportRecords: () => '/tmp/mock-export.csv',
    purgeRecords: (days: number) => {
      mockState.purgeDaysCalls.push(days);
      return 42;
    },
    estimatePurgeRecords: (days: number) => {
      mockState.estimateDaysCalls.push(days);
      return { count: 123, cutoffDate: '2026-01-01' };
    }
  };
}

async function startServer(): Promise<RunningContext> {
  const db = new Database(':memory:');
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smdr-settings-test-'));
  const mockState: MockState = {
    updateConfigCalls: [],
    updateAlertRulesCalls: [],
    purgeDaysCalls: [],
    estimateDaysCalls: []
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
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password, role })
  });
  expect(status).toBe(200);
  expect(body.success).toBe(true);
}

describe('Settings API security and validation', () => {
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
        console.warn('[integration] Skipping settings-api-security tests: local socket bind not permitted');
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

  it('blocks non-admin updates and purge actions', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');
    await createUser(ctx, adminToken, 'settings_user', 'settings-pass-1', 'user');
    const userToken = await login(ctx, 'settings_user', 'settings-pass-1');

    const configRes = await requestJson(ctx, '/api/config/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseConfig)
    });
    const alertsRes = await requestJson(ctx, '/api/alerts/update-rules', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseConfig.alerts)
    });
    const purgeRes = await requestJson(ctx, '/api/records/purge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30 })
    });

    expect(configRes.status).toBe(403);
    expect(alertsRes.status).toBe(403);
    expect(purgeRes.status).toBe(403);
    expect(configRes.body.error).toContain('Admin privileges required');
    expect(alertsRes.body.error).toContain('Admin privileges required');
    expect(purgeRes.body.error).toContain('Admin privileges required');

    expect(ctx.mockState.updateConfigCalls.length).toBe(0);
    expect(ctx.mockState.updateAlertRulesCalls.length).toBe(0);
    expect(ctx.mockState.purgeDaysCalls.length).toBe(0);
  });

  it('redacts encryptionKey and validates config payloads', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');

    const getConfigRes = await requestJson(ctx, '/api/config', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(getConfigRes.status).toBe(200);
    expect(getConfigRes.body.storage?.encryptionKey).toBeUndefined();

    const invalidConfig = {
      ...baseConfig,
      connection: {
        ...baseConfig.connection,
        port: -1
      }
    };

    const invalidRes = await requestJson(ctx, '/api/config/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidConfig)
    });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error).toContain('Invalid configuration payload');

    const validRes = await requestJson(ctx, '/api/config/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseConfig)
    });

    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
    expect(ctx.mockState.updateConfigCalls.length).toBe(1);
    expect(ctx.mockState.updateConfigCalls[0].connection.port).toBe(1752);
  });

  it('supports purge via body contract, validates bounds, and exposes purge estimate', async () => {
    if (!ctx) return;
    const adminToken = await login(ctx, 'admin', 'admin123!');

    const purgeBodyRes = await requestJson(ctx, '/api/records/purge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30 })
    });
    expect(purgeBodyRes.status).toBe(200);
    expect(purgeBodyRes.body.removed).toBe(42);
    expect(ctx.mockState.purgeDaysCalls).toEqual([30]);

    const purgeQueryRes = await requestJson(ctx, '/api/records/purge?days=45', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(purgeQueryRes.status).toBe(200);
    expect(ctx.mockState.purgeDaysCalls).toEqual([30, 45]);

    const purgeTooLow = await requestJson(ctx, '/api/records/purge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 0 })
    });
    const purgeTooHigh = await requestJson(ctx, '/api/records/purge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 5001 })
    });
    expect(purgeTooLow.status).toBe(400);
    expect(purgeTooHigh.status).toBe(400);

    const estimateRes = await requestJson(ctx, '/api/records/purge-estimate?days=30', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(estimateRes.status).toBe(200);
    expect(estimateRes.body.data?.count).toBe(123);
    expect(estimateRes.body.data?.cutoffDate).toBe('2026-01-01');
    expect(ctx.mockState.estimateDaysCalls).toEqual([30]);

    const estimateBad = await requestJson(ctx, '/api/records/purge-estimate?days=5001', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(estimateBad.status).toBe(400);
  });
});
