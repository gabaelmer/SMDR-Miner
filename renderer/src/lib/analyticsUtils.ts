import dayjs from 'dayjs';

export type RangePreset = 'today' | 'last7' | 'last30' | 'custom';

export function getPresetRange(preset: Exclude<RangePreset, 'custom'>): { startDate: string; endDate: string } {
  const today = dayjs();
  if (preset === 'today') {
    const d = today.format('YYYY-MM-DD');
    return { startDate: d, endDate: d };
  }
  if (preset === 'last7') {
    return {
      startDate: today.subtract(6, 'day').format('YYYY-MM-DD'),
      endDate: today.format('YYYY-MM-DD')
    };
  }
  return {
    startDate: today.subtract(29, 'day').format('YYYY-MM-DD'),
    endDate: today.format('YYYY-MM-DD')
  };
}

export function normalizeTransferLabel(flag: string): string {
  if (flag === 'T') return 'T - Transfer';
  if (flag === 'X') return 'X - Conference';
  if (flag === 'C') return 'C - Conference';
  if (flag === 'none') return 'None';
  return flag;
}

export function safePercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function deltaBadge(current: number, previous?: number) {
  if (previous === undefined) return null;
  const diff = current - previous;
  const pct = previous === 0 ? (current > 0 ? 100 : 0) : (diff / previous) * 100;
  return {
    diff,
    pct: Math.round(pct * 10) / 10,
    text: `${diff >= 0 ? '+' : ''}${diff} (${diff >= 0 ? '+' : ''}${Math.round(pct * 10) / 10}%)`,
    color: diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--muted2)'
  };
}

export function toCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n')}\n`;
}
