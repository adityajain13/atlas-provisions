// Runs on the Atlas Provisions pages. Marks the page as having the extension (the app reads the attribute), passes the
// app's sync request to the background, and passes progress and the result back to the page.
(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const VERSION = '1.0.0';

  function mark() {
    if (document.documentElement) document.documentElement.dataset.provisionsSync = VERSION;
  }
  mark();
  document.addEventListener('DOMContentLoaded', mark);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'provisions' || data.type !== 'tnt-sync') return;
    api.runtime.sendMessage({ type: 'start', apiBase: data.apiBase, key: data.key }).then((reply) => {
      if (reply && reply.error) {
        window.postMessage({ source: 'provisions-sync', type: 'error', message: reply.error }, location.origin);
      }
    }, () => {
      window.postMessage({ source: 'provisions-sync', type: 'error', message: 'The extension could not start the sync.' }, location.origin);
    });
  });

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || (msg.type !== 'progress' && msg.type !== 'done' && msg.type !== 'error')) return;
    window.postMessage(Object.assign({ source: 'provisions-sync' }, msg), location.origin);
  });
})();
