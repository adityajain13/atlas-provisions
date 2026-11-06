// The T&T sync bookmark: a javascript: address that carries the app's address and the household's key, stays under the
// size limit, and parses as a script. No network.
import { describe, expect, it } from 'vitest';
import { BOOKMARKLET_MAX_LENGTH, buildSyncBookmarklet } from './tntBookmarklet';

const APP = 'https://adityajain.ca/provisions/api';
const KEY = 'AbC_dEf-123_xyz-0123456789abcdefGHIJKLMNOPQ';

describe('buildSyncBookmarklet', () => {
  it('is a javascript: address with the app address and the key inside', () => {
    const bm = buildSyncBookmarklet({ apiBase: APP, key: KEY });
    expect(bm.startsWith('javascript:')).toBe(true);
    const code = decodeURIComponent(bm.slice('javascript:'.length));
    expect(code).toContain(APP);
    expect(code).toContain(KEY);
  });

  it('stays under the size limit', () => {
    const bm = buildSyncBookmarklet({ apiBase: APP, key: KEY });
    expect(bm.length).toBeLessThan(BOOKMARKLET_MAX_LENGTH);
  });

  it('parses as a script, and does not navigate the page (it begins with void)', () => {
    const bm = buildSyncBookmarklet({ apiBase: APP, key: KEY });
    const code = decodeURIComponent(bm.slice('javascript:'.length));
    expect(code.startsWith('void (async function')).toBe(true);
    expect(() => new Function(code)).not.toThrow();
  });

  it('takes a key with quotes out of the script as data, not code', () => {
    const bm = buildSyncBookmarklet({ apiBase: APP, key: 'a"b' });
    const code = decodeURIComponent(bm.slice('javascript:'.length));
    expect(code).toContain('"key":"a\\"b"');
    expect(() => new Function(code)).not.toThrow();
  });
});
