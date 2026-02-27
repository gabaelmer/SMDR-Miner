/// <reference types="vite/client" />

import type {
  AlertRuleSet,
  AnalyticsSnapshot,
  AppConfig,
  AuthCredentials,
  DashboardMetrics,
  ExportDialogOptions,
  ExportOptions,
  RecordFilters,
  ServiceState,
  SMDRRecord
} from '../../shared/types';

interface DesktopApi {
  login: (credentials: AuthCredentials) => Promise<boolean>;
  createUser: (credentials: AuthCredentials) => Promise<boolean>;
  getConfig: () => Promise<AppConfig>;
  updateConfig: (config: AppConfig) => Promise<boolean>;
  updateAlertRules: (rules: AlertRuleSet) => Promise<boolean>;
  startStream: () => Promise<boolean>;
  stopStream: () => Promise<boolean>;
  getState: () => Promise<ServiceState>;
  getRecords: (filters: RecordFilters) => Promise<SMDRRecord[]>;
  getRecentRecords: () => Promise<SMDRRecord[]>;
  getDashboard: (date?: string) => Promise<DashboardMetrics>;
  getAnalytics: (startDate?: string, endDate?: string) => Promise<AnalyticsSnapshot>;
  getAlerts: (limit?: number) => Promise<unknown[]>;
  getParseErrors: (limit?: number) => Promise<unknown[]>;
  exportRecords: (options: ExportOptions) => Promise<string>;
  exportRecordsWithDialog: (options: ExportDialogOptions) => Promise<string | null>;
  purgeRecords: (days: number) => Promise<number>;
  onServiceEvent: (callback: (event: { type: string; payload: unknown }) => void) => () => void;
  log: (level: string, message: string) => void;
}

declare global {
  interface Window {
    smdrInsight: DesktopApi;
  }
}
