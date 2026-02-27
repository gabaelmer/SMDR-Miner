/**
 * Convert duration string (HH:MM:SS or MM:SS) to seconds
 */
export function durationToSeconds(duration: string): number {
  if (!duration || duration.trim() === '') return 0;
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Convert seconds to duration string (HH:MM:SS)
 */
export function secondsToDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to human-readable duration (e.g., "2h 15m", "45s")
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 0) return '0s';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/**
 * Format seconds to billable units based on block size
 */
export function secondsToBillableUnits(totalSeconds: number, blockSize: number, minimumCharge: number): number {
  if (totalSeconds <= 0) return 0;
  const raw = Math.ceil(totalSeconds / blockSize);
  return Math.max(raw, minimumCharge);
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Get day of week (0-6, 0 = Sunday)
 */
export function getDayOfWeek(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.getDay();
}
