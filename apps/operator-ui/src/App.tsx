
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Suggestions } from './pages/Suggestions';
import { Settings } from './pages/Settings';
import { BillingPage } from './pages/Billing';
import { BrandsPage } from './pages/Brands';
import { BrandsAnalytics } from './pages/analytics/BrandsAnalytics';
import { UsageAnalytics } from './pages/analytics/UsageAnalytics';
import { AutomationPolicySettings } from './pages/settings/AutomationPolicy';
import { MarketProfiles } from './pages/settings/MarketProfiles';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="suggestions" element={<Suggestions />} />
                    <Route path="brands" element={<BrandsPage />} />
                    <Route path="brands/:brandId/policy" element={<AutomationPolicySettings />} />
                    <Route path="brands/:brandId/market-profiles" element={<MarketProfiles />} />
                    <Route path="billing" element={<BillingPage />} />
                    <Route path="settings" element={<Settings />} />

                    {/* Analytics */}
                    <Route path="analytics/brands" element={<BrandsAnalytics />} />
                    <Route path="analytics/usage" element={<UsageAnalytics />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
