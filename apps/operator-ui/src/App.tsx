
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { VerifyEmailPage } from './pages/VerifyEmail';
import { ForgotPasswordPage } from './pages/ForgotPassword';
import { ResetPasswordPage } from './pages/ResetPassword';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Suggestions } from './pages/Suggestions';
import { Leads } from './pages/Leads';
import { Runs } from './pages/Runs';
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
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="suggestions" element={<Suggestions />} />
                    <Route path="leads" element={<Leads />} />
                    <Route path="runs" element={<Runs />} />
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
