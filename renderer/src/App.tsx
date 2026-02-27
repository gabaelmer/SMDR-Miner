import { useEffect, useMemo, useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { CallLogPage } from './pages/CallLogPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AlertsPage } from './pages/AlertsPage';
import { BillingSettingsPage } from './pages/BillingSettingsPage';
import { BillingReportPage } from './pages/BillingReportPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { api } from './lib/api';
import { PageId, useAppStore } from './state/appStore';
import logo from './assets/logo.png';

const navItems: Array<{ id: PageId; label: string; icon: React.ReactNode; badge?: string; badgeType?: 'alert' | 'new' }> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.2"/><rect x="9" y="1" width="6" height="6" rx="1.2"/><rect x="1" y="9" width="6" height="6" rx="1.2"/><rect x="9" y="9" width="6" height="6" rx="1.2"/></svg>
  },
  {
    id: 'calls',
    label: 'Call Log',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm1 3v1h10V4H3zm0 3v1h10V7H3zm0 3v1h6v-1H3z"/></svg>
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 13l3.5-4 2.5 2 3-5L14 9v4H1z"/></svg>
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a6 6 0 0 0-6 6c0 3.5-1 4.5-1 4.5h14s-1-1-1-4.5A6 6 0 0 0 8 1zm0 14a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2z"/></svg>
  },
  {
    id: 'users',
    label: 'Users',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2 0-6 1-6 3v1h12v-1c0-2-4-3-6-3z"/></svg>
  },
  {
    id: 'billing',
    label: 'Billing Config',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.5 10.5h-1v-1h1v1zm0-2.5h-1V4.5h1V9z"/></svg>
  },
  {
    id: 'billing-report',
    label: 'Billing Report',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 1h12v14H2V1zm2 3v1h8V4H4zm0 3v1h8V7H4zm0 3v1h5v-1H4z"/></svg>
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 11H2V3h12v8zM2 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2z"/></svg>
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5.5h3l.4 1.6c.46.19.9.44 1.3.74l1.6-.5 1.5 2.6-1.2 1.2a5.5 5.5 0 0 1 0 1.5l1.2 1.2L12.8 11l-1.6-.5c-.4.3-.84.55-1.3.74l-.4 1.76h-3l-.4-1.76A5.5 5.5 0 0 1 4.8 10.5L3.2 11 1.7 8.4l1.2-1.2a5.5 5.5 0 0 1 0-1.5L1.7 4.5 3.2 1.9l1.6.5c.4-.3.84-.55 1.3-.74L6.5.5zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
  }
];

const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: "Today's overview" },
  calls: { title: 'Call Log', subtitle: new Date().toISOString().split('T')[0] },
  analytics: { title: 'Analytics', subtitle: 'Volume & correlation insights' },
  alerts: { title: 'Alerts', subtitle: 'Active alerts' },
  users: { title: 'Users', subtitle: 'User management' },
  billing: { title: 'Billing Config', subtitle: 'Prefix rules & rates' },
  'billing-report': { title: 'Billing Report', subtitle: 'Cost breakdown & trends' },
  diagnostics: { title: 'Diagnostics', subtitle: 'System health & events' },
  settings: { title: 'Settings', subtitle: 'Connection & system config' }
};

export default function App() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

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

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format date and time
  const formatDateTime = (date: Date) => {
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
    hours = hours ? hours : 12; // 0 should be 12
    
    return {
      date: `${dayName}, ${monthName} ${dayNum}, ${year}`,
      time: `${hours}:${minutes}:${seconds} ${ampm}`
    };
  };

  const dateTime = formatDateTime(currentTime);

  useEffect(() => {
    console.log('[App] Initializing...');
    void initialize().then(() => {
      console.log('[App] Initialization complete');
      setLoading(false);
    }).catch((err) => {
      console.error('[App] Initialization failed:', err);
      setLoading(false);
    });
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

  const pageNode = useMemo(() => {
    console.log('[App] Rendering page:', activePage);
    if (activePage === 'dashboard') return <DashboardPage />;
    if (activePage === 'calls') return <CallLogPage />;
    if (activePage === 'analytics') return <AnalyticsPage />;
    if (activePage === 'alerts') return <AlertsPage />;
    if (activePage === 'users') return <UserManagementPage />;
    if (activePage === 'settings') return <SettingsPage />;
    if (activePage === 'billing') return <BillingSettingsPage />;
    if (activePage === 'billing-report') return <BillingReportPage />;
    if (activePage === 'diagnostics') return <DiagnosticsPage />;
    return <DashboardPage />;
  }, [activePage]);

  const handleLogin = async () => {
    try {
      const ok = await login(loginForm.username, loginForm.password);
      if (!ok) setError('Invalid username or password');
    } catch (loginError) {
      console.error('Login failed', loginError);
      setError('Login service error occurred');
    }
  };

  if (!initialized || loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#050b1a', color: '#e9f1ff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>⟳</div>
          <p style={{ marginTop: '16px', fontSize: '14px' }}>Loading SMDR Insight...</p>
        </div>
      </div>
    );
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
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleLogin();
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
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleLogin();
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
              onClick={handleLogin}
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
      : currentPage.subtitle;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* SIDEBAR */}
      <aside className="sidebar" style={{
        width: '228px',
        flexShrink: 0,
        background: 'linear-gradient(180deg, #0d1a36, #080f22)',
        borderRight: '1px solid var(--border2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Logo Section */}
        <div style={{ padding: '18px 15px 14px', borderBottom: '1px solid var(--border2)', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <img src={logo} alt="SMDR Insight" style={{ height: '70px', maxWidth: '100%', objectFit: 'contain' }} />
          </div>
          <div className="app-name" style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--text)' }}>SMDR Insight</div>
          <div style={{ fontSize: '9px', color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '1.2px', marginTop: '2px' }}>MiVoice Business Edition</div>
          {activeController && (
            <div className="conn-pill" style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '6px', 
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
              borderRadius: '20px', 
              fontSize: '11px', 
              fontWeight: '600',
              color: connectionStatus === 'connected'
                ? 'var(--green)'
                : connectionStatus === 'retrying'
                ? 'var(--orange)'
                : 'var(--red)'
            }}>
              <span className="conn-dot" style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: connectionStatus === 'connected' 
                  ? 'var(--green)' 
                  : connectionStatus === 'retrying'
                  ? 'var(--orange)'
                  : 'var(--red)',
                boxShadow: `0 0 6px ${
                  connectionStatus === 'connected' 
                    ? 'var(--green)' 
                    : connectionStatus === 'retrying'
                    ? 'var(--orange)'
                    : 'var(--red)'
                }`, 
                animation: 'blink 2.2s ease-in-out infinite' 
              }}></span>
              {activeController}:1752
            </div>
          )}
        </div>

        {/* Navigation - Monitor Section */}
        <div style={{ padding: '13px 9px 4px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px', color: 'var(--muted2)', padding: '0 7px', marginBottom: '4px' }}>Monitor</div>
          {navItems.filter(i => ['dashboard', 'calls', 'analytics', 'alerts'].includes(i.id)).map((item) => (
            <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
          ))}
        </div>

        {/* Navigation - Billing Section */}
        <div style={{ padding: '13px 9px 4px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px', color: 'var(--muted2)', padding: '0 7px', marginBottom: '4px' }}>Billing</div>
          {navItems.filter(i => ['billing', 'billing-report'].includes(i.id)).map((item) => (
            <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
          ))}
        </div>

        {/* Navigation - System Section */}
        <div style={{ padding: '13px 9px 4px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px', color: 'var(--muted2)', padding: '0 7px', marginBottom: '4px' }}>System</div>
          {navItems.filter((i) => {
            const allowed = ['users', 'diagnostics', ...(currentUserRole === 'admin' ? ['settings'] : [])];
            return allowed.includes(i.id);
          }).map((item) => (
            <NavItem key={item.id} item={item} active={activePage === item.id} onClick={() => setActivePage(item.id)} />
          ))}
        </div>

        {/* Bottom Section - Logout and Footer */}
        <div style={{ marginTop: 'auto' }}>
          {/* Logout Button */}
          <div style={{ padding: '11px 15px', borderTop: '1px solid var(--border2)' }}>
            <button
              onClick={async () => {
                await useAppStore.getState().logout();
              }}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '12px',
                border: '1px solid #7f1d1d',
                background: 'transparent',
                color: '#f87171',
                fontSize: '13px',
                fontWeight: '600',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.borderColor = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#7f1d1d';
              }}
            >
              <span>🚪</span>
              Logout
            </button>
          </div>

          {/* Footer */}
          <div style={{ padding: '11px 15px', borderTop: '1px solid var(--border2)', fontSize: '10px', color: 'var(--muted2)', lineHeight: 1.6 }}>
            elmertech · Elmer Gaba<br />v2.1.0-web · Node 24.x
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0
      }}>
        {/* TOPBAR */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '9px 18px',
          background: 'rgba(13, 23, 48, 0.85)',
          borderBottom: '1px solid var(--border2)',
          backdropFilter: 'blur(8px)',
          flexShrink: 0
        }}>
          <span className="ptitle" style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '-0.3px' }}>{currentPage.title}</span>
          <span className="psub" style={{ fontSize: '10.5px', color: 'var(--muted2)', marginLeft: '6px' }}>{currentPageSubtitle}</span>
          
          {/* Center Clock */}
          <div style={{ 
            marginLeft: 'auto', 
            marginRight: 'auto',
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px'
          }}>
            <div style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              color: 'var(--text)',
              letterSpacing: '0.5px'
            }}>
              {dateTime.date}
            </div>
            <div style={{ 
              fontSize: '13px', 
              fontWeight: 700, 
              color: 'var(--brand)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '1px'
            }}>
              {dateTime.time}
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="live-badge" style={{
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
            }}>
              <span className="pr" style={{ 
                width: '7px', 
                height: '7px', 
                borderRadius: '50%', 
                background: connectionStatus === 'connected' 
                  ? 'var(--green)' 
                  : connectionStatus === 'retrying'
                  ? 'var(--orange)'
                  : 'var(--red)',
                boxShadow: `0 0 0 0 ${
                  connectionStatus === 'connected' 
                    ? 'rgba(38, 182, 127, 0.4)' 
                    : connectionStatus === 'retrying'
                    ? 'rgba(245, 158, 11, 0.4)'
                    : 'rgba(239, 68, 68, 0.4)'
                }`, 
                animation: 'pulse 1.8s ease-out infinite' 
              }}></span>
              {connectionStatus === 'connected' ? 'Live Stream' : connectionStatus === 'retrying' ? 'Reconnecting...' : 'Disconnected'}
            </div>
            <div className="chip">{dashboard.totalCallsToday} calls today</div>
            <div className="chip">{formatDurationShort(dashboard.totalDurationSeconds)} talk time</div>
          </div>
        </header>

        {/* CONTENT */}
        <div className="content" style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--border2) transparent'
        }}>
          <div className="page-transition">
            {pageNode}
          </div>
        </div>

        {/* TOAST */}
        <div id="toast">
          <div className="tico tload" id="ticon"><span className="spin">⟳</span></div>
          <div>
            <div className="ttl" id="ttl">Processing...</div>
            <div className="tsb" id="tsb">Please wait</div>
          </div>
        </div>
      </main>
    </div>
  );
}

// NavItem Component
function NavItem({ item, active, onClick }: { item: typeof navItems[0]; active: boolean; onClick: () => void }) {
  const [isPressed, setIsPressed] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      className={`nav-item ${active ? 'active' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        borderRadius: '10px',
        cursor: 'pointer',
        color: active ? '#fff' : 'var(--muted)',
        fontSize: '12.5px',
        fontWeight: 600,
        transition: 'all 0.15s ease',
        marginBottom: '2px',
        border: '1px solid',
        borderColor: active ? 'rgba(36, 132, 235, 0.3)' : 'transparent',
        background: active 
          ? 'linear-gradient(135deg, rgba(36, 132, 235, 0.2), rgba(36, 132, 235, 0.1))'
          : 'transparent',
        userSelect: 'none',
        transform: isPressed ? 'scale(0.96)' : 'scale(1)',
        boxShadow: active 
          ? '0 2px 8px rgba(36, 132, 235, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
          : 'none',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Hover effect overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: active 
          ? 'rgba(36, 132, 235, 0.15)' 
          : 'rgba(255, 255, 255, 0.03)',
        opacity: isPressed ? 0.3 : 0,
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none'
      }} />
      
      <svg className="ni" style={{ 
        width: '14px', 
        height: '14px', 
        opacity: active ? 1 : 0.7, 
        flexShrink: 0,
        filter: active ? 'drop-shadow(0 1px 2px rgba(36, 132, 235, 0.3))' : 'none',
        transition: 'transform 0.15s ease, opacity 0.15s ease',
        transform: isPressed ? 'scale(0.9)' : 'scale(1)'
      }} viewBox="0 0 16 16" fill="currentColor">
        {item.icon}
      </svg>
      {item.label}
      {item.badge && (
        <span className={`nbadge ${item.badgeType === 'alert' ? 'nalert' : 'nnew'}`} style={{
          marginLeft: 'auto',
          fontSize: '9px',
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: '20px',
          background: item.badgeType === 'alert' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(38, 182, 127, 0.14)',
          color: item.badgeType === 'alert' ? 'var(--red)' : 'var(--green)',
          transition: 'transform 0.15s ease',
          transform: isPressed ? 'scale(0.95)' : 'scale(1)'
        }}>
          {item.badge}
        </span>
      )}
    </div>
  );
}

// Helper function for short duration format
function formatDurationShort(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}
