import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSyncBookmarklet } from '@provisions/shared';
import {
  createSyncKey,
  errorMessage,
  getMembers,
  getTntSyncStatus,
  listSyncKeys,
  revokeSyncKey,
  type SyncKeyRow,
  type TntSyncStatus,
} from '../api';
import { timeAgo } from './FlyerRefresh';
import { Disclosure } from './Disclosure';
import { useConfirm } from './ConfirmDialog';
import { useSaveStatus } from './SaveStatus';
import { eyebrow, linkBtn, secondaryBtn } from './ui';

const ERROR_TEXT = 'text-[#D98C7A]';
/** The store preset id of T&T. */
export const TNT_STORE_ID = 'tt-supermarket';
/** The extension's README on GitHub: how to install it. */
export const EXTENSION_README_URL = 'https://github.com/adityajain13/atlas-provisions/tree/main/extension';
/** The attribute the extension sets on the app's pages, with its version. */
const DETECT_ATTRIBUTE = 'provisionsSync';
/** The sync stops waiting for the extension after this long with no word from it. Progress resets the wait. */
const IDLE_MS = 60_000;
/** The keys this browser holds, per household: the key itself, and its id so Devices can mark it. */
const KEY_PREFIX = 'provisions:syncKey:';
const KEY_ID_PREFIX = 'provisions:syncKeyId:';
export const BOOKMARK_LABEL_DEFAULT = 'iPhone bookmark';

export const SYNC_INSTALL_LINE = 'Install the Atlas Provisions Sync extension (Firefox, Chrome, Edge) to read T&T prices from your browser.';
export const BOOKMARK_WARNING = "This bookmark contains your household's sync key. Don't share it; revoke it under Devices if you do.";

/**
 * A label for this browser's key from its user agent, such as "Firefox on Windows" or "Chrome on Android". Edge and Chrome
 * are told apart from Safari, and iPhones and iPads from Macs. "This browser" when nothing is recognised.
 */
export function deviceLabel(ua: string): string {
  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '';
  if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iPhone';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'This browser';
}

/** The status line under the T&T heading: when it last synced and how many prices are current. */
export function lastSyncedLine(status: TntSyncStatus | null, now: number = Date.now()): string {
  if (!status) return 'Loading…';
  if (!status.lastRun) return 'Never synced';
  const n = status.prices;
  const when = `Last synced ${timeAgo(status.lastRun.finishedAt, now)}`;
  return `${when} · ${n} ${n === 1 ? 'price' : 'prices'}`;
}

/** A key's last use, for the Devices list. */
export function lastUsedLine(lastUsedAt: string | null, now: number = Date.now()): string {
  return lastUsedAt ? `Last used ${timeAgo(lastUsedAt, now)}` : 'Never used';
}

/** The line while a sync runs. */
export function syncProgressLine(p: { done: number; total: number }): string {
  return `Searching ${p.done} of ${p.total}…`;
}

/** The line after a sync finishes: what was saved, or the reason there was nothing to look up. */
export function syncDoneLine(s: { stored: number; searched: number; reason?: string }): string {
  if (s.reason) return s.reason;
  const prices = `${s.stored} ${s.stored === 1 ? 'price' : 'prices'}`;
  const searches = `${s.searched} ${s.searched === 1 ? 'search' : 'searches'}`;
  return `Saved ${prices} from ${searches}.`;
}

/** This browser's key for a household, or null. Storage can be blocked, so a failure reads as no key. */
export function readStoredKey(householdId: string): { key: string; id: string | null } | null {
  try {
    const key = window.localStorage.getItem(KEY_PREFIX + householdId);
    if (!key) return null;
    return { key, id: window.localStorage.getItem(KEY_ID_PREFIX + householdId) };
  } catch {
    return null;
  }
}

export function writeStoredKey(householdId: string, key: string, id: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + householdId, key);
    window.localStorage.setItem(KEY_ID_PREFIX + householdId, id);
  } catch {
    // Not kept: the next sync makes a new key.
  }
}

export function clearStoredKey(householdId: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + householdId);
    window.localStorage.removeItem(KEY_ID_PREFIX + householdId);
  } catch {
    // Nothing to clear.
  }
}

/** Whether the Atlas Provisions Sync extension is installed here: it marks the page when it runs. */
function extensionInstalled(): boolean {
  return document.documentElement.dataset[DETECT_ATTRIBUTE] !== undefined;
}

type SyncMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; summary: { stored: number; searched: number; reason?: string } }
  | { type: 'error'; message: string };

/**
 * The T&T row's sync: the extension (one press runs the sync in a T&T tab) when it is installed, and always the bookmark
 * for an iPhone. Each browser keeps its own key; each bookmark has its own. Devices lists them all, and revoking one
 * leaves the rest working.
 */
export function TntSync() {
  const { track } = useSaveStatus();
  const confirm = useConfirm();
  const [status, setStatus] = useState<TntSyncStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [keys, setKeys] = useState<SyncKeyRow[]>([]);
  const [thisBrowserId, setThisBrowserId] = useState<string | null>(null);
  const [bookmarkLabel, setBookmarkLabel] = useState(BOOKMARK_LABEL_DEFAULT);
  const [bookmark, setBookmark] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const pending = useRef<{ resolve: (m: SyncMessage) => void; touch: () => void } | null>(null);

  const refreshStatus = useCallback(() => {
    getTntSyncStatus()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((e: unknown) => setStatusError(errorMessage(e)));
  }, []);

  const refreshKeys = useCallback(() => {
    listSyncKeys()
      .then(setKeys)
      .catch((e: unknown) => setOutcomeError(errorMessage(e)));
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshKeys();
    getMembers()
      .then((m) => setHouseholdId(m.household.id))
      .catch(() => setHouseholdId(null));
    setDetected(extensionInstalled());
  }, [refreshStatus, refreshKeys]);

  useEffect(() => {
    if (!householdId) return;
    setThisBrowserId(readStoredKey(householdId)?.id ?? null);
  }, [householdId, keys]);

  // The extension's replies come back through the window: progress, then done or error.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as (SyncMessage & { source?: string }) | null;
      if (!d || d.source !== 'provisions-sync' || !pending.current) return;
      if (d.type === 'progress') {
        setProgress({ done: d.done, total: d.total });
        pending.current.touch();
      } else if (d.type === 'done' || d.type === 'error') {
        pending.current.resolve(d);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** This browser's key, or a new one labelled for this browser when there is none. */
  async function ensureKey(): Promise<string> {
    const id = householdId ?? (await getMembers()).household.id;
    if (householdId === null) setHouseholdId(id);
    const stored = readStoredKey(id);
    if (stored) return stored.key;
    const made = await createSyncKey(deviceLabel(navigator.userAgent));
    writeStoredKey(id, made.key, made.id);
    setThisBrowserId(made.id);
    refreshKeys();
    return made.key;
  }

  /** One sync through the extension: asks the page to start, then waits for the extension's answer. */
  const sync = useCallback(async (): Promise<void> => {
    setRunning(true);
    setProgress(null);
    setOutcome(null);
    setOutcomeError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = await new Promise<SyncMessage>((resolve) => {
      const finish = (m: SyncMessage) => {
        clearTimeout(timer);
        pending.current = null;
        resolve(m);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish({ type: 'error', message: 'The extension did not answer. Check it is installed and turned on, then try again.' }),
          IDLE_MS,
        );
      };
      pending.current = { resolve: finish, touch: arm };
      arm();
      ensureKey().then(
        (key) => window.postMessage({ source: 'provisions', type: 'tnt-sync', apiBase: `${window.location.origin}/provisions/api`, key }, window.location.origin),
        (e: unknown) => finish({ type: 'error', message: errorMessage(e) }),
      );
    });
    setRunning(false);
    setProgress(null);
    if (answer.type === 'error') {
      // A key the app no longer knows (revoked elsewhere) is replaced on the next press.
      if (/not recognised/i.test(answer.message) && householdId) {
        clearStoredKey(householdId);
        setThisBrowserId(null);
        refreshKeys();
      }
      throw new Error(answer.message);
    }
    if (answer.type === 'done') setOutcome(syncDoneLine(answer.summary));
    refreshStatus();
  }, [householdId, refreshStatus, refreshKeys]);

  function syncNow() {
    track(sync(), sync).catch((e: unknown) => setOutcomeError(errorMessage(e)));
  }

  /** A new key for the iPhone bookmark, under the label typed. Other keys are not changed. */
  async function makeBookmark() {
    setOutcomeError(null);
    const label = bookmarkLabel.trim().replace(/\s+/g, ' ');
    if (label === '') {
      setOutcomeError('Give the bookmark a label, such as iPhone bookmark.');
      return;
    }
    try {
      const made = await createSyncKey(label);
      setBookmark(buildSyncBookmarklet({ apiBase: `${window.location.origin}/provisions/api`, key: made.key }));
      refreshKeys();
    } catch (e) {
      setOutcomeError(errorMessage(e));
    }
  }

  async function copyBookmark() {
    if (!bookmark) return;
    try {
      await navigator.clipboard.writeText(bookmark);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setOutcomeError('Could not copy. Select the bookmark link and copy it instead.');
    }
  }

  async function revoke(row: SyncKeyRow) {
    const mine = row.id === thisBrowserId;
    if (
      !(await confirm({
        title: `Revoke "${row.label}"?`,
        message: mine
          ? 'This browser stops syncing until it makes a new key on its next sync.'
          : 'The bookmark or device using this key stops working. Other keys are not affected.',
        confirmLabel: 'Revoke',
        danger: true,
      }))
    )
      return;
    setOutcomeError(null);
    try {
      await revokeSyncKey(row.id);
      if (mine && householdId) {
        clearStoredKey(householdId);
        setThisBrowserId(null);
      }
      refreshKeys();
    } catch (e) {
      setOutcomeError(errorMessage(e));
    }
  }

  return (
    <div>
      <span className={eyebrow}>T&amp;T prices</span>
      <p className="mt-2 text-[15px] text-paper">T&amp;T prices sync from your browser.</p>
      <span className="block text-[12px] text-muted">{statusError ? 'Could not load the last sync' : lastSyncedLine(status)}</span>

      {detected ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={syncNow} disabled={running} className={`${secondaryBtn} disabled:opacity-40`}>
            {running ? 'Syncing…' : 'Sync T&T prices'}
          </button>
          {running && progress && <span className="text-[13px] text-muted">{syncProgressLine(progress)}</span>}
          {running && !progress && <span className="text-[13px] text-muted">Starting the sync in your browser…</span>}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          {SYNC_INSTALL_LINE}{' '}
          <a href={EXTENSION_README_URL} target="_blank" rel="noopener noreferrer" className="text-herb underline-offset-2 hover:underline">
            How to install it
          </a>
        </p>
      )}

      {outcome && <p className="mt-3 text-[13px] text-paper">{outcome}</p>}
      {outcomeError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>{outcomeError}</p>}

      <div className="mt-5">
        <span className={eyebrow}>Devices</span>
        {keys.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">No sync keys yet. The first sync from a browser makes one for it.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line2">
            {keys.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0">
                  <span className="block text-[14px] text-paper">
                    {row.label}
                    {row.id === thisBrowserId && <span className="ml-2 text-[12px] text-herbLight">This browser</span>}
                  </span>
                  <span className="block text-[12px] text-muted">{lastUsedLine(row.lastUsedAt)}</span>
                </span>
                <button type="button" onClick={() => void revoke(row)} className={linkBtn}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <Disclosure variant="compact" open={bookmarkOpen} onToggle={() => setBookmarkOpen((v) => !v)} title="Use a bookmark instead (iPhone)">
          <div className="space-y-4">
            <label className="block">
              <span className={eyebrow}>Label for this bookmark&apos;s key</span>
              <input
                value={bookmarkLabel}
                onChange={(e) => setBookmarkLabel(e.target.value)}
                maxLength={40}
                className="mt-2 w-full rounded-lg border border-edge bg-transparent px-3 py-2 text-[14px] text-paper"
              />
            </label>
            <div>
              <button type="button" onClick={makeBookmark} className={secondaryBtn}>
                Create sync bookmark
              </button>
            </div>

            {bookmark && (
              <div className="space-y-3">
                <p className={`text-[13px] ${ERROR_TEXT}`}>{BOOKMARK_WARNING}</p>
                <p className="text-[13px] text-muted">On a computer, drag this link to the bookmarks bar.</p>
                <a
                  ref={(el) => {
                    if (el) el.setAttribute('href', bookmark);
                  }}
                  className="inline-block rounded-lg border border-herb/50 px-4 py-2 text-[14px] text-herbLight"
                >
                  Sync T&amp;T prices
                </a>
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" onClick={copyBookmark} className={linkBtn}>
                    {copied ? 'Copied' : 'Copy bookmark code'}
                  </button>
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
                  <li>Copy the code.</li>
                  <li>
                    Bookmark any page in Safari, then edit the bookmark: name it &quot;Sync T&amp;T prices&quot; and paste the code as
                    its address.
                  </li>
                  <li>
                    Open{' '}
                    <a
                      href="https://www.tntsupermarket.com/eng/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-herbLight underline underline-offset-2"
                    >
                      tntsupermarket.com
                    </a>{' '}
                    and tap the bookmark.
                  </li>
                </ol>
              </div>
            )}
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
