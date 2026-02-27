// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementPage } from '../../renderer/src/pages/UserManagementPage';

const getUsersMock = vi.fn();
const getCurrentUserMock = vi.fn();
const createUserMock = vi.fn();
const changePasswordMock = vi.fn();
const deleteUserMock = vi.fn();
const getAuditLogsMock = vi.fn();

vi.mock('../../renderer/src/lib/api', () => ({
  api: {
    getUsers: (...args: unknown[]) => getUsersMock(...args),
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    createUser: (...args: unknown[]) => createUserMock(...args),
    changePassword: (...args: unknown[]) => changePasswordMock(...args),
    deleteUser: (...args: unknown[]) => deleteUserMock(...args),
    getAuditLogs: (...args: unknown[]) => getAuditLogsMock(...args)
  }
}));

function makeUser(id: number, username: string, role: 'admin' | 'user' = 'user') {
  return {
    id,
    username,
    role,
    created_at: '2026-02-20T10:00:00.000Z',
    last_login: '2026-02-26T12:30:00.000Z'
  };
}

function hasUsersQuery(partial: Record<string, unknown>): boolean {
  return getUsersMock.mock.calls.some((call) => {
    const arg = call[0] as Record<string, unknown>;
    return Object.entries(partial).every(([key, value]) => arg?.[key] === value);
  });
}

beforeEach(() => {
  getCurrentUserMock.mockResolvedValue({ username: 'admin', role: 'admin' });
  getUsersMock.mockResolvedValue({
    items: [makeUser(1, 'qa_user')],
    total: 40,
    page: 1,
    pageSize: 20
  });
  getAuditLogsMock.mockResolvedValue([]);
  createUserMock.mockResolvedValue({ success: true });
  changePasswordMock.mockResolvedValue({ success: true });
  deleteUserMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UserManagementPage', () => {
  it('shows access message for non-admin users and skips user list loading', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ username: 'regular', role: 'user' });

    render(<UserManagementPage />);

    await waitFor(() =>
      expect(screen.getByText('Admin privileges are required to view and manage users.')).toBeTruthy()
    );
    expect(getUsersMock).not.toHaveBeenCalled();
  });

  it('uses in-app delete confirmation modal before deleting a user', async () => {
    getUsersMock.mockResolvedValue({
      items: [makeUser(7, 'delete_me')],
      total: 1,
      page: 1,
      pageSize: 20
    });

    render(<UserManagementPage />);

    await waitFor(() => expect(screen.getByText('delete_me')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByRole('heading', { name: 'Delete User' })).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(deleteUserMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));
    await waitFor(() => expect(deleteUserMock).toHaveBeenCalledWith('delete_me'));
  });

  it('sends updated role/sort/pagination queries to the users API', async () => {
    render(<UserManagementPage />);

    await waitFor(() => expect(hasUsersQuery({ page: 1, pageSize: 20, role: 'all', sortBy: 'created_at', sortDir: 'desc' })).toBe(true));

    fireEvent.change(screen.getByDisplayValue('All Roles'), { target: { value: 'user' } });
    await waitFor(() => expect(hasUsersQuery({ role: 'user', page: 1 })).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /Username/ }));
    await waitFor(() => expect(hasUsersQuery({ sortBy: 'username', sortDir: 'desc' })).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /Username/ }));
    await waitFor(() => expect(hasUsersQuery({ sortBy: 'username', sortDir: 'asc' })).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(hasUsersQuery({ page: 2 })).toBe(true));
  });
});
