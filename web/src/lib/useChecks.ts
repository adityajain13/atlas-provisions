// Shopping-list and prep ticks, shared across the household's devices. The server is the source of truth.
// Toggles show at once and save through the page's save pill. The page re-reads every 15 s while visible,
// and on focus or return, so ticks made on another device show up here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CheckKind, Checks } from '@provisions/shared';
import { bulkChecks, errorMessage, getChecks, setCheck } from '../api';
import { useSaveStatus } from '../components/SaveStatus';
import {
  NO_PENDING,
  addPending,
  emptyChecks,
  legacyUpload,
  mergeChecks,
  parseLegacyTicks,
  setServerTick,
  settlePending,
  type Pending,
} from './checks';

const POLL_MS = 15_000;

// The old device-only ticks lived under these keys. They are moved to the server once, then removed.
const legacyKey = (kind: CheckKind, weekOf: string) => `provisions:${kind}:${weekOf}`;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Storage blocked or unavailable: nothing to move.
  }
}

function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Still there next visit; the upload is skipped then, since the server has the ticks.
  }
}

export function useChecks(weekOf: string | null) {
  const { track, setFailure } = useSaveStatus();
  const [server, setServer] = useState<Checks>(emptyChecks);
  const [pending, setPending] = useState<Pending>(NO_PENDING);
  const [ready, setReady] = useState(false);
  const checks = useMemo(() => mergeChecks(server, pending), [server, pending]);

  const checksRef = useRef(checks);
  checksRef.current = checks;
  const weekRef = useRef(weekOf);
  weekRef.current = weekOf;
  const seqRef = useRef(0);
  // Requests in flight. Polls wait while a write is out, so a stale read cannot land on top of it.
  const inFlight = useRef(0);
  // Bumped on every write. A read that started before a write is dropped, since it may predate the write.
  const writes = useRef(0);

  useEffect(() => {
    if (!weekOf) return;
    const week = weekOf;
    let active = true;
    setServer(emptyChecks());
    setPending(NO_PENDING);
    setReady(false);

    async function pull(): Promise<void> {
      const gen = writes.current;
      const next = await getChecks(week);
      if (active && gen === writes.current) setServer(next);
    }

    // First read, plus the one-time move of ticks this browser saved before they synced.
    async function load(): Promise<void> {
      try {
        const gen = writes.current;
        let next = await getChecks(week);
        const upload = legacyUpload(
          { list: parseLegacyTicks(readStored(legacyKey('list', week))), prep: parseLegacyTicks(readStored(legacyKey('prep', week))) },
          next,
        );
        if (upload) {
          await track(bulkChecks(week, upload));
          for (const kind of Object.keys(upload) as CheckKind[]) clearStored(legacyKey(kind, week));
          next = await getChecks(week);
        }
        if (active && gen === writes.current) setServer(next);
      } catch (e) {
        if (active) setFailure(errorMessage(e));
      } finally {
        if (active) setReady(true);
      }
    }

    const poll = () => {
      if (document.visibilityState !== 'visible' || inFlight.current > 0) return;
      pull().catch(() => {}); // A failed poll is retried on the next tick.
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', poll);
    void load();

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', poll);
    };
  }, [weekOf, track, setFailure]);

  /** Flips one item. kind is 'list' (ingredient id) or 'prep' (prep step id). */
  const toggle = useCallback(
    (kind: CheckKind, id: string) => {
      const week = weekRef.current;
      if (!week) return;
      const checked = checksRef.current[kind][id] !== true;
      const seq = ++seqRef.current;
      writes.current++;
      setPending((p) => addPending(p, kind, id, checked, seq));

      // Used for the first try and for Retry. Its pending tick stays until the server confirms it.
      const save = async (): Promise<void> => {
        inFlight.current++;
        try {
          await setCheck(week, kind, id, checked);
        } finally {
          inFlight.current--;
        }
        if (weekRef.current !== week) return; // The reader moved to another week meanwhile.
        setPending((p) => settlePending(p, kind, id, seq));
        setServer((s) => setServerTick(s, kind, id, checked));
      };
      track(save(), save).catch(() => {}); // track() shows a failure in the save pill.
    },
    [track],
  );

  return { checks, toggle, ready };
}
