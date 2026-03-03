import { useEffect, useState } from 'react';
import { api, AuditEntry } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';

interface ActivityStats {
  totalLogins: number;
  failedLogins: number;
  uniqueUsers: number;
  peakHour: string;
  adminCount: number;
  userCount: number;
}

interface DailyLogins {
  date: string;
  count: number;
  failed: number;
}

interface UserActivity {
  username: string;
  logins: number;
  failedAttempts: number;
}

const COLORS = ['#2484eb', '#26b67f', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function UserActivityDashboard() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [dailyLogins, setDailyLogins] = useState<DailyLogins[]>([]);
  const [userActivity, setUserActivity] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActivityData();
  }, []);

  const loadActivityData = async () => {
    try {
      setLoading(true);

      // Get audit logs for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await api.getAuditLogs({
        startDate: thirtyDaysAgo.toISOString().split('T')[0],
        limit: 10000
      });

      const logs = result.data;

      // Get users for role distribution
      const usersData = await api.getUsers({});
      const adminCount = usersData.items.filter(u => u.role === 'admin').length;
      const userCount = usersData.items.filter(u => u.role === 'user').length;

      // Process login/logout events
      const loginLogs = logs.filter(log => log.action === 'login');
      const logoutLogs = logs.filter(log => log.action === 'logout');

      // Calculate stats
      const statsData = calculateStats(loginLogs, adminCount, userCount);
      setStats(statsData);

      // Calculate daily logins
      const dailyData = calculateDailyLogins(loginLogs);
      setDailyLogins(dailyData);

      // Calculate user activity
      const userData = calculateUserActivity(loginLogs);
      setUserActivity(userData.slice(0, 10)); // Top 10 users
    } catch (error) {
      console.error('Failed to load activity data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (logs: AuditEntry[], adminCount: number, userCount: number): ActivityStats => {
    const failedLogins = logs.filter(log => log.details?.success === false).length;
    const uniqueUsers = new Set(logs.map(log => log.user)).size;

    // Find peak hour
    const hourCounts = new Map<string, number>();
    logs.forEach(log => {
      if (log.createdAt) {
        const hour = new Date(log.createdAt).getHours().toString().padStart(2, '0');
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      }
    });

    let peakHour = '00';
    let maxCount = 0;
    hourCounts.forEach((count, hour) => {
      if (count > maxCount) {
        maxCount = count;
        peakHour = hour;
      }
    });

    return {
      totalLogins: logs.length,
      failedLogins,
      uniqueUsers,
      peakHour: `${peakHour}:00`,
      adminCount,
      userCount
    };
  };

  const calculateDailyLogins = (logs: AuditEntry[]): DailyLogins[] => {
    const dailyMap = new Map<string, { count: number; failed: number }>();

    logs.forEach(log => {
      if (log.createdAt) {
        const date = log.createdAt.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { count: 0, failed: 0 });
        }
        const data = dailyMap.get(date)!;
        data.count++;
        if (log.details?.success === false) {
          data.failed++;
        }
      }
    });

    // Sort by date chronologically (most recent last for chart display)
    return Array.from(dailyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0])) // Sort by ISO date string
      .slice(-30) // Last 30 days
      .map(([date, data]) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: data.count,
        failed: data.failed
      }));
  };

  const calculateUserActivity = (logs: AuditEntry[]): UserActivity[] => {
    const userMap = new Map<string, { logins: number; failedAttempts: number }>();
    
    logs.forEach(log => {
      if (log.user) {
        if (!userMap.has(log.user)) {
          userMap.set(log.user, { logins: 0, failedAttempts: 0 });
        }
        const data = userMap.get(log.user)!;
        data.logins++;
        if (log.details?.success === false) {
          data.failedAttempts++;
        }
      }
    });

    return Array.from(userMap.entries())
      .map(([username, data]) => ({
        username,
        logins: data.logins,
        failedAttempts: data.failedAttempts
      }))
      .sort((a, b) => b.logins - a.logins);
  };

  if (loading) {
    return (
      <div className="card p-8">
        <div className="flex items-center justify-center">
          <span className="spin text-3xl" style={{ color: 'var(--brand)' }}>⟳</span>
          <span className="ml-3 text-sm" style={{ color: 'var(--muted)' }}>Loading activity data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Total Logins (30d)</p>
          <p className="text-2xl font-bold mt-2" style={{ color: 'var(--brand)' }}>{stats?.totalLogins || 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Failed Logins</p>
          <p className="text-2xl font-bold mt-2" style={{ color: 'var(--red)' }}>{stats?.failedLogins || 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Unique Users</p>
          <p className="text-2xl font-bold mt-2" style={{ color: 'var(--green)' }}>{stats?.uniqueUsers || 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>Peak Hour</p>
          <p className="text-2xl font-bold mt-2" style={{ color: 'var(--purple)' }}>{stats?.peakHour || 'N/A'}</p>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Role Distribution */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>Role Distribution</h3>
          <div style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Admins', value: stats?.adminCount || 0 },
                    { name: 'Users', value: stats?.userCount || 0 }
                  ]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                >
                  <Cell fill="#8b5cf6" />
                  <Cell fill="#2484eb" />
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '2px solid',
                    borderColor: '#8b5cf6',
                    borderRadius: '12px',
                    boxShadow: '0 0 20px rgba(139, 92, 246, 0.5), inset 0 0 10px rgba(139, 92, 246, 0.1)'
                  }}
                  itemStyle={{
                    color: '#fff',
                    fontWeight: '700',
                    textShadow: '0 0 8px currentColor'
                  }}
                  labelStyle={{
                    color: '#a78bfa',
                    fontWeight: '600'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Active Users */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>Most Active Users</h3>
          <div className="space-y-2 max-h-[250px] overflow-auto pr-2 custom-scrollbar">
            {userActivity.length === 0 ? (
              <p className="text-xs text-center py-8 opacity-40" style={{ color: 'var(--text)' }}>No activity data</p>
            ) : (
              userActivity.slice(0, 6).map((user, index) => (
                <div key={user.username} className="flex items-center justify-between p-2 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: COLORS[index % COLORS.length], color: '#fff' }}>
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{user.username}</p>
                      <p className="text-[10px] opacity-60" style={{ color: 'var(--text)' }}>
                        {user.failedAttempts > 0 && `${user.failedAttempts} failed`}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs font-bold" style={{ color: 'var(--brand)' }}>{user.logins}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
