import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Client } from '../lib/api';
import {
    LayoutDashboard,
    MessageSquare,
    Settings,
    LogOut,
    Layers,
    Briefcase,
    CreditCard,
    Target,
    Play,
    Menu,
    X,
    Sparkles,
} from 'lucide-react';

export function Layout() {
    const [user, setUser] = useState<any>(null);
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<string>('');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [loadingSession, setLoadingSession] = useState(true);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        loadSession();
    }, [location.pathname]);

    const loadSession = async () => {
        setLoadingSession(true);
        try {
            const me = await Client.get('/auth/me');
            setUser(me.user);
            if (me.active_workspace) {
                setActiveWorkspace(me.active_workspace.id);
                setWorkspaces([{
                    workspace_id: me.active_workspace.id,
                    account: me.active_workspace
                }]);

                const needsOnboarding = me.active_workspace.onboarding_state !== 'ONBOARDED';
                const onOnboardingRoute = location.pathname === '/onboarding';

                if (needsOnboarding && !onOnboardingRoute) {
                    navigate('/onboarding', { replace: true });
                    return;
                }

                if (!needsOnboarding && onOnboardingRoute) {
                    navigate('/', { replace: true });
                    return;
                }
            }
        } catch (e) {
            console.error(e);
            window.location.href = '/login';
        } finally {
            setLoadingSession(false);
        }
    };

    const handleSwitch = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newId = e.target.value;
        try {
            await Client.post('/workspaces/switch', { workspace_id: newId });
            setActiveWorkspace(newId);
            window.location.reload();
        } catch (err) {
            console.error('Failed to switch workspace', err);
            alert('Failed to switch workspace');
        }
    };

    const handleLogout = async () => {
        try {
            await Client.post('/auth/logout', {});
        } catch (e) {
            console.error('Logout failed', e);
        }
        window.location.href = '/login';
    };

    if (loadingSession || !user) {
        return <div className="flex h-screen items-center justify-center text-slate-600">Loading...</div>;
    }

    const navClass = (path: string) =>
        `flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition ${location.pathname === path
            ? 'bg-teal-700 text-white shadow-lg shadow-teal-900/10'
            : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
        }`;

    const closeMobileNav = () => setMobileNavOpen(false);

    return (
        <div className="app-shell flex min-h-screen">
            {mobileNavOpen && (
                <button
                    className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
                    onClick={closeMobileNav}
                    aria-label="Close navigation"
                />
            )}

            <aside
                className={`fixed inset-y-0 left-0 z-40 w-80 max-w-[88vw] transform border-r border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,240,231,0.94))] px-4 py-4 shadow-2xl shadow-slate-900/10 transition-transform duration-200 lg:static lg:z-auto lg:w-72 lg:translate-x-0 lg:shadow-none ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex h-full flex-col">
                    <div className="panel-strong mb-4 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="hero-kicker">Operator Console</div>
                                <h1 className="mt-2 flex items-center gap-2 text-xl font-bold">
                                    <Layers className="h-5 w-5 text-teal-700" />
                                    Syntrae Signal Desk
                                </h1>
                                <p className="mt-2 text-sm text-slate-500">
                                    Review buyer intent, supervise discovery, and keep the lead pipeline clean.
                                </p>
                            </div>
                            <button className="rounded-xl p-2 text-slate-500 lg:hidden" onClick={closeMobileNav}>
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="panel mb-4 p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                            Active Workspace
                        </div>
                        <select
                            className="surface-input mt-3"
                            value={activeWorkspace || ''}
                            onChange={handleSwitch}
                        >
                            {workspaces.map(ws => (
                                <option key={ws.workspace_id} value={ws.workspace_id}>
                                    {ws.account.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <nav className="flex-1 space-y-5 overflow-y-auto pr-1">
                        <div className="panel p-3">
                            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Workspace</div>
                            <div className="space-y-1">
                                <Link to="/" className={navClass('/')} onClick={closeMobileNav}>
                                    <LayoutDashboard className="h-5 w-5" />
                                    Dashboard
                                </Link>
                                <Link to="/suggestions" className={navClass('/suggestions')} onClick={closeMobileNav}>
                                    <MessageSquare className="h-5 w-5" />
                                    Suggestions
                                </Link>
                                <Link to="/leads" className={navClass('/leads')} onClick={closeMobileNav}>
                                    <Target className="h-5 w-5" />
                                    Leads
                                </Link>
                                <Link to="/replies" className={navClass('/replies')} onClick={closeMobileNav}>
                                    <MessageSquare className="h-5 w-5" />
                                    Pending Replies
                                </Link>
                                <Link to="/runs" className={navClass('/runs')} onClick={closeMobileNav}>
                                    <Play className="h-5 w-5" />
                                    Automation Runs
                                </Link>
                                <Link to="/brands" className={navClass('/brands')} onClick={closeMobileNav}>
                                    <Briefcase className="h-5 w-5" />
                                    Brands
                                </Link>
                            </div>
                        </div>

                        <div className="panel p-3">
                            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Analytics</div>
                            <div className="space-y-1">
                                <Link to="/analytics/brands" className={navClass('/analytics/brands')} onClick={closeMobileNav}>
                                    <LayoutDashboard className="h-5 w-5" />
                                    Performance
                                </Link>
                                <Link to="/analytics/usage" className={navClass('/analytics/usage')} onClick={closeMobileNav}>
                                    <CreditCard className="h-5 w-5" />
                                    Usage & Limits
                                </Link>
                            </div>
                        </div>

                        <div className="panel p-3">
                            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Account</div>
                            <div className="space-y-1">
                                <Link to="/billing" className={navClass('/billing')} onClick={closeMobileNav}>
                                    <CreditCard className="h-5 w-5" />
                                    Billing Plans
                                </Link>
                                <Link to="/settings" className={navClass('/settings')} onClick={closeMobileNav}>
                                    <Settings className="h-5 w-5" />
                                    Settings
                                </Link>
                            </div>
                        </div>
                    </nav>

                    <div className="panel-strong mt-4 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Signed In</div>
                        <div className="mt-2 truncate text-sm font-semibold text-slate-800">{user.email}</div>
                        <button
                            onClick={handleLogout}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                            <LogOut className="h-4 w-4" />
                            Sign Out
                        </button>
                    </div>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="sticky top-0 z-20 border-b border-white/50 bg-white/60 backdrop-blur-xl lg:hidden">
                    <div className="flex items-center justify-between px-4 py-3">
                        <div>
                            <div className="hero-kicker">Syntrae</div>
                            <div className="text-lg font-bold text-slate-900">Signal Desk</div>
                        </div>
                        <button
                            className="rounded-2xl border border-slate-200 bg-white/80 p-2 text-slate-700 shadow-sm"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label="Open navigation"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <main className="min-w-0 flex-1">
                    <div className="page-frame">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
