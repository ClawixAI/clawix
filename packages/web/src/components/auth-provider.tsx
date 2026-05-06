'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type AuthUser,
  ensureAccessToken,
  hasSessionCookie,
  login as authLogin,
  logout as authLogout,
  parseJwtPayload,
} from '@/lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fresh page load: in-memory access token is empty.
    // If clawix_has_session=1 is present, ensureAccessToken() will refresh
    // via the httpOnly cookie. Otherwise treat as logged-out.
    if (!hasSessionCookie()) {
      setIsLoading(false);
      return;
    }
    void ensureAccessToken()
      .then((token) => {
        if (token) setUser(parseJwtPayload(token));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const authUser = await authLogin(email, password);
    setUser(authUser);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
