import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './lib/api';
import { PageId, useAppStore } from './state/appStore';
import logo from './assets/logo.png';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const CallLogPage = lazy(() => import('./pages/CallLogPage').then((m) => ({ default: m.CallLogPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const BillingSettingsPage = lazy(() => import('./pages/BillingSettingsPage').then((m) => ({ default: m.BillingSettingsPage })));
const BillingReportPage = lazy(() => import('./pages/BillingReportPage').then((m) => ({ default: m.BillingReportPage })));
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage })));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage').then((m) => ({ default: m.UserManagementPage })));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const PasswordPolicyPage = lazy(() => import('./pages/PasswordPolicyPage').then((m) => ({ default: m.PasswordPolicyPage })));

const navItems: Array<{ id: PageId; label: string; icon: ReactNode; badge?: string; badgeType?: 'alert' | 'new' }> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <>
        <rect x="1" y="1" width="6" height="6" rx="1.2" />
        <rect x="9" y="1" width="6" height="6" rx="1.2" />
        <rect x="1" y="9" width="6" height="6" rx="1.2" />
        <rect x="9" y="9" width="6" height="6" rx="1.2" />
      </>
    )
  },
  {
    id: 'calls',
    label: 'Call Log',
    icon: <path d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm1 3v1h10V4H3zm0 3v1h10V7H3zm0 3v1h6v-1H3z" />
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <path d="M1 13l3.5-4 2.5 2 3-5L14 9v4H1z" />
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: <path d="M8 1a6 6 0 0 0-6 6c0 3.5-1 4.5-1 4.5h14s-1-1-1-4.5A6 6 0 0 0 8 1zm0 14a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2z" />
  },
  {
    id: 'users',
    label: 'Users',
    icon: <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2 0-6 1-6 3v1h12v-1c0-2-4-3-6-3z" />
  },
  {
    id: 'audit',
    label: 'Audit Log',
    icon: (
      <>
        <path d="M14 11H2V3h12v8zM2 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2z" />
        <circle cx="6" cy="6" r="1" />
        <circle cx="8" cy="6" r="1" />
        <circle cx="10" cy="6" r="1" />
      </>
    )
  },
  {
    id: 'password-policy',
    label: 'Password Policy',
    icon: <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 5c1.5 0 3 .8 3 2v1H5v-1c0-1.2 1.5-2 3-2z" />
  },
  {
    id: 'billing',
    label: 'Billing Config',
    icon: <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.5 10.5h-1v-1h1v1zm0-2.5h-1V4.5h1V9z" />
  },
  {
    id: 'billing-report',
    label: 'Billing Report',
    icon: <path d="M2 1h12v14H2V1zm2 3v1h8V4H4zm0 3v1h8V7H4zm0 3v1h5v-1H4z" />
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: <path d="M14 11H2V3h12v8zM2 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2z" />
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <path d="M6.5.5h3l.4 1.6c.46.19.9.44 1.3.74l1.6-.5 1.5 2.6-1.2 1.2a5.5 5.5 0 0 1 0 1.5l1.2 1.2L12.8 11l-1.6-.5c-.4.3-.84.55-1.3.74l-.4 1.76h-3l-.4-1.76A5.5 5.5 0 0 1 4.8 10.5L3.2 11 1.7 8.4l1.2-1.2a5.5 5.5 0 0 1 0-1.5L1.7 4.5 3.2 1.9l1.6.5c.4-.3.84-.55 1.3-.74L6.5.5zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
  }
];

const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: "Today's overview" },
  calls: { title: 'Call Log', subtitle: '' },
  analytics: { title: 'Analytics', subtitle: 'Volume & correlation insights' },
  alerts: { title: 'Alerts', subtitle: 'Active alerts' },
  users: { title: 'Users', subtitle: 'User management' },
  audit: { title: 'Audit Log', subtitle: 'System activity tracking' },
  'password-policy': { title: 'Password Policy', subtitle: 'Security requirements' },
  billing: { title: 'Billing Config', subtitle: 'Prefix rules & rates' },
  'billing-report': { title: 'Billing Report', subtitle: 'Cost breakdown & trends' },
  diagnostics: { title: 'Diagnostics', subtitle: 'System health & events' },
  settings: { title: 'Settings', subtitle: 'Connection & system config' }
};

function getTodayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(date: Date): { date: string; time: string } {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayNum = date.getDate();
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return {
    date: `${dayName}, ${monthName} ${dayNum}, ${year}`,
    time: `${hours}:${minutes}:${seconds} ${ampm}`
  };
}

function formatDurationShort(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

function AppClock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const dateTime = formatDateTime(currentTime);

  return (
    <div className="topbar-clock" aria-live="polite">
      <div className="topbar-clock-date">{dateTime.date}</div>
      <div className="topbar-clock-time">{dateTime.time}</div>
    </div>
  );
}

function SplashScreen({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#050b1a', color: '#e9f1ff' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>⟳</div>
        <p style={{ marginTop: '16px', fontSize: '14px' }}>{label}</p>
      </div>
    </div>
  );
}

function PageLoadingFallback() {
  return (
    <div className="card" style={{ height: '100%', minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted2)' }}>
      <span className="spin" style={{ marginRight: 8 }}>⟳</span>
      Loading page...
    </div>
  );
}

export default function App() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState<boolean | null>(null);
  const [billingToggleBusy, setBillingToggleBusy] = useState(false);

  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const login = useAppStore((state) => state.login);
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useAppStore((state) => state.initialized);
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const activeController = useAppStore((state) => state.activeController);
  const dashboard = useAppStore((state) => state.dashboard);
  const alerts = useAppStore((state) => state.alerts);
  const toast = useAppStore((state) => state.toast);
  const setToast = useAppStore((state) => state.setToast);

  useEffect(() => {
    if (!toast) return;

    if (toast.type === 'loading') {
      const timeout = window.setTimeout(() => setToast(null), 30000);
      return () => window.clearTimeout(timeout);
    }

    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    void initialize()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [initialize]);

  useEffect(() => {
    let mounted = true;

    const loadCurrentUserRole = async () => {
      if (!isAuthenticated) {
        if (mounted) setCurrentUserRole(null);
        return;
      }
      try {
        const user = await api.getCurrentUser();
        if (mounted) setCurrentUserRole(user?.role ?? null);
      } catch {
        if (mounted) setCurrentUserRole(null);
      }
    };

    void loadCurrentUserRole();
    return () => {
      mounted = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (activePage === 'settings' && currentUserRole && currentUserRole !== 'admin') {
      setActivePage('dashboard');
    }
  }, [activePage, currentUserRole, setActivePage]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [activePage]);

  useEffect(() => {
    let mounted = true;
    const loadBillingEnabled = async () => {
      if (!isAuthenticated) {
        if (mounted) setBillingEnabled(null);
        return;
      }
      try {
        const config = await api.getBillingConfig();
        if (mounted) setBillingEnabled(Boolean(config?.enabled));
      } catch {
        if (mounted) setBillingEnabled(null);
      }
    };
    void loadBillingEnabled();
    return () => {
      mounted = false;
    };
  }, [isAuthenticated, activePage]);

  const toggleBillingEnabled = async () => {
    if (billingEnabled === null || billingToggleBusy) return;
    const next = !billingEnabled;
    setBillingToggleBusy(true);
    setBillingEnabled(next);
    try {
      const config = await api.getBillingConfig();
      const saved = await api.saveBillingConfig({ ...config, enabled: next });
      setBillingEnabled(Boolean(saved?.enabled));
      setToast({ type: 'success', message: `Billing ${next ? 'enabled' : 'disabled'}` });
    } catch {
      setBillingEnabled(!next);
      setToast({ type: 'error', message: 'Failed to update billing state' });
    } finally {
      setBillingToggleBusy(false);
    }
  };

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1100) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const pageNode = useMemo(() => {
    if (activePage === 'dashboard') return <DashboardPage />;
    if (activePage === 'calls') return <CallLogPage />;
    if (activePage === 'analytics') return <AnalyticsPage />;
    if (activePage === 'alerts') return <AlertsPage />;
    if (activePage === 'users') return <UserManagementPage />;
    if (activePage === 'audit') return <AuditLogPage />;
    if (activePage === 'password-policy') return <PasswordPolicyPage />;
    if (activePage === 'settings') return <SettingsPage />;
    if (activePage === 'billing') return <BillingSettingsPage />;
    if (activePage === 'billing-report') return <BillingReportPage />;
    if (activePage === 'diagnostics') return <DiagnosticsPage />;
    return <DashboardPage />;
  }, [activePage]);

  const handleLogin = async () => {
    try {
      const result = await login(loginForm.username, loginForm.password);
      if (!result.success) {
        setError(result.error || 'Invalid username or password');
      }
    } catch {
      setError('Login service error occurred');
    }
  };

  if (!initialized || loading) {
    return <SplashScreen label="Loading SMDR Insight..." />;
  }

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#050b1a' }}>
        <div style={{
          background: '#0d1730',
          border: '1px solid #22345e',
          borderRadius: '14px',
          padding: '32px',
          width: '100%',
          maxWidth: '400px',
          boxShadow: '0 4px 18px rgba(4, 10, 28, 0.28)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <img src={logo} alt="SMDR Insight Logo" style={{ height: '100px', maxWidth: '100%', objectFit: 'contain' }} />
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#e9f1ff', margin: '0 0 8px 0' }}>SMDR Insight</h1>
            <p style={{ fontSize: '13px', color: '#a9b9d8', margin: 0 }}>Web-Based SMDR Analytics</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              aria-label="Username"
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleLogin();
                }
              }}
              placeholder="Username"
              style={{
                width: '100%',
                background: '#101f3f',
                border: '1px solid #22345e',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '14px',
                color: '#e9f1ff',
                outline: 'none'
              }}
            />
            <input
              aria-label="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleLogin();
                }
              }}
              type="password"
              placeholder="Password"
              style={{
                width: '100%',
                background: '#101f3f',
                border: '1px solid #22345e',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '14px',
                color: '#e9f1ff',
                outline: 'none'
              }}
            />
            {error && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>
            )}
            <button
              type="button"
              onClick={() => void handleLogin()}
              style={{
                width: '100%',
                background: '#2484eb',
                border: 'none',
                borderRadius: '10px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#fff',
                cursor: 'pointer',
                marginTop: '8px'
              }}
            >
              Sign In
            </button>
            <p style={{ fontSize: '12px', color: '#5f6e88', textAlign: 'center', margin: '16px 0 0 0' }}>
              Use your configured administrator credentials.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = pageTitles[activePage];
  const currentPageSubtitle =
    activePage === 'alerts'
      ? `${alerts.length} active alert${alerts.length === 1 ? '' : 's'}`
      : activePage === 'calls'
      ? getTodayLocalDate()
      : currentPage.subtitle;

  const statusLabel =
    connectionStatus === 'connected' ? 'Live Stream' : connectionStatus === 'retrying' ? 'Reconnecting...' : 'Disconnected';

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div style={{ padding: '18px 15px 14px', borderBottom: '1px solid var(--border2)', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <img src={logo} alt="SMDR Insight" style={{ height: '70px', maxWidth: '100%', objectFit: 'contain' }} />
          </div>
          <div
            className="app-name"
            style={{
              fontSize: '15px',
              fontWeight: 800,
              letterSpacing: '-0.3px',
              color: '#9fd8ff',
              textShadow: '0 0 4px rgba(56, 189, 248, 0.85), 0 0 10px rgba(56, 189, 248, 0.55), 0 0 18px rgba(14, 165, 233, 0.45)'
            }}
          >
            SMDR Insight
          </div>
          <div
            style={{
              fontSize: '9px',
              color: '#45c9ff',
              textTransform: 'uppercase',
              letterSpacing: '1.2px',
              marginTop: '2px',
              textShadow: '0 0 3px rgba(34, 211, 238, 0.9), 0 0 8px rgba(14, 165, 233, 0.6)'
            }}
          >
            MiVoice Business Edition
          </div>
          {activeController && (
            <div
              className="conn-pill"
              style={{
                marginTop: '12px',
                padding: '6px 12px',
                background: connectionStatus === 'connected'
                  ? 'rgba(38, 182, 127, 0.12)'
                  : connectionStatus === 'retrying'
                  ? 'rgba(245, 158, 11, 0.12)'
                  : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${
                  connectionStatus === 'connected'
                    ? 'rgba(38, 182, 127, 0.3)'
                    : connectionStatus === 'retrying'
                    ? 'rgba(245, 158, 11, 0.3)'
                    : 'rgba(239, 68, 68, 0.3)'
                }`,
                color: connectionStatus === 'connected'
                  ? 'var(--green)'
                  : connectionStatus === 'retrying'
                  ? 'var(--orange)'
                  : 'var(--red)'
              }}
            >
              <span
                className="conn-dot"
                style={{
                  background: connectionStatus === 'connected'
                    ? 'var(--green)'
                    : connectionStatus === 'retrying'
                    ? 'var(--orange)'
                    : 'var(--red)'
                }}
              />
              {activeController}:1752
            </div>
          )}
        </div>

        <div style={{ padding: '16px 12px 8px' }}>
          <div className="sidebar-section-title sidebar-section-title-monitor">
            <span className="sidebar-section-dot" style={{ background: 'var(--brand)' }} />
            Monitor
          </div>
          <nav aria-label="Monitor navigation">
            {navItems.filter((item) => ['dashboard', 'calls', 'analytics', 'alerts'].includes(item.id)).map((item) => (
              <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
            ))}
          </nav>
        </div>

        <div style={{ padding: '16px 12px 8px' }}>
          <div className="sidebar-section-title sidebar-section-title-billing" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="sidebar-section-dot" style={{ background: 'var(--orange)' }} />
            <span>Billing</span>
            <button
              type="button"
              onClick={() => {
                void toggleBillingEnabled();
              }}
              disabled={billingEnabled === null || billingToggleBusy}
              className={`inline-flex h-5 w-10 items-center rounded-full transition ${billingEnabled ? 'bg-brand-600' : 'bg-gray-600'} disabled:opacity-50`}
              style={{ marginLeft: 'auto' }}
              aria-label="Toggle Billing"
            >
              <span className={`h-4 w-4 rounded-full bg-white transition ${billingEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
          <nav aria-label="Billing navigation">
            {navItems.filter((item) => ['billing', 'billing-report'].includes(item.id)).map((item) => (
              <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
            ))}
          </nav>
        </div>

        <div style={{ padding: '16px 12px 8px' }}>
          <div className="sidebar-section-title sidebar-section-title-system">
            <span className="sidebar-section-dot" style={{ background: 'var(--purple)' }} />
            System
          </div>
          <nav aria-label="System navigation">
            {navItems
              .filter((item) => {
                const allowed = ['users', 'audit', 'password-policy', 'diagnostics', ...(currentUserRole === 'admin' ? ['settings'] : [])];
                return allowed.includes(item.id);
              })
              .map((item) => (
                <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
              ))}
          </nav>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div style={{ padding: '11px 15px', borderTop: '1px solid var(--border2)' }}>
            <button
              type="button"
              onClick={async () => {
                await useAppStore.getState().logout();
              }}
              className="logout-button"
            >
              <span>🚪</span>
              Logout
            </button>
          </div>

          <div style={{ padding: '11px 15px', borderTop: '1px solid var(--border2)', fontSize: '10px', color: 'var(--muted2)', lineHeight: 1.6 }}>
            elmertech · Elmer Gaba<br />v2.1.0-web · Node 24.x
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-label="Open navigation menu"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <div className="topbar-title-wrap">
            <span className="ptitle">{currentPage.title}</span>
            <span className="psub">{currentPageSubtitle}</span>
          </div>

          <AppClock />

          <div className="topbar-statuses">
            <div
              className="live-badge"
              style={{
                background: connectionStatus === 'connected'
                  ? 'var(--green-dim)'
                  : connectionStatus === 'retrying'
                  ? 'rgba(245, 158, 11, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${
                  connectionStatus === 'connected'
                    ? 'rgba(38, 182, 127, 0.2)'
                    : connectionStatus === 'retrying'
                    ? 'rgba(245, 158, 11, 0.2)'
                    : 'rgba(239, 68, 68, 0.2)'
                }`,
                color: connectionStatus === 'connected'
                  ? 'var(--green)'
                  : connectionStatus === 'retrying'
                  ? 'var(--orange)'
                  : 'var(--red)'
              }}
            >
              <span
                className="pr"
                style={{
                  background: connectionStatus === 'connected'
                    ? 'var(--green)'
                    : connectionStatus === 'retrying'
                    ? 'var(--orange)'
                    : 'var(--red)'
                }}
              />
              {statusLabel}
            </div>
            <div className="chip">{dashboard.totalCallsToday} calls today</div>
            <div className="chip">{formatDurationShort(dashboard.totalDurationSeconds)} talk time</div>
          </div>
        </header>

        <div className="content page-host">
          <div className="page-transition h-full min-h-0">
            <Suspense fallback={<PageLoadingFallback />}>{pageNode}</Suspense>
          </div>
        </div>

        {toast && (
          <div id="toast" className="show" role="status" aria-live="polite">
            <div className={`tico ${toast.type === 'success' ? 'tsuc' : toast.type === 'error' ? 'terr' : toast.type === 'warning' ? 'twarn' : 'tload'}`}>
              {toast.type === 'loading' ? <span className="spin">⟳</span> : toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : '⚠'}
            </div>
            <div>
              <div className="ttl" id="ttl">{toast.title}</div>
              <div className="tsb" id="tsb">{toast.sub}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function NavItem({ item, active, onClick }: { item: typeof navItems[0]; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nav-item ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {active && <span className="nav-item-active-mark" />}
      <svg className="ni" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        {item.icon}
      </svg>
      <span className="nav-item-label">{item.label}</span>
      {item.badge && <span className={`nbadge ${item.badgeType === 'alert' ? 'nalert' : 'nnew'}`}>{item.badge}</span>}
    </button>
  );
}
