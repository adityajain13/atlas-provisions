import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSession, signOutRequest } from './api';

export type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; email: string };

interface SessionValue {
  state: SessionState;
  setSignedIn: (email: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Checks the session once on load. Until it answers the state is 'loading'. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    fetchSession()
      .then((s) => {
        if (alive) setState(s ? { status: 'in', email: s.email } : { status: 'out' });
      })
      .catch(() => {
        if (alive) setState({ status: 'out' });
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      setSignedIn: (email) => setState({ status: 'in', email }),
      signOut: async () => {
        try {
          await signOutRequest();
        } finally {
          setState({ status: 'out' });
          navigate('/login', { replace: true });
        }
      },
    }),
    [state, navigate],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

/** The page to go to after sign-in: in-app paths only. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/';
  return raw;
}
