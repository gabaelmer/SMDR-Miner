import { useMemo } from 'react';
import dayjs from 'dayjs';
import { RecordFilters } from '../../../shared/types';
import { formatDuration } from '../lib/format';
import { useAppStore } from '../state/appStore';

const categoryColor: Record<string, string> = {
  local: 'var(--green)',
  national: 'var(--brand)',
  mobile: 'var(--purple)',
  international: 'var(--orange)',
  internal: 'var(--muted)'
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2
  }).format(value);
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'international':
      return 'INTL';
    default:
      return category.toUpperCase();
  }
}

export function DashboardPage() {
  const dashboard = useAppStore((state) => state.dashboard);
  const dashboardLoading = useAppStore((state) => state.dashboardLoading);
  const dashboardError = useAppStore((state) => state.dashboardError);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const setFilters = useAppStore((state) => state.setFilters);
  const refreshRecords = useAppStore((state) => state.refreshRecords);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);

  const selectedDate = dashboard.date || dayjs().format('YYYY-MM-DD');

  const goToCallLog = (overrides: Partial<RecordFilters> = {}) => {
    setFilters({
      date: selectedDate,
      dateFrom: undefined,
      dateTo: undefined,
      extension: undefined,
      accountCode: undefined,
      hour: undefined,
      callType: undefined,
      completionStatus: undefined,
      transferFlag: undefined,
      callIdentifier: undefined,
      associatedCallIdentifier: undefined,
      networkOLI: undefined,
      limit: 50,
      offset: 0,
      ...overrides
    });
    setActivePage('calls');
    void refreshRecords();
  };

  const topExtensions = useMemo(() => {
    if (dashboard.topExtensionsByCostAndVolume.length > 0) return dashboard.topExtensionsByCostAndVolume;
    return dashboard.topExtensions.map((row) => ({ extension: row.extension, count: row.count, totalCost: 0 }));
  }, [dashboard.topExtensions, dashboard.topExtensionsByCostAndVolume]);

  const trendRows = useMemo(
    () =>
      dashboard.sevenDayTrend.map((row) => ({
        ...row,
        label: dayjs(row.date).format('ddd')
      })),
    [dashboard.sevenDayTrend]
  );

  const distributionRows = useMemo(() => {
    const requiredOrder = ['local', 'national', 'mobile', 'international', 'internal'];
    const map = new Map(dashboard.callDistribution.map((row) => [row.category, row]));

    const required = requiredOrder.map((category) => {
      const row = map.get(category);
      return row ?? { category, count: 0, percentage: 0, totalCost: 0 };
    });

    const extras = dashboard.callDistribution
      .filter((row) => row.category !== 'unclassified' && !requiredOrder.includes(row.category))
      .sort((a, b) => a.category.localeCompare(b.category));

    return [...required, ...extras];
  }, [dashboard.callDistribution]);

  const maxTrendCalls = Math.max(...trendRows.map((row) => row.callCount), 1);
  const maxTrendCost = Math.max(...trendRows.map((row) => row.totalCost), 1);
  const maxExtensionCalls = Math.max(...topExtensions.map((row) => row.count), 1);

  const totalExternal = dashboard.inboundCalls + dashboard.outboundCalls;
  const inboundPct = totalExternal > 0 ? Math.round((dashboard.inboundCalls / totalExternal) * 100) : 0;
  const outboundPct = totalExternal > 0 ? Math.round((dashboard.outboundCalls / totalExternal) * 100) : 0;

  return (
    <div className="gap">
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="ct">Dashboard Overview</span>
            <span className="cs">{selectedDate}</span>
            <span className="cs">
              Updated: {dashboard.lastUpdatedAt ? dayjs(dashboard.lastUpdatedAt).format('MMM D, YYYY HH:mm:ss') : 'n/a'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {dashboard.activeStream ? <span className="live-badge"><span className="pr"></span>Live</span> : <span className="chip">Not live</span>}
            <button
              type="button"
              className="btn bg2"
              disabled={dashboardLoading}
              onClick={() => {
                void refreshDashboard(selectedDate);
              }}
            >
              {dashboardLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        {dashboardError && (
          <div
            style={{
              marginTop: '10px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '10px',
              padding: '8px 10px',
              color: 'var(--red)',
              background: 'rgba(239, 68, 68, 0.08)',
              fontSize: '12px',
              fontWeight: 700
            }}
          >
            {dashboardError}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" className="card metric" style={{ minHeight: '132px', textAlign: 'left' }} onClick={() => goToCallLog()}>
          <div className="mlbl">Total Calls Today</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval" style={{ color: 'var(--brand)' }}>{dashboard.totalCallsToday}</div>
            <div className="macc" style={{ background: 'var(--brand)' }}></div>
          </div>
          <div className="msub">Tap to open call log</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '132px', textAlign: 'left' }}
          onClick={() => goToCallLog({ callType: 'internal' })}
        >
          <div className="mlbl">Internal Calls</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval" style={{ color: 'var(--purple)' }}>{dashboard.internalCalls}</div>
            <div className="macc" style={{ background: 'var(--purple)' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--purple)' }}>{formatDuration(dashboard.internalDurationSeconds)} today</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '132px', textAlign: 'left' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl">Inbound Calls</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval">{dashboard.inboundCalls}</div>
            <div className="macc" style={{ background: 'var(--brand)' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--brand)' }}>{formatDuration(dashboard.inboundDurationSeconds)} today</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '132px', textAlign: 'left' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl">Outbound Calls</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval">{dashboard.outboundCalls}</div>
            <div className="macc" style={{ background: 'var(--green)' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--green)' }}>{formatDuration(dashboard.outboundDurationSeconds)} today</div>
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="card" style={{ padding: '14px 16px', minHeight: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div className="ct">Inbound vs Outbound</div>
            <div className="cs">External calls</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ position: 'relative', width: '160px', height: '160px', flexShrink: 0 }}>
              <svg viewBox="0 0 100 100" width="160" height="160">
                <circle cx="50" cy="50" r="38" fill="none" stroke="#101f3f" strokeWidth="14" />
                {dashboard.inboundCalls > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#2484eb"
                    strokeWidth="14"
                    strokeDasharray={`${(inboundPct / 100) * 239} ${239}`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                )}
                {dashboard.outboundCalls > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#26b67f"
                    strokeWidth="14"
                    strokeDasharray={`${(outboundPct / 100) * 239} ${239}`}
                    strokeDashoffset={-(inboundPct / 100) * 239}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                )}
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)' }}>{totalExternal}</div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>external</div>
              </div>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '11px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand)' }}></div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Inbound</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand)', marginLeft: 'auto' }}>{inboundPct}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${inboundPct}%`, height: '100%', background: 'var(--brand)', borderRadius: '3px' }}></div>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--green)' }}></div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Outbound</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--green)', marginLeft: 'auto' }}>{outboundPct}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${outboundPct}%`, height: '100%', background: 'var(--green)', borderRadius: '3px' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', minHeight: '360px' }}>
          <div className="ct" style={{ marginBottom: '14px' }}>7-day Trend</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {trendRows.map((row) => (
              <div key={row.date} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '38px', fontSize: '12px', fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{row.label}</div>
                <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, height: '9px', background: 'var(--surface-alt)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(row.callCount / maxTrendCalls) * 100}%`, height: '100%', background: 'var(--brand)' }}></div>
                  </div>
                  <div style={{ flex: 1, height: '9px', background: 'var(--surface-alt)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(row.totalCost / maxTrendCost) * 100}%`, height: '100%', background: 'var(--purple)' }}></div>
                  </div>
                </div>
                <div style={{ width: '36px', fontSize: '12px', fontWeight: 700, textAlign: 'right' }}>{row.callCount}</div>
              </div>
            ))}
            {trendRows.length === 0 && <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '16px 0' }}>No trend data available</p>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '14px', height: '8px', background: 'var(--brand)', borderRadius: '4px' }}></div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>Volume</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '14px', height: '8px', background: 'var(--purple)', borderRadius: '4px' }}></div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>Cost</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', minHeight: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div className="ct">Top Extensions (Cost + Volume)</div>
            <span className="cs">Click row to drill down</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px', fontSize: '10px', color: 'var(--muted2)', fontWeight: 700 }}>
            <div>Extension</div>
            <div style={{ textAlign: 'right' }}>Calls / Cost</div>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
            {topExtensions.map((row) => (
              <button
                type="button"
                key={row.extension}
                className="erow"
                style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '8px 0' }}
                onClick={() => goToCallLog({ extension: row.extension })}
              >
                <span className="mono" style={{ width: '52px', color: 'var(--text)', fontWeight: 700 }}>{row.extension}</span>
                <div className="etrk">
                  <div className="efil" style={{ width: `${Math.max((row.count / maxExtensionCalls) * 100, 4)}%`, background: 'linear-gradient(90deg, var(--brand), var(--purple))' }}></div>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)', width: '92px', textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>{row.count} calls</div>
                  <div style={{ color: 'var(--brand)', fontWeight: 700 }}>{formatCurrency(row.totalCost)}</div>
                </div>
              </button>
            ))}
            {topExtensions.length === 0 && <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '30px 0' }}>No extension activity yet</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card metric" style={{ padding: '15px 17px' }}>
          <div className="mlbl">Total Cost</div>
          <div className="mval" style={{ color: 'var(--orange)', fontSize: '22px' }}>{formatCurrency(dashboard.totalCostToday)}</div>
          <div className="msub">All charges (today)</div>
        </div>
        <div className="card metric" style={{ padding: '15px 17px' }}>
          <div className="mlbl">Avg Call Duration</div>
          <div className="mval" style={{ color: 'var(--purple)', fontSize: '22px' }}>{formatDuration(dashboard.avgCallDurationSeconds)}</div>
          <div className="msub">Per call average</div>
        </div>
        <button
          type="button"
          className="card metric"
          style={{ padding: '15px 17px', textAlign: 'left' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl">High-Cost Calls (&gt;₱50)</div>
          <div className="mval" style={{ color: 'var(--red)', fontSize: '22px' }}>{dashboard.highCostCalls}</div>
          <div className="msub">Tap to inspect call log</div>
        </button>
      </div>

      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div className="ct">Call Distribution by Type</div>
          <span className="cs">Computed from full-day records</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {distributionRows.map((row) => {
            const color = categoryColor[row.category] ?? 'var(--muted2)';
            return (
              <div key={row.category} style={{ textAlign: 'center', padding: '12px', background: 'rgba(95, 110, 136, 0.1)', borderRadius: '10px', border: '1px solid rgba(95, 110, 136, 0.2)' }}>
                <div style={{ fontSize: '22px', fontWeight: 800, color }}>{Math.round(row.percentage)}%</div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)', marginTop: '4px', fontWeight: 700 }}>{categoryLabel(row.category)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text)', marginTop: '4px' }}>{row.count} calls</div>
                <div style={{ fontSize: '10px', color: 'var(--brand)', marginTop: '3px', fontWeight: 700 }}>
                  {formatCurrency(row.totalCost)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="ch">
          <span className="ct">Long Calls (&gt;30 min)</span>
          <span className="cs">Click a call to filter by extension</span>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.longCalls.slice(0, 9).map((record, idx) => (
            <button
              type="button"
              key={`${record.callIdentifier ?? idx}-${record.startTime}`}
              onClick={() => goToCallLog({ extension: record.callingParty })}
              style={{
                background: 'var(--surface-alt)',
                borderRadius: '9px',
                padding: '10px 12px',
                border: '1px solid var(--border2)',
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700 }}>
                {record.callingParty} → {record.calledParty}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '2px' }}>
                {record.startTime} · <strong style={{ color: 'var(--orange)' }}>{record.duration}</strong>
              </div>
            </button>
          ))}
          {dashboard.longCalls.length === 0 && (
            <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '20px 0', gridColumn: '1 / -1' }}>
              No long calls detected today
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
