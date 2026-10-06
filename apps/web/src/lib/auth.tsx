import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, createContext, useContext, useEffect } from 'react';
import { api } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, loading: true, refresh: () => {}, logout: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User }>('/auth/me').then((r) => r.user),
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const onExpired = () => qc.setQueryData(['me'], null);
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, [qc]);

  const value: AuthState = {
    user: me.data ?? null,
    loading: me.isLoading,
    refresh: () => void qc.invalidateQueries({ queryKey: ['me'] }),
    logout: async () => {
      await api.post('/auth/logout');
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
