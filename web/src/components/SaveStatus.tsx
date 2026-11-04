import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { useConfirm } from './ConfirmDialog';

// One save indicator per page. Every write goes through track(), so the pill shows Saving, Saved or Not saved.
// Scope says where the page's data lives: 'sync' (saved to the server), 'local' (this browser only), or
// 'plan' (kept only once the plan is generated).

export type SaveScope = 'sync' | 'local' | 'plan';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' } // an edit waiting for its debounce to end
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string; retry?: () => Promise<unknown> };

interface SaveContextValue {
  status: SaveState;
  scope: SaveScope;
  ready: boolean;
  track<T>(promise: Promise<T>, retry?: () => Promise<T>): Promise<T>;
  setPending(): void;
  setFailure(message: string): void;
  setFlush(fn: (() => void) | null): void;
  retry(): void;
  setPage(scope: SaveScope, ready: boolean): void;
  leavePage(): void;
}

const SaveContext = createContext<SaveContextValue | null>(null);

const IDLE_TEXT: Record<SaveScope, string> = {
  sync: 'All changes saved',
  local: 'Saved on this device',
  plan: 'Not saved until you generate',
};

const RECENT_MS = 3000;

/** Mount once, inside the router and the confirm provider. Guards in-app links and tab close while a save is unsaved. */
export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveState>({ kind: 'idle' });
  const [page, setPageState] = useState<{ scope: SaveScope; ready: boolean }>({ scope: 'sync', ready: false });
  const statusRef = useRef(status);
  statusRef.current = status;
  const flushRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const confirm = useConfirm();

  // Only a sync page's pending or failed save is something to lose. Local and plan pages never block.
  const unsaved = page.scope === 'sync' && (status.kind === 'pending' || status.kind === 'error');
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  const track = useCallback(<T,>(promise: Promise<T>, retry?: () => Promise<T>): Promise<T> => {
    setStatus({ kind: 'saving' });
    return promise.then(
      (value) => {
        setStatus({ kind: 'saved', at: Date.now() });
        return value;
      },
      (e: unknown) => {
        setStatus({ kind: 'error', message: errorMessage(e), retry });
        throw e;
      },
    );
  }, []);

  const retry = useCallback(() => {
    const s = statusRef.current;
    if (s.kind === 'error' && s.retry) {
      const again = s.retry;
      void track(again(), again).catch(() => {});
    }
  }, [track]);

  const setPending = useCallback(() => setStatus({ kind: 'pending' }), []);
  const setFailure = useCallback((message: string) => setStatus({ kind: 'error', message }), []);
  const setFlush = useCallback((fn: (() => void) | null) => {
    flushRef.current = fn;
  }, []);
  const setPage = useCallback((scope: SaveScope, ready: boolean) => setPageState({ scope, ready }), []);
  // Leaving a page drops a finished "Saved" so the next page starts from its own idle text.
  const leavePage = useCallback(() => {
    setPageState({ scope: 'sync', ready: false });
    setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
  }, []);

  // In-app navigation: a link click while unsaved asks first. Confirmed, the pending edit is sent, then we go.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!unsavedRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return;
      const url = new URL(target.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search + url.hash === pathname + search + hash) return;
      e.preventDefault();
      e.stopPropagation();
      const dest = url.pathname.replace(/^\/provisions/, '') + url.search + url.hash;
      void confirm({
        title: 'Changes not saved yet',
        message: 'Leave anyway? Changes that have not saved will be lost.',
        confirmLabel: 'Leave anyway',
        cancelLabel: 'Stay',
        danger: true,
      }).then((leave) => {
        if (!leave) return;
        flushRef.current?.();
        navigate(dest);
      });
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [confirm, navigate, pathname, search, hash]);

  // Tab close: the browser's own prompt, since the app cannot show a dialog there.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!unsavedRef.current) return;
      flushRef.current?.();
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const value = useMemo<SaveContextValue>(
    () => ({
      status,
      scope: page.scope,
      ready: page.ready,
      track,
      setPending,
      setFailure,
      setFlush,
      retry,
      setPage,
      leavePage,
    }),
    [status, page, track, setPending, setFailure, setFlush, retry, setPage, leavePage],
  );

  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}

function useSaveContext(): SaveContextValue {
  const ctx = useContext(SaveContext);
  if (!ctx) throw new Error('Save status hooks must be used inside SaveStatusProvider');
  return ctx;
}

/** track(promise, retry?) for writes, plus the page's status helpers. Returns the promise's value. */
export function useSaveStatus() {
  const { track, setPending, setFailure, setFlush, status } = useSaveContext();
  return { track, setPending, setFailure, setFlush, status };
}

/** Tells the indicator where this page's data lives, and whether its first load has finished. */
export function useSaveScope(scope: SaveScope, ready: boolean) {
  const { setPage, leavePage } = useSaveContext();
  useEffect(() => {
    setPage(scope, ready);
  }, [scope, ready, setPage]);
  useEffect(() => leavePage, [leavePage]);
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

const PILL = 'inline-flex items-center gap-2 rounded-full border border-line2 px-2.5 py-1 text-[12px] whitespace-nowrap';

/** The save pill. Sits next to the page heading (desktop) or under it (phone). Renders nothing before the first load. */
export function SaveStatus() {
  const { status, scope, ready, retry } = useSaveContext();
  const [recent, setRecent] = useState(false);

  useEffect(() => {
    if (status.kind !== 'saved') {
      setRecent(false);
      return;
    }
    setRecent(true);
    const t = window.setTimeout(() => setRecent(false), RECENT_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  if (!ready) return null;

  let body: ReactNode;
  if (status.kind === 'pending' || status.kind === 'saving') {
    body = (
      <span className="flex items-center gap-2 text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        Saving&hellip;
      </span>
    );
  } else if (status.kind === 'saved' && recent) {
    body = (
      <span className="flex items-center gap-1.5 text-herbLight" title={`Saved at ${timeLabel(status.at)}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Saved
      </span>
    );
  } else if (status.kind === 'error') {
    body = (
      <span className="flex items-center gap-2">
        <span className="text-[#E5806F]" title={status.message}>
          Not saved
        </span>
        {status.retry && (
          <button type="button" onClick={retry} className="text-herb underline-offset-2 hover:underline">
            Retry
          </button>
        )}
      </span>
    );
  } else {
    body = <span className="text-muted">{scope === 'local' ? IDLE_TEXT.local : scope === 'plan' && status.kind === 'idle' ? IDLE_TEXT.plan : IDLE_TEXT.sync}</span>;
  }

  return (
    <span role="status" aria-live="polite" className={PILL}>
      {body}
    </span>
  );
}
