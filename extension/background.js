// Atlas Provisions Sync. When the app asks (the page posts its sync key), this opens T&T's home page in a tab, runs the
// shared sync function in that tab as the shopper's own browser would, relays progress back to the app's tab, and closes
// the T&T tab. The key is held in memory for the one run and is not stored. Only one run at a time.
// In Chromium this is a service worker that loads tnt-sync.js here; in Firefox the manifest loads both scripts.
if (typeof importScripts === 'function') importScripts('tnt-sync.js');

const api = typeof browser !== 'undefined' ? browser : chrome;
const APP_PREFIX = 'https://adityajain.ca/provisions/';
const TNT_HOME = 'https://www.tntsupermarket.com/eng/';
const TNT_PREFIX = 'https://www.tntsupermarket.com/';
const LOAD_TIMEOUT_MS = 30000;
const CLOSE_ON_ERROR_MS = 3000;

let run = null; // { originTabId, tntTabId } while a sync is running

function sendToApp(tabId, msg) {
  api.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function isAndroid() {
  try {
    const info = await api.runtime.getPlatformInfo();
    return info.os === 'android';
  } catch (e) {
    return false;
  }
}

/** Resolves once the tab has finished loading, or rejects after LOAD_TIMEOUT_MS. */
function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timer = null;
    function done(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(done);
      resolve();
    }
    api.tabs.onUpdated.addListener(done);
    timer = setTimeout(() => {
      api.tabs.onUpdated.removeListener(done);
      reject(new Error('The T&T page took too long to load.'));
    }, LOAD_TIMEOUT_MS);
    api.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') done(tabId, { status: 'complete' });
    }, () => {});
  });
}

async function closeSoon(tabId, ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  api.tabs.remove(tabId).catch(() => {});
}

async function startRun(originTabId, apiBase, key) {
  let tntTabId = null;
  try {
    const tab = await api.tabs.create({ url: TNT_HOME, active: await isAndroid() });
    tntTabId = tab.id;
    run = { originTabId, tntTabId };
    await waitForLoad(tntTabId);
    const results = await api.scripting.executeScript({
      target: { tabId: tntTabId },
      world: 'MAIN',
      func: runTntSync,
      args: [{ apiBase, key, progressChannel: 'provisions-sync-tnt' }],
    });
    const summary = results && results[0] ? results[0].result : null;
    if (summary && (summary.ok || summary.reason)) {
      sendToApp(originTabId, { type: 'done', summary });
      closeSoon(tntTabId, 0);
    } else {
      sendToApp(originTabId, { type: 'error', message: (summary && summary.error) || 'The sync did not finish.', summary });
      closeSoon(tntTabId, CLOSE_ON_ERROR_MS);
    }
  } catch (e) {
    sendToApp(originTabId, { type: 'error', message: e && e.message ? e.message : 'The sync did not finish.' });
    if (tntTabId !== null) closeSoon(tntTabId, CLOSE_ON_ERROR_MS);
  } finally {
    run = null;
  }
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || !sender.tab || !sender.url) return undefined;

  if (msg && msg.type === 'start') {
    if (!sender.url.startsWith(APP_PREFIX)) return { error: 'The sync can only be started from Atlas Provisions.' };
    const apiBase = String(msg.apiBase || '');
    const key = String(msg.key || '');
    if (!apiBase.startsWith(APP_PREFIX) || key === '') return { error: 'The sync request was incomplete.' };
    if (run) return { error: 'A T&T sync is already running. Wait for it to finish.' };
    run = { originTabId: sender.tab.id, tntTabId: null };
    startRun(sender.tab.id, apiBase, key);
    return { ok: true };
  }

  if (msg && msg.type === 'tnt-progress' && sender.url.startsWith(TNT_PREFIX) && run && run.tntTabId === sender.tab.id) {
    sendToApp(run.originTabId, { type: 'progress', done: msg.done, total: msg.total, term: msg.term });
  }
  return undefined;
});
