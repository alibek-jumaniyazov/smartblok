import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { PageTransition } from './components/PageTransition';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Payments from './pages/Payments';
import Clients from './pages/Clients';
import Agents from './pages/Agents';
import Procurement from './pages/Procurement';
import Pallets from './pages/Pallets';
import Reports from './pages/Reports';

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const token = localStorage.getItem('sb_token');
  if (!token && !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<AnimatePresence mode="wait"><PageTransition key="d"><Dashboard /></PageTransition></AnimatePresence>} />
        <Route path="/sales" element={<PageTransition><Sales /></PageTransition>} />
        <Route path="/payments" element={<PageTransition><Payments /></PageTransition>} />
        <Route path="/clients" element={<PageTransition><Clients /></PageTransition>} />
        <Route path="/agents" element={<PageTransition><Agents /></PageTransition>} />
        <Route path="/procurement" element={<PageTransition><Procurement /></PageTransition>} />
        <Route path="/pallets" element={<PageTransition><Pallets /></PageTransition>} />
        <Route path="/reports" element={<PageTransition><Reports /></PageTransition>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
