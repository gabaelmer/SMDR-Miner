import { useEffect, useState } from 'react';
import { api } from '../lib/api';
// import { apiCache, generateCacheKey } from '../lib/cache';
import { User } from '../../../shared/types';
import { UserTable } from '../components/UserTable';
import { CreateUserModal } from '../components/CreateUserModal';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { UserActivityLog } from '../components/UserActivityLog';
import { UserDetailsModal } from '../components/UserDetailsModal';
import { UserActivityDashboard } from '../components/UserActivityDashboard';
import { StatCard } from '../components/StatCard';

export function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userPendingDelete, setUserPendingDelete] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkActionSubmitting, setBulkActionSubmitting] = useState(false);
  const [showBulkRoleModal, setShowBulkRoleModal] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showUserDetailsModal, setShowUserDetailsModal] = useState(false);
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'activity'>('users');

  // Calculate statistics
  const adminsCount = users.filter(u => u.role === 'admin').length;
  const activeToday = 0; // Would need last_login tracking
  const neverLoggedIn = users.filter(u => !u.last_login).length;

  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'username' | 'role' | 'created_at' | 'last_login'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Advanced filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'locked'>('all');
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');
  const [lastLoginAfter, setLastLoginAfter] = useState('');
  const [lastLoginBefore, setLastLoginBefore] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 500);  // Increased from 250ms to 500ms for better performance
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadUsers = async () => {
    try {
      setLoading(true);

      // Temporarily disabled caching for debugging
      /*
      // Generate cache key from current filters
      const cacheKey = generateCacheKey('users', {
        page,
        pageSize,
        search: debouncedSearch,
        role: roleFilter,
        sortBy,
        sortDir,
        status: statusFilter,
        createdAfter,
        createdBefore,
        lastLoginAfter,
        lastLoginBefore
      });

      // Try to get from cache first
      const cachedData = apiCache.get<{ items: User[]; total: number }>(cacheKey);
      if (cachedData) {
        console.log('[UserManagement] Using cached user data');
        setUsers(cachedData.items);
        setTotalUsers(cachedData.total);
        return;
      }
      */

      console.log('[UserManagement] Fetching fresh user data');
      const data = await api.getUsers({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        role: roleFilter === 'all' ? 'all' : (roleFilter as 'admin' | 'user'),
        sortBy,
        sortDir,
        // Advanced filters
        status: statusFilter,
        createdAfter: createdAfter || undefined,
        createdBefore: createdBefore || undefined,
        lastLoginAfter: lastLoginAfter || undefined,
        lastLoginBefore: lastLoginBefore || undefined,
      });

      // Cache the result for 2 minutes (shorter for user management)
      // apiCache.set(cacheKey, { items: data.items, total: data.total }, 2 * 60 * 1000);

      setUsers(data.items);
      setTotalUsers(data.total);
    } catch (error) {
      console.error('Failed to load users:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  const checkCurrentUser = async () => {
    try {
      const user = await api.getCurrentUser();
      setCurrentUser(user);
      if (!user) {
        setMessage({ type: 'error', text: 'Session expired. Please sign in again.' });
      } else if (user.role !== 'admin') {
        setMessage({ type: 'error', text: 'Admin privileges required for User Management' });
      }
    } catch (error) {
      console.error('Failed to get current user info:', error);
      setMessage({ type: 'error', text: 'Failed to verify your session' });
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    void checkCurrentUser();
  }, []);

  useEffect(() => {
    if (!authChecked || currentUser?.role !== 'admin') {
      setLoading(false);
      return;
    }
    void loadUsers();
  }, [authChecked, currentUser?.role, page, pageSize, debouncedSearch, roleFilter, sortBy, sortDir]);

  const handleCreateUser = async (username: string, password: string, role: string) => {
    try {
      await api.createUser(username, password, role);
      const successMessage = `User "${username}" created successfully`;
      setMessage({ type: 'success', text: successMessage });
      setAnnouncement(successMessage);
      
      // Invalidate cache
      // apiCache.clear(); // Temporarily disabled
      
      if (page !== 1) {
        setPage(1);
      } else {
        await loadUsers();
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to create user';
      setMessage({ type: 'error', text: messageText });
      setAnnouncement(messageText);
      throw error;
    }
  };

  const handleChangePassword = async (username: string, newPassword: string, oldPassword?: string) => {
    try {
      await api.changePassword(username, newPassword, oldPassword);
      setMessage({ type: 'success', text: `Password for "${username}" updated` });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to change password';
      setMessage({ type: 'error', text: messageText });
      throw error;
    }
  };

  const handleSortChange = (nextSortBy: 'username' | 'role' | 'created_at' | 'last_login') => {
    if (nextSortBy === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(nextSortBy);
      setSortDir('desc');
    }
    setPage(1);
  };

  const handleDeleteUser = async () => {
    if (!userPendingDelete) return;
    try {
      setDeleteSubmitting(true);
      await api.deleteUser(userPendingDelete);
      setMessage({ type: 'success', text: `User "${userPendingDelete}" deleted` });
      setUserPendingDelete(null);
      
      // Invalidate cache
      // apiCache.clear(); // Temporarily disabled

      if (users.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await loadUsers();
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete user' });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const openPasswordModal = (username: string) => {
    setSelectedUser(username);
    setShowPasswordModal(true);
  };

  const openUserDetails = (username: string) => {
    setSelectedUserForDetails(username);
    setShowUserDetailsModal(true);
  };

  const toggleUserSelection = (username: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedUsers(new Set(users.map(u => u.username)));
  };

  const clearSelection = () => {
    setSelectedUsers(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;
    try {
      setBulkActionSubmitting(true);
      console.log('[BulkDelete] Attempting to delete:', Array.from(selectedUsers));
      const result = await api.bulkDeleteUsers(Array.from(selectedUsers));
      console.log('[BulkDelete] Result:', result);

      if (result.deleted > 0) {
        setMessage({
          type: result.success ? 'success' : 'warning',
          text: `${result.deleted} user(s) deleted successfully` + (result.errors.length > 0 ? ` (${result.errors.length} failed)` : '')
        });
      }
      if (result.errors.length > 0) {
        setMessage({ type: 'error', text: `Failed to delete: ${result.errors.join(', ')}` });
      }
      setSelectedUsers(new Set());
      
      // Invalidate cache
      // apiCache.clear(); // Temporarily disabled
      
      await loadUsers();
    } catch (error) {
      console.error('[BulkDelete] Exception:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Bulk delete failed' });
    } finally {
      setBulkActionSubmitting(false);
      setShowBulkDeleteModal(false);
    }
  };

  const handleBulkRoleChange = async (newRole: 'admin' | 'user') => {
    if (selectedUsers.size === 0) return;
    try {
      setBulkActionSubmitting(true);
      const result = await api.bulkUpdateRole(Array.from(selectedUsers), newRole);
      if (result.updated > 0) {
        setMessage({
          type: result.success ? 'success' : 'warning',
          text: `${result.updated} user(s) updated to ${newRole}` + (result.errors.length > 0 ? ` (${result.errors.length} failed)` : '')
        });
      }
      if (result.errors.length > 0) {
        setMessage({ type: 'error', text: `Failed to update: ${result.errors.join(', ')}` });
      }
      setSelectedUsers(new Set());
      
      // Invalidate cache
      // apiCache.clear(); // Temporarily disabled
      
      await loadUsers();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Bulk role change failed' });
    } finally {
      setBulkActionSubmitting(false);
      setShowBulkRoleModal(false);
    }
  };

  // Keyboard shortcuts for accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Ctrl/Cmd + N: New user
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setShowCreateModal(true);
      }

      // Delete: Bulk delete (when users selected)
      if (e.key === 'Delete' && selectedUsers.size > 0) {
        e.preventDefault();
        setShowBulkDeleteModal(true);
      }

      // Escape: Close modals
      if (e.key === 'Escape') {
        setShowCreateModal(false);
        setShowPasswordModal(false);
        setShowBulkDeleteModal(false);
        setShowBulkRoleModal(false);
        setShowUserDetailsModal(false);
      }

      // Ctrl/Cmd + A: Select all visible users
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedUsers(new Set(users.map(u => u.username)));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedUsers.size, users]);

  if (authChecked && currentUser?.role !== 'admin') {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {message && (
          <div className={`fixed top-4 right-4 z-[100] p-4 rounded-2xl border shadow-2xl flex items-center gap-3 ${message.type === 'success'
              ? 'bg-green-900/40 border-green-700 text-green-200'
              : 'bg-red-900/40 border-red-700 text-red-200'
            }`}>
            <p className="text-sm font-bold">{message.text}</p>
          </div>
        )}
        <div className="card p-8">
          <h2 className="text-xl font-black" style={{ color: 'var(--text)' }}>User Management</h2>
          <p className="mt-2 text-sm opacity-70" style={{ color: 'var(--text)' }}>
            Admin privileges are required to view and manage users.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-4 animate-in fade-in duration-500">
      {/* Screen Reader Announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{ position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0' }}
      >
        {announcement}
      </div>

      {/* Notifications */}
      {message && (
        <div className={`fixed top-4 right-4 z-[100] p-4 rounded-2xl border shadow-2xl flex items-center gap-3 animate-in slide-in-from-right-10 duration-300 ${message.type === 'success'
            ? 'bg-green-900/40 border-green-700 text-green-200'
            : 'bg-red-900/40 border-red-700 text-red-200'
          }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${message.type === 'success' ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
            {message.type === 'success' ? '✓' : '!'}
          </div>
          <div>
            <p className="text-sm font-bold">{message.text}</p>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="ml-2 opacity-50 hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Section */}
      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>User Management</h1>
          <p className="text-sm opacity-60 mt-1" style={{ color: 'var(--text)' }}>Manage system access, roles, and security audit logs.</p>
        </div>
        <div className="flex gap-1 md:justify-self-end">
          <button
            onClick={() => setActiveTab('users')}
            className={`rounded-2xl px-4 py-1.5 text-sm font-semibold capitalize transition ${
              activeTab === 'users' ? 'bg-brand-600 text-white' : 'card border'
            }`}
            style={activeTab === 'users' ? undefined : { borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`rounded-2xl px-4 py-1.5 text-sm font-semibold capitalize transition ${
              activeTab === 'activity' ? 'bg-brand-600 text-white' : 'card border'
            }`}
            style={activeTab === 'activity' ? undefined : { borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Activity Dashboard
          </button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <div className="card p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Advanced Filters</h3>
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="text-xs font-semibold hover:opacity-80 transition-opacity"
            style={{ color: 'var(--brand)' }}
          >
            {showAdvancedFilters ? '▼ Hide' : '▼ Show'}
          </button>
        </div>
        
        {showAdvancedFilters && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Status Filter */}
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Account Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive (30+ days)</option>
                <option value="locked">Locked</option>
              </select>
            </div>
            
            {/* Created Date Range */}
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Created After</label>
              <input
                type="date"
                value={createdAfter}
                onChange={(e) => { setCreatedAfter(e.target.value); setPage(1); }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Created Before</label>
              <input
                type="date"
                value={createdBefore}
                onChange={(e) => { setCreatedBefore(e.target.value); setPage(1); }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            
            {/* Last Login Range */}
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Last Login After</label>
              <input
                type="date"
                value={lastLoginAfter}
                onChange={(e) => { setLastLoginAfter(e.target.value); setPage(1); }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text)' }}>Last Login Before</label>
              <input
                type="date"
                value={lastLoginBefore}
                onChange={(e) => { setLastLoginBefore(e.target.value); setPage(1); }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            
            {/* Clear Filters */}
            <div className="lg:col-span-4 flex justify-end">
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setCreatedAfter('');
                  setCreatedBefore('');
                  setLastLoginAfter('');
                  setLastLoginBefore('');
                  setPage(1);
                }}
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Clear All Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'users' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* User Statistics Cards */}
        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <StatCard label="Total Users" value={totalUsers} color="brand" icon={
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2 0-6 1-6 3v1h12v-1c0-2-4-3-6-3z"/></svg>
            } />
            <StatCard label="Admins" value={adminsCount} color="purple" icon={
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 5c1.5 0 3 .8 3 2v1H5v-1c0-1.2 1.5-2 3-2z"/></svg>
            } />
            <StatCard label="Never Logged In" value={neverLoggedIn} color="orange" icon={
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 5c1.5 0 3 .8 3 2v1H5v-1c0-1.2 1.5-2 3-2z"/></svg>
            } />
            <StatCard label="Active Users" value={totalUsers - neverLoggedIn} color="green" icon={
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 10.5h-1v-1h1v1zm0-2.5h-1V4.5h1V9z"/></svg>
            } />
          </div>
        </div>

        {/* Main Users Table */}
        <div className="lg:col-span-2 space-y-2">
          <UserTable
            users={users}
            loading={loading}
            total={totalUsers}
            page={page}
            pageSize={pageSize}
            searchTerm={searchTerm}
            roleFilter={roleFilter}
            sortBy={sortBy}
            sortDir={sortDir}
            currentUsername={currentUser?.username}
            selectedUsers={selectedUsers}
            onSearchChange={setSearchTerm}
            onRoleFilterChange={(value) => {
              setRoleFilter(value);
              setPage(1);
            }}
            onSortChange={handleSortChange}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            onToggleSelect={toggleUserSelection}
            onSelectAll={selectAllVisible}
            onClearSelection={clearSelection}
            onBulkDelete={() => setShowBulkDeleteModal(true)}
            onBulkRoleChange={() => setShowBulkRoleModal(true)}
            onViewDetails={openUserDetails}
            onDelete={(username) => setUserPendingDelete(username)}
            onChangePassword={openPasswordModal}
            onCreateUser={() => setShowCreateModal(true)}
          />
        </div>

        {/* Sidebar: Activity Log */}
        <div className="lg:col-span-1">
          <UserActivityLog enabled={currentUser?.role === 'admin'} />
        </div>
      </div>
      )}

      {activeTab === 'activity' && (
        <UserActivityDashboard />
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateUser}
        />
      )}

      {showPasswordModal && selectedUser && (
        <ChangePasswordModal
          username={selectedUser}
          isAdmin={currentUser?.role === 'admin' && selectedUser !== currentUser?.username}
          onClose={() => {
            setShowPasswordModal(false);
            setSelectedUser(null);
          }}
          onChange={handleChangePassword}
        />
      )}

      {userPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="card w-full max-w-md p-6 shadow-2xl overflow-hidden">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Delete User</h3>
            <p className="mt-2 text-sm opacity-70" style={{ color: 'var(--text)' }}>
              Delete <span className="font-bold">{userPendingDelete}</span>? This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deleteSubmitting}
                className="flex-1 rounded-2xl bg-rose-700 hover:bg-rose-600 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white transition-all"
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete User'}
              </button>
              <button
                type="button"
                onClick={() => setUserPendingDelete(null)}
                disabled={deleteSubmitting}
                className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold transition-all hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="card w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Bulk Delete Users</h3>
            <p className="mt-2 text-sm opacity-70" style={{ color: 'var(--text)' }}>
              Delete {selectedUsers.size} user(s)? This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkActionSubmitting}
                className="flex-1 rounded-2xl bg-rose-700 hover:bg-rose-600 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white"
              >
                {bulkActionSubmitting ? 'Deleting...' : 'Delete All'}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={bulkActionSubmitting}
                className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Role Change Modal */}
      {showBulkRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="card w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Change Role</h3>
            <p className="mt-2 text-sm opacity-70" style={{ color: 'var(--text)' }}>
              Change role for {selectedUsers.size} user(s) to:
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => handleBulkRoleChange('admin')}
                disabled={bulkActionSubmitting}
                className="flex-1 rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2.5 text-sm font-bold text-white"
              >
                {bulkActionSubmitting ? 'Updating...' : 'Make Admin'}
              </button>
              <button
                type="button"
                onClick={() => handleBulkRoleChange('user')}
                disabled={bulkActionSubmitting}
                className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {bulkActionSubmitting ? 'Updating...' : 'Make User'}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkRoleModal(false)}
                disabled={bulkActionSubmitting}
                className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Details Modal */}
      {showUserDetailsModal && selectedUserForDetails && (
        <UserDetailsModal
          username={selectedUserForDetails}
          onClose={() => {
            setShowUserDetailsModal(false);
            setSelectedUserForDetails(null);
          }}
        />
      )}
    </div>
  );
}
