// The bookmark that runs the T&T sync on tntsupermarket.com (for iPhone, where the extension cannot run). The code is the
// shared sync function plus a small overlay that shows progress and the result. The household's sync key is inside the
// code, so the bookmark is as private as the key: anyone who has it can save T&T prices for the household.
import { tntSyncSource } from './tntSyncScript';

export const SYNC_OVERLAY_ID = 'provisions-sync-overlay';

/** The longest bookmark address the page offers (a browser's comfortable limit, well under its own). */
export const BOOKMARKLET_MAX_LENGTH = 8192;

/**
 * A javascript: address that runs the sync when the bookmark is tapped on the T&T site. It returns nothing, so the page
 * stays where it is. The text is percent-encoded, so spaces, quotes and newlines survive a bookmark's address field.
 */
export function buildSyncBookmarklet(input: { apiBase: string; key: string }): string {
  const config = JSON.stringify({ apiBase: input.apiBase, key: input.key });
  // The sync function's lines, trimmed and joined: its statements end with semicolons, so nothing relies on a line break.
  const sync = tntSyncSource()
    .split('\n')
    .map((line) => line.trim())
    .join('');
  const code = [
    'void (async function () {',
    `var cfg = ${config};`,
    `var old = document.getElementById('${SYNC_OVERLAY_ID}');`,
    'if (old) old.remove();',
    'var box = document.createElement("div");',
    `box.id = '${SYNC_OVERLAY_ID}';`,
    'box.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:320px;padding:12px 14px;border-radius:10px;background:#1d2620;color:#f4efe6;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,0.35);");',
    'var text = document.createElement("div");',
    'text.textContent = "Atlas Provisions: syncing T&T prices...";',
    'var close = document.createElement("button");',
    'close.textContent = "Close";',
    'close.setAttribute("style", "margin-top:8px;background:none;border:1px solid #6b7d70;color:#f4efe6;border-radius:6px;padding:4px 10px;cursor:pointer;");',
    'close.onclick = function () { box.remove(); };',
    'box.appendChild(text);',
    'box.appendChild(close);',
    'document.body.appendChild(box);',
    `var run = (${sync});`,
    'try {',
    '  var r = await run({ apiBase: cfg.apiBase, key: cfg.key, onProgress: function (p) { text.textContent = "Searching " + p.done + " of " + p.total + "..."; } });',
    '  if (r.reason) text.textContent = r.reason;',
    '  else if (r.ok) text.textContent = "Synced: " + r.stored + " T&T prices saved from " + r.searched + " searches.";',
    '  else text.textContent = r.error || "The sync did not finish.";',
    '} catch (e) {',
    '  text.textContent = "The sync failed: " + (e && e.message ? e.message : e);',
    '}',
    '})();',
  ].join('');
  return 'javascript:' + encodeURIComponent(code);
}
