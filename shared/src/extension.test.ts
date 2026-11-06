// The browser extension's files: the manifest keys the two browsers need, the scripts it names exist, the copy of the sync
// function matches the shared source (npm run ext:sync), and the icons are there. Reads only files in the repo. No network.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXTENSION_SYNC_HEADER, tntSyncSource } from './tntSyncScript';

const dir = fileURLToPath(new URL('../../extension/', import.meta.url));
const read = (name: string) => readFileSync(dir + name, 'utf8');
const manifest = JSON.parse(read('manifest.json')) as Record<string, any>;

describe('extension manifest', () => {
  it('is Manifest V3 with the sync permissions and the two host patterns', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.permissions).toEqual(expect.arrayContaining(['scripting', 'tabs', 'storage']));
    expect(manifest.host_permissions).toEqual(['https://www.tntsupermarket.com/*', 'https://adityajain.ca/provisions/*']);
  });

  it('names the Firefox id and the minimum Firefox version for desktop and Android', () => {
    expect(manifest.browser_specific_settings.gecko).toEqual({ id: 'provisions-sync@adityajain.ca', strict_min_version: '128.0' });
    expect(manifest.browser_specific_settings.gecko_android.strict_min_version).toBe('128.0');
  });

  it('gives Chromium a service worker and Firefox the scripts, both loading the shared sync first', () => {
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.background.scripts).toEqual(['tnt-sync.js', 'background.js']);
  });

  it('runs the app content script on the provisions pages and the T&T content script on T&T', () => {
    const scripts = manifest.content_scripts as { matches: string[]; js: string[]; run_at: string }[];
    expect(scripts).toEqual([
      { matches: ['https://adityajain.ca/provisions/*'], js: ['content-app.js'], run_at: 'document_start' },
      { matches: ['https://www.tntsupermarket.com/*'], js: ['content-tnt.js'], run_at: 'document_start' },
    ]);
  });

  it('names only files that exist, with the four icon sizes', () => {
    const named = [
      ...manifest.background.scripts,
      manifest.background.service_worker,
      ...manifest.content_scripts.flatMap((s: { js: string[] }) => s.js),
      ...Object.values(manifest.icons as Record<string, string>),
    ] as string[];
    for (const f of named) expect(existsSync(dir + f), f).toBe(true);
    expect(Object.keys(manifest.icons).sort()).toEqual(['128', '16', '32', '48']);
  });
});

describe('extension sync copy', () => {
  it('is the shared sync function, generated (run npm run ext:sync after a change)', () => {
    expect(read('tnt-sync.js')).toBe(EXTENSION_SYNC_HEADER + tntSyncSource() + '\n');
  });
});
