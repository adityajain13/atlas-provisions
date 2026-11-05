// Who may sign in: the rules (settings, the app's list, admins, members and invites of approved owners) and the
// admin routes that manage the app's list. The real Worker app on a real in-memory database. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { defaultHousehold, type AccessView, type MeView } from '@provisions/shared';
import { API, call, count, householdOf, json, rows, send as emailBinding, setup, signIn } from './testing/app';

type Raw = DatabaseSync;

const ADMIN = 'admin@example.com';
const ADMIN_TWO = 'admin-two@example.com';
const SETTINGS = 'settings@example.com';
const OWNER = 'alex@example.com';
const MEMBER = 'member@example.com';
const INVITEE = 'invitee@example.com';
const OUTSIDER = 'outsider@example.com';
const OTHER_OWNER = 'casey@example.com';

/** Admins are named in ADMIN_EMAILS; nobody is approved by settings or the app's list unless a test says so. */
const ENV = { ADMIN_EMAILS: ADMIN, ALLOWED_EMAILS: '' };

const http = (method: string, path: string, cookie: string | undefined, env: unknown, body?: unknown) =>
  call(`${API}${path}`, body === undefined ? { method, headers: cookie ? { cookie } : {} } : json(method, body, cookie), env);

const status = async (path: string, cookie: string, env: unknown) => (await http('GET', path, cookie, env)).status;

/** Puts an address on the app's list, as the admin route does. */
const allow = (raw: Raw, email: string, by = ADMIN) =>
  raw.prepare('INSERT INTO allowed_emails (email, added_by, added_at, note) VALUES (?, ?, ?, NULL)').run(email, by, '2026-11-01T09:00:00.000Z');

/** Gives an address its household by its first request, as a sign-in does. */
const firstRequest = (cookie: string, env: unknown) => http('GET', '/household', cookie, env);

afterEach(() => {
  emailBinding.mockClear();
  vi.unstubAllGlobals();
});

describe('the rules: who may use the app', () => {
  it('approves an address listed in Worker settings, with no app list entry', async () => {
    const { env, cookies } = await setup([SETTINGS], { ADMIN_EMAILS: ADMIN, ALLOWED_EMAILS: SETTINGS });
    expect(await status('/household', cookies[SETTINGS]!, env)).toBe(200);
  });

  it('approves an address on the app list, and needs no ALLOWED_EMAILS for it', async () => {
    const { raw, env, cookies } = await setup([OWNER], ENV);
    allow(raw, OWNER);
    expect(await status('/household', cookies[OWNER]!, env)).toBe(200);
  });

  it('approves the admins named in ADMIN_EMAILS, without any other list', async () => {
    const { env, cookies } = await setup([ADMIN], ENV);
    expect(await status('/household', cookies[ADMIN]!, env)).toBe(200);
  });

  it('makes the owners of household h1 the admins when ADMIN_EMAILS is unset', async () => {
    const { raw, env, cookies } = await setup([OWNER, OUTSIDER], { ADMIN_EMAILS: undefined, ALLOWED_EMAILS: '' });
    raw
      .prepare(`INSERT INTO households (id, name, data, created_at, updated_at) VALUES ('h1', 'Home', ?, 'x', 'x')`)
      .run(JSON.stringify(defaultHousehold()));
    raw
      .prepare(`INSERT INTO household_members (household_id, email, role, joined_at) VALUES ('h1', ?, 'owner', 'x')`)
      .run(OWNER);
    expect(await status('/household', cookies[OWNER]!, env)).toBe(200);
    expect(await status('/household', cookies[OUTSIDER]!, env)).toBe(401);
    const me = (await (await http('GET', '/me', cookies[OWNER], env)).json()) as MeView;
    expect(me.isAdmin).toBe(true);
  });

  it('turns away an address that is not approved, is not a member, and has no invite', async () => {
    const { env, cookies } = await setup([OUTSIDER], ENV);
    const res = await http('GET', '/household', cookies[OUTSIDER], env);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('lets a member in while its household has an approved owner, and blocks the owner and members once the owner is removed', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, MEMBER], ENV);
    allow(raw, OWNER);
    await firstRequest(cookies[OWNER]!, env);
    expect((await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER })).status).toBe(201);
    expect(await status('/household', cookies[MEMBER]!, env)).toBe(200);
    expect(householdOf(raw, MEMBER)).toBe(householdOf(raw, OWNER));

    expect((await http('DELETE', `/access/${OWNER}`, cookies[ADMIN], env)).status).toBe(200);
    expect(await status('/household', cookies[OWNER]!, env)).toBe(401);
    expect(await status('/household', cookies[MEMBER]!, env)).toBe(401);
    expect(count(raw, 'household_members', 'email = ?', MEMBER)).toBe(1);

    // Approving the owner again restores the member, with the same household. The 401 ended the old session.
    allow(raw, OWNER);
    const memberAgain = (await signIn(raw, MEMBER, 'member-again')).cookie;
    expect(await status('/household', memberAgain, env)).toBe(200);
    expect(householdOf(raw, MEMBER)).toBe(householdOf(raw, OWNER));
  });

  it('keeps a member of an unapproved owner’s household when the member is approved in its own right', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, MEMBER], ENV);
    allow(raw, OWNER);
    await firstRequest(cookies[OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER });
    await firstRequest(cookies[MEMBER]!, env);

    await http('DELETE', `/access/${OWNER}`, cookies[ADMIN], env);
    allow(raw, MEMBER);
    expect(await status('/household', cookies[MEMBER]!, env)).toBe(200);
    expect(await status('/household', cookies[OWNER]!, env)).toBe(401);
  });

  it('blocks an invitee of a household whose owner is no longer approved, and admits it when the owner is approved again', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, INVITEE], ENV);
    allow(raw, OWNER);
    await firstRequest(cookies[OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: INVITEE });

    await http('DELETE', `/access/${OWNER}`, cookies[ADMIN], env);
    expect(count(raw, 'household_invites', 'email = ?', INVITEE)).toBe(1);
    expect(await status('/household', cookies[INVITEE]!, env)).toBe(401);

    allow(raw, OWNER);
    const inviteeAgain = (await signIn(raw, INVITEE, 'invitee-again')).cookie;
    expect(await status('/household', inviteeAgain, env)).toBe(200);
  });

  it('gives an invitee of an approved owner the owner’s household', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, OTHER_OWNER, INVITEE], ENV);
    allow(raw, OWNER);
    allow(raw, OTHER_OWNER);
    await firstRequest(cookies[OWNER]!, env);
    await firstRequest(cookies[OTHER_OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: INVITEE });
    expect(await status('/household', cookies[INVITEE]!, env)).toBe(200);
    expect(householdOf(raw, INVITEE)).toBe(householdOf(raw, OWNER));
  });

  it('refuses sign-in for a member of a household with no approved owner, even with an invite elsewhere, so sign-in and every request agree', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, OTHER_OWNER, MEMBER], ENV);
    allow(raw, OWNER);
    allow(raw, OTHER_OWNER);
    await firstRequest(cookies[OWNER]!, env);
    await firstRequest(cookies[OTHER_OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER });
    await firstRequest(cookies[MEMBER]!, env);
    await http('DELETE', `/access/${OWNER}`, cookies[ADMIN], env);
    await http('POST', '/invites', cookies[OTHER_OWNER], env, { email: MEMBER });

    expect(await status('/household', cookies[MEMBER]!, env)).toBe(401);
    expect(await (await call(`${API}/auth/request`, json('POST', { email: MEMBER }), env)).json()).toEqual({ ok: true });
    expect(emailBinding).not.toHaveBeenCalled();
    expect(householdOf(raw, MEMBER)).toBe(householdOf(raw, OWNER));
  });
});

describe('admin routes', () => {
  it('lets only admins read, add and remove access; everyone else gets 403', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER], ENV);
    allow(raw, OWNER);
    for (const [method, path, body] of [
      ['GET', '/access', undefined],
      ['POST', '/access', { email: MEMBER }],
      ['DELETE', `/access/${MEMBER}`, undefined],
    ] as const) {
      const res = await http(method, path, cookies[OWNER], env, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.text()).toBe('Only admins can manage access.');
    }
    expect(count(raw, 'allowed_emails', 'email = ?', MEMBER)).toBe(0);
    const me = (await (await http('GET', '/me', cookies[OWNER], env)).json()) as MeView;
    expect(me).toEqual({ email: OWNER, isAdmin: false });
    expect(await (await http('GET', '/me', cookies[ADMIN], env)).json()).toEqual({ email: ADMIN, isAdmin: true });
  });

  it('lists every approved address once, admins first, with its source and household', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER], { ADMIN_EMAILS: ADMIN, ALLOWED_EMAILS: `${SETTINGS},${ADMIN}` });
    await http('POST', '/access', cookies[ADMIN], env, { email: OWNER });
    await firstRequest(cookies[OWNER]!, env);

    const res = await http('GET', '/access', cookies[ADMIN], env);
    const view = (await res.json()) as AccessView;
    expect(view.isAdmin).toBe(true);
    expect(view.entries).toMatchObject([
      { email: ADMIN, source: 'admin' },
      { email: SETTINGS, source: 'settings' },
      {
        email: OWNER,
        source: 'app',
        addedBy: ADMIN,
        household: { name: "alex's household", role: 'owner', soleOwner: true },
      },
    ]);
  });

  it('lists the h1 owners as admins when ADMIN_EMAILS is unset', async () => {
    const { raw, env, cookies } = await setup([OWNER], { ADMIN_EMAILS: undefined, ALLOWED_EMAILS: '' });
    raw.prepare(`INSERT INTO households (id, name, data, created_at, updated_at) VALUES ('h1', 'Home', ?, 'x', 'x')`).run(JSON.stringify(defaultHousehold()));
    raw.prepare(`INSERT INTO household_members (household_id, email, role, joined_at) VALUES ('h1', ?, 'owner', 'x')`).run(OWNER);
    const view = (await (await http('GET', '/access', cookies[OWNER], env)).json()) as AccessView;
    expect(view.entries).toMatchObject([{ email: OWNER, source: 'admin', household: { id: 'h1', name: 'Home', role: 'owner', soleOwner: true } }]);
  });

  it('adds an address in lower case, validates it, and refuses one that already has access', async () => {
    const { raw, env, cookies } = await setup([ADMIN], { ADMIN_EMAILS: ADMIN, ALLOWED_EMAILS: SETTINGS });
    const added = await http('POST', '/access', cookies[ADMIN], env, { email: '  New.Person@Example.com ' });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({
      entry: { email: 'new.person@example.com', source: 'app', addedBy: ADMIN },
      emailed: false,
    });
    expect(rows(raw, 'SELECT email, added_by, note FROM allowed_emails')).toEqual([
      { email: 'new.person@example.com', added_by: ADMIN, note: null },
    ]);

    expect((await http('POST', '/access', cookies[ADMIN], env, { email: 'not-an-email' })).status).toBe(400);
    const again = await http('POST', '/access', cookies[ADMIN], env, { email: 'NEW.PERSON@example.com' });
    expect(again.status).toBe(409);
    expect(await again.text()).toBe('They already have access.');
    expect((await http('POST', '/access', cookies[ADMIN], env, { email: SETTINGS })).status).toBe(409);
    expect((await http('POST', '/access', cookies[ADMIN], env, { email: ADMIN })).status).toBe(409);
  });

  it('emails the access only when asked and RESEND_API_KEY is set, and still gives access when the email fails', async () => {
    const fetchStub = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const { raw, env, cookies } = await setup([ADMIN], { ...ENV, RESEND_API_KEY: 're_test' });

    const quiet = (await (await http('POST', '/access', cookies[ADMIN], env, { email: 'quiet@example.com', sendEmail: false })).json()) as { emailed: boolean };
    expect(quiet.emailed).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();

    const sent = (await (await http('POST', '/access', cookies[ADMIN], env, { email: 'hello@example.com', sendEmail: true })).json()) as { emailed: boolean };
    expect(sent.emailed).toBe(true);
    const payload = JSON.parse((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(payload.to).toEqual(['hello@example.com']);
    expect(payload.subject).toBe("You've been given access to Atlas Provisions");
    expect(payload.text).toContain(`${ADMIN} gave you access`);
    expect(payload.text).toContain('/provisions/login');

    fetchStub.mockImplementationOnce(async () => new Response('domain not verified', { status: 403 }));
    const failed = await http('POST', '/access', cookies[ADMIN], env, { email: 'failed@example.com', sendEmail: true });
    expect(failed.status).toBe(201);
    expect(await failed.json()).toMatchObject({ entry: { email: 'failed@example.com' }, emailed: false });
    expect(count(raw, 'allowed_emails', 'email = ?', 'failed@example.com')).toBe(1);

    expect(emailBinding).not.toHaveBeenCalled();
  });

  it('never sends the access email when RESEND_API_KEY is unset, even when asked', async () => {
    const { raw, env, cookies } = await setup([ADMIN], ENV);
    const res = await http('POST', '/access', cookies[ADMIN], env, { email: 'nomail@example.com', sendEmail: true });
    expect(count(raw, 'allowed_emails', 'email = ?', 'nomail@example.com')).toBe(1);
    expect(await res.json()).toMatchObject({ emailed: false });
    expect(emailBinding).not.toHaveBeenCalled();
  });

  it('removes an app address and ends its sessions at once, including sessions written with a capital letter', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER], ENV);
    await http('POST', '/access', cookies[ADMIN], env, { email: OWNER });
    await firstRequest(cookies[OWNER]!, env);
    raw
      .prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES (?, ?, 0, ?, NULL)')
      .run('legacy-hash', 'Alex@Example.com', Date.now() + 60_000);
    expect(count(raw, 'sessions', 'email = ?', OWNER)).toBe(1);

    const removed = await http('DELETE', `/access/${OWNER.toUpperCase()}`, cookies[ADMIN], env);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, householdDeleted: false });
    expect(count(raw, 'allowed_emails', 'email = ?', OWNER)).toBe(0);
    expect(count(raw, 'sessions', 'lower(email) = ?', OWNER)).toBe(0);
    expect((await http('GET', '/household', cookies[OWNER], env)).status).toBe(401);
  });

  it('refuses to remove Worker settings and admin addresses, or the admin’s own address, and says so', async () => {
    const { raw, env, cookies } = await setup([ADMIN, ADMIN_TWO], { ADMIN_EMAILS: `${ADMIN},${ADMIN_TWO}`, ALLOWED_EMAILS: SETTINGS });
    const self = await http('DELETE', `/access/${ADMIN}`, cookies[ADMIN], env);
    expect(self.status).toBe(400);
    expect(await self.text()).toBe("You can't remove your own access.");

    const settings = await http('DELETE', `/access/${SETTINGS}`, cookies[ADMIN], env);
    expect(settings.status).toBe(400);
    expect(await settings.text()).toBe('This address is set in Worker settings.');

    const admin = await http('DELETE', `/access/${ADMIN_TWO}`, cookies[ADMIN], env);
    expect(admin.status).toBe(400);
    expect(await admin.text()).toBe('This address is an admin, so its access is not removed here.');

    expect((await http('DELETE', `/access/${OUTSIDER}`, cookies[ADMIN], env)).status).toBe(404);
    expect(count(raw, 'allowed_emails')).toBe(0);
  });

  it('with deleteHousehold=1, deletes a sole owner’s household and its data, and its members lose access', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, MEMBER], ENV);
    await http('POST', '/access', cookies[ADMIN], env, { email: OWNER });
    await firstRequest(cookies[OWNER]!, env);
    const household = householdOf(raw, OWNER);
    await http('POST', '/pantry', cookies[OWNER], env, { ingredientId: 'milk-2-percent', qty: 1 });
    await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER });
    await firstRequest(cookies[MEMBER]!, env);
    expect(count(raw, 'pantry_items', 'household_id = ?', household)).toBe(1);

    const res = await http('DELETE', `/access/${OWNER}?deleteHousehold=1`, cookies[ADMIN], env);
    expect(await res.json()).toEqual({ ok: true, householdDeleted: true });
    expect(count(raw, 'households', 'id = ?', household)).toBe(0);
    for (const table of ['household_members', 'pantry_items', 'meal_ratings', 'meal_plans', 'checks', 'usage', 'household_invites']) {
      expect(count(raw, table, 'household_id = ?', household), table).toBe(0);
    }
    expect(await status('/household', cookies[MEMBER]!, env)).toBe(401);
    expect(await status('/household', cookies[OWNER]!, env)).toBe(401);
  });

  it('with deleteHousehold=1, leaves the household alone when the address is not its only owner', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, OTHER_OWNER], ENV);
    await http('POST', '/access', cookies[ADMIN], env, { email: OWNER });
    await http('POST', '/access', cookies[ADMIN], env, { email: OTHER_OWNER });
    await firstRequest(cookies[OWNER]!, env);
    const household = householdOf(raw, OWNER);
    raw.prepare(`INSERT INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'owner', 'x')`).run(household, OTHER_OWNER);

    const res = await http('DELETE', `/access/${OWNER}?deleteHousehold=1`, cookies[ADMIN], env);
    expect(await res.json()).toEqual({ ok: true, householdDeleted: false });
    expect(count(raw, 'households', 'id = ?', household)).toBe(1);
  });

  it('with deleteHousehold=1, leaves a household alone when the address is only a member of it', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, MEMBER], ENV);
    allow(raw, OWNER);
    allow(raw, MEMBER);
    await firstRequest(cookies[OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER });
    await firstRequest(cookies[MEMBER]!, env);
    const household = householdOf(raw, OWNER);

    const res = await http('DELETE', `/access/${MEMBER}?deleteHousehold=1`, cookies[ADMIN], env);
    expect(await res.json()).toEqual({ ok: true, householdDeleted: false });
    expect(count(raw, 'households', 'id = ?', household)).toBe(1);
  });

  it('a removed owner’s household is not deleted without deleteHousehold=1, and its members are blocked by the removal', async () => {
    const { raw, env, cookies } = await setup([ADMIN, OWNER, MEMBER], ENV);
    allow(raw, OWNER);
    await firstRequest(cookies[OWNER]!, env);
    await http('POST', '/invites', cookies[OWNER], env, { email: MEMBER });
    await firstRequest(cookies[MEMBER]!, env);
    const household = householdOf(raw, OWNER);

    await http('DELETE', `/access/${OWNER}`, cookies[ADMIN], env);
    expect(count(raw, 'households', 'id = ?', household)).toBe(1);
    expect(count(raw, 'household_members', 'email = ?', MEMBER)).toBe(1);
    expect(await status('/household', cookies[MEMBER]!, env)).toBe(401);
  });
});
