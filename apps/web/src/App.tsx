import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth/AuthContext';
import { RequireRole } from './auth/RequireRole';
import { useRealtime } from './lib/realtime';
import AppShell from './components/AppShell';
import type { Role } from './lib/types';

// route-level code splitting: each page is its own chunk
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const NewOrder = lazy(() => import('./pages/NewOrder'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const Agents = lazy(() => import('./pages/Agents'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const Factories = lazy(() => import('./pages/Factories'));
const FactoryDetail = lazy(() => import('./pages/FactoryDetail'));
const Products = lazy(() => import('./pages/Products'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const Payments = lazy(() => import('./pages/Payments'));
const Debts = lazy(() => import('./pages/Debts'));
const Pallets = lazy(() => import('./pages/Pallets'));
const Bonus = lazy(() => import('./pages/Bonus'));
const Kassa = lazy(() => import('./pages/Kassa'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Me = lazy(() => import('./pages/Me'));

const ALL: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'];
const FIN: Role[] = ['ADMIN', 'ACCOUNTANT'];
const SALES: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT'];
const TREASURY: Role[] = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  return <RequireRole roles={roles}>{children}</RequireRole>;
}

function Protected({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  useRealtime(token); // live change events → query invalidation, app-wide
  if (!token && !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Public marketing landing at `/`; authenticated users bounce to the app. */
function PublicHome() {
  const { user, token } = useAuth();
  if (token || user) return <Navigate to="/app" replace />;
  return <Landing />;
}

export default function App() {
  return (
    <Suspense fallback={<Spin size="large" style={{ display: 'block', margin: '30vh auto' }} />}>
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route path="/app" element={<Guard roles={ALL}><Dashboard /></Guard>} />
          <Route path="/orders" element={<Guard roles={SALES}><Orders /></Guard>} />
          <Route path="/orders/new" element={<Guard roles={SALES}><NewOrder /></Guard>} />
          <Route path="/orders/:id" element={<Guard roles={SALES}><OrderDetail /></Guard>} />
          <Route path="/clients" element={<Guard roles={SALES}><Clients /></Guard>} />
          <Route path="/clients/:id" element={<Guard roles={SALES}><ClientDetail /></Guard>} />
          <Route path="/agents" element={<Guard roles={FIN}><Agents /></Guard>} />
          <Route path="/agents/:id" element={<Guard roles={SALES}><AgentDetail /></Guard>} />
          <Route path="/factories" element={<Guard roles={FIN}><Factories /></Guard>} />
          <Route path="/factories/:id" element={<Guard roles={FIN}><FactoryDetail /></Guard>} />
          <Route path="/products" element={<Guard roles={FIN}><Products /></Guard>} />
          <Route path="/vehicles" element={<Guard roles={FIN}><Vehicles /></Guard>} />
          <Route path="/payments" element={<Guard roles={ALL}><Payments /></Guard>} />
          {/* /payments/:id — same register, peek pre-opened on that document (money.md §2) */}
          <Route path="/payments/:id" element={<Guard roles={ALL}><Payments /></Guard>} />
          <Route path="/debts" element={<Guard roles={SALES}><Debts /></Guard>} />
          <Route path="/pallets" element={<Guard roles={SALES}><Pallets /></Guard>} />
          <Route path="/bonus" element={<Guard roles={FIN}><Bonus /></Guard>} />
          <Route path="/kassa" element={<Guard roles={TREASURY}><Kassa /></Guard>} />
          <Route path="/users" element={<Guard roles={['ADMIN']}><Users /></Guard>} />
          <Route path="/settings" element={<Guard roles={['ADMIN']}><Settings /></Guard>} />
          <Route path="/profile" element={<Guard roles={ALL}><Profile /></Guard>} />
          {/* /me — AGENT self card; resolves GET /agents/me → /agents/:id (03 §4) */}
          <Route path="/me" element={<Guard roles={['AGENT']}><Me /></Guard>} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </Suspense>
  );
}
