// Runs on tntsupermarket.com. The sync script runs in the page and posts its progress to the window; this relays it to the
// background, which passes it to the app's tab. Nothing else on the T&T page is read or changed.
(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'provisions-sync-tnt') return;
    api.runtime.sendMessage({ type: 'tnt-progress', done: event.data.done, total: event.data.total, term: event.data.term }).catch(() => {});
  });
})();
