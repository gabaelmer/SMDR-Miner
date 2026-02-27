import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BillingConfigManager } from '../../backend/billing/BillingConfigManager';
import { DEFAULT_BILLING_CONFIG } from '../../shared/types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smdr-billing-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('BillingConfigManager', () => {
  it('falls back to defaults and quarantines invalid config file', () => {
    const dir = createTempDir();
    const invalidPath = path.join(dir, 'billing.json');
    fs.writeFileSync(
      invalidPath,
      JSON.stringify({
        enabled: true,
        currency: 'BAD-CURRENCY',
        prefixRules: [],
        rates: []
      }),
      'utf-8'
    );

    const manager = new BillingConfigManager(dir);
    const loaded = manager.get();

    expect(loaded.currency).toBe(DEFAULT_BILLING_CONFIG.currency);
    expect(loaded.prefixRules.length).toBeGreaterThan(0);
    const invalidCopies = fs.readdirSync(dir).filter((name) => name.startsWith('billing.json.invalid-'));
    expect(invalidCopies.length).toBe(1);
    expect(fs.existsSync(path.join(dir, 'billing.json'))).toBe(true);
  });

  it('writes backups and validates payloads on save', () => {
    const dir = createTempDir();
    const manager = new BillingConfigManager(dir);
    const first = manager.get();
    manager.save({
      ...first,
      currency: 'USD',
      rates: first.rates.map((rate) => ({ ...rate, currency: 'USD' }))
    });

    const backupPath = path.join(dir, 'billing.json.bak');
    expect(fs.existsSync(backupPath)).toBe(true);

    expect(() =>
      manager.save({
        ...first,
        currency: 'X',
        rates: first.rates.map((rate) => ({ ...rate, currency: 'X' }))
      } as any)
    ).toThrow(/Invalid billing config/);
  });
});
