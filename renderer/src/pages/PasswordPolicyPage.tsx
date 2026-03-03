import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
  expirationDays: number;
  preventReuse: number;
}

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecial: false,
  expirationDays: 0, // No expiration
  preventReuse: 0 // Don't prevent reuse
};

export function PasswordPolicyPage() {
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadPolicy();
  }, []);

  const loadPolicy = async () => {
    try {
      setLoading(true);
      // Try to load from localStorage (simulated - in production this would be from API)
      const stored = localStorage.getItem('passwordPolicy');
      if (stored) {
        setPolicy(JSON.parse(stored));
      } else {
        setPolicy(DEFAULT_POLICY);
      }
    } catch (error) {
      console.error('Failed to load password policy:', error);
    } finally {
      setLoading(false);
    }
  };

  const savePolicy = async () => {
    try {
      setSaving(true);
      // Save to localStorage (simulated - in production this would be API call)
      localStorage.setItem('passwordPolicy', JSON.stringify(policy));
      setMessage({ type: 'success', text: 'Password policy saved successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save password policy' });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setPolicy(DEFAULT_POLICY);
    setMessage({ type: 'success', text: 'Policy reset to defaults' });
    setTimeout(() => setMessage(null), 3000);
  };

  if (loading) {
    return (
      <div className="card p-8">
        <div className="flex items-center justify-center">
          <span className="spin text-3xl" style={{ color: 'var(--brand)' }}>⟳</span>
          <span className="ml-3 text-sm" style={{ color: 'var(--muted)' }}>Loading policy...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
            Password Policy
          </h1>
          <p className="text-sm opacity-60 mt-1" style={{ color: 'var(--text)' }}>
            Configure password requirements and security settings.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={resetToDefaults}
            className="rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:bg-white/5 transition-all"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={savePolicy}
            disabled={saving}
            className="rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white transition-all"
          >
            {saving ? 'Saving...' : 'Save Policy'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div className={`fixed top-4 right-4 z-[100] p-4 rounded-2xl border shadow-2xl ${
          message.type === 'success'
            ? 'bg-green-900/40 border-green-700 text-green-200'
            : 'bg-red-900/40 border-red-700 text-red-200'
        }`}>
          <p className="text-sm font-bold">{message.text}</p>
        </div>
      )}

      {/* Password Requirements */}
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text)' }}>Password Requirements</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Minimum Length */}
          <div>
            <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text)' }}>
              Minimum Length: {policy.minLength} characters
            </label>
            <input
              type="range"
              min="6"
              max="20"
              value={policy.minLength}
              onChange={(e) => setPolicy({ ...policy, minLength: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: 'var(--brand)' }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--muted)' }}>
              <span>6</span>
              <span>20</span>
            </div>
          </div>

          {/* Password Expiration */}
          <div>
            <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text)' }}>
              Password Expiration: {policy.expirationDays === 0 ? 'Never' : `${policy.expirationDays} days`}
            </label>
            <input
              type="range"
              min="0"
              max="365"
              step="30"
              value={policy.expirationDays}
              onChange={(e) => setPolicy({ ...policy, expirationDays: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: 'var(--brand)' }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--muted)' }}>
              <span>Never</span>
              <span>365 days</span>
            </div>
          </div>
        </div>

        {/* Complexity Requirements */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Complexity Requirements</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
              <input
                type="checkbox"
                checked={policy.requireUppercase}
                onChange={(e) => setPolicy({ ...policy, requireUppercase: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--brand)' }}
              />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Require Uppercase</p>
                <p className="text-xs opacity-60" style={{ color: 'var(--text)' }}>At least one uppercase letter (A-Z)</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
              <input
                type="checkbox"
                checked={policy.requireLowercase}
                onChange={(e) => setPolicy({ ...policy, requireLowercase: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--brand)' }}
              />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Require Lowercase</p>
                <p className="text-xs opacity-60" style={{ color: 'var(--text)' }}>At least one lowercase letter (a-z)</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
              <input
                type="checkbox"
                checked={policy.requireNumbers}
                onChange={(e) => setPolicy({ ...policy, requireNumbers: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--brand)' }}
              />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Require Numbers</p>
                <p className="text-xs opacity-60" style={{ color: 'var(--text)' }}>At least one number (0-9)</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
              <input
                type="checkbox"
                checked={policy.requireSpecial}
                onChange={(e) => setPolicy({ ...policy, requireSpecial: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--brand)' }}
              />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Require Special Characters</p>
                <p className="text-xs opacity-60" style={{ color: 'var(--text)' }}>At least one special character (!@#$...)</p>
              </div>
            </label>
          </div>
        </div>

        {/* Password History */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Password History</h3>
          <div>
            <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text)' }}>
              Prevent Password Reuse: Last {policy.preventReuse === 0 ? 'None' : policy.preventReuse} passwords
            </label>
            <input
              type="range"
              min="0"
              max="12"
              value={policy.preventReuse}
              onChange={(e) => setPolicy({ ...policy, preventReuse: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: 'var(--brand)' }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--muted)' }}>
              <span>Allow reuse</span>
              <span>Last 12 passwords</span>
            </div>
          </div>
        </div>
      </div>

      {/* Policy Summary */}
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text)' }}>Current Policy Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Minimum Length</p>
            <p className="text-2xl font-bold mt-2" style={{ color: 'var(--brand)' }}>{policy.minLength} chars</p>
          </div>
          <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Expiration</p>
            <p className="text-2xl font-bold mt-2" style={{ color: 'var(--green)' }}>{policy.expirationDays === 0 ? 'Never' : `${policy.expirationDays} days`}</p>
          </div>
          <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>History</p>
            <p className="text-2xl font-bold mt-2" style={{ color: 'var(--purple)' }}>{policy.preventReuse === 0 ? 'None' : `Last ${policy.preventReuse}`}</p>
          </div>
        </div>

        <div className="mt-4 p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>Complexity Requirements:</p>
          <div className="flex flex-wrap gap-2">
            {policy.requireUppercase && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(36,132,235,0.15)', color: 'var(--brand)' }}>
                ✓ Uppercase
              </span>
            )}
            {policy.requireLowercase && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(38,182,127,0.15)', color: 'var(--green)' }}>
                ✓ Lowercase
              </span>
            )}
            {policy.requireNumbers && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--orange)' }}>
                ✓ Numbers
              </span>
            )}
            {policy.requireSpecial && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--purple)' }}>
                ✓ Special Characters
              </span>
            )}
            {!policy.requireUppercase && !policy.requireLowercase && !policy.requireNumbers && !policy.requireSpecial && (
              <span className="text-xs opacity-60" style={{ color: 'var(--text)' }}>No complexity requirements</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
