# Atlas Provisions Sync

A browser extension that reads T&T prices for Atlas Provisions. It runs in your own browser, as you would when you browse
tntsupermarket.com, so T&T sees an ordinary visit. Press **Sync T&T prices** in the app (Household, then the T&T row under Stores) and it opens T&T's home page in a tab, searches the household's ingredients one at a time with a short pause between
them, then closes the tab. If T&T asks you to verify you are human, it stops and says so: open tntsupermarket.com, browse for
a moment, and try again.

Works in Firefox (desktop and Android) and in Chrome or Edge. On iPhone, use the bookmark in the app instead.

## Install

### Firefox (desktop and Android)

The extension is not listed on addons.mozilla.org. It is signed as an unlisted add-on, which needs the owner's AMO API keys.

1. From this folder, sign it (the keys come from the developer hub at addons.mozilla.org, under API keys):

   ```sh
   npx web-ext sign --source-dir . --channel=unlisted --api-key=YOUR_KEY --api-secret=YOUR_SECRET
   ```

   This writes a signed `.xpi` into `web-ext-artifacts/`.
2. Desktop: open the `.xpi` file in Firefox and confirm the install.
3. Android: open the `.xpi` from Firefox's downloads, or first turn on the debug menu: Settings, About Firefox, tap the
   Firefox logo five times. Then Settings, Install add-on from file, and pick the `.xpi`.

### Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and pick this `extension` folder.

## Build a zip

From the repo root, `npm run ext:zip` writes a zip of this folder to `extension-dist/`. The sync code the extension runs
is `tnt-sync.js`, a copy of `shared/src/tntSyncScript.ts`. After changing that file, run `npm run ext:sync` to refresh the
copy (the tests fail while it is stale).

## Privacy

The extension keeps the household's sync key only while a sync runs. It sends the T&T search results to the app, and
nothing else. It runs only on the Atlas Provisions pages and on tntsupermarket.com.
