import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AuthUser, post, refresh, setOnUnauthorized, setToken } from './api';

type Ctx = { user: AuthUser | null; loading: boolean; login: (email: string, password: string) => Promise<AuthUser>; logout: () => Promise<void>; setUser: (u: AuthUser) => void };
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setOnUnauthorized(() => { setToken(null); setUser(null); });
    refresh().then((r) => { if (r) setUser(r.user); }).finally(() => setLoading(false));
  }, []);
  const login = async (email: string, password: string) => {
    const r = await post<{ user: AuthUser; accessToken: string }>('/auth/login', { email, password });
    setToken(r.accessToken); setUser(r.user); return r.user;
  };
  const logout = async () => { await post('/auth/logout').catch(() => {}); setToken(null); setUser(null); };
  return <AuthCtx.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthCtx.Provider>;
}
