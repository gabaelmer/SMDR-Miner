import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsSnapshot, RecordFilters } from '../../../shared/types';
import { Heatmap } from '../components/Heatmap';
import { api } from '../lib/api';
import { RangePreset, deltaBadge, formatSeconds, getPresetRange, normalizeTransferLabel, toCsv } from '../lib/analyticsUtils';
import { EMPTY_SUMMARY, normalizeAnalyticsSnapshot } from '../lib/analyticsSnapshot';
import { useAppStore } from '../state/appStore';

const TRANSFER_COLORS: Record<string, string> = {
  None: '#2484eb',
  'Supervised Transfer': '#26b67f',
  'Blind Transfer': '#9b59b6',
  Conference: '#e67e22',
  none: '#2484eb',
  T: '#26b67f',
  X: '#9b59b6',
  C: '#e67e22'
};

const TRANSFER_FLAG_ORDER = [
  { flag: 'none', label: 'None' },
  { flag: 'T', label: 'Supervised Transfer' },
  { flag: 'X', label: 'Blind Transfer' },
  { flag: 'C', label: 'Conference' }
] as const;

const CORRELATION_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--orange)',
  medium: 'var(--brand)',
  low: 'var(--muted2)'
};

function download(name: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AnalyticsPage() {
  const analytics = useAppStore((state) => state.analytics);
  const refreshAnalytics = useAppStore((state) => state.refreshAnalytics);
  const setFilters = useAppStore((state) => state.setFilters);
  const refreshRecords = useAppStore((state) => state.refreshRecords);
  const setActivePage = useAppStore((state) => state.setActivePage);

  const rootRef = useRef<HTMLDivElement>(null);

  const [preset, setPreset] = useState<RangePreset>('last7');
  const [startDate, setStartDate] = useState(getPresetRange('last7').startDate);
  const [endDate, setEndDate] = useState(getPresetRange('last7').endDate);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [compareAnalytics, setCompareAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [compareLabel, setCompareLabel] = useState('');
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [selectedTransferSlice, setSelectedTransferSlice] = useState<{ label: string; count: number } | null>(null);
  const transferDonutRef = useRef<HTMLDivElement>(null);
  const [transferDonutSize, setTransferDonutSize] = useState({ width: 0, height: 0 });

  const transferCountByFlag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of analytics.transferConference) {
      const rawFlag = String(item.flag ?? '').trim();
      if (!rawFlag) continue;
      const normalizedFlag =
        rawFlag.toLowerCase() === 'none' ? 'none' : rawFlag.toUpperCase();
      counts.set(normalizedFlag, (counts.get(normalizedFlag) ?? 0) + (item.count ?? 0));
    }
    return counts;
  }, [analytics.transferConference]);

  const transferSummaryData = useMemo(
    () =>
      TRANSFER_FLAG_ORDER.map((item) => ({
        flag: item.flag,
        label: item.label,
        count: transferCountByFlag.get(item.flag) ?? 0,
        color: TRANSFER_COLORS[item.label] || TRANSFER_COLORS[item.flag] || '#2484eb'
      })),
    [transferCountByFlag]
  );

  const transferChartData = useMemo(
    () =>
      transferSummaryData
        .filter((item) => item.count > 0)
        .map((item) => ({
          ...item,
          label: normalizeTransferLabel(item.flag)
        })),
    [transferSummaryData]
  );
  const centerTransferLines = useMemo(
    () =>
      transferSummaryData.map((item) => ({
        key: item.flag,
        text: `${item.label}: ${item.count}`,
        color: item.color,
        active: selectedTransferSlice?.label === item.label
      })),
    [transferSummaryData, selectedTransferSlice]
  );
  const centerTransferLayout = useMemo(() => {
    const minDim = Math.max(0, Math.min(transferDonutSize.width, transferDonutSize.height));
    const innerDiameter = minDim > 0 ? minDim * 0.55 : 220;
    const overlayWidth = Math.max(132, innerDiameter * 0.88);
    const gap = Math.max(4, Math.min(6, innerDiameter * 0.025));
    const padY = Math.max(2, Math.min(4, innerDiameter * 0.015));
    const padX = Math.max(7, Math.min(10, innerDiameter * 0.045));
    const dotSize = Math.max(6, Math.min(8, innerDiameter * 0.03));
    const fontSize = Math.max(9, Math.min(11, innerDiameter * 0.045));
    const lineHeight = fontSize + padY * 2 + 2;
    const estimatedHeight = centerTransferLines.length > 0
      ? centerTransferLines.length * lineHeight + (centerTransferLines.length - 1) * gap
      : lineHeight;
    const availableHeight = innerDiameter * 0.9;
    const scale = availableHeight > 0 ? Math.min(1, availableHeight / estimatedHeight) : 1;

    return { overlayWidth, gap, padY, padX, dotSize, fontSize, scale };
  }, [centerTransferLines.length, transferDonutSize.height, transferDonutSize.width]);

  const compareSummary = compareAnalytics?.summary;
  const summary = analytics.summary ?? EMPTY_SUMMARY;
  const peakHourCount = analytics.volumeByHour.find((x) => x.hour === summary.peakHour)?.count ?? 0;

  useEffect(() => {
    if (startDate > endDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setFilters({
      date: undefined,
      dateFrom: startDate,
      dateTo: endDate
    });
    setLoadingCurrent(true);
    void refreshAnalytics(startDate, endDate)
      .catch((error) => {
        console.error('Analytics refresh failed', error);
      })
      .finally(() => setLoadingCurrent(false));
  }, [startDate, endDate, refreshAnalytics, setFilters]);

  useEffect(() => {
    if (!compareEnabled) {
      setCompareAnalytics(null);
      setCompareLabel('');
      return;
    }

    const start = dayjs(startDate);
    const end = dayjs(endDate);
    const daySpan = Math.max(1, end.diff(start, 'day') + 1);
    const prevEnd = start.subtract(1, 'day');
    const prevStart = prevEnd.subtract(daySpan - 1, 'day');
    const prevStartStr = prevStart.format('YYYY-MM-DD');
    const prevEndStr = prevEnd.format('YYYY-MM-DD');
    setCompareLabel(`${prevStartStr} to ${prevEndStr}`);
    setLoadingCompare(true);
    void api
      .getAnalytics(prevStartStr, prevEndStr)
      .then((snapshot) => setCompareAnalytics(normalizeAnalyticsSnapshot(snapshot as AnalyticsSnapshot)))
      .catch((error) => {
        console.error('Comparison analytics failed', error);
        setCompareAnalytics(null);
      })
      .finally(() => setLoadingCompare(false));
  }, [compareEnabled, startDate, endDate]);

  useEffect(() => {
    const node = transferDonutRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setTransferDonutSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const openCallLog = (partial: Partial<RecordFilters>) => {
    setFilters({
      date: undefined,
      dateFrom: startDate,
      dateTo: endDate,
      extension: undefined,
      accountCode: undefined,
      hour: undefined,
      callType: undefined,
      completionStatus: undefined,
      transferFlag: undefined,
      callIdentifier: undefined,
      associatedCallIdentifier: undefined,
      networkOLI: undefined,
      ...partial
    });
    setActivePage('calls');
    void refreshRecords();
  };

  const applyPreset = (value: RangePreset) => {
    setPreset(value);
    if (value !== 'custom') {
      const range = getPresetRange(value);
      setStartDate(range.startDate);
      setEndDate(range.endDate);
    }
  };

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(['Metric', 'Current']);
    rows.push(['Total Calls', String(summary.totalCalls)]);
    rows.push(['Answered Calls', String(summary.answeredCalls)]);
    rows.push(['Answered Rate', `${summary.answeredRate}%`]);
    rows.push(['Average Call Duration (s)', String(summary.avgDurationSeconds)]);
    rows.push(['Peak Hour', summary.peakHour]);
    rows.push(['Transfer/Conference Calls', String(summary.transferConferenceCalls)]);
    rows.push(['Transfer/Conference Rate', `${summary.transferConferenceRate}%`]);
    rows.push([]);
    rows.push(['Hour', 'Calls']);
    for (const row of analytics.volumeByHour) rows.push([row.hour, String(row.count)]);
    rows.push([]);
    rows.push(['Transfer Flag', 'Calls']);
    for (const row of analytics.transferConference) rows.push([row.flag, String(row.count)]);
    rows.push([]);
    rows.push(['Correlation Key', 'Count', 'Severity', 'Anomaly Score']);
    for (const row of analytics.correlations) rows.push([row.key, String(row.count), row.severity, String(row.anomalyScore)]);
    download(`analytics-${startDate}-to-${endDate}.csv`, toCsv(rows), 'text/csv');
  };

  const exportImage = async () => {
    if (!rootRef.current) return;
    const canvas = await html2canvas(rootRef.current, { backgroundColor: '#050b1a', scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      download(`analytics-${startDate}-to-${endDate}.png`, blob, 'image/png');
    });
  };

  const exportPdf = async () => {
    if (!rootRef.current) return;
    const canvas = await html2canvas(rootRef.current, { backgroundColor: '#050b1a', scale: 2 });
    const img = canvas.toDataURL('image/png');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.addImage(img, 'PNG', 8, 8, pageWidth - 16, pageHeight - 16);
    doc.save(`analytics-${startDate}-to-${endDate}.pdf`);
  };

  return (
    <div ref={rootRef} className="h-[calc(100vh-148px)] min-h-0 overflow-auto xl:overflow-hidden flex flex-col gap-1.5">
      <div className="card p-3 shrink-0">
        <div className="grid gap-2 md:grid-cols-12" style={{ alignItems: 'end' }}>
          <div className="md:col-span-2">
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Preset</p>
            <select
              value={preset}
              onChange={(e) => applyPreset(e.target.value as RangePreset)}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="today">Today</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>From</p>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setPreset('custom');
                setStartDate(e.target.value);
              }}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>To</p>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setPreset('custom');
                setEndDate(e.target.value);
              }}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="md:col-span-1" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
            <input type="checkbox" checked={compareEnabled} onChange={(e) => setCompareEnabled(e.target.checked)} />
            <span style={{ fontSize: '11px', color: 'var(--text)', fontWeight: 600 }}>Compare</span>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Comparison Range</p>
            <p style={{ fontSize: '12px', color: 'var(--muted2)' }}>
              {compareEnabled ? (loadingCompare ? 'Loading comparison…' : compareLabel || 'No baseline') : 'Comparison disabled'}
            </p>
          </div>
          <div className="md:col-span-3" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={exportCsv} className="btn bg2" style={{ fontSize: '11px', flex: '0 1 120px', minWidth: '120px' }}>
              Export CSV
            </button>
            <button onClick={() => void exportImage()} className="btn bg2" style={{ fontSize: '11px', flex: '0 1 120px', minWidth: '120px' }}>
              Export PNG
            </button>
            <button onClick={() => void exportPdf()} className="btn bg2" style={{ fontSize: '11px', flex: '0 1 120px', minWidth: '120px' }}>
              Export PDF
            </button>
          </div>
        </div>
        <p style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted2)' }}>
          {loadingCurrent ? 'Refreshing analytics…' : `Range: ${startDate} to ${endDate}`}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-5 shrink-0">
        {[
          {
            label: 'Total Calls',
            value: summary.totalCalls.toLocaleString(),
            delta: deltaBadge(summary.totalCalls, compareSummary?.totalCalls)
          },
          {
            label: 'Answered Rate',
            value: `${summary.answeredRate}%`,
            delta: deltaBadge(summary.answeredRate, compareSummary?.answeredRate)
          },
          {
            label: 'Average Call Duration',
            value: formatSeconds(summary.avgDurationSeconds),
            delta: deltaBadge(summary.avgDurationSeconds, compareSummary?.avgDurationSeconds)
          },
          {
            label: 'Peak Hour',
            value: `${summary.peakHour}:00 (${peakHourCount})`,
            delta: null
          },
          {
            label: 'Transfer/Conference Rate',
            value: `${summary.transferConferenceRate}%`,
            delta: deltaBadge(summary.transferConferenceRate, compareSummary?.transferConferenceRate)
          }
        ].map((card) => (
          <div key={card.label} className="card p-2.5">
            <p className="text-xs" style={{ color: 'var(--muted2)' }}>{card.label}</p>
            <p style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>{card.value}</p>
            <p style={{ marginTop: '4px', fontSize: '11px', color: card.delta?.color ?? 'var(--muted2)' }}>
              {card.delta ? card.delta.text : '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-1.5 min-h-0 flex-1 xl:grid-cols-12 xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card p-3 min-h-0 overflow-hidden flex flex-col xl:col-span-6 xl:row-start-1">
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Call Volume Per Hour (click a point to drill down)
          </p>
          <div className="flex-1 min-h-[170px]">
            <ResponsiveContainer>
              <AreaChart
                data={analytics.volumeByHour}
                onClick={(state) => {
                  const activeLabel = (state as { activeLabel?: string | number | null } | null | undefined)?.activeLabel;
                  if (activeLabel === undefined || activeLabel === null) return;
                  const hourMatch = String(activeLabel).match(/\d{1,2}/);
                  if (!hourMatch) return;
                  openCallLog({ hour: hourMatch[0].padStart(2, '0') });
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip
                  contentStyle={{
                    background: '#00a8ff',
                    border: '1px solid #7fdbff',
                    borderRadius: '12px',
                    boxShadow: '0 0 16px rgba(0, 168, 255, 0.65)',
                    color: '#001228',
                    fontWeight: 700
                  }}
                  labelStyle={{ color: '#001228', fontWeight: 800 }}
                  itemStyle={{ color: '#001228', fontWeight: 800 }}
                  formatter={(value: number) => [`${Number(value) || 0} calls`, 'Volume']}
                  labelFormatter={(label) => `Hour ${String(label).padStart(2, '0')}:00`}
                />
                <Area type="monotone" dataKey="count" stroke="#2484eb" fill="#2484eb55" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-3 min-h-0 overflow-hidden flex flex-col xl:col-start-10 xl:col-span-3 xl:row-start-1 xl:row-span-2">
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Transfer/Conference Distribution (click a slice to drill down)
          </p>
          <div
            ref={transferDonutRef}
            className="relative flex-1 min-h-[170px]"
            onClick={() => setSelectedTransferSlice(null)}
          >
            {transferChartData.length === 0 ? (
              <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', paddingTop: '84px' }}>
                No transfer or conference calls in selected range
              </p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={transferChartData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={4}
                    labelLine={false}
                    label={false}
                    onClick={(entry: unknown) => {
                      if (!entry || typeof entry !== 'object') return;
                      const payload = (entry as { payload?: { flag?: unknown; count?: number; label?: string } }).payload ?? (entry as { flag?: unknown; count?: number; label?: string });
                      const flag = payload.flag;
                      if (typeof flag === 'string' && flag) {
                        setSelectedTransferSlice({
                          label: typeof payload.label === 'string' && payload.label ? payload.label : normalizeTransferLabel(flag),
                          count: typeof payload.count === 'number' ? payload.count : 0
                        });
                        openCallLog({ transferFlag: flag });
                      }
                    }}
                  >
                    {transferChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || TRANSFER_COLORS[entry.label] || TRANSFER_COLORS[entry.flag] || '#2484eb'} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            {transferChartData.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) scale(${centerTransferLayout.scale})`,
                  transformOrigin: 'center center',
                  width: `${centerTransferLayout.overlayWidth}px`,
                  maxWidth: '88%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: `${centerTransferLayout.gap}px`,
                  pointerEvents: 'none'
                }}
              >
                {centerTransferLines.map((line) => (
                  <div
                    key={`center-transfer-pill-${line.key}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderRadius: '8px',
                      border: `1px solid ${line.active ? `${line.color}99` : 'var(--border)'}`,
                      background: line.active ? `${line.color}22` : 'rgba(19, 41, 87, 0.72)',
                      boxShadow: line.active ? `0 0 10px ${line.color}33` : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                      padding: `${centerTransferLayout.padY}px ${centerTransferLayout.padX}px`
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: `${centerTransferLayout.dotSize}px`,
                        height: `${centerTransferLayout.dotSize}px`,
                        borderRadius: '999px',
                        display: 'inline-block',
                        background: line.color,
                        boxShadow: `0 0 8px ${line.color}66`
                      }}
                    />
                    <span
                      className="mono"
                      style={{
                        color: '#f5f8ff',
                        fontSize: `${centerTransferLayout.fontSize}px`,
                        fontWeight: line.active ? 800 : 700,
                        letterSpacing: '0.01em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card p-3 min-h-0 overflow-hidden flex flex-col xl:col-start-7 xl:col-span-3 xl:row-start-1">
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Average Call Duration by Extension
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px', fontSize: '9px', color: 'var(--muted2)', fontWeight: 600, textTransform: 'uppercase' }}>
            <div>Extension</div>
            <div style={{ textAlign: 'right' }}>Duration / Calls</div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
            {(() => {
              const rows = [...analytics.extensionUsage].sort((a, b) => {
                if (b.avgHandleTime === a.avgHandleTime) return b.calls - a.calls;
                return b.avgHandleTime - a.avgHandleTime;
              });
              const maxSeconds = Math.max(...rows.map((ext) => ext.avgHandleTime || 0), 1);
              return rows.map((ext) => {
                const pct = Math.round(((ext.avgHandleTime || 0) / maxSeconds) * 100);
                return (
                  <button
                    key={`acd-${ext.extension}`}
                    className="erow"
                    style={{ padding: '8px 0', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onClick={() => openCallLog({ extension: ext.extension })}
                  >
                    <span className="mono" style={{ width: '40px', color: 'var(--text)', fontWeight: 600 }}>{ext.extension}</span>
                    <div className="etrk">
                      <div className="efil" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--brand), var(--purple))' }}></div>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--muted2)', width: '88px', textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{formatSeconds(ext.avgHandleTime)}</div>
                      <div style={{ color: 'var(--brand)', fontWeight: 700 }}>{ext.calls} calls</div>
                    </div>
                  </button>
                );
              });
            })()}
            {analytics.extensionUsage.length === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '40px 0' }}>No calls yet in selected range</p>
            )}
          </div>
        </div>

        <div className="min-h-0 xl:col-span-9 xl:row-start-2">
          <Heatmap
            data={analytics.heatmap}
            onCellClick={(cell) => {
              openCallLog({
                dateFrom: cell.day,
                dateTo: cell.day,
                hour: String(cell.hour).padStart(2, '0')
              });
            }}
          />
        </div>

        <div className="card p-3 min-h-0 overflow-hidden flex flex-col xl:col-span-6 xl:row-start-3">
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Extension Usage (click row to drill down)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px', fontSize: '9px', color: 'var(--muted2)', fontWeight: 600, textTransform: 'uppercase' }}>
            <div>Extension</div>
            <div style={{ textAlign: 'right' }}>Calls / Duration</div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
            {analytics.extensionUsage.slice(0, 10).map((ext) => {
              const maxCalls = analytics.extensionUsage[0]?.calls || 1;
              const pct = Math.round((ext.calls / maxCalls) * 100);
              return (
                <button
                  key={ext.extension}
                  className="erow"
                  style={{ padding: '8px 0', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onClick={() => openCallLog({ extension: ext.extension })}
                >
                  <span className="mono" style={{ width: '40px', color: 'var(--text)', fontWeight: 600 }}>{ext.extension}</span>
                  <div className="etrk">
                    <div className="efil" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--brand), var(--purple))' }}></div>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--muted2)', width: '88px', textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{ext.calls} calls</div>
                    <div style={{ color: 'var(--brand)', fontWeight: 700 }}>{formatSeconds(ext.totalDurationSeconds)}</div>
                  </div>
                </button>
              );
            })}
            {analytics.extensionUsage.length === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '40px 0' }}>No calls yet in selected range</p>
            )}
          </div>
        </div>

        <div className="card p-3 min-h-0 overflow-hidden flex flex-col xl:col-start-7 xl:col-span-6 xl:row-start-3">
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Correlation Anomalies (grouped and scored)
          </p>
          <div className="space-y-2" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
            {analytics.correlations.slice(0, 30).map((item) => (
              <button
                key={item.key}
                className="rounded-2xl border p-2"
                style={{ borderColor: 'var(--border)', width: '100%', textAlign: 'left', background: 'transparent' }}
                onClick={() =>
                  openCallLog({
                    callIdentifier: item.callIdentifier,
                    associatedCallIdentifier: item.associatedCallIdentifier,
                    networkOLI: item.networkOLI
                  })
                }
              >
                <p className="text-xs" style={{ color: 'var(--text)' }}>
                  CID: {item.callIdentifier ?? '-'} | Assoc: {item.associatedCallIdentifier ?? '-'} | OLI: {item.networkOLI ?? '-'}
                </p>
                <p className="text-xs" style={{ color: CORRELATION_COLORS[item.severity], fontWeight: 700 }}>
                  {item.count} matches · {item.severity.toUpperCase()} · anomaly {item.anomalyScore}
                </p>
              </button>
            ))}
            {analytics.correlations.length === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center', padding: '40px 0' }}>
                No significant correlation clusters in this range
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
