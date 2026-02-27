import path from 'node:path';
import fs from 'node:fs';
import { SMDRService } from '../backend/SMDRService';
import { AppConfig } from '../shared/types';
import { buildDefaultConfig } from './defaultConfig';
import { WebServer } from '../backend/web/WebServer';

console.log('[NodeServer] Starting SMDR Insight in Pure Node mode...');
console.log('[NodeServer] Process PID:', process.pid);
console.log('[NodeServer] Node version:', process.version);

// In non-electron mode, we use a local config folder
const configDir = process.env.SMDR_CONFIG_DIR || path.join(process.cwd(), 'config');
const configPath = path.join(configDir, 'settings.json');
const configBackupPath = path.join(configDir, 'settings.backup.json');
const configHistoryDir = path.join(configDir, 'config-history');
const maxConfigHistoryFiles = 15;

console.log('[NodeServer] Config directory:', configDir);
console.log('[NodeServer] Config file:', configPath);

if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }
        return parsed as Record<string, unknown>;
    } catch (err) {
        console.error(`[NodeServer] Failed reading JSON from ${filePath}:`, err);
        return undefined;
    }
}

function mergeWithDefaults(defaultConfig: AppConfig, data?: Record<string, unknown>): AppConfig {
    const source = data ?? {};
    return {
        ...defaultConfig,
        ...source,
        connection: { ...defaultConfig.connection, ...((source.connection as Record<string, unknown> | undefined) ?? {}) },
        storage: { ...defaultConfig.storage, ...((source.storage as Record<string, unknown> | undefined) ?? {}) },
        alerts: { ...defaultConfig.alerts, ...((source.alerts as Record<string, unknown> | undefined) ?? {}) }
    };
}

function pruneConfigHistory(): void {
    if (!fs.existsSync(configHistoryDir)) return;
    const files = fs
        .readdirSync(configHistoryDir)
        .filter((name) => name.startsWith('settings-') && name.endsWith('.json'))
        .sort();
    if (files.length <= maxConfigHistoryFiles) return;
    const toDelete = files.slice(0, files.length - maxConfigHistoryFiles);
    for (const fileName of toDelete) {
        try {
            fs.rmSync(path.join(configHistoryDir, fileName), { force: true });
        } catch (err) {
            console.error('[NodeServer] Failed pruning old config history file:', fileName, err);
        }
    }
}

function persistConfigSafely(nextConfig: AppConfig): void {
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(configHistoryDir, { recursive: true });

    const existingJson = readJsonObject(configPath) ?? readJsonObject(configBackupPath) ?? {};
    const patchedConfig: Record<string, unknown> = {
        ...existingJson,
        ...nextConfig,
        connection: {
            ...((existingJson.connection as Record<string, unknown> | undefined) ?? {}),
            ...nextConfig.connection
        },
        storage: {
            ...((existingJson.storage as Record<string, unknown> | undefined) ?? {}),
            ...nextConfig.storage
        },
        alerts: {
            ...((existingJson.alerts as Record<string, unknown> | undefined) ?? {}),
            ...nextConfig.alerts
        }
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (fs.existsSync(configPath)) {
        const previousRaw = fs.readFileSync(configPath, 'utf8');
        fs.writeFileSync(configBackupPath, previousRaw, 'utf8');
        fs.writeFileSync(path.join(configHistoryDir, `settings-${timestamp}.json`), previousRaw, 'utf8');
    }

    const tempPath = `${configPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(patchedConfig, null, 2), 'utf8');
    fs.renameSync(tempPath, configPath);
    pruneConfigHistory();
}

function loadConfig(): AppConfig {
    const defaultConfig = buildDefaultConfig(configDir);
    const primaryData = readJsonObject(configPath);
    if (primaryData) {
        console.log('[NodeServer] Config loaded from:', configPath);
        console.log('[NodeServer] MiVB IPs:', (primaryData.connection as any)?.controllerIps || 'not set');
        console.log('[NodeServer] MiVB Port:', (primaryData.connection as any)?.port || 1752);
        return mergeWithDefaults(defaultConfig, primaryData);
    }

    const backupData = readJsonObject(configBackupPath);
    if (backupData) {
        console.log('[NodeServer] Primary config unavailable. Loaded backup config:', configBackupPath);
        return mergeWithDefaults(defaultConfig, backupData);
    }

    console.log('[NodeServer] Config file not found, using defaults');
    console.log('[NodeServer] Run: npx tsx scripts/configure.ts configure');
    return defaultConfig;
}

const config = loadConfig();

// Ensure DB directory exists
const dbDir = path.dirname(config.storage.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
console.log('[NodeServer] Database path:', config.storage.dbPath);

const service = new SMDRService(config);
console.log('[NodeServer] SMDRService initialized');

// Add comprehensive logging to service events
service.on('event', (event) => {
    if (event.type === 'status') {
        console.log(`[NodeServer] Connection status: ${event.payload}`);
    }
});

service.on('config-change', (updatedConfig: AppConfig) => {
    try {
        persistConfigSafely(updatedConfig);
        console.log('[NodeServer] Configuration persisted with backup/history:', configPath);
    } catch (err) {
        console.error('[NodeServer] Failed to persist configuration:', err);
    }
});

const webServer = new WebServer(service, configDir);
webServer.start();
console.log('[NodeServer] Web Server started');

console.log('[NodeServer] Starting SMDR stream...');
service.start();
console.log('[NodeServer] SMDR Data Stream started');
console.log('[NodeServer] Waiting for MiVB connection...');

// Handle process termination
process.on('SIGTERM', () => {
    console.log('[NodeServer] SIGTERM received, shutting down...');
    service.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[NodeServer] SIGINT received, shutting down...');
    service.close();
    process.exit(0);
});

// Unhandled errors
process.on('uncaughtException', (err) => {
    console.error('[NodeServer] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[NodeServer] Unhandled Rejection at:', promise, 'reason:', reason);
});
