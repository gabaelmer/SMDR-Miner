#!/usr/bin/env tsx
/**
 * Cleanup duplicate SMDR records from the database
 * Keeps only the record with the highest ID for each unique call
 */

import path from 'node:path';
import Database from 'better-sqlite3';

const configDir = process.env.SMDR_CONFIG_DIR || path.join(process.cwd(), 'config');
const dbPath = path.join(configDir, 'smdr-insight.sqlite');

console.log(`Cleaning up duplicates in: ${dbPath}`);

const db = new Database(dbPath);

// Count before cleanup
const before = db.prepare('SELECT COUNT(*) as count FROM smdr_records').get() as { count: number };
console.log(`Records before cleanup: ${before.count}`);

// Delete duplicates - keep only the record with max ID for each unique call
const result = db.exec(`
  DELETE FROM smdr_records 
  WHERE id NOT IN (
    SELECT MAX(id) 
    FROM smdr_records 
    GROUP BY date, start_time, duration, calling_party, called_party
  )
`);

// Count after cleanup
const after = db.prepare('SELECT COUNT(*) as count FROM smdr_records').get() as { count: number };
console.log(`Records after cleanup: ${after.count}`);
console.log(`Removed: ${before.count - after.count} duplicate records`);

// Run VACUUM to reclaim space
db.exec('VACUUM');
console.log('Database optimized');

db.close();
console.log('Done!');
