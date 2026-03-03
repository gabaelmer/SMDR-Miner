import type { UsersQuery } from '../lib/api';
import { User } from '../../../shared/types';

type UsersSortBy = NonNullable<UsersQuery['sortBy']>;
type UsersSortDir = NonNullable<UsersQuery['sortDir']>;

interface UserTableProps {
    users: User[];
    loading: boolean;
    total: number;
    page: number;
    pageSize: number;
    searchTerm: string;
    roleFilter: string;
    sortBy: UsersSortBy;
    sortDir: UsersSortDir;
    currentUsername?: string;
    selectedUsers: Set<string>;
    onSearchChange: (value: string) => void;
    onRoleFilterChange: (value: string) => void;
    onSortChange: (sortBy: UsersSortBy) => void;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    onToggleSelect: (username: string) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onBulkDelete: () => void;
    onBulkRoleChange: () => void;
    onViewDetails: (username: string) => void;
    onDelete: (username: string) => void;
    onChangePassword: (username: string) => void;
}

function formatDate(value?: string, includeTime: boolean = false): string {
    if (!value) return includeTime ? 'Never' : 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function UserTable({
    users,
    loading,
    total,
    page,
    pageSize,
    searchTerm,
    roleFilter,
    sortBy,
    sortDir,
    currentUsername,
    selectedUsers,
    onSearchChange,
    onRoleFilterChange,
    onSortChange,
    onPageChange,
    onPageSizeChange,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    onBulkDelete,
    onBulkRoleChange,
    onViewDetails,
    onDelete,
    onChangePassword
}: UserTableProps) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const fromRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const toRow = Math.min(page * pageSize, total);

    const renderSortLabel = (column: UsersSortBy, label: string) => {
        const isActive = sortBy === column;
        return (
            <button
                type="button"
                onClick={() => onSortChange(column)}
                className="inline-flex items-center gap-1 hover:opacity-90 transition-opacity"
                style={{ color: 'var(--muted)' }}
            >
                <span>{label}</span>
                <span className="text-[10px]">{isActive ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
            </button>
        );
    };

    return (
        <div className="card overflow-hidden">
            {/* Search and Filter Bar */}
            <div className="p-4 border-b flex flex-wrap gap-3 items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <div className="flex-1 min-w-[200px]">
                    <div
                        className="flex items-center rounded-xl border"
                        style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)' }}
                    >
                        <span className="pointer-events-none flex items-center justify-center w-10 opacity-50" style={{ color: 'var(--muted)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                        </span>
                        <input
                            type="text"
                            placeholder="Search users..."
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="w-full border-0 bg-transparent py-2 pr-3 text-sm focus:outline-none"
                            style={{ color: 'var(--text)', boxShadow: 'none' }}
                        />
                    </div>
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => onRoleFilterChange(e.target.value)}
                    className="rounded-xl border px-3 py-2 text-sm min-w-[120px]"
                    style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                    <option value="all">All Roles</option>
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                </select>
                <select
                    value={String(pageSize)}
                    onChange={(e) => onPageSizeChange(Number(e.target.value))}
                    className="rounded-xl border px-3 py-2 text-sm min-w-[120px]"
                    style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                    <option value="10">10 / page</option>
                    <option value="20">20 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                </select>
            </div>

            {/* Bulk Action Toolbar */}
            {selectedUsers.size > 0 && (
                <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'rgba(36,132,235,0.05)' }} role="alert" aria-live="polite">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text)' }} aria-live="polite">
                        {selectedUsers.size} user(s) selected
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onBulkRoleChange}
                            className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-white/5 transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                            aria-label="Change role for selected users"
                        >
                            Change Role
                        </button>
                        <button
                            type="button"
                            onClick={onBulkDelete}
                            className="rounded-xl bg-rose-900/40 px-3 py-1.5 text-xs font-semibold text-rose-400 border border-rose-700 hover:bg-rose-900/60 transition-colors"
                            aria-label="Delete selected users"
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={onClearSelection}
                            className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-white/5 transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                            aria-label="Clear selection"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                        <th className="text-center px-4 py-3 text-xs font-semibold w-10">
                            <input
                                type="checkbox"
                                checked={users.length > 0 && selectedUsers.size === users.length}
                                onChange={(e) => e.target.checked ? onSelectAll() : onClearSelection()}
                                className="w-4 h-4 rounded"
                                style={{ accentColor: 'var(--brand)' }}
                            />
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold">{renderSortLabel('username', 'Username')}</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold">{renderSortLabel('role', 'Role')}</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold">{renderSortLabel('created_at', 'Created')}</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold">{renderSortLabel('last_login', 'Last Login')}</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        // Skeleton loaders for better perceived performance
                        Array.from({ length: Math.min(pageSize, 5) }).map((_, idx) => (
                            <tr key={idx} className="border-b" style={{ borderColor: 'var(--border)' }}>
                                <td className="px-4 py-3">
                                    <div className="w-4 h-4 rounded bg-gray-700 animate-pulse" />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
                                        <div className="w-24 h-4 rounded bg-gray-700 animate-pulse" />
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="w-16 h-6 rounded-full bg-gray-700 animate-pulse" />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="w-20 h-4 rounded bg-gray-700 animate-pulse" />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="w-24 h-4 rounded bg-gray-700 animate-pulse" />
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <div className="w-20 h-7 rounded bg-gray-700 animate-pulse" />
                                        <div className="w-14 h-7 rounded bg-gray-700 animate-pulse" />
                                    </div>
                                </td>
                            </tr>
                        ))
                    ) : users.length === 0 ? (
                        <tr>
                            <td colSpan={6} className="px-4 py-12 text-center">
                                <div className="flex flex-col items-center justify-center">
                                    <div className="text-5xl mb-4">👥</div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                        {searchTerm || roleFilter !== 'all' ? 'No users match your filters' : 'No users yet'}
                                    </p>
                                    {(!searchTerm && roleFilter === 'all') && (
                                        <>
                                            <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--text)' }}>
                                                Get started by creating your first user
                                            </p>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ) : (
                        users.map((user) => (
                            <tr key={user.id} className="border-b hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--border)' }}>
                                <td className="px-4 py-3 text-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedUsers.has(user.username)}
                                        onChange={() => onToggleSelect(user.username)}
                                        className="w-4 h-4 rounded"
                                        style={{ accentColor: 'var(--brand)' }}
                                        aria-label={`Select ${user.username}`}
                                    />
                                </td>
                                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text)' }}>
                                    {user.username}
                                    {currentUsername === user.username && (
                                        <span className="ml-2 text-[10px] rounded-full border px-1.5 py-0.5 opacity-70" style={{ borderColor: 'var(--border)' }}>
                                            You
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                        user.role === 'admin'
                                            ? 'bg-rose-900/25 text-rose-300 border border-rose-800'
                                            : user.role === 'manager'
                                            ? 'bg-purple-900/25 text-purple-300 border border-purple-800'
                                            : user.role === 'viewer'
                                            ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                            : 'bg-blue-900/25 text-blue-300 border border-blue-800'
                                        }`}>
                                        {user.role}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                                    {formatDate(user.created_at)}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                                    {formatDate(user.last_login, true)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => onViewDetails(user.username)}
                                            className="rounded-lg border px-3 py-1 text-xs font-semibold hover:bg-white/5 transition-colors"
                                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                                            aria-label={`View details for user ${user.username}`}
                                        >
                                            Details
                                        </button>
                                        <button
                                            onClick={() => onChangePassword(user.username)}
                                            className="rounded-lg border px-3 py-1 text-xs font-semibold hover:bg-white/5 transition-colors"
                                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                                            aria-label={`Change password for user ${user.username}`}
                                        >
                                            Password
                                        </button>
                                        {user.username !== currentUsername && (
                                            <button
                                                onClick={() => onDelete(user.username)}
                                                className="rounded-lg bg-rose-900/40 px-3 py-1 text-xs font-semibold text-rose-400 border border-rose-700 hover:bg-rose-900/60 transition-colors"
                                                aria-label={`Delete user ${user.username}`}
                                            >
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>

            <div className="p-3 border-t flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs opacity-60" style={{ color: 'var(--text)' }}>
                    Showing {fromRow}-{toRow} of {total}
                </p>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1 || loading}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                        Previous
                    </button>
                    <span className="text-xs opacity-70 min-w-[88px] text-center" style={{ color: 'var(--text)' }}>
                        Page {page} of {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= totalPages || loading}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
