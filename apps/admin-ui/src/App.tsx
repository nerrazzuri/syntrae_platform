import { useEffect, useMemo, useState } from 'react';
import { adminRequest, clearAdminToken, getAdminToken, setAdminToken } from './lib/api';

type ViewKey =
  | 'dashboard'
  | 'workspaces'
  | 'access'
  | 'runs'
  | 'installs'
  | 'discovery'
  | 'leads'
  | 'ai_audit'
  | 'drafts'
  | 'policy'
  | 'billing'
  | 'alerts'
  | 'health'
  | 'audit'
  | 'taxonomy';

type ViewDef = {
  key: ViewKey;
  label: string;
  short: string;
  description: string;
};

const views: ViewDef[] = [
  { key: 'dashboard', label: 'Dashboard', short: 'DB', description: 'Global system state, tenant health, and incident visibility.' },
  { key: 'workspaces', label: 'Workspaces', short: 'WS', description: 'Multi-tenant control with plan, brand, policy, and usage visibility.' },
  { key: 'access', label: 'Access', short: 'AC', description: 'Users, internal roles, tenant isolation, and permission guardrails.' },
  { key: 'runs', label: 'Run Center', short: 'RN', description: 'Automation lifecycle, failure reasons, artifacts, and intervention controls.' },
  { key: 'installs', label: 'Installs', short: 'IN', description: 'Connected account health, auth state, session freshness, and risk.' },
  { key: 'discovery', label: 'Discovery', short: 'DS', description: 'Capture diagnostics, extraction drift, search yield, and parser health.' },
  { key: 'leads', label: 'Lead Signals', short: 'LD', description: 'Business-value layer with source comment, scores, and downstream status.' },
  { key: 'ai_audit', label: 'AI Audit', short: 'AI', description: 'Intent trace, explanation trail, fallback path, and decision confidence.' },
  { key: 'drafts', label: 'Draft Review', short: 'DR', description: 'Human-in-loop reply review, approvals, send state, and queue aging.' },
  { key: 'policy', label: 'Policy Center', short: 'PL', description: 'Outreach controls, compliance posture, and manual review requirements.' },
  { key: 'billing', label: 'Billing & Usage', short: 'BL', description: 'Plan enforcement, quotas, credits, and overage visibility.' },
  { key: 'alerts', label: 'Alerts', short: 'AL', description: 'Internal notifications for spikes, disconnects, block reasons, and backlog.' },
  { key: 'health', label: 'System Health', short: 'HL', description: 'Service status, environment signals, backlog risk, and observability.' },
  { key: 'audit', label: 'Audit Log', short: 'AU', description: 'Who changed what, where, and when across tenants and system controls.' },
  { key: 'taxonomy', label: 'Taxonomy', short: 'TX', description: 'Intent labels, buyer stages, actions, thresholds, and rule-control surfaces.' },
];

const rolesCatalog = [
  { name: 'Super Admin', scope: 'Global', description: 'Can perform destructive actions, billing changes, tenant suspension, and full ops control.' },
  { name: 'Ops Admin', scope: 'Internal', description: 'Can inspect runs, installs, policies, and health, but should not mutate billing by default.' },
  { name: 'Reviewer', scope: 'Tenant scoped', description: 'Can inspect leads and drafts for assigned tenants and approve or reject human-review queues.' },
  { name: 'Customer Admin', scope: 'Workspace', description: 'Can manage brand settings, policies, and reviewers inside a single tenant boundary.' },
  { name: 'Customer Analyst', scope: 'Workspace', description: 'Read-heavy access for leads, runs, and reporting without destructive permissions.' },
  { name: 'Read-only Auditor', scope: 'Scoped', description: 'Can inspect evidence and audit trails without mutating operational state.' },
];

const taxonomyCatalog = {
  intents: ['PRODUCT_INQUIRY', 'PROBLEM_SOLUTION', 'FIT_SUITABILITY', 'LATENT_PURCHASE', 'POST_PURCHASE_REGRET', 'NOISE', 'UNKNOWN'],
  buyerStages: ['AWARENESS', 'EVALUATING', 'READY'],
  recommendedActions: ['SILENT_CAPTURE', 'RECOMMEND_DM', 'PRIORITY_DM'],
  policyReasons: ['PLAN_LIMIT_REACHED', 'POLICY_BLOCK', 'PLATFORM_SAFETY_RULE', 'CONFIDENCE_THRESHOLD'],
  controlSurfaces: ['Normalization dictionaries', 'Intent thresholds', 'Stopwords and banned phrases', 'Market category mappings', 'Rule overrides'],
};

export default function App() {
  const [token, setTokenState] = useState(getAdminToken());
  const [admin, setAdmin] = useState<any>(null);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [accessQuery, setAccessQuery] = useState('');

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
  }, [token, admin, view]);

  async function loadView(target: ViewKey) {
    setLoading(true);
    setError(null);

    try {
      let payload: unknown = null;

      switch (target) {
        case 'dashboard':
          payload = await loadDashboardBundle();
          break;
        case 'workspaces':
          payload = await adminRequest(`/workspaces${workspaceQuery ? `?q=${encodeURIComponent(workspaceQuery)}` : ''}`);
          break;
        case 'access':
          payload = {
            ...(await adminRequest(`/users${accessQuery ? `?q=${encodeURIComponent(accessQuery)}` : ''}`)),
            roles: rolesCatalog,
          };
          break;
        case 'runs':
          payload = await adminRequest('/runs');
          break;
        case 'installs':
          payload = await adminRequest('/platform-connections');
          break;
        case 'discovery':
          payload = {
            runs: (await adminRequest('/runs')).items || [],
            installs: (await adminRequest('/platform-connections')).items || [],
          };
          break;
        case 'leads':
          payload = await adminRequest('/leads');
          break;
        case 'ai_audit':
          payload = await adminRequest('/leads');
          break;
        case 'drafts':
          payload = await adminRequest('/drafts');
          break;
        case 'policy':
          payload = await adminRequest('/policies');
          break;
        case 'billing':
          payload = await adminRequest('/billing');
          break;
        case 'alerts':
          payload = await loadAlertBundle();
          break;
        case 'health':
          payload = await adminRequest('/system/health');
          break;
        case 'audit':
          payload = await adminRequest('/audit');
          break;
        case 'taxonomy':
          payload = taxonomyCatalog;
          break;
      }

      setData((prev) => ({ ...prev, [target]: payload }));
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboardBundle() {
    const [overview, runs, workspaces, installs, drafts, health, leads, billing] = await Promise.all([
      adminRequest('/dashboard'),
      adminRequest('/runs'),
      adminRequest('/workspaces'),
      adminRequest('/platform-connections'),
      adminRequest('/drafts'),
      adminRequest('/system/health'),
      adminRequest('/leads'),
      adminRequest('/billing'),
    ]);

    return {
      overview,
      runs: runs.items || [],
      workspaces: workspaces.items || [],
      installs: installs.items || [],
      drafts: drafts.items || [],
      health,
      leads: leads.items || [],
      billing: billing.items || [],
    };
  }

  async function loadAlertBundle() {
    const [runs, installs, drafts, billing, audit] = await Promise.all([
      adminRequest('/runs'),
      adminRequest('/platform-connections'),
      adminRequest('/drafts'),
      adminRequest('/billing'),
      adminRequest('/audit'),
    ]);

    return {
      runs: runs.items || [],
      installs: installs.items || [],
      drafts: drafts.items || [],
      billing: billing.items || [],
      audit: audit.items || [],
    };
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
            <p className="admin-muted">Operator-grade control plane for tenant ops, run diagnosis, AI audit, and safe intervention.</p>
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
                  placeholder="Search workspace, brand, or owner email"
                  value={workspaceQuery}
                  onChange={(e) => setWorkspaceQuery(e.target.value)}
                />
                <button className="primary-button" onClick={() => loadView('workspaces')}>Search</button>
              </>
            )}
            {view === 'access' && (
              <>
                <input
                  className="surface-input"
                  placeholder="Search user email"
                  value={accessQuery}
                  onChange={(e) => setAccessQuery(e.target.value)}
                />
                <button className="primary-button" onClick={() => loadView('access')}>Search</button>
              </>
            )}
            <div className="header-pill">{admin.role}</div>
            <button className="secondary-button" onClick={() => loadView(view)}>Refresh</button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {loading ? <div className="panel">Loading...</div> : renderView(view, data[view], loadView)}
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
        onSubmit={(event) => {
          event.preventDefault();
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
        <p className="admin-muted">Use this control plane to inspect tenant state, diagnose runs, review AI decisions, and intervene safely.</p>
        <div className="login-points">
          <span>Tenant-safe operations</span>
          <span>Run diagnostics</span>
          <span>AI decision audit</span>
        </div>
        <input className="surface-input" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="surface-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
      </form>
    </div>
  );
}

function renderView(view: ViewKey, payload: any, reload: (target: ViewKey) => Promise<void>) {
  if (!payload) return <div className="panel">No data yet.</div>;

  switch (view) {
    case 'dashboard':
      return <DashboardView payload={payload} />;
    case 'workspaces':
      return <WorkspacesView payload={payload} reload={reload} />;
    case 'access':
      return <AccessView payload={payload} />;
    case 'runs':
      return <RunsView payload={payload} />;
    case 'installs':
      return <InstallsView payload={payload} />;
    case 'discovery':
      return <DiscoveryView payload={payload} />;
    case 'leads':
      return <LeadsView payload={payload} />;
    case 'ai_audit':
      return <AiAuditView payload={payload} />;
    case 'drafts':
      return <DraftsView payload={payload} />;
    case 'policy':
      return <PolicyView payload={payload} />;
    case 'billing':
      return <BillingView payload={payload} />;
    case 'alerts':
      return <AlertsView payload={payload} />;
    case 'health':
      return <HealthView payload={payload} />;
    case 'audit':
      return <AuditView payload={payload} />;
    case 'taxonomy':
      return <TaxonomyView payload={payload} />;
    default:
      return <div className="panel">Unknown view.</div>;
  }
}

function DashboardView({ payload }: { payload: any }) {
  const overview = payload.overview || {};
  const metrics = overview.metrics || {};
  const runs = payload.runs || [];
  const installs = payload.installs || [];
  const workspaces = payload.workspaces || [];
  const drafts = payload.drafts || [];
  const leads = payload.leads || [];
  const health = payload.health || {};
  const billing = payload.billing || [];

  const runCounts = countBy(runs, (run: any) => run.status || 'UNKNOWN');
  const platformCounts = countBy(runs, (run: any) => normalizePlatform(run.platform));
  const installCounts = countBy(installs, (item: any) => normalizePlatform(item.platform));
  const emission = runs.reduce((acc: { success: number; failed: number }, run: any) => {
    acc.success += statNumber(run.stats, 'comments_emitted_success');
    acc.failed += statNumber(run.stats, 'comments_emitted_failed');
    return acc;
  }, { success: 0, failed: 0 });
  const backlog = drafts.filter((draft: any) => ['DRAFT', 'EDITED'].includes(draft.status)).length;
  const blockedCounters = billing.flatMap((item: any) => (item.usage_counters || []).filter((counter: any) => counter.blocked_at));
  const serviceFailures = Object.entries(health)
    .filter(([, value]) => extractHealthStatus(value) !== 'ok')
    .map(([key, value]) => ({ key, status: extractHealthStatus(value), detail: summarizeHealth(value) }));
  const topTenants = [...workspaces]
    .map((workspace: any) => ({
      workspace,
      score: tenantHealthScore(workspace),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const incidents = [
    ...runs.filter((run: any) => ['FAILED', 'DEGRADED', 'ABORTED'].includes(run.status)).slice(0, 4).map((run: any) => ({
      title: `${run.status} run`,
      detail: `${run.brand?.name || run.brand_id || 'Unknown brand'} · ${normalizePlatform(run.platform)}`,
      meta: run.last_error || summarizeRunStats(run.stats),
      tone: run.status === 'FAILED' ? 'danger' : 'warning',
    })),
    ...installs.filter((item: any) => item.status !== 'CONNECTED' || item.last_error).slice(0, 4).map((item: any) => ({
      title: `${item.status} install`,
      detail: `${item.account?.name || 'Unknown workspace'} · ${normalizePlatform(item.platform)}`,
      meta: item.last_error || item.verification_error || 'Connection requires intervention',
      tone: item.status === 'CONNECTED' ? 'warning' : 'danger',
    })),
  ].slice(0, 6);

  const summaryCards = [
    { label: 'Active workspaces', value: metrics.workspace_count ?? workspaces.filter((item: any) => item.status === 'ACTIVE').length, note: 'Multi-tenant accounts currently enabled' },
    { label: 'Connected installs', value: metrics.active_connection_count ?? installs.filter((item: any) => item.status === 'CONNECTED').length, note: 'Platform sessions healthy and available' },
    { label: 'Runs today', value: runs.length, note: `Completed ${runCounts.COMPLETED || 0} · Degraded ${runCounts.DEGRADED || 0} · Failed ${runCounts.FAILED || 0}` },
    { label: 'Comments captured', value: sumBy(runs, (run: any) => statNumber(run.stats, 'comments_captured')), note: 'Captured comment events across recent runs' },
    { label: 'Leads generated', value: metrics.lead_count ?? leads.length, note: 'Qualified lead objects currently stored' },
    { label: 'Draft backlog', value: backlog, note: `${countBy(drafts, (draft: any) => draft.status).APPROVED || 0} approved · ${countBy(drafts, (draft: any) => draft.status).SENT || 0} sent` },
  ];

  return (
    <div className="view-stack">
      <div className="dashboard-grid metrics-grid">
        {summaryCards.map((item) => (
          <MetricCard key={item.label} label={item.label} value={formatMetric(item.value)} note={item.note} />
        ))}
      </div>

      <div className="dashboard-grid dashboard-primary-grid">
        <Section title="Run Status Distribution">
          <StatusBarGroup items={[
            { label: 'Queued', value: runCounts.PENDING || 0, tone: 'neutral' },
            { label: 'Running', value: runCounts.RUNNING || 0, tone: 'accent' },
            { label: 'Completed', value: runCounts.COMPLETED || 0, tone: 'success' },
            { label: 'Degraded', value: runCounts.DEGRADED || 0, tone: 'warning' },
            { label: 'Failed', value: runCounts.FAILED || 0, tone: 'danger' },
          ]} />
        </Section>

        <Section title="Emission Success Rate">
          <div className="insight-stat">{successRate(emission.success, emission.failed)}%</div>
          <p className="admin-muted">Based on emitted comment events across recent runs.</p>
          <InlineStats items={[
            { label: 'Success', value: formatMetric(emission.success) },
            { label: 'Failed', value: formatMetric(emission.failed) },
            { label: 'Manual review backlog', value: formatMetric(backlog) },
          ]} />
        </Section>

        <Section title="Platform Breakdown">
          <InlineStats items={[
            { label: 'XHS / Rednote runs', value: formatMetric(platformCounts.XIAOHONGSHU || 0) },
            { label: 'TikTok runs', value: formatMetric(platformCounts.TIKTOK || 0) },
            { label: 'Connected XHS installs', value: formatMetric(installCounts.XIAOHONGSHU || 0) },
            { label: 'Connected TikTok installs', value: formatMetric(installCounts.TIKTOK || 0) },
          ]} />
        </Section>

        <Section title="AI Inference Latency">
          <div className="insight-stat muted">Telemetry pending</div>
          <p className="admin-muted">Wire request timing from AI Core into admin telemetry before using this for SLOs.</p>
        </Section>
      </div>

      <div className="dashboard-grid">
        <Section title="Tenant Health Leaderboard">
          <div className="stack">
            {topTenants.map(({ workspace, score }: any) => (
              <div key={workspace.id} className="list-row">
                <div>
                  <strong>{workspace.name}</strong>
                  <div className="admin-muted">{workspace.subscription?.plan_code || workspace.plan_id} · {workspace._count?.brands || 0} brands</div>
                </div>
                <div className="list-row-meta">
                  <span className={`status-badge ${tenantHealthTone(score)}`}>{tenantHealthLabel(score)}</span>
                  <span className="admin-muted">Score {score}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Recent Incidents">
          {incidents.length ? (
            <div className="stack">
              {incidents.map((incident, index) => (
                <div key={`${incident.title}-${index}`} className={`incident-card ${incident.tone}`}>
                  <strong>{incident.title}</strong>
                  <div>{incident.detail}</div>
                  <div className="admin-muted">{incident.meta}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No recent incidents in the current payload window." />
          )}
        </Section>

        <Section title="Alert Summary">
          <InlineStats items={[
            { label: 'Blocked events', value: formatMetric(blockedCounters.length) },
            { label: 'Failing services', value: formatMetric(serviceFailures.length) },
            { label: 'Disconnected installs', value: formatMetric(installs.filter((item: any) => item.status !== 'CONNECTED').length) },
            { label: 'At-risk tenants', value: formatMetric(topTenants.filter((item: any) => item.score < 65).length) },
          ]} />
        </Section>
      </div>
    </div>
  );
}

function WorkspacesView({ payload, reload }: { payload: any; reload: (target: ViewKey) => Promise<void> }) {
  const items = payload.items || [];
  return (
    <Section title="Workspace / Tenant Management">
      <div className="stack">
        {items.map((item: any) => (
          <div key={item.id} className="panel workspace-card">
            <div className="workspace-header">
              <div>
                <strong>{item.name}</strong>
                <div className="admin-muted">{item.id}</div>
              </div>
              <div className="status-pair">
                <span className={`status-badge ${item.status === 'ACTIVE' ? 'success' : 'danger'}`}>{item.status}</span>
                <span className="pill">{item.subscription?.plan_code || item.plan_id}</span>
              </div>
            </div>

            <div className="workspace-grid">
              <DetailCard label="Owner Info" value={item.memberships?.[0]?.user?.email || 'No owner email found'} note={item.memberships?.[0]?.role || 'Membership not assigned'} />
              <DetailCard label="Billing Status" value={item.subscription?.status || 'Manual'} note={item.subscription?.billing_interval || 'No interval'} />
              <DetailCard label="Target Profile" value={item.brands?.[0]?.latest_market_profile?.primary_category || 'Not configured'} note={item.brands?.[0]?.latest_market_profile?.target_audience || 'No active market profile'} />
              <DetailCard label="Last Run" value={item.brands?.[0]?.latest_run?.status || 'No runs'} note={item.brands?.[0]?.latest_run?.started_at ? formatDate(item.brands?.[0]?.latest_run?.started_at) : 'No execution yet'} />
            </div>

            <div className="multi-column two">
              <InfoGroup title="Connected Channels / Installs">
                <TagList items={(item.platform_connections || []).map((connection: any) => `${normalizePlatform(connection.platform)} · ${connection.status}`)} emptyText="No platform connections" />
                <div className="admin-muted small-text">{(item.installs || []).length} install records linked to this tenant.</div>
              </InfoGroup>
              <InfoGroup title="Policy Snapshot">
                <TagList items={item.brands?.map((brand: any) => {
                  const policy = brand.latest_policy;
                  return policy ? `${brand.name}: ${policy.mode} v${policy.version}` : `${brand.name}: No policy`;
                })} emptyText="No brand policies" />
              </InfoGroup>
            </div>

            <div className="multi-column two">
              <InfoGroup title="Brand Profile">
                <TagList items={item.brands?.map((brand: any) => `${brand.name} · ${brand.status}`)} emptyText="No brands" />
              </InfoGroup>
              <InfoGroup title="Daily / Monthly Usage">
                <TagList items={formatUsageCounters(item.usage_counters)} emptyText="No usage counters" />
              </InfoGroup>
            </div>

            <div className="action-row">
              <MutationButton label="Reset Daily Automation Quota" action={() => adminRequest(`/workspaces/${item.id}/reset-automation-quota`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />
              {item.status === 'ACTIVE'
                ? <MutationButton label="Suspend Workspace" kind="danger" action={() => adminRequest(`/workspaces/${item.id}/suspend`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />
                : <MutationButton label="Reactivate Workspace" action={() => adminRequest(`/workspaces/${item.id}/activate`, { method: 'POST', body: JSON.stringify({}) }).then(() => reload('workspaces'))} />}
              <GhostButton label="Force stop active automations" />
              <GhostButton label="Impersonation mode (read-only)" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AccessView({ payload }: { payload: any }) {
  const users = payload.items || [];
  const roles = payload.roles || [];
  return (
    <div className="view-stack">
      <Section title="User / Role / Permission Management">
        <SimpleTable rows={users} columns={['id', 'email', 'status', 'email_verified_at', 'last_login_at', 'created_at']} />
      </Section>

      <Section title="RBAC Guardrails">
        <div className="dashboard-grid">
          {roles.map((role: any) => (
            <div key={role.name} className="panel nested-panel">
              <div className="section-title">{role.name}</div>
              <div className="status-badge neutral">{role.scope}</div>
              <p className="admin-muted">{role.description}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function RunsView({ payload }: { payload: any }) {
  const items = payload.items || [];
  return (
    <Section title="Automation Run Center">
      <div className="stack">
        {items.map((run: any) => (
          <div key={run.id} className="panel run-card">
            <div className="list-row">
              <div>
                <strong>{run.brand?.name || run.brand_id}</strong>
                <div className="admin-muted">{run.id}</div>
              </div>
              <div className="status-pair">
                <span className={`status-badge ${runTone(run.status)}`}>{run.status}</span>
                <span className="pill">{normalizePlatform(run.platform)}</span>
              </div>
            </div>

            <InlineStats items={[
              { label: 'Start', value: formatDate(run.started_at) },
              { label: 'End', value: run.ended_at ? formatDate(run.ended_at) : 'In progress' },
              { label: 'Discovered', value: formatMetric(statNumber(run.stats, 'videos_processed')) },
              { label: 'Comments', value: formatMetric(statNumber(run.stats, 'comments_captured')) },
              { label: 'Emitted', value: `${statNumber(run.stats, 'comments_emitted_success')} / ${statNumber(run.stats, 'comments_emitted_failed')}` },
            ]} />

            <div className="multi-column two">
              <InfoGroup title="Reason Codes">
                <div>{run.last_error || summarizeRunStats(run.stats) || 'No failure reason captured'}</div>
              </InfoGroup>
              <InfoGroup title="Snapshot Used">
                <div>Policy snapshot: {summarizeSnapshot(run.policy_snapshot)}</div>
                <div className="admin-muted">Market profile snapshot: {summarizeSnapshot(run.market_profile_snapshot)}</div>
              </InfoGroup>
            </div>

            <div className="action-row">
              <GhostButton label="Retry run" />
              <GhostButton label="Cancel run" />
              <GhostButton label="Inspect logs" />
              <GhostButton label="Download artifacts" />
              <GhostButton label="Compare previous run" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function InstallsView({ payload }: { payload: any }) {
  const items = payload.items || [];
  return (
    <Section title="Install / Account Connection Management">
      <div className="dashboard-grid">
        {items.map((item: any) => (
          <div key={item.id} className="panel nested-panel">
            <div className="list-row">
              <div>
                <strong>{item.account?.name || 'Unknown workspace'}</strong>
                <div className="admin-muted">{item.brand?.name || item.brand_id}</div>
              </div>
              <span className={`status-badge ${item.status === 'CONNECTED' ? 'success' : item.status === 'PENDING' ? 'warning' : 'danger'}`}>{item.status}</span>
            </div>
            <InlineStats items={[
              { label: 'Platform', value: normalizePlatform(item.platform) },
              { label: 'Last heartbeat', value: item.last_checked_at ? formatDate(item.last_checked_at) : 'No heartbeat' },
              { label: 'Last verified', value: item.last_verified_at ? formatDate(item.last_verified_at) : 'Not verified' },
            ]} />
            <p className="admin-muted">{item.last_error || item.verification_error || 'No connection error recorded.'}</p>
            <TagList items={[
              item.expires_at ? `Expires ${formatDate(item.expires_at)}` : 'No explicit expiry',
              item.provider ? `Provider ${item.provider}` : null,
              item.auth_type ? `Auth ${item.auth_type}` : null,
            ].filter(Boolean) as string[]} emptyText="No metadata" />
            <div className="action-row">
              <GhostButton label="Test connectivity" />
              <GhostButton label="Revalidate secret" />
              <GhostButton label="Rotate install secret" />
              <GhostButton label="Mark compromised" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DiscoveryView({ payload }: { payload: any }) {
  const runs = payload.runs || [];
  const installs = payload.installs || [];
  const emptyResults = runs.filter((run: any) => statNumber(run.stats, 'comments_captured') === 0).length;
  const extractionFailures = runs.filter((run: any) => ['FAILED', 'DEGRADED'].includes(run.status)).length;
  const averageComments = averageOf(runs, (run: any) => statNumber(run.stats, 'comments_captured'));
  const sessionIssues = installs.filter((item: any) => item.status !== 'CONNECTED' || item.last_error).length;

  return (
    <div className="view-stack">
      <div className="dashboard-grid metrics-grid">
        <MetricCard label="Extraction success rate" value={`${successRate(runs.length - extractionFailures, extractionFailures)}%`} note="Run-level proxy for discovery health" />
        <MetricCard label="Average comments / source" value={averageComments.toFixed(1)} note="Based on recent run payloads" />
        <MetricCard label="Empty-result rate" value={`${successRate(emptyResults, runs.length || 1)}%`} note="Runs with zero captured comments" />
        <MetricCard label="Session issues" value={formatMetric(sessionIssues)} note="Disconnected or erroring platform sessions" />
      </div>

      <Section title="Platform Diagnostics">
        <div className="dashboard-grid">
          <InfoGroup title="Search Navigation Failures">
            <TagList items={runs.filter((run: any) => /search|query/i.test(run.last_error || '')).map((run: any) => `${normalizePlatform(run.platform)} · ${run.id}`)} emptyText="No search navigation failures detected" />
          </InfoGroup>
          <InfoGroup title="Session / Login Issues">
            <TagList items={installs.filter((item: any) => /login|session|auth/i.test(`${item.last_error || ''} ${item.verification_error || ''}`)).map((item: any) => `${item.account?.name || item.workspace_id} · ${normalizePlatform(item.platform)}`)} emptyText="No active login failures detected" />
          </InfoGroup>
          <InfoGroup title="Adapter Drift Indicators">
            <TagList items={runs.filter((run: any) => /selector|parser|extract|token/i.test(run.last_error || '')).map((run: any) => `${run.brand?.name || run.brand_id} · ${run.last_error}`)} emptyText="No parser drift indicators in recent runs" />
          </InfoGroup>
        </div>
      </Section>
    </div>
  );
}

function LeadsView({ payload }: { payload: any }) {
  const items = payload.items || [];
  return (
    <Section title="Lead / Signal Management">
      <div className="stack">
        {items.map((lead: any) => (
          <div key={lead.id} className="panel nested-panel">
            <div className="list-row">
              <div>
                <strong>{lead.brand?.name || lead.brand_id}</strong>
                <div className="admin-muted">{lead.account?.name} · {normalizePlatform(lead.platform)}</div>
              </div>
              <div className="status-pair">
                <span className={`status-badge ${confidenceTone(lead.confidence)}`}>{lead.intent}</span>
                <span className="pill">{lead.buyer_stage}</span>
              </div>
            </div>
            <blockquote className="quoted-text">{lead.event?.content_text || 'Original comment text unavailable.'}</blockquote>
            <InlineStats items={[
              { label: 'Confidence', value: percent(lead.confidence) },
              { label: 'Relevance', value: lead.market_match_score != null ? percent(lead.market_match_score) : 'Not scored' },
              { label: 'Recommended action', value: lead.recommended_action },
              { label: 'Drafts', value: formatMetric((lead.drafts || []).length) },
            ]} />
            <div className="action-row">
              <GhostButton label="Approve lead" />
              <GhostButton label="Reject lead" />
              <GhostButton label="Relabel lead" />
              <GhostButton label="Assign reviewer" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AiAuditView({ payload }: { payload: any }) {
  const items = (payload.items || []).slice(0, 24);
  return (
    <Section title="AI Decision Audit Panel">
      <div className="stack">
        {items.map((lead: any) => {
          const trace = extractIntentTrace(lead.event?.metadata);
          return (
            <div key={lead.id} className="panel nested-panel">
              <div className="list-row">
                <div>
                  <strong>{lead.intent}</strong>
                  <div className="admin-muted">{lead.brand?.name || lead.brand_id} · {lead.id}</div>
                </div>
                <span className={`status-badge ${confidenceTone(lead.confidence)}`}>{percent(lead.confidence)}</span>
              </div>
              <div className="multi-column two">
                <InfoGroup title="Raw Input">
                  <blockquote className="quoted-text compact">{lead.event?.content_text || 'Raw input unavailable.'}</blockquote>
                </InfoGroup>
                <InfoGroup title="Decision Trace">
                  <ul className="plain-list">
                    <li>Intent label: {lead.intent}</li>
                    <li>Buyer stage: {lead.buyer_stage}</li>
                    <li>Normalization confidence: {trace.normalizationConfidence || 'Not instrumented'}</li>
                    <li>Fallback path: {trace.fallback || 'Unknown'}</li>
                    <li>Explanation: {trace.explanation || 'Trace unavailable in current payload'}</li>
                  </ul>
                </InfoGroup>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function DraftsView({ payload }: { payload: any }) {
  const items = payload.items || [];
  const backlog = items.filter((item: any) => ['DRAFT', 'EDITED'].includes(item.status));
  return (
    <div className="view-stack">
      <div className="dashboard-grid metrics-grid">
        <MetricCard label="Pending approvals" value={formatMetric(backlog.length)} note="Drafts waiting for review or revision" />
        <MetricCard label="Approved" value={formatMetric(items.filter((item: any) => item.status === 'APPROVED').length)} note="Ready for send or final handling" />
        <MetricCard label="Sent" value={formatMetric(items.filter((item: any) => item.status === 'SENT').length)} note="Manual or confirmed sent state" />
      </div>
      <Section title="Outreach Drafts and Human Review">
        <div className="stack">
          {items.map((draft: any) => (
            <div key={draft.id} className="panel nested-panel">
              <div className="list-row">
                <div>
                  <strong>{draft.brand?.name || draft.brand_id}</strong>
                  <div className="admin-muted">{draft.lead?.intent || 'Unknown intent'} · {draft.lead?.user_handle || draft.lead?.comment_id || 'No thread reference'}</div>
                </div>
                <span className={`status-badge ${draftTone(draft.status)}`}>{draft.status}</span>
              </div>
              <blockquote className="quoted-text compact">{draft.edited_text || draft.draft_text}</blockquote>
              <InlineStats items={[
                { label: 'Created', value: formatDate(draft.created_at) },
                { label: 'Approved', value: draft.approved_at ? formatDate(draft.approved_at) : 'Pending' },
                { label: 'Sent', value: draft.sent_at ? formatDate(draft.sent_at) : 'Not sent' },
                { label: 'Channel', value: draft.reply_channel || 'THREAD_REPLY' },
              ]} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function PolicyView({ payload }: { payload: any }) {
  const items = payload.items || [];
  return (
    <Section title="Policy and Compliance Center">
      <div className="stack">
        {items.map((brand: any) => {
          const latestPolicy = brand.policies?.[0];
          const ownerSettings = brand.account?.owner_settings;
          const blockedCounters = (brand.usage_counters || []).filter((counter: any) => counter.blocked_at);
          return (
            <div key={brand.id} className="panel workspace-card">
              <div className="list-row">
                <div>
                  <strong>{brand.name}</strong>
                  <div className="admin-muted">{brand.account?.name} · {brand.domain}</div>
                </div>
                <div className="status-pair">
                  <span className={`status-badge ${latestPolicy?.enabled ? 'success' : 'warning'}`}>{latestPolicy?.status || 'No policy'}</span>
                  <span className="pill">{latestPolicy?.mode || 'Unconfigured'}</span>
                </div>
              </div>
              <div className="workspace-grid">
                <DetailCard label="Forbidden / blocked" value={formatMetric(blockedCounters.length)} note={blockedCounters[0]?.block_reason_code || 'No active block reason'} />
                <DetailCard label="Manual review requirement" value={ownerSettings?.reply_require_human_review_high_risk ? 'Required' : 'Optional'} note={ownerSettings?.reply_qualified_mode || 'Not set'} />
                <DetailCard label="Frequency caps" value={latestPolicy ? `${latestPolicy.max_comments_per_hour}/hour` : 'No policy'} note={latestPolicy ? `${latestPolicy.max_comments_per_video}/video · ${latestPolicy.max_videos_per_hour}/hour videos` : 'Policy unavailable'} />
                <DetailCard label="CTA / redirect" value={ownerSettings?.reply_redirect_target || 'STORE'} note={ownerSettings?.reply_cta_style || 'SOFT'} />
              </div>
              <div className="action-row">
                <GhostButton label="Edit policy template" />
                <GhostButton label="Compare policy versions" />
                <GhostButton label="Freeze automation" />
                <GhostButton label="Manual review only mode" />
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function BillingView({ payload }: { payload: any }) {
  const items = payload.items || [];
  return (
    <Section title="Billing / Plan / Usage Controls">
      <div className="dashboard-grid">
        {items.map((workspace: any) => (
          <div key={workspace.id} className="panel nested-panel">
            <div className="list-row">
              <div>
                <strong>{workspace.name}</strong>
                <div className="admin-muted">{workspace.id}</div>
              </div>
              <span className="pill">{workspace.subscription?.plan_code || workspace.plan_id}</span>
            </div>
            <InlineStats items={[
              { label: 'Status', value: workspace.subscription?.status || workspace.status },
              { label: 'Interval', value: workspace.subscription?.billing_interval || 'Manual' },
              { label: 'Brands', value: formatMetric(workspace._count?.brands || 0) },
              { label: 'Installs', value: formatMetric(workspace._count?.installs || 0) },
            ]} />
            <TagList items={formatUsageCounters(workspace.usage_counters)} emptyText="No usage counters" />
            <div className="action-row">
              <GhostButton label="Upgrade / downgrade" />
              <GhostButton label="Grant temporary credits" />
              <GhostButton label="Pause for non-payment" />
              <GhostButton label="Enterprise override" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AlertsView({ payload }: { payload: any }) {
  const alerts = deriveAlerts(payload);
  return (
    <Section title="Notifications / Alerts">
      <div className="stack">
        {alerts.length ? alerts.map((alert, index) => (
          <div key={`${alert.title}-${index}`} className={`incident-card ${alert.tone}`}>
            <strong>{alert.title}</strong>
            <div>{alert.detail}</div>
            <div className="admin-muted">{alert.meta}</div>
          </div>
        )) : <EmptyState text="No alerts derived from the current control-plane payload." />}
      </div>
    </Section>
  );
}

function HealthView({ payload }: { payload: any }) {
  return (
    <Section title="System Health / Observability">
      <div className="dashboard-grid">
        {Object.entries(payload).map(([key, value]) => (
          <div key={key} className="panel nested-panel">
            <div className="list-row">
              <strong>{humanizeKey(key)}</strong>
              <span className={`status-badge ${extractHealthStatus(value) === 'ok' ? 'success' : 'danger'}`}>{extractHealthStatus(value)}</span>
            </div>
            <pre>{JSON.stringify(value, null, 2)}</pre>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AuditView({ payload }: { payload: any }) {
  return (
    <Section title="Audit Logs">
      <SimpleTable rows={payload.items || []} columns={['created_at', 'actor_type', 'actor_id', 'action', 'resource', 'resource_id', 'workspace_id', 'ip']} />
    </Section>
  );
}

function TaxonomyView({ payload }: { payload: any }) {
  return (
    <div className="view-stack">
      <div className="dashboard-grid">
        <InfoGroup title="Intent Labels">
          <TagList items={payload.intents || []} emptyText="No intent labels configured" />
        </InfoGroup>
        <InfoGroup title="Buyer Stages">
          <TagList items={payload.buyerStages || []} emptyText="No buyer stages configured" />
        </InfoGroup>
        <InfoGroup title="Recommended Actions">
          <TagList items={payload.recommendedActions || []} emptyText="No action labels configured" />
        </InfoGroup>
        <InfoGroup title="Control Surfaces">
          <TagList items={payload.controlSurfaces || []} emptyText="No control surfaces defined" />
        </InfoGroup>
      </div>
      <Section title="Blocked Reason Taxonomy">
        <TagList items={payload.policyReasons || []} emptyText="No block reasons configured" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="section-title">{title}</div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

function DetailCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="detail-card">
      <div className="eyebrow-label">{label}</div>
      <div className="detail-value">{value}</div>
      {note && <div className="admin-muted small-text">{note}</div>}
    </div>
  );
}

function InfoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel nested-panel">
      <div className="section-title compact">{title}</div>
      {children}
    </div>
  );
}

function InlineStats({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="inline-stats">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="inline-stat">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function TagList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items.length) return <EmptyState text={emptyText} compact />;
  return (
    <div className="tag-list">
      {items.map((item) => (
        <span key={item} className="tag">{item}</span>
      ))}
    </div>
  );
}

function StatusBarGroup({ items }: { items: Array<{ label: string; value: number; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> }) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <div className="stack">
      {items.map((item) => (
        <div key={item.label} className="status-bar-row">
          <div className="list-row">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          <div className="status-bar-track">
            <div className={`status-bar-fill ${item.tone}`} style={{ width: `${(item.value / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
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

function GhostButton({ label }: { label: string }) {
  return <button className="ghost-button" type="button">{label}</button>;
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}>{text}</div>;
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) {
    return <EmptyState text="No records available for this view." />;
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
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanizeKey(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatMetric(value: number | string) {
  if (typeof value === 'string') return value;
  return new Intl.NumberFormat().format(value || 0);
}

function normalizePlatform(value?: string | null) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function statNumber(stats: unknown, key: string) {
  if (!stats || typeof stats !== 'object') return 0;
  const raw = (stats as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw : Number(raw || 0) || 0;
}

function sumBy(items: any[], getter: (item: any) => number) {
  return items.reduce((sum, item) => sum + getter(item), 0);
}

function averageOf(items: any[], getter: (item: any) => number) {
  if (!items.length) return 0;
  return sumBy(items, getter) / items.length;
}

function countBy(items: any[], getter: (item: any) => string) {
  return items.reduce((acc: Record<string, number>, item) => {
    const key = getter(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function successRate(success: number, failure: number) {
  const total = success + failure;
  if (!total) return 0;
  return Math.round((success / total) * 100);
}

function percent(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function runTone(status?: string) {
  if (status === 'COMPLETED') return 'success';
  if (status === 'RUNNING' || status === 'PENDING') return 'accent';
  if (status === 'DEGRADED') return 'warning';
  return 'danger';
}

function draftTone(status?: string) {
  if (status === 'SENT') return 'success';
  if (status === 'APPROVED') return 'accent';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}

function confidenceTone(value?: number | null) {
  if (value == null) return 'neutral';
  if (value >= 0.8) return 'success';
  if (value >= 0.6) return 'accent';
  if (value >= 0.4) return 'warning';
  return 'danger';
}

function extractHealthStatus(value: any) {
  return String(value?.status || value?.ok || 'unknown').toLowerCase();
}

function summarizeHealth(value: any) {
  if (!value || typeof value !== 'object') return 'No health payload';
  return JSON.stringify(value);
}

function tenantHealthScore(workspace: any) {
  let score = 100;
  if (workspace.status !== 'ACTIVE') score -= 40;
  if (workspace.subscription?.status && workspace.subscription.status !== 'ACTIVE') score -= 20;
  if ((workspace.platform_connections || []).some((item: any) => item.status !== 'CONNECTED')) score -= 15;
  if ((workspace.usage_counters || []).some((item: any) => item.blocked_at)) score -= 20;
  if (workspace.brands?.some((brand: any) => ['FAILED', 'DEGRADED', 'ABORTED'].includes(brand.latest_run?.status))) score -= 15;
  return Math.max(0, score);
}

function tenantHealthTone(score: number) {
  if (score >= 85) return 'success';
  if (score >= 65) return 'warning';
  return 'danger';
}

function tenantHealthLabel(score: number) {
  if (score >= 85) return 'Healthy';
  if (score >= 65) return 'At risk';
  return 'Needs action';
}

function summarizeRunStats(stats: any) {
  const discovered = statNumber(stats, 'videos_processed');
  const captured = statNumber(stats, 'comments_captured');
  const emitted = statNumber(stats, 'comments_emitted_success');
  if (!discovered && !captured && !emitted) return '';
  return `Discovered ${discovered}, captured ${captured}, emitted ${emitted}`;
}

function summarizeSnapshot(snapshot: any) {
  if (!snapshot) return 'Unavailable';
  if (typeof snapshot === 'string') return snapshot.length > 72 ? `${snapshot.slice(0, 72)}…` : snapshot;
  if (typeof snapshot === 'object') {
    const keys = Object.keys(snapshot);
    return keys.length ? keys.slice(0, 4).join(', ') : 'Available';
  }
  return String(snapshot);
}

function formatUsageCounters(counters: any[]) {
  return (counters || []).slice(0, 6).map((counter: any) => {
    const blocked = counter.blocked_at ? ` · blocked (${counter.block_reason_code || 'reason unknown'})` : '';
    return `${humanizeKey(counter.metric_code)} ${counter.current_value}${blocked}`;
  });
}

function extractIntentTrace(metadata: any) {
  const trace = metadata?.policy_decisions?.trace || metadata?.trace || metadata?.intent_trace || {};
  return {
    explanation: trace?.intent?.reason || trace?.summary || metadata?.explanation || '',
    fallback: trace?.forced ? 'Forced strategy' : trace?.intent?.forced_strategy || metadata?.fallback || '',
    normalizationConfidence: metadata?.normalization_confidence || trace?.normalization_confidence || '',
  };
}

function deriveAlerts(payload: any) {
  type AlertItem = { title: string; detail: string; meta: string; tone: 'danger' | 'warning' | 'accent' };
  const alerts: AlertItem[] = [];
  (payload.runs || [])
    .filter((run: any) => ['FAILED', 'DEGRADED', 'ABORTED'].includes(run.status))
    .slice(0, 6)
    .forEach((run: any) => {
      alerts.push({
        title: `${run.status} automation run`,
        detail: `${run.brand?.name || run.brand_id} on ${normalizePlatform(run.platform)}`,
        meta: run.last_error || summarizeRunStats(run.stats) || 'Run requires investigation',
        tone: run.status === 'FAILED' ? 'danger' : 'warning',
      });
    });
  (payload.installs || [])
    .filter((item: any) => item.status !== 'CONNECTED' || item.last_error)
    .slice(0, 6)
    .forEach((item: any) => {
      alerts.push({
        title: `${item.status} install`,
        detail: `${item.account?.name || item.workspace_id} · ${normalizePlatform(item.platform)}`,
        meta: item.last_error || item.verification_error || 'Install health requires review',
        tone: item.status === 'CONNECTED' ? 'accent' : 'danger',
      });
    });
  (payload.billing || [])
    .flatMap((workspace: any) => (workspace.usage_counters || []).filter((counter: any) => counter.blocked_at).map((counter: any) => ({
      title: 'Usage limit reached',
      detail: `${workspace.name} · ${humanizeKey(counter.metric_code)}`,
      meta: counter.block_reason_code || 'Blocked without explicit reason code',
      tone: 'warning' as const,
    })))
    .slice(0, 6)
    .forEach((item: AlertItem) => alerts.push(item));
  const draftBacklog = (payload.drafts || []).filter((draft: any) => ['DRAFT', 'EDITED'].includes(draft.status));
  if (draftBacklog.length > 10) {
    alerts.push({
      title: 'Manual review backlog',
      detail: `${draftBacklog.length} drafts waiting for human action`,
      meta: 'Review queue is above the recommended ops threshold.',
      tone: 'accent',
    });
  }
  return alerts;
}
