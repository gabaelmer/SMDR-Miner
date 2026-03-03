import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AuditEntry } from '../../../shared/types';

interface UserActivityLogProps {
    enabled?: boolean;
}

export function UserActivityLog({ enabled = true }: UserActivityLogProps) {
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLogs = async () => {
        if (!enabled) {
            setLogs([]);
            setError(null);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null);
            const result = await api.getAuditLogs({ limit: 10 });
            if (Array.isArray(result)) {
                setLogs(result as AuditEntry[]);
            } else if (result && Array.isArray((result as { data?: unknown }).data)) {
                setLogs((result as { data: AuditEntry[] }).data);
            } else {
                setLogs([]);
            }
        } catch (err) {
            console.error('Failed to fetch activity logs:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch activity logs');
            setLogs([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchLogs();
    }, [enabled]);

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'login': return '🔑';
            case 'user-create': return '👤';
            case 'user-delete': return '🗑️';
            case 'password-change': return '🛡️';
            default: return '📝';
        }
    };

    return (
        <div className="card p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M9 20V10M18 20V4M6 20v-4" /></svg>
                    Recent Activity
                </h4>
                <button
                    onClick={fetchLogs}
                    disabled={!enabled}
                    className="text-[10px] uppercase tracking-widest font-bold opacity-60 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text)' }}
                >
                    Refresh
                </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col gap-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-12 w-full rounded-lg bg-white/5 animate-pulse" />
                        ))}
                    </div>
                ) : !enabled ? (
                    <p className="text-xs text-center py-8 opacity-40">Admin privileges required to view audit logs</p>
                ) : error ? (
                    <p className="text-xs text-center py-8 opacity-60">{error}</p>
                ) : logs.length === 0 ? (
                    <p className="text-xs text-center py-8 opacity-40">No recent activity</p>
                ) : (
                    logs.map((log) => {
                        const createdUser = typeof log.details?.createdUser === 'string' ? log.details.createdUser : '';
                        const targetUser = typeof log.details?.targetUser === 'string' ? log.details.targetUser : '';
                        return (
                        <div key={log.id} className="group p-2.5 rounded-xl border border-transparent hover:border-brand-900/30 hover:bg-brand-900/5 transition-all">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-sm shadow-inner group-hover:scale-110 transition-transform">
                                    {getActionIcon(log.action)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                                            {log.user || 'system'}
                                        </p>
                                        <span className="text-[10px] whitespace-nowrap opacity-40">
                                            {log.createdAt ? new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                    </div>
                                    <p className="text-[11px] opacity-60 truncate">
                                        {log.action.replace(/-/g, ' ')}
                                        {createdUser && `: ${createdUser}`}
                                        {targetUser && `: ${targetUser}`}
                                    </p>
                                </div>
                            </div>
                        </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
