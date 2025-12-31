
import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Client } from '../lib/api';
import { LayoutDashboard, MessageSquare, Settings, LogOut, Layers, Briefcase, CreditCard } from 'lucide-react';

export function Layout() {
    const [user, setUser] = useState<any>(null);
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<string>('');
    const location = useLocation();

    useEffect(() => {
        loadSession();
    }, []);

    const loadSession = async () => {
        try {
            const me = await Client.get('/auth/me');
            setUser(me.user);
            // Default to active workspace ID from the response (which is the object now)
            if (me.active_workspace) {
                setActiveWorkspace(me.active_workspace.id);
                // Also set workspace list to just active one if /workspaces fails or just use it
                setWorkspaces([{
                    workspace_id: me.active_workspace.id,
                    account: me.active_workspace
                }]);
            }

            // Optional: fetch full list if available
            // const ws = await Client.get('/workspaces');
            // setWorkspaces(ws);
        } catch (e) {
            console.error(e);
            // Redirect to login if session fetch fails
            window.location.href = '/login';
        }
    };

    const handleSwitch = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newId = e.target.value;
        try {
            await Client.post('/workspaces/switch', { workspace_id: newId });
            setActiveWorkspace(newId);
            // Reload page to refresh context (e.g. Brands list, Billing info)
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

    if (!user) return <div className="flex h-screen items-center justify-center">Loading...</div>;

    const navClass = (path: string) =>
        `flex items-center p-3 mb-1 rounded cursor-pointer ${location.pathname === path ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`;

    return (
        <div className="flex h-screen bg-gray-50">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r flex flex-col">
                <div className="p-4 border-b">
                    <h1 className="font-bold text-xl flex items-center gap-2">
                        <Layers className="w-6 h-6 text-blue-600" />
                        Operator UI
                    </h1>
                </div>

                <div className="p-4">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Workspace</label>
                    <select
                        className="w-full mt-1 p-2 border rounded bg-gray-50 text-sm"
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

                <nav className="flex-1 p-4">
                    <Link to="/" className={navClass('/')}>
                        <LayoutDashboard className="w-5 h-5 mr-3" />
                        Dashboard
                    </Link>
                    <Link to="/suggestions" className={navClass('/suggestions')}>
                        <MessageSquare className="w-5 h-5 mr-3" />
                        Suggestions
                    </Link>
                    <Link to="/brands" className={navClass('/brands')}>
                        <Briefcase className="w-5 h-5 mr-3" />
                        Brands
                    </Link>
                    <Link to="/billing" className={navClass('/billing')}>
                        <CreditCard className="w-5 h-5 mr-3" />
                        Billing
                    </Link>
                    <Link to="/settings" className={navClass('/settings')}>
                        <Settings className="w-5 h-5 mr-3" />
                        Settings
                    </Link>
                </nav>

                <div className="p-4 border-t">
                    <div className="text-sm text-gray-600 mb-2 truncate">{user.email}</div>
                    <button onClick={handleLogout} className="flex items-center text-sm text-red-600 hover:text-red-800">
                        <LogOut className="w-4 h-4 mr-2" />
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <Outlet />
            </div>
        </div>
    );
}
