import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { endpoints } from '../lib/api';

export interface AuthUser {
  id: number;
  username: string;
  email?: string | null;
  name: string;
  role: 'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER';
  agentId: number | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('sb_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('sb_token') && !user) {
      endpoints.me().then((u) => { setUser(u); localStorage.setItem('sb_user', JSON.stringify(u)); }).catch(() => {});
    }
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const res = await endpoints.login({ username, password });
      localStorage.setItem('sb_token', res.accessToken);
      localStorage.setItem('sb_user', JSON.stringify(res.user));
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
    setUser(null);
    location.href = '/login';
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
