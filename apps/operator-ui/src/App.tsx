

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Suggestions } from './pages/Suggestions';
import { Settings } from './pages/Settings';

import { BillingPage } from './pages/Billing';
import { BrandsPage } from './pages/Brands';

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
                    <Route path="billing" element={<BillingPage />} />
                    <Route path="settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
