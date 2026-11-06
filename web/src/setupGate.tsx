import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getHousehold, getMembers } from './api';

/**
 * Whether this address must finish first-time setup now. Only the owner of a household that has not finished setup
 * is sent there. A member who joined by invite never sees it, and its saves leave the household's flag alone.
 */
async function needsSetup(): Promise<boolean> {
  const h = await getHousehold();
  if (h.setupDone !== false) return false;
  const view = await getMembers();
  return view.me.role === 'owner';
}

interface SetupGateValue {
  /** False until the household check has answered. Nothing should be routed before then. */
  ready: boolean;
  /** Whether the household has finished first-time setup. A failed check counts as done, so the app still opens. */
  setupDone: boolean;
  /** Called when the wizard finishes, so the guard lets the next page through without another request. */
  markSetupDone(): void;
}

const SetupGateContext = createContext<SetupGateValue | null>(null);

/** Checks once, while signed in, whether the household still has its first-time setup to do. */
export function SetupGateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; done: boolean }>({ ready: false, done: true });

  useEffect(() => {
    let alive = true;
    needsSetup()
      .then((pending) => {
        if (alive) setState({ ready: true, done: !pending });
      })
      .catch(() => {
        if (alive) setState({ ready: true, done: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  const markSetupDone = useCallback(() => setState({ ready: true, done: true }), []);

  const value = useMemo<SetupGateValue>(
    () => ({ ready: state.ready, setupDone: state.done, markSetupDone }),
    [state, markSetupDone],
  );

  return <SetupGateContext.Provider value={value}>{children}</SetupGateContext.Provider>;
}

export function useSetupGate(): SetupGateValue {
  const v = useContext(SetupGateContext);
  if (!v) throw new Error('useSetupGate must be used inside SetupGateProvider');
  return v;
}
