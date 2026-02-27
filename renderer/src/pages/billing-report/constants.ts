import { CallCategory } from '../../../../shared/types';

export const CATEGORY_ORDER: CallCategory[] = ['international', 'mobile', 'national', 'local', 'unclassified'];

export const CAT_COLOR: Record<CallCategory, string> = {
  local: '#22c55e',
  national: '#3b82f6',
  mobile: '#a855f7',
  international: '#f59e0b',
  unclassified: '#6b7280'
};

export const CAT_BG: Record<CallCategory, string> = {
  local: 'rgba(34, 197, 94, 0.1)',
  national: 'rgba(59, 130, 246, 0.1)',
  mobile: 'rgba(168, 85, 247, 0.1)',
  international: 'rgba(245, 158, 11, 0.1)',
  unclassified: 'rgba(95, 110, 136, 0.1)'
};

export const CAT_BORDER: Record<CallCategory, string> = {
  local: 'rgba(34, 197, 94, 0.3)',
  national: 'rgba(59, 130, 246, 0.3)',
  mobile: 'rgba(168, 85, 247, 0.3)',
  international: 'rgba(245, 158, 11, 0.3)',
  unclassified: 'rgba(95, 110, 136, 0.3)'
};

export const TREND_COLORS = ['#2484eb', '#f59e0b', '#a855f7', '#14b8a6', '#ef4444', '#22c55e', '#eab308', '#06b6d4'];
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EXPORT_TOP_CALL_LIMITS = [100, 500, 1000, 5000] as const;
