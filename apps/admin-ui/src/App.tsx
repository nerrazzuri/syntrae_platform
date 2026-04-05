import { useEffect, useMemo, useState } from 'react';
import { adminRequest, clearAdminToken, getAdminToken, setAdminToken } from './lib/api';

type ViewKey =
  | 'dashboard'
  | 'workspaces'
  | 'users'
  | 'runs'
  | 'leads'
  | 'connections'
  | 'audit'
  | 'health';

const views: Array<{ key: ViewKey; label: string; short: string; description: string }> = [
  { key: 'dashboard', label: 'Dashboard', short: 'DB', description: 'System overview, volume, and recent activity.' },
  { key: 'workspaces', label: 'Workspaces', short: 'WS', description: 'Subscriptions, brands, membership, and quota controls.' },
  { key: 'users', label: 'Users', short: 'US', description: 'User records, verification state, and account lifecycle.' },
  { key: 'runs', label: 'Runs', short: 'RN', description: 'Automation execution history across brands and installs.' },
  { key: 'leads', label: 'Leads', short: 'LD', description: 'Qualified lead pipeline and source event coverage.' },
  { key: 'connections', label: 'Connections', short: 'CN', description: 'Platform sessions, health, and reconnect status.' },
  { key: 'audit', label: 'Audit', short: 'AU', description: 'Internal admin actions and workspace-level changes.' },
  { key: 'health', label: 'Health', short: 'HL', description: 'Service status, payloads, and internal diagnostics.' },
];

export default function App() {
  const [token, setTokenState] = useState(getAdminToken());
  const [admin, setAdmin] = useState<any>(null);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const currentView = useMemo(() => views.find((item) => item.key === view) ?? views[0], [view]);

  useEffect(() => {
    if (!token) return;
    adminRequest('/auth/me')
      .then((payload) => setAdmin(payload.admin))
      .catch(() => {
        clearAdminToken();
        setTokenState('');
      });
  }, [token]);

  useEffect(() => {
    if (!token || !admin) return;
    void loadView(view);
  }, [view, token, admin]);

  async function loadView(target: ViewKey) {
    setLoading(true);
    setError(null);
    try {
      let payload: unknown = null;
      if (target === 'dashboard') payload = await adminRequest('/dashboard');
      if (target === 'workspaces') payload = await adminRequest(`/workspaces${workspaceQuery ? `?q=${encodeURIComponent(workspaceQuery)}` : ''}`);
      if (target === 'users') payload = await adminRequest(`/users${userQuery ? `?q=${encodeURIComponent(userQuery)}` : ''}`);
      if (target === 'runs') payload = await adminRequest('/runs');
      if (target === 'leads') payload = await adminRequest('/leads');
      if (target === 'connections') payload = await adminRequest('/platform-connections');
      if (target === 'audit') payload = await adminRequest('/audit');
      if (target === 'health') payload = await adminRequest('/system/health');
      setData((prev) => ({ ...prev, [target]: payload }));
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminRequest('/auth/login', {
        method: 'POST',
        headers: {},
        body: JSON.stringify({ email, password }),
      });
      setAdminToken(payload.token);
      setTokenState(payload.token);
      setAdmin(payload.admin);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await adminRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // ignore
    }
    clearAdminToken();
    setTokenState('');
    setAdmin(null);
    setData({});
  }

  const current = data[view];

  if (!token || !admin) {
    return <LoginScreen onLogin={login} loading={loading} error={error} />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <div className="admin-kicker">Internal Control Plane</div>
            <h1>Syntrae Admin</h1>
            <p className="admin-muted">Workspace, billing, automation, and reply operations in one internal panel.</p>
          </div>
        </div>

        <nav className="admin-nav">
          {views.map((item) => (
            <button
              key={item.key}
              className={`admin-nav-item ${view === item.key ? 'active' : ''}`}
              onClick={() => setView(item.key)}
            >
              <span className="nav-badge">{item.short}</span>
              <span className="nav-copy">
                <span className="nav-title">{item.label}</span>
                <span className="nav-description">{item.description}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="admin-account">
          <div className="admin-account-row">
            <div className="admin-avatar">{admin.email?.[0]?.toUpperCase() || 'A'}</div>
            <div>
              <div>{admin.email}</div>
              <div className="admin-muted">{admin.role}</div>
            </div>
          </div>
          <button className="danger-button" onClick={logout}>Log Out</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <div className="admin-kicker">{currentView.label}</div>
            <h2>{currentView.label}</h2>
            <p className="admin-header-copy">{currentView.description}</p>
          </div>
          <div className="topbar-actions">
            {view === 'workspaces' && (
              <>
                <input
                  className="surface-input"
                  placeholder="Search workspace, brand, email"
                  value={workspaceQuery}
                  onChange={(e) => setWorkspaceQuery(e.target.value)}
                />
                <button className="primary-button" onClick={() => loadView('workspaces')}>Search</button>
              </>
            )}
            {view === 'users' && (
              <>
                <input
                  className="surface-input"
                  placeholder="Search user email"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
                <button className="primary-button" onClick={() => loadView('users')}>Search</button>
              </>
            )}
            <div className="header-pill">{admin.role}</div>
            <button className="secondary-button" onClick={() => loadView(view)}>Refresh</button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {loading ? <div className="panel">Loading...</div> : renderView(view, current, loadView)}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin, loading, error }: { onLogin: (email: string, password: string) => Promise<void>; loading: boolean; error: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="login-shell">
      <div className="login-backdrop" aria-hidden="true" />
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void onLogin(email, password);
        }}
      >
        <div className="login-brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="admin-kicker">Internal Only</div>
            <h1>Syntrae Admin</h1>
          </div>
        </div>
        <p className="admin-muted">Separate control plane for workspaces, runs, billing, and operator activity.</p>
        <div className="login-points">
          <span>Workspace controls</span>
          <span>Run visibility</span>
          <span>Audit access</span>
        </div>
        <input className="surface-input" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="surface-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
      </form>
    </div>
  );
}

function renderView(view: ViewKey, payload: any, reload: (view: ViewKey) => Promise<void>) {
  if (!payload) return <div className="panel">No data yet.</div>;

  if (view === 'dashboard') {
    const metrics = payload.metrics || {};
    return (
      <div className="view-stack">
        <div className="dashboard-grid metrics-grid">
          {Object.entries(metrics).map(([key, value]) => (
            <div key={key} className="metric-card">
              <div className="metric-label">{humanizeKey(key)}</div>
              <div className="metric-value">{String(value)}</div>
            </div>
          ))}
        </div>
        <div className="dashboard-grid">
          <Section title="Recent Runs">
            <SimpleTable rows={payload.recent_runs || []} columns={['id', 'status', 'install_id', 'created_at']} />
          </Section>
          <Section title="Recent Workspaces">
            <SimpleTable rows={payload.recent_workspaces || []} columns={['id', 'name', 'status', 'plan_id', 'created_at']} />
          </Section>
        </div>
      </div>
    );
  }

  if (view === 'workspaces') {
    return (
      <Section title="Workspaces">
        <div className="stack">
          {(payload.items || []).map((item: any) => (
            <div key={item.id} className="panel workspace-card">
              <div className="workspace-header">
                <div>
                  <strong>{item.name}</strong>
                  <div className="admin-muted">{item.id}</div>
                </div>
                <div className="pill">{item.status} / {item.plan_id}</div>
              </div>
              <div className="workspace-grid">
                <div>
                  <div className="eyebrow-label">Brands</div>
                  <div>{item.brands?.map((brand: any) => brand.name).join(', ') || 'None'}</div>
                </div>
                <div>
                  <div className="eyebrow-label">Members</div>
                  <div>{item.memberships?.map((membership: any) => membership.user.email).join(', ') || 'None'}</div>
                </div>
                <div>
                  <div className="eyebrow-label">Subscription</div>
                  <div>{item.subscription?.plan_code || 'Manual'} / {item.subscription?.status || item.status}</div>
                </div>
                <div>
                  <div className="eyebrow-label">Counts</div>
                  <div>{formatCounts(item._count)}</div>
                </div>
              </div>
              <div className="action-row">
                <MutationButton label="Reset Daily Automation Quota" action={() => adminRequest(`/workspaces/${item.id}/reset-automation-quota`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />
                {item.status === 'ACTIVE'
                  ? <MutationButton label="Suspend Workspace" kind="danger" action={() => adminRequest(`/workspaces/${item.id}/suspend`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />
                  : <MutationButton label="Activate Workspace" action={() => adminRequest(`/workspaces/${item.id}/activate`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />}
              </div>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (view === 'users') {
    return <Section title="Users"><SimpleTable rows={payload.items || []} columns={['id', 'email', 'status', 'email_verified_at', 'created_at']} /></Section>;
  }
  if (view === 'runs') {
    return <Section title="Automation Runs"><SimpleTable rows={payload.items || []} columns={['id', 'account_id', 'brand_id', 'status', 'install_id', 'created_at']} /></Section>;
  }
  if (view === 'leads') {
    return <Section title="Leads"><SimpleTable rows={payload.items || []} columns={['id', 'platform', 'buyer_stage', 'intent', 'confidence', 'comment_id', 'created_at']} /></Section>;
  }
  if (view === 'connections') {
    return <Section title="Platform Connections"><SimpleTable rows={payload.items || []} columns={['id', 'platform', 'status', 'brand_id', 'workspace_id', 'updated_at']} /></Section>;
  }
  if (view === 'audit') {
    return <Section title="Audit Log"><SimpleTable rows={payload.items || []} columns={['created_at', 'actor_type', 'actor_id', 'action', 'resource', 'workspace_id']} /></Section>;
  }
  if (view === 'health') {
    return (
      <div className="dashboard-grid">
        {Object.entries(payload).map(([key, value]) => (
          <div key={key} className="panel health-card">
            <div className="section-title">{humanizeKey(key)}</div>
            <pre>{JSON.stringify(value, null, 2)}</pre>
          </div>
        ))}
      </div>
    );
  }

  return <div className="panel">Unknown view.</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="section-title">{title}</div>
      {children}
    </section>
  );
}

function MutationButton({ label, action, kind = 'default' }: { label: string; action: () => Promise<void>; kind?: 'default' | 'danger' }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={kind === 'danger' ? 'danger-button' : 'secondary-button'}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await action();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Working...' : label}
    </button>
  );
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) {
    return <div className="empty-state">No records available for this view.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col}>{humanizeKey(col)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id || idx}>
              {columns.map((col) => <td key={col}>{formatCell(row[col])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: any) {
  if (value == null) return '—';
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanizeKey(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCounts(value: Record<string, unknown> | null | undefined) {
  if (!value) return '—';
  return Object.entries(value)
    .map(([key, item]) => `${humanizeKey(key)}: ${String(item)}`)
    .join(' · ');
}
