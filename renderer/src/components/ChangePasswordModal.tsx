import { useState, useEffect } from 'react';
import { validatePasswordStrength, meetsMinimumRequirements, getStrengthColorClass, getStrengthTextClass } from '../../../shared/utils/passwordStrength';

const MIN_LENGTH = 8;

// Helper component for requirement checklist
function RequirementCheck({ label, met }: { label: string; met: boolean }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className={`text-[10px] ${met ? 'text-green-400' : 'text-gray-500'}`}>
                {met ? '✓' : '○'}
            </span>
            <span className={`text-[10px] ${met ? 'text-green-300' : 'text-gray-500'}`}>
                {label}
            </span>
        </div>
    );
}

interface ChangePasswordModalProps {
    username: string;
    isAdmin: boolean;
    onClose: () => void;
    onChange: (username: string, newPassword: string, oldPassword?: string) => Promise<void>;
}

export function ChangePasswordModal({ username, isAdmin, onClose, onChange }: ChangePasswordModalProps) {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof validatePasswordStrength> | null>(null);

    // Update password strength when new password changes
    useEffect(() => {
        if (newPassword) {
            setPasswordStrength(validatePasswordStrength(newPassword));
        } else {
            setPasswordStrength(null);
        }
    }, [newPassword]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPassword) {
            setError('New password required');
            return;
        }
        
        // Check minimum requirements
        const minRequirements = meetsMinimumRequirements(newPassword);
        if (!minRequirements.valid) {
            setError(minRequirements.errors.join('. '));
            return;
        }
        
        // Check strength score (require at least "Fair" = score 2)
        const strength = validatePasswordStrength(newPassword);
        if (strength.score < 2) {
            setError('Password is too weak. Please add more character types or increase length.');
            return;
        }
        
        if (newPassword.length < 6 || newPassword.length > 100) {
            setError('Password must be 6-100 characters');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (!isAdmin && !oldPassword) {
            setError('Current password required');
            return;
        }

        try {
            setSubmitting(true);
            setError(null);
            await onChange(username, newPassword, oldPassword || undefined);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="card w-full max-w-md p-6 shadow-2xl scale-in-center overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
                        Change Password
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <p className="mb-4 text-sm text-muted-foreground">
                    Updating password for <span className="text-brand-400 font-bold">{username}</span>
                    {isAdmin && <span className="ml-2 px-2 py-0.5 bg-brand-900/30 text-brand-300 rounded text-[10px] uppercase font-bold border border-brand-800">Admin Override</span>}
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="p-3 bg-red-900/20 border border-red-700 rounded-xl text-red-400 text-xs font-semibold animate-in slide-in-from-top-2">
                            {error}
                        </div>
                    )}

                    {!isAdmin && (
                        <div className="space-y-1">
                            <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                                Current Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showOldPassword ? 'text' : 'password'}
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    className="w-full rounded-xl border px-3 py-2.5 text-sm pr-10"
                                    style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                    placeholder="Enter current password"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowOldPassword(!showOldPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100 transition-opacity"
                                    style={{ color: 'var(--text)' }}
                                >
                                    {showOldPassword ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                            New Password
                        </label>
                        <div className="relative">
                            <input
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm pr-10"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                placeholder="6-100 characters"
                                maxLength={100}
                                autoFocus={isAdmin}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100 transition-opacity"
                                style={{ color: 'var(--text)' }}
                            >
                                {showNewPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                        
                        {/* Password Strength Meter */}
                        {newPassword && passwordStrength && (
                            <div className="mt-3 space-y-2">
                                {/* Strength Bar */}
                                <div className="flex gap-1">
                                    {[0, 1, 2, 3].map((index) => (
                                        <div
                                            key={index}
                                            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                                index < passwordStrength.score
                                                    ? getStrengthColorClass(passwordStrength.color)
                                                    : 'bg-gray-700'
                                            }`}
                                        />
                                    ))}
                                </div>
                                
                                {/* Strength Label */}
                                <div className="flex items-center justify-between">
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${getStrengthTextClass(passwordStrength.color)}`}>
                                        {passwordStrength.label}
                                    </span>
                                    <span className="text-[10px] opacity-50" style={{ color: 'var(--text)' }}>
                                        {newPassword.length} chars
                                    </span>
                                </div>
                                
                                {/* Requirements Checklist */}
                                <div className="grid grid-cols-2 gap-1 mt-2">
                                    <RequirementCheck
                                        label={`${MIN_LENGTH}+ characters`}
                                        met={passwordStrength.checks.hasMinLength}
                                    />
                                    <RequirementCheck label="Uppercase (A-Z)" met={passwordStrength.checks.hasUppercase} />
                                    <RequirementCheck label="Lowercase (a-z)" met={passwordStrength.checks.hasLowercase} />
                                    <RequirementCheck label="Numbers (0-9)" met={passwordStrength.checks.hasNumber} />
                                    <RequirementCheck label="Special (!@#...)" met={passwordStrength.checks.hasSpecial} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                            Confirm New Password
                        </label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-xl border px-3 py-2.5 text-sm"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            placeholder="Re-enter new password"
                        />
                    </div>

                    <div className="mt-8 flex gap-3">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white transition-all transform active:scale-[0.98]"
                        >
                            {submitting ? 'Updating...' : 'Update Password'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold transition-all hover:bg-white/5 active:scale-[0.98]"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
