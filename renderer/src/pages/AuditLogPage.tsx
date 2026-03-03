import { useEffect, useState } from 'react';
import { api, AuditEntry, AuditAction } from '../lib/api';

const ACTION_ICONS: Record<string, string> = {
    'login': '🔑',
    'logout': '🚪',
    'user-create': '👤',
    'user-delete': '🗑️',
    'user-bulk-delete': '🗑️',
    'user-role-change': '🔄',
    'user-bulk-role-change': '🔄',
    'password-change': '🛡️',
    'password-reset': '🛡️',
    'config-change': '⚙️',
    'billing-config-change': '💰',
    'alert-rule-change': '🚨',
    'export': '📤',
    'purge': '🧹',
    'stream-start': '▶️',
    'stream-stop': '⏹️',
    'account-unlocked': '🔓',
    'account-lock': '🔒',
    'account-status-change': '📊'
};

const ACTION_LABELS: Record<string, string> = {
    'login': 'Login',
    'logout': 'Logout',
    'user-create': 'User Created',
    'user-delete': 'User Deleted',
    'user-bulk-delete': 'Bulk User Delete',
    'user-role-change': 'Role Changed',
    'user-bulk-role-change': 'Bulk Role Change',
    'password-change': 'Password Changed',
    'password-reset': 'Password Reset',
    'config-change': 'Config Changed',
    'billing-config-change': 'Billing Config Changed',
    'alert-rule-change': 'Alert Rule Changed',
    'export': 'Data Exported',
    'purge': 'Data Purged',
    'stream-start': 'Stream Started',
    'stream-stop': 'Stream Stopped',
    'account-unlocked': 'Account Unlocked',
    'account-lock': 'Account Locked',
    'account-status-change': 'Account Status Changed'
};

interface AuditLogFilters {
    action?: AuditAction | 'all';
    user?: string;
    startDate?: string;
    endDate?: string;
    ipAddress?: string;
}

export function AuditLogPage() {
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [filters, setFilters] = useState<AuditLogFilters>({
        action: 'all',
        user: '',
        startDate: '',
        endDate: '',
        ipAddress: ''
    });
    const [showFilters, setShowFilters] = useState(false);

    const loadLogs = async () => {
        try {
            setLoading(true);
            const result = await api.getAuditLogs({
                action: filters.action !== 'all' ? filters.action : undefined,
                user: filters.user || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined,
                ipAddress: filters.ipAddress || undefined,
                limit: pageSize,
                offset: (page - 1) * pageSize
            });

            setLogs(result.data);
            setTotal(result.total); // Use actual total from API
        } catch (error) {
            console.error('Failed to load audit logs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLogs();
    }, [page, pageSize, filters]);

    const handleExport = async () => {
        try {
            const result = await api.getAuditLogs({
                action: filters.action !== 'all' ? filters.action : undefined,
                user: filters.user || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined,
                ipAddress: filters.ipAddress || undefined,
                limit: 10000
            });

            // Convert to CSV
            const headers = ['Timestamp', 'Action', 'User', 'IP Address', 'Details'];
            const rows = result.data.map(log => [
                log.createdAt,
                log.action,
                log.user || 'system',
                log.ipAddress || '-',
                log.details ? JSON.stringify(log.details) : '-'
            ]);

            const csv = [headers.join(','), ...rows.map(row => 
                row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
            )].join('\n');

            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export audit logs:', error);
        }
    };

    const clearFilters = () => {
        setFilters({
            action: 'all',
            user: '',
            startDate: '',
            endDate: '',
            ipAddress: ''
        });
        setPage(1);
    };

    return (
        <div className="flex flex-col h-[84vh] p-4 gap-4" style={{ background: 'var(--surface)' }}>
            {/* Header */}
            <div className="flex flex-shrink-0 flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
                        Audit Log
                    </h1>
                    <p className="text-sm opacity-60 mt-1" style={{ color: 'var(--text)' }}>
                        System activity tracking and compliance reporting.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:bg-white/5 transition-all flex items-center gap-2"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                        Filters
                    </button>
                    <button
                        onClick={handleExport}
                        className="rounded-2xl bg-brand-600 hover:bg-brand-500 px-4 py-2.5 text-sm font-bold text-white transition-all flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" x2="12" y1="15" y2="3" />
                        </svg>
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="flex-shrink-0 card p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Action Type</label>
                            <select
                                value={filters.action || 'all'}
                                onChange={(e) => { setFilters({ ...filters, action: e.target.value as any }); setPage(1); }}
                                className="w-full rounded-xl border px-3 py-2 text-sm"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            >
                                <option value="all">All Actions</option>
                                {Object.entries(ACTION_LABELS).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Username</label>
                            <input
                                type="text"
                                value={filters.user || ''}
                                onChange={(e) => { setFilters({ ...filters, user: e.target.value }); setPage(1); }}
                                placeholder="Filter by user..."
                                className="w-full rounded-xl border px-3 py-2 text-sm"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Start Date</label>
                            <input
                                type="date"
                                value={filters.startDate || ''}
                                onChange={(e) => { setFilters({ ...filters, startDate: e.target.value }); setPage(1); }}
                                className="w-full rounded-xl border px-3 py-2 text-sm"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>End Date</label>
                            <input
                                type="date"
                                value={filters.endDate || ''}
                                onChange={(e) => { setFilters({ ...filters, endDate: e.target.value }); setPage(1); }}
                                className="w-full rounded-xl border px-3 py-2 text-sm"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>IP Address</label>
                            <input
                                type="text"
                                value={filters.ipAddress || ''}
                                onChange={(e) => { setFilters({ ...filters, ipAddress: e.target.value }); setPage(1); }}
                                placeholder="Filter by IP..."
                                className="w-full rounded-xl border px-3 py-2 text-sm"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button
                            onClick={clearFilters}
                            className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-white/5 transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                        >
                            Clear All Filters
                        </button>
                    </div>
                </div>
            )}

            {/* Logs Table Card - Scrollable */}
            <div className="flex-1 card overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                        <thead className="sticky top-0" style={{ background: 'var(--surface)', zIndex: 1 }}>
                            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--muted)', width: '180px' }}>Timestamp</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--muted)', width: '200px' }}>Action</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--muted)', width: '120px' }}>User</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--muted)', width: '140px' }}>IP Address</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <span className="spin text-2xl">⟳</span>
                                            <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading audit logs...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center justify-center">
                                            <div className="text-5xl mb-4">📋</div>
                                            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No audit logs found</p>
                                            <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--text)' }}>
                                                {Object.values(filters).some(v => v) ? 'Try adjusting your filters' : 'No system activity recorded yet'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="border-b hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--border)' }}>
                                        <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                                            {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-lg">{ACTION_ICONS[log.action] || '📝'}</span>
                                                <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>
                                                    {ACTION_LABELS[log.action] || log.action}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text)' }}>
                                            {log.user || <span className="opacity-50">system</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                                            {log.ipAddress || <span className="opacity-50">-</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                                            {log.details ? (
                                                <span className="font-mono text-[10px] break-all">
                                                    {JSON.stringify(log.details)}
                                                </span>
                                            ) : (
                                                <span className="opacity-50">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination - Fixed at bottom */}
                {!loading && total > 0 && (
                    <div className="flex-shrink-0 p-3 border-t flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text)' }}>
                                Showing {Math.min((page - 1) * pageSize + 1, total)}-{Math.min(page * pageSize, total)} of {total} log(s)
                            </span>
                            <select
                                value={pageSize}
                                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                className="rounded-xl border px-2 py-1 text-xs"
                                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                            >
                                <option value="20">20 / page</option>
                                <option value="50">50 / page</option>
                                <option value="100">100 / page</option>
                                <option value="200">200 / page</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-40"
                                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                            >
                                Previous
                            </button>
                            <span className="text-xs opacity-70 min-w-[88px] text-center" style={{ color: 'var(--text)' }}>
                                Page {page} of {Math.ceil(total / pageSize)}
                            </span>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={page * pageSize >= total}
                                className="rounded-xl border px-3 py-1 text-xs font-semibold disabled:opacity-40"
                                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
