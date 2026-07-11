import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Result } from 'antd';
import { useAuth } from './AuthContext';
import type { Role } from '../lib/types';

/** Route guard: unauthenticated → /login; wrong role → 403 screen (no silent hiding). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!roles.includes(user.role)) {
    return <Result status="403" title="403" subTitle="Bu sahifaga kirish huquqingiz yo'q" />;
  }
  return <>{children}</>;
}
