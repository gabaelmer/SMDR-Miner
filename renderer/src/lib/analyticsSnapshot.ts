import { AnalyticsSnapshot, AnalyticsSummary } from '../../../shared/types';

const EMPTY_SUMMARY: AnalyticsSummary = {
  totalCalls: 0,
  totalDurationSeconds: 0,
  answeredCalls: 0,
  answeredRate: 0,
  avgDurationSeconds: 0,
  peakHour: '00',
  transferConferenceCalls: 0,
  transferConferenceRate: 0
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeVolumeByHour(volumeByHour: unknown) {
  const map = new Map<string, number>();
  for (const item of asArray<{ hour?: unknown; count?: unknown }>(volumeByHour)) {
    const rawHour = item?.hour;
    const parsedHour =
      typeof rawHour === 'number'
        ? Math.max(0, Math.min(23, Math.trunc(rawHour)))
        : Number.parseInt(String(rawHour ?? ''), 10);
    if (!Number.isFinite(parsedHour)) continue;
    const hourKey = String(parsedHour).padStart(2, '0');
    map.set(hourKey, Number(item?.count ?? 0) || 0);
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    return { hour: key, count: map.get(key) ?? 0 };
  });
}

function normalizeHeatmap(heatmap: unknown) {
  const rows = asArray<{ day?: unknown; hour?: unknown; count?: unknown }>(heatmap)
    .map((item) => ({
      day: typeof item?.day === 'string' ? item.day : '',
      hour: Number(item?.hour ?? 0),
      count: Number(item?.count ?? 0)
    }))
    .filter((item) => item.day.length > 0 && Number.isFinite(item.hour) && item.hour >= 0 && item.hour <= 23);
  if (rows.length === 0) return rows;
  const days = Array.from(new Set(rows.map((item) => item.day))).sort();
  const map = new Map(rows.map((item) => [`${item.day}|${item.hour}`, item.count]));
  return days.flatMap((day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      day,
      hour,
      count: map.get(`${day}|${hour}`) ?? 0
    }))
  );
}

function inferSummary(base: Partial<AnalyticsSnapshot> & { [key: string]: unknown }): AnalyticsSummary {
  const volumeByHour = normalizeVolumeByHour(base.volumeByHour);
  const totalCalls = volumeByHour.reduce((sum, item) => sum + item.count, 0);
  const extensionUsage = asArray<{ totalDurationSeconds?: unknown }>(base.extensionUsage);
  const totalDurationSeconds = extensionUsage.reduce((sum, item) => sum + Number(item?.totalDurationSeconds ?? 0), 0);
  const peak = volumeByHour.reduce((best, current) => (current.count > best.count ? current : best), volumeByHour[0] ?? { hour: '00', count: 0 });
  const transferConferenceCalls = asArray<{ flag?: unknown; count?: unknown }>(base.transferConference)
    .filter((item) => {
      const flag = typeof item?.flag === 'string' ? item.flag : '';
      return ['T', 'X', 'C'].includes(flag);
    })
    .reduce((sum, item) => sum + Number(item?.count ?? 0), 0);

  return {
    totalCalls,
    totalDurationSeconds,
    answeredCalls: 0,
    answeredRate: 0,
    avgDurationSeconds: totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0,
    peakHour: peak.hour,
    transferConferenceCalls,
    transferConferenceRate: totalCalls > 0 ? Math.round((transferConferenceCalls / totalCalls) * 1000) / 10 : 0
  };
}

export function normalizeAnalyticsSnapshot(input: Partial<AnalyticsSnapshot> | null | undefined): AnalyticsSnapshot {
  const safeInput = (input && typeof input === 'object' ? input : {}) as Partial<AnalyticsSnapshot> & {
    [key: string]: unknown;
  };
  const volumeByHour = normalizeVolumeByHour(safeInput.volumeByHour);
  const heatmap = normalizeHeatmap(safeInput.heatmap);
  const summary = safeInput.summary
    ? {
        ...EMPTY_SUMMARY,
        ...safeInput.summary
      }
    : inferSummary({ ...safeInput, volumeByHour, heatmap });

  const correlations = asArray<{
    key?: unknown;
    callIdentifier?: unknown;
    associatedCallIdentifier?: unknown;
    networkOLI?: unknown;
    count?: unknown;
    anomalyScore?: unknown;
    severity?: unknown;
  }>(safeInput.correlations).map((row, index): AnalyticsSnapshot['correlations'][number] => {
    const count = Number(row?.count ?? 0) || 0;
    const inferredSeverity: AnalyticsSnapshot['correlations'][number]['severity'] = count >= 10 ? 'high' : count >= 4 ? 'medium' : 'low';
    const severityCandidate = row?.severity;
    const severity: AnalyticsSnapshot['correlations'][number]['severity'] =
      severityCandidate === 'low' ||
      severityCandidate === 'medium' ||
      severityCandidate === 'high' ||
      severityCandidate === 'critical'
        ? severityCandidate
        : inferredSeverity;
    return {
      key:
        (typeof row?.key === 'string' && row.key) ||
        `${row?.callIdentifier ?? '-'}|${row?.associatedCallIdentifier ?? '-'}|${row?.networkOLI ?? '-'}|${index}`,
      callIdentifier: typeof row?.callIdentifier === 'string' ? row.callIdentifier : undefined,
      associatedCallIdentifier: typeof row?.associatedCallIdentifier === 'string' ? row.associatedCallIdentifier : undefined,
      networkOLI: typeof row?.networkOLI === 'string' ? row.networkOLI : undefined,
      count,
      anomalyScore: Number(row?.anomalyScore ?? 0) || 0,
      severity
    };
  });

  return {
    volumeByHour,
    heatmap,
    extensionUsage: asArray<{ extension?: unknown; calls?: unknown; totalDurationSeconds?: unknown; avgHandleTime?: unknown }>(
      safeInput.extensionUsage
    ).map((item) => ({
      extension: String(item?.extension ?? ''),
      calls: Number(item?.calls ?? 0) || 0,
      totalDurationSeconds: Number(item?.totalDurationSeconds ?? 0) || 0,
      avgHandleTime: Number(item?.avgHandleTime ?? 0) || 0
    })),
    transferConference: asArray<{ flag?: unknown; count?: unknown }>(safeInput.transferConference).map((item) => ({
      flag: String(item?.flag ?? 'none'),
      count: Number(item?.count ?? 0) || 0
    })),
    summary,
    correlations
  };
}

export { EMPTY_SUMMARY };
