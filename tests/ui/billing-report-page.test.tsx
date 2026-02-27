// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingReportData } from '../../shared/types';
import { BillingReportPage } from '../../renderer/src/pages/BillingReportPage';

const getBillingReportMock = vi.fn();
const exportBillingReportPdfMock = vi.fn();

vi.mock('../../renderer/src/lib/api', () => ({
  api: {
    getBillingReport: (...args: unknown[]) => getBillingReportMock(...args),
    exportBillingReportPdf: (...args: unknown[]) => exportBillingReportPdfMock(...args)
  }
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
  Line: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

function buildReport(overrides: Partial<BillingReportData> = {}): BillingReportData {
  return {
    summary: [
      {
        call_category: 'mobile',
        call_count: 2,
        total_duration_secs: 300,
        total_cost: 10,
        total_tax: 0,
        avg_cost: 5,
        max_cost: 8,
        currency: 'PHP'
      }
    ],
    topCostCalls: [
      {
        id: 1,
        date: '2026-02-26',
        start_time: '10:00:00',
        calling_party: '1001',
        called_party: '09171234567',
        digits_dialed: '09171234567',
        duration_seconds: 180,
        call_category: 'mobile',
        call_cost: 8,
        tax_amount: 0,
        bill_currency: 'PHP',
        matched_prefix: '09',
        rate_per_minute: 4
      }
    ],
    topCostCallsTotal: 1,
    dailyTrend: [{ date: '2026-02-26', call_count: 2, total_cost: 10, currency: 'PHP' }],
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BillingReportPage', () => {
  it('keeps latest response when earlier request resolves later', async () => {
    const first = deferred<BillingReportData>();
    const second = deferred<BillingReportData>();
    getBillingReportMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    render(<BillingReportPage />);

    fireEvent.change(screen.getByPlaceholderText('e.g. 1001'), { target: { value: '1001' } });
    fireEvent.click(screen.getByText('Apply'));

    second.resolve(buildReport({
      topCostCalls: [{ ...buildReport().topCostCalls[0], id: 2, calling_party: 'LATEST' }]
    }));
    await waitFor(() => expect(screen.getByText('LATEST')).toBeTruthy());

    first.resolve(buildReport({
      topCostCalls: [{ ...buildReport().topCostCalls[0], id: 3, calling_party: 'STALE' }]
    }));
    await waitFor(() => expect(screen.queryByText('STALE')).toBeNull());
  });

  it('shows blocking error state on initial load failure', async () => {
    getBillingReportMock.mockRejectedValueOnce(new Error('network down'));
    render(<BillingReportPage />);

    await waitFor(() => expect(screen.getByText('Failed to load billing report')).toBeTruthy());
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText('Total Call Charges')).toBeNull();
  });

  it('shows stale-data warning when refresh fails after previous success', async () => {
    getBillingReportMock.mockResolvedValueOnce(buildReport()).mockRejectedValueOnce(new Error('refresh failed'));
    render(<BillingReportPage />);

    await waitFor(() => expect(screen.getByText('1001')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('e.g. 1001'), { target: { value: '2002' } });
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => expect(screen.getByText('Showing previous successful data. Retry to refresh.')).toBeTruthy());
    expect(screen.getByText('1001')).toBeTruthy();
  });

  it('shows export warning when top call total exceeds selected export cap', async () => {
    getBillingReportMock.mockResolvedValueOnce(buildReport({ topCostCallsTotal: 2000 }));
    render(<BillingReportPage />);

    await waitFor(() => expect(screen.getByText(/Top Cost Calls \(2,000\)/)).toBeTruthy());
    expect(screen.getByText('Export will include only top 1,000 of 2,000 calls.')).toBeTruthy();
  });
});
