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

interface CreateUserModalProps {
    onClose: () => void;
    onCreate: (username: string, password: string, role: string) => Promise<void>;
}

export function CreateUserModal({ onClose, onCreate }: CreateUserModalProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('user');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof validatePasswordStrength> | null>(null);

    // Update password strength when password changes
    useEffect(() => {
        if (password) {
            setPasswordStrength(validatePasswordStrength(password));
        } else {
            setPasswordStrength(null);
        }
    }, [password]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalizedUsername = username.trim();

        if (!normalizedUsername || !password) {
            setError('Username and password required');
            return;
        }
        if (normalizedUsername.length < 3 || normalizedUsername.length > 50) {
            setError('Username must be 3-50 characters');
            return;
        }
        if (!/^[a-zA-Z0-9_.-]+$/.test(normalizedUsername)) {
            setError('Username can only use letters, numbers, dots, underscores, and hyphens');
            return;
        }
        
        // Check minimum requirements
        const minRequirements = meetsMinimumRequirements(password);
        if (!minRequirements.valid) {
            setError(minRequirements.errors.join('. '));
            return;
        }
        
        // Check strength score (require at least "Fair" = score 2)
        const strength = validatePasswordStrength(password);
        if (strength.score < 2) {
            setError('Password is too weak. Please add more character types or increase length.');
            return;
        }
        
        if (role !== 'admin' && role !== 'user') {
            setError('Invalid access level');
            return;
        }

        try {
            setSubmitting(true);
            setError(null);
            await onCreate(normalizedUsername, password, role);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create user');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="card w-full max-w-md p-6 shadow-2xl scale-in-center overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Create New User</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="p-3 bg-red-900/20 border border-red-700 rounded-xl text-red-400 text-xs font-semibold animate-in slide-in-from-top-2">
                            {error}
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                            Username
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-xl border px-3 py-2.5 text-sm"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            placeholder="e.g. john_doe"
                            maxLength={50}
                            autoFocus
                        />
                        <p className="text-[11px] opacity-55" style={{ color: 'var(--text)' }}>
                            3-50 chars. Allowed: letters, numbers, <code>._-</code>
                        </p>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                            Password
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm pr-10"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                placeholder="6-100 characters"
                                maxLength={100}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100 transition-opacity"
                                style={{ color: 'var(--text)' }}
                            >
                                {showPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                        
                        {/* Password Strength Meter */}
                        {passwordStrength && (
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
                                        {password.length} chars
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
                                
                                {/* Feedback */}
                                {passwordStrength.feedback.length > 0 && passwordStrength.score < 4 && (
                                    <div className="mt-2 p-2 rounded-lg bg-blue-900/20 border border-blue-800">
                                        <p className="text-[10px] font-semibold text-blue-300">💡 Tips to strengthen:</p>
                                        <ul className="mt-1 space-y-0.5">
                                            {passwordStrength.feedback.slice(0, 3).map((tip, i) => (
                                                <li key={i} className="text-[10px] text-blue-200/80">• {tip}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
                            Access Level
                        </label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className="w-full rounded-xl border px-3 py-2.5 text-sm appearance-none"
                            style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                        >
                            <option value="user">Standard User</option>
                            <option value="admin">Administrator</option>
                        </select>
                    </div>

                    <div className="mt-8 flex gap-3">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white transition-all transform active:scale-[0.98]"
                        >
                            {submitting ? 'Creating...' : 'Create Account'}
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
