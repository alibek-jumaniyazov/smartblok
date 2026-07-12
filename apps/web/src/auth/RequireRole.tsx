import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Result, Spin } from 'antd';
import { useAuth } from './AuthContext';
import type { Role } from '../lib/types';

/** Route guard: unauthenticated → /login; wrong role → 403 screen (no silent hiding). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, token } = useAuth();
  const location = useLocation();
  // token present but user not resolved yet (boot /auth/me in flight, or a corrupted
  // cached user): wait rather than bounce to /login and flicker back on re-auth.
  if (!user && token) return <Spin size="large" style={{ display: 'block', margin: '30vh auto' }} />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!roles.includes(user.role)) {
    return <Result status="403" title="403" subTitle="Bu sahifaga kirish huquqingiz yo'q" />;
  }
  return <>{children}</>;
}
