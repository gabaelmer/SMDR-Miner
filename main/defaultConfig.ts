import path from 'node:path';
import { AppConfig } from '../shared/types';

export function buildDefaultConfig(userDataPath: string): AppConfig {
  return {
    connection: {
      controllerIps: ['127.0.0.1'],
      port: 1752,
      concurrentConnections: 1,
      autoReconnect: true,
      reconnectDelayMs: 5000,
      autoReconnectPrimary: true,
      primaryRecheckDelayMs: 60_000,
      ipWhitelist: []
    },
    storage: {
      dbPath: path.join(userDataPath, 'smdr-insight.sqlite'),
      retentionDays: 60,
      archiveDirectory: path.join(userDataPath, 'archive')
    },
    alerts: {
      longCallMinutes: 30,
      watchNumbers: [],
      repeatedBusyThreshold: 3,
      repeatedBusyWindowMinutes: 30,
      detectTagCalls: true,
      detectTollDenied: true
    },
    maxInMemoryRecords: 2000
  };
}
