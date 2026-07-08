import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import Users from './pages/Users';
import Kassa from './pages/Kassa';
import ImportPage from './pages/Import';

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
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<PageTransition key="dash"><Dashboard /></PageTransition>} />
        <Route path="/sales" element={<PageTransition key="sales"><Sales /></PageTransition>} />
        <Route path="/payments" element={<PageTransition key="pay"><Payments /></PageTransition>} />
        <Route path="/clients" element={<PageTransition key="cli"><Clients /></PageTransition>} />
        <Route path="/agents" element={<PageTransition key="ag"><Agents /></PageTransition>} />
        <Route path="/procurement" element={<PageTransition key="proc"><Procurement /></PageTransition>} />
        <Route path="/pallets" element={<PageTransition key="pal"><Pallets /></PageTransition>} />
        <Route path="/kassa" element={<PageTransition key="kassa"><Kassa /></PageTransition>} />
        <Route path="/reports" element={<PageTransition key="rep"><Reports /></PageTransition>} />
        <Route path="/users" element={<PageTransition key="usr"><Users /></PageTransition>} />
        <Route path="/import" element={<PageTransition key="imp"><ImportPage /></PageTransition>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
