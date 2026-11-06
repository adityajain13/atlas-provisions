// Writes extension/tnt-sync.js from the shared sync function, so the extension runs the same code as the bookmark.
// Run it after changing shared/src/tntSyncScript.ts: npm run ext:sync. shared/src/extension.test.ts fails when the copy
// is stale.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXTENSION_SYNC_HEADER, tntSyncSource } from '../shared/src/tntSyncScript';

const target = fileURLToPath(new URL('../extension/tnt-sync.js', import.meta.url));
writeFileSync(target, EXTENSION_SYNC_HEADER + tntSyncSource() + '\n');
console.log(`wrote ${target}`);
