// ─────────────────────────────────────────────────────────────────────────────
//  backend/billing/BillingConfigManager.ts
//  Persists billing config to <configDir>/billing.json
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { BillingConfig, DEFAULT_BILLING_CONFIG } from '../../shared/types';
import { billingConfigSchema } from '../../shared/validators';
import { billingEngine } from './BillingEngine';

export class BillingConfigManager {
  private readonly configPath: string;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, 'billing.json');
    this.load();
  }

  load(): BillingConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = billingConfigSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          const normalized = this.withRuleIds(parsed.data as BillingConfig);
          billingEngine.updateConfig(normalized);
          console.log(`[Billing] Config loaded from ${this.configPath}`);
          return normalized;
        }

        const invalidPath = `${this.configPath}.invalid-${Date.now()}`;
        fs.renameSync(this.configPath, invalidPath);
        console.error('[Billing] Config validation failed. Moved invalid config to:', invalidPath);
        console.error('[Billing] Validation issues:', parsed.error.errors);
      }
    } catch (err) {
      console.error('[Billing] Failed to load config, using defaults:', err);
    }
    // First run — persist defaults
    const defaults = { ...DEFAULT_BILLING_CONFIG, updatedAt: new Date().toISOString() };
    this.save(defaults);
    return defaults;
  }

  save(config: BillingConfig): void {
    const parsed = billingConfigSchema.safeParse({
      ...config,
      updatedAt: new Date().toISOString()
    });
    if (!parsed.success) {
      throw new Error(`Invalid billing config: ${parsed.error.errors.map((issue) => issue.message).join('; ')}`);
    }

    const updated = this.withRuleIds(parsed.data as BillingConfig);
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });

    const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');

    if (fs.existsSync(this.configPath)) {
      const backupPath = `${this.configPath}.bak`;
      fs.copyFileSync(this.configPath, backupPath);
    }

    fs.renameSync(tempPath, this.configPath);
    billingEngine.updateConfig(updated);
    console.log(`[Billing] Config saved to ${this.configPath}`);
  }

  get(): BillingConfig {
    return billingEngine.getConfig();
  }

  private withRuleIds(config: BillingConfig): BillingConfig {
    return {
      ...config,
      prefixRules: config.prefixRules.map((rule) => ({
        ...rule,
        id: rule.id || `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }))
    };
  }
}
