import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { AuditEntry } from '../../../shared/types';

interface UserDetailsModalProps {
    username: string;
    onClose: () => void;
}

interface UserDetails {
    id: number;
    username: string;
    role: string;
    created_at: string;
    last_login?: string;
    account_status: 'active' | 'locked' | 'disabled';
    failed_login_attempts: number;
    login_count: number;
}

function formatDate(value?: string): string {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString();
}

function getStatusBadge(status: string) {
    const styles = {
        active: 'bg-green-900/25 text-green-300 border border-green-800',
        locked: 'bg-red-900/25 text-red-300 border border-red-800',
        disabled: 'bg-gray-800 text-gray-300 border border-gray-700'
    };
    return styles[status as keyof typeof styles] || styles.disabled;
}

function getActionIcon(action: string) {
    const icons: Record<string, string> = {
        'login': '🔑',
        'logout': '🚪',
        'user-create': '👤',
        'user-delete': '🗑️',
        'password-change': '🛡️',
        'config-change': '⚙️',
        'export': '📤',
        'purge': '🧹'
    };
    return icons[action] || '📝';
}

export function UserDetailsModal({ username, onClose }: UserDetailsModalProps) {
    const [user, setUser] = useState<UserDetails | null>(null);
    const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingAudit, setLoadingAudit] = useState(true);
    const modalRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    // Focus management: Focus close button when modal opens
    useEffect(() => {
        closeButtonRef.current?.focus();
        
        // Trap focus within modal
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Tab' && modalRef.current) {
                const focusableElements = modalRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                const firstElement = focusableElements[0] as HTMLElement;
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                if (e.shiftKey && document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                } else if (!e.shiftKey && document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        const loadDetails = async () => {
            try {
                setLoading(true);
                console.log('[UserDetails] Loading details for:', username);
                const details = await api.getUserDetails(username);
                console.log('[UserDetails] Details received:', details);
                setUser(details);
            } catch (error) {
                console.error('[UserDetails] Failed to load user details:', error);
            } finally {
                setLoading(false);
            }
        };

        const loadAudit = async () => {
            try {
                setLoadingAudit(true);
                const history = await api.getUserAuditHistory(username, 10);
                console.log('[UserDetails] Audit history received:', history);
                setAuditHistory(history);
            } catch (error) {
                console.error('[UserDetails] Failed to load audit history:', error);
            } finally {
                setLoadingAudit(false);
            }
        };

        loadDetails();
        loadAudit();
    }, [username]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div ref={modalRef} className="card w-full max-w-2xl p-6 shadow-2xl max-h-[80vh] overflow-auto" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                <div className="flex justify-between items-center mb-6">
                    <h3 id="modal-title" className="text-xl font-bold" style={{ color: 'var(--text)' }}>
                        User Details: {username}
                    </h3>
                    <button ref={closeButtonRef} onClick={onClose} className="text-muted-foreground hover:text-white transition-colors" aria-label="Close modal">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <span className="spin text-3xl">⟳</span>
                        <span className="ml-3 text-sm" style={{ color: 'var(--muted)' }}>Loading...</span>
                    </div>
                ) : user ? (
                    <div className="space-y-6">
                        {/* Account Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
                                <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Username</p>
                                <p className="text-lg font-bold mt-1" style={{ color: 'var(--text)' }}>{user.username}</p>
                            </div>
                            <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
                                <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Role</p>
                                <p className="text-lg font-bold mt-1" style={{ color: 'var(--text)' }}>{user.role}</p>
                            </div>
                            <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
                                <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Account Status</p>
                                <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(user.account_status)}`}>
                                    {user.account_status}
                                </span>
                            </div>
                            <div className="p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
                                <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>User ID</p>
                                <p className="text-lg font-bold mt-1" style={{ color: 'var(--text)' }}>#{user.id}</p>
                            </div>
                        </div>

                        {/* Activity Stats */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                                <p className="text-xs font-semibold opacity-60" style={{ color: 'var(--text)' }}>Total Logins</p>
                                <p className="text-2xl font-bold mt-1" style={{ color: 'var(--brand)' }}>{user.login_count}</p>
                            </div>
                            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                                <p className="text-xs font-semibold opacity-60" style={{ color: 'var(--text)' }}>Failed Attempts</p>
                                <p className={`text-2xl font-bold mt-1 ${user.failed_login_attempts > 0 ? 'text-red-400' : ''}`} style={{ color: 'var(--text)' }}>
                                    {user.failed_login_attempts}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                                <p className="text-xs font-semibold opacity-60" style={{ color: 'var(--text)' }}>Created</p>
                                <p className="text-sm font-bold mt-1" style={{ color: 'var(--text)' }}>{formatDate(user.created_at)}</p>
                            </div>
                        </div>

                        {/* Last Login */}
                        <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                            <p className="text-xs font-semibold opacity-60" style={{ color: 'var(--text)' }}>Last Login</p>
                            <p className="text-lg font-bold mt-1" style={{ color: 'var(--text)' }}>
                                {user.last_login ? formatDate(user.last_login) : 'Never'}
                            </p>
                        </div>

                        {/* Security Info */}
                        {user.failed_login_attempts > 0 && (
                            <div className="p-4 rounded-xl border border-red-800" style={{ background: 'rgba(239,68,68,0.1)' }}>
                                <p className="text-sm font-semibold text-red-400">⚠️ Security Alert</p>
                                <p className="text-xs mt-1 opacity-80" style={{ color: 'var(--text)' }}>
                                    This account has {user.failed_login_attempts} failed login attempt(s).
                                    {user.failed_login_attempts >= 5 && ' Account may be locked.'}
                                </p>
                            </div>
                        )}

                        {/* Recent Activity */}
                        <div>
                            <h4 className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>Recent Activity</h4>
                            <div className="space-y-2 max-h-48 overflow-auto pr-2 custom-scrollbar">
                                {loadingAudit ? (
                                    <div className="flex items-center justify-center py-8">
                                        <span className="spin text-2xl">⟳</span>
                                    </div>
                                ) : auditHistory.length === 0 ? (
                                    <p className="text-xs text-center py-8 opacity-40" style={{ color: 'var(--text)' }}>No recent activity</p>
                                ) : (
                                    auditHistory.map((entry) => (
                                        <div key={entry.id} className="p-3 rounded-xl border flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm" style={{ background: 'var(--surface-alt)' }}>
                                                {getActionIcon(entry.action)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                                                    {entry.action.replace(/-/g, ' ')}
                                                </p>
                                                <p className="text-[10px] opacity-60" style={{ color: 'var(--text)' }}>
                                                    {formatDate(entry.createdAt)}
                                                    {entry.ipAddress && ` • ${entry.ipAddress}`}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>Failed to load user details</p>
                    </div>
                )}

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded-2xl border px-6 py-2.5 text-sm font-bold transition-all hover:bg-white/5"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
