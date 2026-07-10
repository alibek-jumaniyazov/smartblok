import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { PageTransition } from './components/PageTransition';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import NewOrder from './pages/NewOrder';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import Factories from './pages/Factories';
import FactoryDetail from './pages/FactoryDetail';
import Products from './pages/Products';
import Vehicles from './pages/Vehicles';
import VehicleDetail from './pages/VehicleDetail';
import Procurement from './pages/Procurement';
import Payments from './pages/Payments';
import Debts from './pages/Debts';
import Expenses from './pages/Expenses';
import Kassa from './pages/Kassa';
import Reports from './pages/Reports';
import Users from './pages/Users';
import ImportPage from './pages/Import';
import Profile from './pages/Profile';

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const token = localStorage.getItem('sb_token');
  if (!token && !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
const P = ({ k, children }: { k: string; children: ReactNode }) => <PageTransition key={k}>{children}</PageTransition>;

export default function App() {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<P k="dash"><Dashboard /></P>} />
        <Route path="/orders" element={<P k="ord"><Orders /></P>} />
        <Route path="/orders/new" element={<P k="ordnew"><NewOrder /></P>} />
        <Route path="/clients" element={<P k="cli"><Clients /></P>} />
        <Route path="/clients/:id" element={<P k="clid"><ClientDetail /></P>} />
        <Route path="/agents" element={<P k="ag"><Agents /></P>} />
        <Route path="/agents/:id" element={<P k="agd"><AgentDetail /></P>} />
        <Route path="/factories" element={<P k="fac"><Factories /></P>} />
        <Route path="/factories/:id" element={<P k="facd"><FactoryDetail /></P>} />
        <Route path="/products" element={<P k="prod"><Products /></P>} />
        <Route path="/vehicles" element={<P k="veh"><Vehicles /></P>} />
        <Route path="/vehicles/:id" element={<P k="vehd"><VehicleDetail /></P>} />
        <Route path="/procurement" element={<P k="proc"><Procurement /></P>} />
        <Route path="/payments" element={<P k="pay"><Payments /></P>} />
        <Route path="/debts" element={<P k="debt"><Debts /></P>} />
        <Route path="/expenses" element={<P k="exp"><Expenses /></P>} />
        <Route path="/kassa" element={<P k="kassa"><Kassa /></P>} />
        <Route path="/reports" element={<P k="rep"><Reports /></P>} />
        <Route path="/users" element={<P k="usr"><Users /></P>} />
        <Route path="/import" element={<P k="imp"><ImportPage /></P>} />
        <Route path="/profile" element={<P k="prof"><Profile /></P>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
