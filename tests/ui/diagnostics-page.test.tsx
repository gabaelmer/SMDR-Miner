// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsPage } from '../../renderer/src/pages/DiagnosticsPage';

const getCurrentUserMock = vi.fn();
const getHealthMock = vi.fn();
const getConnectionEventsMock = vi.fn();

const mockStoreState = {
  connectionStatus: 'connected',
  activeController: '10.0.0.1',
  dashboard: {
    totalCallsToday: 10,
    incomingCalls: 6,
    outgoingCalls: 4
  },
  parseErrors: [] as Array<{ line: string; reason: string; createdAt?: string }>,
  refreshRecords: vi.fn().mockResolvedValue(undefined),
  refreshDashboard: vi.fn().mockResolvedValue(undefined),
  refreshParseErrors: vi.fn().mockResolvedValue(undefined),
  sseConnectionStatus: 'connected',
  serviceEvents: [] as Array<{ id: string; type: string; summary: string; createdAt: string }>,
  lastServiceEventAt: undefined as string | undefined,
  recentRecordsCount: 12,
  maxInMemoryRecords: 200,
  startStream: vi.fn().mockResolvedValue(undefined),
  stopStream: vi.fn().mockResolvedValue(undefined),
  setActivePage: vi.fn(),
  setFilters: vi.fn()
};

vi.mock('../../renderer/src/lib/api', () => ({
  api: {
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    getHealth: (...args: unknown[]) => getHealthMock(...args),
    getConnectionEvents: (...args: unknown[]) => getConnectionEventsMock(...args)
  }
}));

vi.mock('../../renderer/src/state/appStore', () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState)
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getCurrentUserMock.mockResolvedValue({ username: 'admin', role: 'admin' });
  getHealthMock.mockResolvedValue({
    status: 'ok',
    timestamp: '2026-02-27T01:00:00.000Z',
    connectionStatus: 'connected',
    uptime: 120
  });
  getConnectionEventsMock.mockResolvedValue({
    items: [{ id: 1, level: 'info', message: 'Connected', createdAt: '2026-02-27 08:00:00' }],
    total: 1,
    limit: 25,
    offset: 0
  });
  mockStoreState.parseErrors = [];
  mockStoreState.serviceEvents = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiagnosticsPage', () => {
  it('shows admin-only notice for non-admin users', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ username: 'user1', role: 'user' });

    render(<DiagnosticsPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection event history is available to administrators only.')).toBeTruthy();
    });
    expect(getConnectionEventsMock).not.toHaveBeenCalled();
  });

  it('shows loading state while connection event history is in-flight', async () => {
    const pending = deferred<{ items: Array<{ id: number; level: string; message: string; createdAt: string }>; total: number; limit: number; offset: number }>();
    getConnectionEventsMock.mockImplementationOnce(() => pending.promise);

    render(<DiagnosticsPage />);

    await waitFor(() => {
      expect(screen.getByText('Loading connection events...')).toBeTruthy();
    });

    pending.resolve({ items: [], total: 0, limit: 25, offset: 0 });
  });

  it('shows health error message when health check fails', async () => {
    getHealthMock.mockRejectedValueOnce(new Error('health endpoint unavailable'));

    render(<DiagnosticsPage />);

    await waitFor(() => {
      expect(screen.getByText('Health check failed: health endpoint unavailable')).toBeTruthy();
    });
  });

  it('shows empty states for parse errors and event log', async () => {
    render(<DiagnosticsPage />);

    await waitFor(() => {
      expect(screen.getByText('No parse errors recorded.')).toBeTruthy();
    });
    expect(screen.getByText('No events available for the selected filters.')).toBeTruthy();
  });
});
