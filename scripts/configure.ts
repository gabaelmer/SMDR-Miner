#!/usr/bin/env node
/**
 * SMDR Insight Configuration Utility
 * Directly edit the configuration file without using the web UI
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CONFIG_DIR = process.env.SMDR_CONFIG_DIR || path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

function loadConfig(): any {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  }
  
  // Return default config
  return {
    connection: {
      controllerIps: ['192.168.1.100'],
      port: 1752,
      concurrentConnections: 1,
      autoReconnect: true,
      reconnectDelayMs: 5000,
      autoReconnectPrimary: true,
      primaryRecheckDelayMs: 60000,
      ipWhitelist: []
    },
    storage: {
      dbPath: path.join(CONFIG_DIR, 'smdr-insight.sqlite'),
      retentionDays: 60,
      archiveDirectory: path.join(CONFIG_DIR, 'archive')
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

function saveConfig(config: any): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`\n✓ Configuration saved to: ${CONFIG_FILE}`);
}

async function configure(): Promise<void> {
  console.log('\n=== SMDR Insight Configuration ===\n');
  
  const config = loadConfig();
  
  console.log('Current MiVoice Business Configuration:');
  console.log(`  IPs: ${config.connection.controllerIps.join(', ')}`);
  console.log(`  Port: ${config.connection.port}`);
  console.log('');
  
  // Get MiVB IP
  const ips = await question(`MiVoice Business IP addresses (comma-separated) [${config.connection.controllerIps.join(', ')}]: `);
  if (ips.trim()) {
    config.connection.controllerIps = ips
      .split(',')
      .map((ip: string) => ip.trim())
      .filter((ip: string) => ip.length > 0);
  }
  
  // Get Port
  const port = await question(`SMDR Port [${config.connection.port}]: `);
  if (port.trim()) {
    config.connection.port = parseInt(port, 10) || 1752;
  }
  
  // Get Concurrent Connections
  const concurrent = await question(`Concurrent Connections (1-10) [${config.connection.concurrentConnections}]: `);
  if (concurrent.trim()) {
    config.connection.concurrentConnections = Math.max(1, Math.min(10, parseInt(concurrent, 10) || 1));
  }
  
  // Auto Reconnect
  const autoReconnect = await question(`Auto Reconnect (y/n) [${config.connection.autoReconnect ? 'y' : 'n'}]: `);
  if (autoReconnect.trim()) {
    config.connection.autoReconnect = autoReconnect.toLowerCase() === 'y';
  }
  
  // Reconnect Delay
  const delay = await question(`Reconnect Delay (ms) [${config.connection.reconnectDelayMs}]: `);
  if (delay.trim()) {
    config.connection.reconnectDelayMs = parseInt(delay, 10) || 5000;
  }
  
  // Primary Recheck Delay
  const primaryDelay = await question(`Primary Recheck Delay (ms) [${config.connection.primaryRecheckDelayMs}]: `);
  if (primaryDelay.trim()) {
    config.connection.primaryRecheckDelayMs = parseInt(primaryDelay, 10) || 60000;
  }
  
  // Retention Days
  const retention = await question(`Data Retention Days [${config.storage.retentionDays}]: `);
  if (retention.trim()) {
    config.storage.retentionDays = parseInt(retention, 10) || 60;
  }
  
  // Watch Numbers
  const watchNumbers = await question(`Watch Numbers (comma-separated) [${config.alerts.watchNumbers.join(', ')}]: `);
  if (watchNumbers.trim()) {
    config.alerts.watchNumbers = watchNumbers
      .split(',')
      .map((n: string) => n.trim())
      .filter((n: string) => n.length > 0);
  }
  
  // Long Call Alert
  const longCall = await question(`Long Call Alert (minutes) [${config.alerts.longCallMinutes}]: `);
  if (longCall.trim()) {
    config.alerts.longCallMinutes = parseInt(longCall, 10) || 30;
  }
  
  // Confirm
  console.log('\n--- Configuration Summary ---');
  console.log(`MiVB IPs: ${config.connection.controllerIps.join(', ')}`);
  console.log(`Port: ${config.connection.port}`);
  console.log(`Concurrent Connections: ${config.connection.concurrentConnections}`);
  console.log(`Auto Reconnect: ${config.connection.autoReconnect}`);
  console.log(`Reconnect Delay: ${config.connection.reconnectDelayMs}ms`);
  console.log(`Primary Recheck: ${config.connection.primaryRecheckDelayMs}ms`);
  console.log(`Retention Days: ${config.storage.retentionDays}`);
  console.log(`Watch Numbers: ${config.alerts.watchNumbers.join(', ') || 'none'}`);
  console.log(`Long Call Alert: ${config.alerts.longCallMinutes} minutes`);
  
  const confirm = await question('\nSave this configuration? (y/n): ');
  
  if (confirm.toLowerCase() === 'y') {
    saveConfig(config);
    console.log('\n✓ Configuration updated successfully!');
    console.log('\nRestart the server to apply changes:');
    console.log('  npm run serve:node');
  } else {
    console.log('\n✗ Configuration changes discarded.');
  }
  
  rl.close();
}

function show(): void {
  console.log('\n=== Current Configuration ===\n');
  
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No configuration file found. Run with "configure" to create one.');
    return;
  }
  
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

function reset(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    const backup = `${CONFIG_FILE}.backup.${Date.now()}`;
    fs.renameSync(CONFIG_FILE, backup);
    console.log(`✓ Configuration backed up to: ${backup}`);
  }
  
  const config = loadConfig();
  saveConfig(config);
  console.log('✓ Configuration reset to defaults.');
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'configure':
  case 'config':
  case 'edit':
    configure().catch(console.error);
    break;
    
  case 'show':
  case 'view':
  case 'cat':
    show();
    break;
    
  case 'reset':
  case 'default':
    reset();
    break;
    
  default:
    console.log(`
SMDR Insight Configuration Utility

Usage:
  tsx scripts/configure.ts configure  - Interactive configuration
  tsx scripts/configure.ts show       - Show current configuration
  tsx scripts/configure.ts reset      - Reset to defaults (backs up current)

Or directly edit: ${CONFIG_FILE}

Example:
  tsx scripts/configure.ts configure
`);
    break;
}
