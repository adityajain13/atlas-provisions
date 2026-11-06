// The browser sync function against a fake fetch and fake timers: the plan, the searches sent from the T&T origin with
// the storefront's headers, the pacing, the stops on a human-verification page or a block, and the one results request.
// Also: the function's source runs on its own, as the bookmark and the extension run it. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTntSync, tntSyncSource, type TntSyncSummary } from './tntSyncScript';

const APP = 'https://adityajain.ca/provisions/api';
const KEY = 'key-for-tests-only-0123456789abcdef';
const HUMAN = "T&T asked to verify you're human. Open tntsupermarket.com, browse normally for a moment, then try again.";

const plan = {
  region: 'ON',
  postcode: 'L5L',
  query: 'query ProductSearch { products { items { name } } }',
  operationName: 'ProductSearch',
  pageSize: 24,
  delayMs: 800,
  terms: [
    { ingredientId: 'eggs-large', term: 'Large eggs' },
    { ingredientId: 'tofu-firm', term: 'Firm tofu' },
    { ingredientId: 'milk-2-percent', term: 'Milk 2%' },
  ],
};

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

/**
 * A fake of the app and the T&T site. `site` answers each storefront search by its input text; `results` answers the
 * POST. Every call is recorded.
 */
function fakeWeb(opts: { plan?: Response; site?: (term: string, n: number) => Response; results?: Response } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let searches = 0;
  const fn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const headers = { ...((init.headers as Record<string, string>) ?? {}) };
    calls.push({ url, method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : undefined });
    if (url === `${APP}/tnt-sync/plan`) return opts.plan ?? json(plan);
    if (url === `${APP}/tnt-sync/results`) return opts.results ?? json({ stored: 2, matched: 2, skipped: 0 });
    if (url.startsWith('/graphql?')) {
      const term = (JSON.parse(new URL(url, 'https://www.tntsupermarket.com').searchParams.get('variables') ?? '{}') as { inputText: string }).inputText;
      searches++;
      return opts.site ? opts.site(term, searches) : json({ data: { products: { items: [{ name: term }] } } });
    }
    throw new Error(`unexpected request ${url}`);
  });
  return { fn, calls, searches: () => searches };
}

/** Runs the sync and advances the fake clock until it finishes. */
async function runAll(opts: Parameters<typeof runTntSync>[0]): Promise<TntSyncSummary> {
  const run = runTntSync(opts);
  await vi.runAllTimersAsync();
  return run;
}

describe('runTntSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter: the pauses are exactly the plan's delay
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('searches each term from the site with the storefront headers, and posts the answers once', async () => {
    const web = fakeWeb();
    vi.stubGlobal('fetch', web.fn);
    const got = await runAll({ apiBase: APP, key: KEY });
    expect(got).toEqual({ ok: true, searched: 3, stored: 2, matched: 2, skipped: 0 });

    const planCall = web.calls[0]!;
    expect(planCall).toMatchObject({ url: `${APP}/tnt-sync/plan`, method: 'GET' });
    expect(planCall.headers.Authorization).toBe(`Bearer ${KEY}`);

    const searches = web.calls.filter((c) => c.url.startsWith('/graphql?'));
    expect(searches).toHaveLength(3);
    const first = new URL(searches[0]!.url, 'https://www.tntsupermarket.com');
    expect(first.searchParams.get('operationName')).toBe('ProductSearch');
    expect(first.searchParams.get('query')).toBe(plan.query);
    expect(JSON.parse(first.searchParams.get('variables')!)).toEqual({
      currentPage: 1,
      pageSize: 24,
      filters: {},
      inputText: 'Large eggs',
      sort: { relevance: 'DESC' },
    });
    expect(searches[0]!.headers).toMatchObject({
      store: 'default',
      'x-current-region': 'ON',
      'x-postcode': 'L5L',
      'x-current-shipping-method': 'delivery',
      'content-currency': 'CAD',
    });
    expect(searches[0]!.headers.Authorization).toBeUndefined();

    const posts = web.calls.filter((c) => c.url === `${APP}/tnt-sync/results`);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(posts[0]!.body!).results.map((r: { ingredientId: string }) => r.ingredientId)).toEqual(['eggs-large', 'tofu-firm', 'milk-2-percent']);
  });

  it('waits the plan delay between searches, with the jitter the script adds, and reports progress', async () => {
    const web = fakeWeb();
    vi.stubGlobal('fetch', web.fn);
    const progress: string[] = [];
    const run = runTntSync({ apiBase: APP, key: KEY, onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
    await vi.advanceTimersByTimeAsync(0);
    expect(web.searches()).toBe(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(web.searches()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(web.searches()).toBe(2);
    await vi.runAllTimersAsync();
    await run;
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
  });

  it('stops at a human-verification page (403) and still saves the searches it had', async () => {
    const web = fakeWeb({
      site: (_t, n) => (n === 2 ? new Response('denied', { status: 403 }) : json({ data: { products: { items: [] } } })),
    });
    vi.stubGlobal('fetch', web.fn);
    const got = await runAll({ apiBase: APP, key: KEY });
    expect(got).toMatchObject({ ok: false, searched: 1, error: HUMAN });
    expect(web.searches()).toBe(2);
    expect(web.calls.filter((c) => c.url === `${APP}/tnt-sync/results`)).toHaveLength(1);
  });

  it('stops at an HTML page answered with 200, which is the same kind of check', async () => {
    const web = fakeWeb({
      site: (_t, n) => (n === 1 ? json({}) : new Response('<html>verify</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })),
    });
    vi.stubGlobal('fetch', web.fn);
    const got = await runAll({ apiBase: APP, key: KEY });
    expect(got).toMatchObject({ ok: false, error: HUMAN });
    expect(web.searches()).toBe(2);
  });

  it('stops on a rate limit (429) with a plain message, and does not retry', async () => {
    const web = fakeWeb({ site: (_t, n) => (n === 1 ? json({ data: { products: { items: [] } } }) : new Response('slow', { status: 429 })) });
    vi.stubGlobal('fetch', web.fn);
    const got = await runAll({ apiBase: APP, key: KEY });
    expect(got.ok).toBe(false);
    expect(got.error).toMatch(/limiting lookups/);
    expect(web.searches()).toBe(2);
  });

  it('gives the sign-in message the app answers when the key is refused, and makes no search', async () => {
    const web = fakeWeb({ plan: json({ error: 'Sync key not recognised. Make a new one in Household.' }, 401) });
    vi.stubGlobal('fetch', web.fn);
    const got = await runAll({ apiBase: APP, key: KEY });
    expect(got).toMatchObject({ ok: false, searched: 0, error: 'Sync key not recognised. Make a new one in Household.' });
    expect(web.searches()).toBe(0);
  });

  it('reports the reason when there is nothing to look up, and does not search', async () => {
    const web = fakeWeb({ plan: json({ terms: [], reason: "T&T isn't one of your stores" }) });
    vi.stubGlobal('fetch', web.fn);
    expect(await runAll({ apiBase: APP, key: KEY })).toEqual({
      ok: true,
      searched: 0,
      stored: 0,
      matched: 0,
      skipped: 0,
      reason: "T&T isn't one of your stores",
    });
    expect(web.calls.some((c) => c.url.startsWith('/graphql?'))).toBe(false);
  });

  it('keeps the progress channel quiet unless one is named', async () => {
    const web = fakeWeb();
    vi.stubGlobal('fetch', web.fn);
    const posted = vi.fn();
    vi.stubGlobal('postMessage', posted);
    await runAll({ apiBase: APP, key: KEY });
    expect(posted).not.toHaveBeenCalled();
    await runAll({ apiBase: APP, key: KEY, progressChannel: 'provisions-sync-tnt' });
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ source: 'provisions-sync-tnt', type: 'progress', done: 1, total: 3 }), '*');
  });
});

describe('tntSyncSource', () => {
  it('is a function that runs on its own, with no reference to anything outside it', async () => {
    const src = tntSyncSource();
    expect(src.startsWith('async function runTntSync')).toBe(true);
    expect(src).not.toContain('__name');
    expect(src).not.toContain('//');
    const web = fakeWeb();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('fetch', web.fn);
    try {
      const standalone = new Function(`return (${src})`)() as typeof runTntSync;
      const run = standalone({ apiBase: APP, key: KEY });
      await vi.runAllTimersAsync();
      expect(await run).toMatchObject({ ok: true, searched: 3 });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
