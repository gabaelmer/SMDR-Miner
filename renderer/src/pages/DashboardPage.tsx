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
    <div className="gap" style={{ gap: '12px' }}>
      {/* Header Card */}
      <div className="card" style={{ padding: '12px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span className="ct" style={{ fontSize: '15px' }}>Dashboard Overview</span>
            <span className="cs" style={{ fontSize: '12px' }}>{selectedDate}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {dashboard.activeStream ? <span className="live-badge" style={{ padding: '3px 9px', fontSize: '11px' }}><span className="pr"></span>Live</span> : <span className="chip" style={{ padding: '3px 9px', fontSize: '11px' }}>Not live</span>}
            <button
              type="button"
              className="btn bg2"
              disabled={dashboardLoading}
              onClick={() => {
                void refreshDashboard(selectedDate);
              }}
              style={{ padding: '6px 14px', fontSize: '13px' }}
            >
              {dashboardLoading ? (
                <>
                  <span className="spin" style={{ fontSize: '13px' }}>⟳</span>
                  Refreshing...
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M14 8a6 6 0 1 1-1.73-4.24l-1.43 1.43A4 4 0 1 0 12 8h2zm-2.83 4.24l1.43-1.43A6 6 0 1 1 14 8h-2a4 4 0 1 0-1.17 2.83z"/></svg>
                  Refresh
                </>
              )}
            </button>
          </div>
        </div>
        {dashboardError && (
          <div
            style={{
              marginTop: '10px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              color: 'var(--red)',
              background: 'var(--red-dim)',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm1 9.5H7v-1h2v1zm0-2H7V4h2v4.5z"/></svg>
            {dashboardError}
          </div>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" style={{ flexShrink: 0 }}>
        <button type="button" className="card metric" style={{ minHeight: '115px', textAlign: 'left', padding: '14px 16px' }} onClick={() => goToCallLog()}>
          <div className="mlbl" style={{ fontSize: '10px' }}>Total Calls</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval" style={{ color: 'var(--brand)', fontSize: '26px' }}>{dashboard.totalCallsToday}</div>
            <div className="macc" style={{ background: 'var(--brand)', height: '28px' }}></div>
          </div>
          <div className="msub" style={{ fontSize: '11px' }}>Tap to view</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '115px', textAlign: 'left', padding: '14px 16px' }}
          onClick={() => goToCallLog({ callType: 'internal' })}
        >
          <div className="mlbl" style={{ fontSize: '10px' }}>Internal</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval" style={{ color: 'var(--purple)', fontSize: '26px' }}>{dashboard.internalCalls}</div>
            <div className="macc" style={{ background: 'var(--purple)', height: '28px' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--purple)', fontSize: '11px' }}>{formatDuration(dashboard.internalDurationSeconds)}</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '115px', textAlign: 'left', padding: '14px 16px' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl" style={{ fontSize: '10px' }}>Inbound</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval">{dashboard.inboundCalls}</div>
            <div className="macc" style={{ background: 'var(--brand)', height: '28px' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--brand)', fontSize: '11px' }}>{formatDuration(dashboard.inboundDurationSeconds)}</div>
        </button>
        <button
          type="button"
          className="card metric"
          style={{ minHeight: '115px', textAlign: 'left', padding: '14px 16px' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl" style={{ fontSize: '10px' }}>Outbound</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="mval">{dashboard.outboundCalls}</div>
            <div className="macc" style={{ background: 'var(--green)', height: '28px' }}></div>
          </div>
          <div className="msub" style={{ color: 'var(--green)', fontSize: '11px' }}>{formatDuration(dashboard.outboundDurationSeconds)}</div>
        </button>
      </div>

      {/* Main Content Grid - Charts and Extensions */}
      <div className="grid gap-3 xl:grid-cols-3" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Inbound vs Outbound Card */}
        <div className="card" style={{ padding: '14px 16px', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
            <div className="ct" style={{ fontSize: '14px' }}>Inbound vs Outbound</div>
            <div className="cs" style={{ fontSize: '11px' }}>External</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', flex: 1 }}>
            <div style={{ position: 'relative', width: '140px', height: '140px', flexShrink: 0 }}>
              <svg viewBox="0 0 100 100" width="140" height="140">
                <defs>
                  <linearGradient id="inboundGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--brand)" />
                    <stop offset="100%" stopColor="var(--brand2)" />
                  </linearGradient>
                  <linearGradient id="outboundGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--green)" />
                    <stop offset="100%" stopColor="#1a9f6e" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--surface-alt)" strokeWidth="14" />
                {dashboard.inboundCalls > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="url(#inboundGrad)"
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
                    stroke="url(#outboundGrad)"
                    strokeWidth="14"
                    strokeDasharray={`${(outboundPct / 100) * 239} ${239}`}
                    strokeDashoffset={-(inboundPct / 100) * 239}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                )}
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)' }}>{totalExternal}</div>
                <div style={{ fontSize: '9px', color: 'var(--muted2)', textTransform: 'uppercase' }}>external</div>
              </div>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand)' }}></div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Inbound</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand)', marginLeft: 'auto' }}>{inboundPct}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${inboundPct}%`, height: '100%', background: 'var(--brand)', borderRadius: '3px' }}></div>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--green)' }}></div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Outbound</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--green)', marginLeft: 'auto' }}>{outboundPct}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${outboundPct}%`, height: '100%', background: 'var(--green)', borderRadius: '3px' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 7-day Trend Card */}
        <div className="card" style={{ padding: '14px 16px', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
          <div className="ct" style={{ marginBottom: '12px', fontSize: '14px', flexShrink: 0 }}>7-day Trend</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflow: 'hidden' }}>
            {trendRows.map((row) => (
              <div key={row.date} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', fontSize: '11px', fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{row.label}</div>
                <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <div style={{ flex: 1, height: '8px', background: 'var(--surface-alt)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(row.callCount / maxTrendCalls) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--brand), var(--brand2))', borderRadius: '4px' }}></div>
                  </div>
                  <div style={{ flex: 1, height: '8px', background: 'var(--surface-alt)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(row.totalCost / maxTrendCost) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--purple), #7c3aed)', borderRadius: '4px' }}></div>
                  </div>
                </div>
                <div style={{ width: '32px', fontSize: '11px', fontWeight: 600, textAlign: 'right', color: 'var(--text)' }}>{row.callCount}</div>
              </div>
            ))}
            {trendRows.length === 0 && (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <div className="empty-state-title" style={{ fontSize: '13px' }}>No trend data</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border2)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '14px', height: '7px', background: 'linear-gradient(90deg, var(--brand), var(--brand2))', borderRadius: '3px' }}></div>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)' }}>Volume</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '14px', height: '7px', background: 'linear-gradient(90deg, var(--purple), #7c3aed)', borderRadius: '3px' }}></div>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)' }}>Cost</span>
            </div>
          </div>
        </div>

        {/* Top Extensions Card */}
        <div className="card" style={{ padding: '14px 16px', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexShrink: 0 }}>
            <div className="ct" style={{ fontSize: '14px' }}>Top Extensions</div>
            <span className="cs" style={{ fontSize: '11px' }}>Click to filter</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px', fontSize: '10px', color: 'var(--muted2)', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
            <div>Extension</div>
            <div style={{ textAlign: 'right' }}>Calls / Cost</div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
            {topExtensions.map((row) => (
              <button
                type="button"
                key={row.extension}
                className="erow"
                style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '8px 0' }}
                onClick={() => goToCallLog({ extension: row.extension })}
              >
                <span className="mono" style={{ width: '48px', color: 'var(--text)', fontWeight: 700, fontSize: '12px' }}>{row.extension}</span>
                <div className="etrk" style={{ height: '5px' }}>
                  <div className="efil" style={{ width: `${Math.max((row.count / maxExtensionCalls) * 100, 4)}%`, background: 'linear-gradient(90deg, var(--brand), var(--purple))' }}></div>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)', width: '85px', textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '11px' }}>{row.count}</div>
                  <div style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '11px' }}>{formatCurrency(row.totalCost)}</div>
                </div>
              </button>
            ))}
            {topExtensions.length === 0 && (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <div className="empty-state-title" style={{ fontSize: '13px' }}>No activity</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row - Metrics and Distribution */}
      <div className="grid gap-3 md:grid-cols-3" style={{ flexShrink: 0 }}>
        <div className="card metric" style={{ padding: '14px 16px' }}>
          <div className="mlbl" style={{ fontSize: '10px' }}>Total Cost</div>
          <div className="mval" style={{ color: 'var(--orange)', fontSize: '22px' }}>{formatCurrency(dashboard.totalCostToday)}</div>
          <div className="msub" style={{ fontSize: '11px' }}>Today</div>
        </div>
        <div className="card metric" style={{ padding: '14px 16px' }}>
          <div className="mlbl" style={{ fontSize: '10px' }}>Avg Duration</div>
          <div className="mval" style={{ color: 'var(--purple)', fontSize: '22px' }}>{formatDuration(dashboard.avgCallDurationSeconds)}</div>
          <div className="msub" style={{ fontSize: '11px' }}>Per call</div>
        </div>
        <button
          type="button"
          className="card metric"
          style={{ padding: '14px 16px', textAlign: 'left' }}
          onClick={() => goToCallLog({ callType: 'external' })}
        >
          <div className="mlbl" style={{ fontSize: '10px' }}>High-Cost (&gt;₱50)</div>
          <div className="mval" style={{ color: 'var(--red)', fontSize: '22px' }}>{dashboard.highCostCalls}</div>
          <div className="msub" style={{ fontSize: '11px' }}>Tap to view</div>
        </button>
      </div>

      {/* Call Distribution */}
      <div className="card" style={{ padding: '14px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div className="ct" style={{ fontSize: '14px' }}>Call Distribution</div>
          <span className="cs" style={{ fontSize: '11px' }}>By type</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {distributionRows.map((row) => {
            const color = categoryColor[row.category] ?? 'var(--muted2)';
            return (
              <div key={row.category} style={{ 
                textAlign: 'center', 
                padding: '12px', 
                background: 'var(--surface-alt)', 
                borderRadius: 'var(--radius-lg)', 
                border: '1px solid var(--border2)'
              }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color }}>{Math.round(row.percentage)}%</div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)', marginTop: '5px', fontWeight: 700, textTransform: 'uppercase' }}>{categoryLabel(row.category)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text)', marginTop: '3px', fontWeight: 600 }}>{row.count}</div>
                <div style={{ fontSize: '10px', color: 'var(--brand)', marginTop: '3px', fontWeight: 700 }}>
                  {formatCurrency(row.totalCost)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Long Calls - Horizontal scroll */}
      <div className="card" style={{ flexShrink: 0 }}>
        <div className="ch" style={{ padding: '12px 16px' }}>
          <span className="ct" style={{ fontSize: '14px' }}>Long Calls (&gt;30 min)</span>
          <span className="cs" style={{ fontSize: '11px' }}>Click to filter</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', overflowX: 'auto' }}>
          {dashboard.longCalls.slice(0, 9).map((record, idx) => (
            <button
              type="button"
              key={`${record.callIdentifier ?? idx}-${record.startTime}`}
              onClick={() => goToCallLog({ extension: record.callingParty })}
              style={{
                background: 'var(--surface-alt)',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 14px',
                border: '1px solid var(--border2)',
                textAlign: 'left',
                cursor: 'pointer',
                flexShrink: 0,
                minWidth: '200px'
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                {record.callingParty} → {record.calledParty}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '5px' }}>
                <span>{record.startTime}</span> · <strong style={{ color: 'var(--orange)', fontSize: '11px' }}>{record.duration}</strong>
              </div>
            </button>
          ))}
          {dashboard.longCalls.length === 0 && (
            <div style={{ padding: '24px', color: 'var(--muted2)', fontSize: '13px', textAlign: 'center' }}>
              No long calls today
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
