import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { User } from '../../../shared/types';
import { UserTable } from '../components/UserTable';
import { CreateUserModal } from '../components/CreateUserModal';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { UserActivityLog } from '../components/UserActivityLog';

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

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'username' | 'role' | 'created_at' | 'last_login'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await api.getUsers({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        role: roleFilter === 'all' ? 'all' : (roleFilter as 'admin' | 'user'),
        sortBy,
        sortDir
      });
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
      setMessage({ type: 'success', text: `User "${username}" created successfully` });
      if (page !== 1) {
        setPage(1);
      } else {
        await loadUsers();
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to create user';
      setMessage({ type: 'error', text: messageText });
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
    <div className="space-y-6 animate-in fade-in duration-500">
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>User Management</h1>
          <p className="text-sm opacity-60 mt-1" style={{ color: 'var(--text)' }}>Manage system access, roles, and security audit logs.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-2xl bg-brand-600 hover:bg-brand-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-900/20 transition-all transform active:scale-95 flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" /></svg>
          Create New User
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Users Table */}
        <div className="lg:col-span-2 space-y-4">
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
            onDelete={(username) => setUserPendingDelete(username)}
            onChangePassword={openPasswordModal}
          />
        </div>

        {/* Sidebar: Activity Log */}
        <div className="lg:col-span-1">
          <UserActivityLog enabled={currentUser?.role === 'admin'} />
        </div>
      </div>

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
    </div>
  );
}
