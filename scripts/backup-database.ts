#!/usr/bin/env node
/**
 * Database Backup Script
 * Creates timestamped backups of the SQLite database
 * Optionally uploads to remote storage (configured via environment)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const CONFIG_DIR = process.env.SMDR_CONFIG_DIR || path.join(process.cwd(), 'config');
const BACKUP_DIR = process.env.SMDR_BACKUP_DIR || path.join(CONFIG_DIR, 'backups');
const DB_PATH = process.env.SMDR_DB_PATH || path.join(CONFIG_DIR, 'smdr-insight.sqlite');
const RETENTION_DAYS = parseInt(process.env.SMDR_BACKUP_RETENTION_DAYS || '30', 10);

interface BackupResult {
  success: boolean;
  backupFile?: string;
  checksum?: string;
  size?: number;
  error?: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getFileHash(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function backupDatabase(): BackupResult {
  try {
    ensureDir(BACKUP_DIR);

    if (!fs.existsSync(DB_PATH)) {
      return {
        success: false,
        error: `Database not found at ${DB_PATH}`
      };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `smdr-backup-${timestamp}.sqlite`);

    // Copy database file
    fs.copyFileSync(DB_PATH, backupFile);

    // Also backup WAL and SHM files if they exist
    const walPath = `${DB_PATH}-wal`;
    const shmPath = `${DB_PATH}-shm`;
    
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${backupFile}-wal`);
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${backupFile}-shm`);
    }

    // Calculate checksum
    const checksum = getFileHash(backupFile);
    fs.writeFileSync(`${backupFile}.sha256`, checksum);

    // Get file size
    const size = fs.statSync(backupFile).size;

    console.log(`[Backup] Created backup: ${backupFile}`);
    console.log(`[Backup] Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[Backup] SHA256: ${checksum}`);

    // Cleanup old backups
    cleanupOldBackups();

    return {
      success: true,
      backupFile,
      checksum,
      size
    };
  } catch (error: any) {
    console.error('[Backup] Failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

function cleanupOldBackups(): void {
  try {
    const files = fs.readdirSync(BACKUP_DIR);
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;

    for (const file of files) {
      if (!file.startsWith('smdr-backup-') || !file.endsWith('.sqlite')) continue;

      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        // Also remove checksum file
        const checksumFile = `${filePath}.sha256`;
        if (fs.existsSync(checksumFile)) {
          fs.unlinkSync(checksumFile);
        }
        deleted++;
        console.log(`[Backup] Deleted old backup: ${file}`);
      }
    }

    if (deleted > 0) {
      console.log(`[Backup] Cleaned up ${deleted} old backup(s)`);
    }
  } catch (error: any) {
    console.error('[Backup] Cleanup failed:', error.message);
  }
}

function restoreBackup(backupFile: string): boolean {
  try {
    if (!fs.existsSync(backupFile)) {
      console.error(`[Restore] Backup file not found: ${backupFile}`);
      return false;
    }

    ensureDir(path.dirname(DB_PATH));

    // Create a backup of current database before restoring
    if (fs.existsSync(DB_PATH)) {
      const preRestoreBackup = path.join(
        BACKUP_DIR,
        `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
      );
      fs.copyFileSync(DB_PATH, preRestoreBackup);
      console.log(`[Restore] Created pre-restore backup: ${preRestoreBackup}`);
    }

    // Restore database
    fs.copyFileSync(backupFile, DB_PATH);

    // Restore WAL and SHM if they exist
    const walBackup = `${backupFile}-wal`;
    const shmBackup = `${backupFile}-shm`;
    
    if (fs.existsSync(walBackup)) {
      fs.copyFileSync(walBackup, `${DB_PATH}-wal`);
    }
    if (fs.existsSync(shmBackup)) {
      fs.copyFileSync(shmBackup, `${DB_PATH}-shm`);
    }

    console.log(`[Restore] Successfully restored from: ${backupFile}`);
    return true;
  } catch (error: any) {
    console.error('[Restore] Failed:', error.message);
    return false;
  }
}

function listBackups(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('[Backup] No backups found');
      return;
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('smdr-backup-') && f.endsWith('.sqlite'))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log('[Backup] No backups found');
      return;
    }

    console.log('\nAvailable Backups:');
    console.log('─'.repeat(70));
    
    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      const checksumFile = `${filePath}.sha256`;
      const checksum = fs.existsSync(checksumFile) 
        ? fs.readFileSync(checksumFile, 'utf8').trim().substring(0, 16)
        : 'N/A';

      console.log(
        `${file.padEnd(35)} | ${(stat.size / 1024 / 1024).toFixed(2)} MB | ${stat.mtime.toISOString().split('T')[0]} | ${checksum}...`
      );
    }
    console.log('─'.repeat(70));
    console.log(`Total: ${files.length} backup(s)\n`);
  } catch (error: any) {
    console.error('[Backup] Failed to list backups:', error.message);
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'backup':
    const result = backupDatabase();
    process.exit(result.success ? 0 : 1);
    break;

  case 'restore':
    const backupFile = args[1];
    if (!backupFile) {
      console.error('[Restore] Usage: tsx scripts/backup-database.ts restore <backup-file>');
      process.exit(1);
    }
    const restored = restoreBackup(backupFile);
    process.exit(restored ? 0 : 1);
    break;

  case 'list':
    listBackups();
    break;

  case 'optimize':
    console.log('[Backup] Optimization is handled by the database service.');
    console.log('[Backup] Use the API endpoint POST /api/maintenance/optimize instead.');
    break;

  default:
    console.log(`
SMDR Database Backup Utility

Usage:
  tsx scripts/backup-database.ts backup   - Create a new backup
  tsx scripts/backup-database.ts restore <file> - Restore from backup
  tsx scripts/backup-database.ts list     - List available backups
  tsx scripts/backup-database.ts optimize - Show optimization instructions

Environment Variables:
  SMDR_CONFIG_DIR          - Configuration directory (default: ./config)
  SMDR_DB_PATH             - Database path (default: <config>/smdr-insight.sqlite)
  SMDR_BACKUP_DIR          - Backup directory (default: <config>/backups)
  SMDR_BACKUP_RETENTION_DAYS - Backup retention in days (default: 30)
`);
    break;
}
