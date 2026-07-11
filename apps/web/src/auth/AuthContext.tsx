import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { endpoints } from '../lib/api';
import type { AuthUser, Role } from '../lib/types';

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('sb_user');
    try {
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('sb_token'));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // trust nothing stale: re-validate the session against the server on boot
    if (token) {
      endpoints
        .me()
        .then((u) => {
          setUser(u);
          localStorage.setItem('sb_user', JSON.stringify(u));
        })
        .catch(() => {
          /* 401 interceptor handles the redirect */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const res = await endpoints.login({ username, password });
      localStorage.setItem('sb_token', res.accessToken);
      localStorage.setItem('sb_user', JSON.stringify(res.user));
      setToken(res.accessToken);
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    const u = await endpoints.me();
    setUser(u);
    localStorage.setItem('sb_user', JSON.stringify(u));
  };

  const logout = () => {
    localStorage.removeItem('sb_token');
    localStorage.removeItem('sb_user');
    setToken(null);
    setUser(null);
    location.href = '/login';
  };

  const hasRole = (...roles: Role[]) => !!user && roles.includes(user.role);

  return (
    <Ctx.Provider value={{ user, token, loading, login, logout, refresh, hasRole }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
