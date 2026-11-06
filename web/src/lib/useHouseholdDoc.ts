import { useCallback, useEffect, useRef, useState } from 'react';
import { HouseholdSchema, type Household } from '@provisions/shared';
import { errorMessage, getHousehold, saveHousehold } from '../api';
import { useSaveScope, useSaveStatus } from '../components/SaveStatus';

export type HouseholdUpdate = (fn: (prev: Household) => Household) => void;

export interface HouseholdDoc {
  /** The household, or null until the first load answers. */
  h: Household | null;
  update: HouseholdUpdate;
  loadError: string | null;
  /** Sends the pending edit now, without waiting for the pause. */
  flush: () => void;
}

/**
 * The household document for a page: loads it once, applies edits, and autosaves each edit after a short pause.
 * The page's save pill (SaveStatus) shows Saving, Saved or Not saved. A pending edit is sent when the page unmounts.
 * Only user edits save; loading the document does not.
 */
export function useHouseholdDoc(): HouseholdDoc {
  const [h, setH] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { track, setPending, setFailure, setFlush } = useSaveStatus();
  useSaveScope('sync', h !== null);
  // Only user edits trigger a save. Loading the document does not.
  const edited = useRef(false);
  const latest = useRef<Household | null>(null);
  const pending = useRef<Household | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getHousehold()
      .then((d) => {
        if (alive) setH(d);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Sends the pending edit now. Also used by the leave guard and on unmount, so an edit is not lost.
  const saveNow = useCallback(() => {
    window.clearTimeout(timer.current);
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    const retry = () => saveHousehold(HouseholdSchema.parse(latest.current));
    void track(saveHousehold(data), retry).catch(() => {});
  }, [track]);

  useEffect(() => {
    setFlush(saveNow);
    return () => {
      setFlush(null);
      saveNow();
    };
  }, [saveNow, setFlush]);

  // Every edit shows Saving at once, then sends after a short pause.
  useEffect(() => {
    if (!h || !edited.current) return;
    latest.current = h;
    const parsed = HouseholdSchema.safeParse(h);
    if (!parsed.success) {
      window.clearTimeout(timer.current);
      pending.current = null;
      const first = parsed.error.issues[0];
      setFailure(first ? first.message : 'Check the fields');
      return;
    }
    pending.current = parsed.data;
    setPending();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 600);
  }, [h, saveNow, setPending, setFailure]);

  const update = useCallback<HouseholdUpdate>((fn) => {
    edited.current = true;
    setH((prev) => (prev ? fn(prev) : prev));
  }, []);

  return { h, update, loadError, flush: saveNow };
}
