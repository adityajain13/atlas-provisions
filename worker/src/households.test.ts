// Households: who may use the app, joining, invites, membership changes, leaving and accepting, isolation
// between two households, and the monthly caps. The real Worker app on a real in-memory database. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type PlanRequest } from '@provisions/shared';
import { API, OWNER, PARTNER, call, count, householdOf, householdWith, json, rows, setup, signIn, withCookie } from './testing/app';
import { toolReply } from './testing/sse';
import { sentPlannerPayload } from './testing/payload';

const H = API;
const FRIEND = 'friend@example.com';
const ADMIN = 'admin@example.com';
const NOW = '2026-11-05T17:00:00Z';
const KEY = { ANTHROPIC_API_KEY: 'test-key' };
const ALLOW_BOTH = { ALLOWED_EMAILS: `${OWNER},${PARTNER}` };

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: 'sun', postalCode: 'M5V2T6', ...over };
}

const claudeReply = () => {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({ id: `${d}-${s}`, slotId: `${d}-${s}`, name: `${d} ${s}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
  );
  return toolReply({ meals, notes: 'x' });
};

const get = (path: string, cookie: string, env: unknown) => call(`${H}${path}`, { headers: { cookie } }, env);
const send = (method: string, path: string, body: unknown, cookie: string, env: unknown) =>
  call(`${H}${path}`, json(method, body, cookie), env);
const bare = (method: string, path: string, cookie: string, env: unknown) =>
  call(`${H}${path}`, { method, headers: { cookie } }, env);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('who may use the app', () => {
  it('gives an allow-listed address a household of its own on first use, owned by it', async () => {
    const { raw, env, cookies } = await setup([OWNER]);
    const res = await get('/household', cookies[OWNER]!, env);
    expect(res.status).toBe(200);
    // A brand-new owner household starts with first-time setup to do.
    expect(await res.json()).toEqual({ ...defaultHousehold(), setupDone: false });
    expect(rows(raw, 'SELECT name FROM households')).toEqual([{ name: "owner's household" }]);
    expect(rows(raw, 'SELECT role FROM household_members WHERE email = ?', OWNER)).toEqual([{ role: 'owner' }]);
  });

  it('refuses an address that is neither allow-listed, a member, nor invited, and ends its session', async () => {
    const { raw, env } = await setup([], {});
    const { cookie } = await signIn(raw, FRIEND);
    const res = await get('/household', cookie, env);
    expect(res.status).toBe(401);
    expect(count(raw, 'households')).toBe(0);
    expect(count(raw, 'sessions', 'email = ?', FRIEND)).toBe(0);
  });

  it('lets an invited address in: it joins the household as a member and the invite is used up', async () => {
    const { raw, env, cookies } = await setup([OWNER]);
    await get('/household', cookies[OWNER]!, env);
    const ownerHousehold = householdOf(raw, OWNER);
    const invite = await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env);
    expect(invite.status).toBe(201);

    const { cookie } = await signIn(raw, FRIEND);
    const res = await get('/members', cookie, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      household: { id: ownerHousehold },
      me: { email: FRIEND, role: 'member' },
      members: [
        { email: OWNER, role: 'owner' },
        { email: FRIEND, role: 'member' },
      ],
      invites: [],
    });
    expect(count(raw, 'household_invites')).toBe(0);
  });

  it('keeps the setup flag the owner saves, and returns it on the next read', async () => {
    const { env, cookies } = await setup([OWNER]);
    await get('/household', cookies[OWNER]!, env);
    const done = { ...defaultHousehold(), setupDone: true };
    expect((await send('PUT', '/household', done, cookies[OWNER]!, env)).status).toBe(200);
    expect(await (await get('/household', cookies[OWNER]!, env)).json()).toEqual(done);
  });

  it('lets an invited member join a household that has setup to do, with the document unchanged and its saves leaving the flag alone', async () => {
    const { raw, env, cookies } = await setup([OWNER]);
    const ownerView = await (await get('/household', cookies[OWNER]!, env)).json();
    expect(ownerView).toMatchObject({ setupDone: false });
    await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env);

    const { cookie } = await signIn(raw, FRIEND);
    const memberView = await (await get('/household', cookie, env)).json();
    expect(memberView).toEqual(ownerView);
    expect(((await (await get('/members', cookie, env)).json()) as { me: { role: string } }).me.role).toBe('member');

    // The member's own save of the Household page sends the same flag back.
    expect((await send('PUT', '/household', memberView, cookie, env)).status).toBe(200);
    expect(await (await get('/household', cookies[OWNER]!, env)).json()).toMatchObject({ setupDone: false });
  });

  it('lets an invited address in even when it is not on the allow-list, and keeps it out once removed', async () => {
    const { raw, env, cookies } = await setup([OWNER, FRIEND], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env);
    expect((await get('/household', cookies[FRIEND]!, env)).status).toBe(200);

    expect((await bare('DELETE', `/members/${FRIEND}`, cookies[OWNER]!, env)).status).toBe(200);
    expect((await get('/household', cookies[FRIEND]!, env)).status).toBe(401);
  });

  it('gives a removed member on the allow-list a household of its own, not the one it was removed from', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], ALLOW_BOTH);
    await get('/household', cookies[OWNER]!, env);
    const shared = householdOf(raw, OWNER);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    expect(householdOf(raw, PARTNER)).toBe(shared);

    await bare('DELETE', `/members/${PARTNER}`, cookies[OWNER]!, env);
    expect((await get('/household', cookies[PARTNER]!, env)).status).toBe(200);
    expect(householdOf(raw, PARTNER)).not.toBe(shared);
    expect(rows(raw, 'SELECT role FROM household_members WHERE email = ?', PARTNER)).toEqual([{ role: 'owner' }]);
  });
});

describe('invites', () => {
  it('lets only the owner invite, and says what went wrong', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER, FRIEND], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);

    const asMember = await send('POST', '/invites', { email: FRIEND }, cookies[PARTNER]!, env);
    expect(asMember.status).toBe(403);
    expect(await asMember.text()).toBe('Only the owner can do that.');

    const bad = await send('POST', '/invites', { email: 'not-an-email' }, cookies[OWNER]!, env);
    expect(bad.status).toBe(400);

    const self = await send('POST', '/invites', { email: OWNER.toUpperCase() }, cookies[OWNER]!, env);
    expect(self.status).toBe(409);

    const member = await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    expect(member.status).toBe(409);
    expect(await member.text()).toBe("They're already in this household.");
    expect(count(raw, 'household_invites')).toBe(0);
  });

  it('answers 201 with emailed false when no sign-in email is sent (no RESEND_API_KEY)', async () => {
    const { env, cookies } = await setup([OWNER], {});
    await get('/household', cookies[OWNER]!, env);
    const res = await send('POST', '/invites', { email: 'Friend@Example.com' }, cookies[OWNER]!, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invite: { email: string }; emailed: boolean };
    expect(body.invite.email).toBe(FRIEND);
    expect(body.emailed).toBe(false);
  });

  it('sends a short invite through Resend when it is set, and still succeeds when Resend fails', async () => {
    const fetchStub = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const { env, cookies } = await setup([OWNER], { RESEND_API_KEY: 're_test' });
    await get('/household', cookies[OWNER]!, env);
    const ok = (await (await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env)).json()) as { emailed: boolean };
    expect(ok.emailed).toBe(true);
    const payload = JSON.parse((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(payload.to).toEqual([FRIEND]);
    expect(payload.subject).toBe("You're invited to owner's household on Atlas Provisions");
    expect(payload.text).toContain('/provisions/login');

    fetchStub.mockImplementationOnce(async () => new Response('domain not verified', { status: 403 }));
    const failed = await send('POST', '/invites', { email: 'other@example.com' }, cookies[OWNER]!, env);
    expect(failed.status).toBe(201);
    expect(await failed.json()).toMatchObject({ emailed: false });
  });

  it('lists invites for the owner and cancels one; cancelling again is a 404', async () => {
    const { env, cookies } = await setup([OWNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env);
    const members = (await (await get('/members', cookies[OWNER]!, env)).json()) as { invites: { email: string }[] };
    expect(members.invites.map((i) => i.email)).toEqual([FRIEND]);

    expect((await bare('DELETE', `/invites/${FRIEND}`, cookies[OWNER]!, env)).status).toBe(200);
    expect((await bare('DELETE', `/invites/${FRIEND}`, cookies[OWNER]!, env)).status).toBe(404);
  });
});

describe('members and the household name', () => {
  it('lets the owner rename the household and refuses a member', async () => {
    const { env, cookies, raw } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);

    const renamed = await send('PATCH', '/household-name', { name: '  The Smiths  ' }, cookies[OWNER]!, env);
    expect(await renamed.json()).toEqual({ name: 'The Smiths' });
    expect(rows(raw, 'SELECT name FROM households')).toEqual([{ name: 'The Smiths' }]);

    const asMember = await send('PATCH', '/household-name', { name: 'Nope' }, cookies[PARTNER]!, env);
    expect(asMember.status).toBe(403);
    expect((await send('PATCH', '/household-name', { name: '   ' }, cookies[OWNER]!, env)).status).toBe(400);
  });

  it('shows a member the same list, read only, with its own role', async () => {
    const { env, cookies } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    const body = (await (await get('/members', cookies[PARTNER]!, env)).json()) as { me: unknown; members: unknown[] };
    expect(body.me).toEqual({ email: PARTNER, role: 'member' });
    expect(body.members).toHaveLength(2);
  });

  it('does not let a member remove the owner or anyone else', async () => {
    const { env, cookies } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    expect((await bare('DELETE', `/members/${OWNER}`, cookies[PARTNER]!, env)).status).toBe(403);
    expect((await bare('DELETE', `/members/${PARTNER}`, cookies[OWNER]!, env)).status).toBe(200);
    expect((await bare('DELETE', `/members/${PARTNER}`, cookies[OWNER]!, env)).status).toBe(404);
  });

  it('lets a member leave: the household stays for the others, and the leaver is signed out', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    const shared = householdOf(raw, OWNER);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);

    expect((await send('POST', '/leave', {}, cookies[PARTNER]!, env)).status).toBe(200);
    expect(count(raw, 'household_members', 'email = ?', PARTNER)).toBe(0);
    expect(count(raw, 'households', 'id = ?', shared)).toBe(1);
    expect((await get('/household', cookies[PARTNER]!, env)).status).toBe(401);
  });

  it('refuses the owner to leave while others are in the household', async () => {
    const { env, cookies } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    const res = await send('POST', '/leave', {}, cookies[OWNER]!, env);
    expect(res.status).toBe(409);
  });

  it('deletes the household with its data when its only member, the owner, leaves', async () => {
    const { raw, env, cookies } = await setup([OWNER], {});
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    const id = householdOf(raw, OWNER);
    await send('POST', '/pantry', { ingredientId: 'milk-2-percent', qty: 1 }, cookies[OWNER]!, env);
    expect(count(raw, 'pantry_items', 'household_id = ?', id)).toBe(1);

    const res = await send('POST', '/leave', {}, cookies[OWNER]!, env);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(count(raw, 'households', 'id = ?', id)).toBe(0);
    for (const table of ['household_members', 'pantry_items', 'meal_ratings', 'meal_plans', 'checks', 'usage', 'household_invites']) {
      expect(count(raw, table, 'household_id = ?', id), table).toBe(0);
    }
  });
});

describe('accepting an invite to another household', () => {
  it('deletes the accepting address’s own household when it was the only member, with its data', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], ALLOW_BOTH);
    await get('/household', cookies[OWNER]!, env);
    const ownerHousehold = householdOf(raw, OWNER);
    await get('/household', cookies[PARTNER]!, env);
    const partnerHousehold = householdOf(raw, PARTNER);
    await send('POST', '/pantry', { ingredientId: 'milk-2-percent', qty: 2 }, cookies[PARTNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);

    const invites = (await (await get('/my-invites', cookies[PARTNER]!, env)).json()) as {
      current: { householdId: string; role: string; memberCount: number };
      invites: { householdId: string; householdName: string }[];
    };
    expect(invites.current).toMatchObject({ householdId: partnerHousehold, role: 'owner', memberCount: 1 });
    expect(invites.invites).toEqual([expect.objectContaining({ householdId: ownerHousehold, householdName: "owner's household" })]);

    const accepted = await send('POST', '/invites/accept', { householdId: ownerHousehold }, cookies[PARTNER]!, env);
    expect(await accepted.json()).toMatchObject({ householdId: ownerHousehold, deleted: true });
    expect(count(raw, 'households', 'id = ?', partnerHousehold)).toBe(0);
    expect(count(raw, 'pantry_items', 'household_id = ?', partnerHousehold)).toBe(0);
    expect(householdOf(raw, PARTNER)).toBe(ownerHousehold);
    expect(rows(raw, 'SELECT role FROM household_members WHERE email = ?', PARTNER)).toEqual([{ role: 'member' }]);
    expect(count(raw, 'household_invites')).toBe(0);
  });

  it('leaves a shared household it is a member of, and keeps it', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER, FRIEND], ALLOW_BOTH);
    await get('/household', cookies[PARTNER]!, env);
    const partnerHousehold = householdOf(raw, PARTNER);
    await send('POST', '/invites', { email: FRIEND }, cookies[PARTNER]!, env);
    await get('/household', cookies[FRIEND]!, env);

    await get('/household', cookies[OWNER]!, env);
    const ownerHousehold = householdOf(raw, OWNER);
    await send('POST', '/invites', { email: FRIEND }, cookies[OWNER]!, env);

    const res = await send('POST', '/invites/accept', { householdId: ownerHousehold }, cookies[FRIEND]!, env);
    expect(await res.json()).toMatchObject({ householdId: ownerHousehold, deleted: false });
    expect(count(raw, 'households', 'id = ?', partnerHousehold)).toBe(1);
    expect(householdOf(raw, FRIEND)).toBe(ownerHousehold);
  });

  it('refuses an owner who has others in its household, and says what to do', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER, FRIEND], ALLOW_BOTH);
    await get('/household', cookies[PARTNER]!, env);
    const partnerHousehold = householdOf(raw, PARTNER);
    await send('POST', '/invites', { email: FRIEND }, cookies[PARTNER]!, env);
    await get('/household', cookies[FRIEND]!, env);
    await get('/household', cookies[OWNER]!, env);
    const ownerHousehold = householdOf(raw, OWNER);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);

    const res = await send('POST', '/invites/accept', { householdId: ownerHousehold }, cookies[PARTNER]!, env);
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/Remove them first/);
    expect(householdOf(raw, PARTNER)).toBe(partnerHousehold);
  });

  it('answers 404 for a household that has not invited the address', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], ALLOW_BOTH);
    await get('/household', cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    const res = await send('POST', '/invites/accept', { householdId: householdOf(raw, OWNER) }, cookies[PARTNER]!, env);
    expect(res.status).toBe(404);
  });
});

describe('households are isolated from each other', () => {
  async function twoHouseholds() {
    const ctx = await setup([OWNER, PARTNER], ALLOW_BOTH);
    const { raw, env, cookies } = ctx;
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    await householdWith(raw, env, cookies[PARTNER]!, PARTNER, household({ people: [{ id: 'zoe', name: 'Zoe', dietTags: [], allergies: [] }] }));
    return { ...ctx, a: householdOf(raw, OWNER), b: householdOf(raw, PARTNER) };
  }

  it('keeps pantry items apart: B cannot see, change or delete A’s, and A cannot see B’s', async () => {
    const { raw, env, cookies } = await twoHouseholds();
    const added = (await (await send('POST', '/pantry', { ingredientId: 'milk-2-percent', qty: 1 }, cookies[OWNER]!, env)).json()) as { id: string };

    expect(await (await get('/pantry', cookies[PARTNER]!, env)).json()).toEqual([]);
    const patch = await send('PATCH', `/pantry/${added.id}`, { qty: 9 }, cookies[PARTNER]!, env);
    expect(patch.status).toBe(404);
    expect((await bare('DELETE', `/pantry/${added.id}`, cookies[PARTNER]!, env)).status).toBe(404);
    expect(rows(raw, 'SELECT qty FROM pantry_items WHERE id = ?', added.id)).toEqual([{ qty: 1 }]);

    await send('POST', '/pantry', { ingredientId: 'cheddar', qty: 2 }, cookies[PARTNER]!, env);
    const ownerView = (await (await get('/pantry', cookies[OWNER]!, env)).json()) as { ingredientId: string }[];
    expect(ownerView.map((p) => p.ingredientId)).toEqual(['milk-2-percent']);
  });

  it('keeps plans apart: B cannot read A’s saved plan for the same week', async () => {
    const { raw, env, cookies, a } = await twoHouseholds();
    raw
      .prepare('INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES (?, ?, ?, ?)')
      .run(a, '2026-11-01', JSON.stringify({ weekOf: '2026-11-01' }), 'now');
    expect((await get('/plan/2026-11-01', cookies[OWNER]!, env)).status).toBe(200);
    expect((await get('/plan/2026-11-01', cookies[PARTNER]!, env)).status).toBe(404);
  });

  it('keeps ticks apart for the same week', async () => {
    const { raw, env, cookies } = await twoHouseholds();
    await send('PUT', '/checks/2026-11-01', { kind: 'list', itemId: 'milk-2-percent', checked: true }, cookies[OWNER]!, env);
    const partnerView = (await (await get('/checks/2026-11-01', cookies[PARTNER]!, env)).json()) as { list: object };
    expect(partnerView.list).toEqual({});
    await send('PUT', '/checks/2026-11-01', { kind: 'list', itemId: 'milk-2-percent', checked: false }, cookies[PARTNER]!, env);
    expect(rows(raw, "SELECT household_id, checked FROM checks WHERE item_id = 'milk-2-percent' ORDER BY household_id").length).toBe(2);
  });

  it('keeps ratings apart: B cannot rate A’s people, and sees none of A’s ratings', async () => {
    const { raw, env, cookies, a } = await twoHouseholds();
    raw
      .prepare(
        `INSERT INTO meal_ratings (household_id, id, meal_name, person_id, rating, ingredient_ids, date)
         VALUES (?, 'r1', 'Dal', 'ann', 'up', '[]', '2026-11-01')`,
      )
      .run(a);
    expect(await (await get('/ratings', cookies[PARTNER]!, env)).json()).toEqual([]);
    const res = await send('POST', '/ratings', { mealName: 'Dal', personId: 'ann', rating: 'down', ingredientIds: [] }, cookies[PARTNER]!, env);
    expect(res.status).toBe(400);
    expect(rows(raw, "SELECT rating FROM meal_ratings WHERE id = 'r1'")).toEqual([{ rating: 'up' }]);
  });

  it('keeps the household documents apart: B’s changes do not reach A, and B sees its own', async () => {
    const { raw, env, cookies } = await twoHouseholds();
    const edited = { ...household(), defaultBudget: 999 };
    expect((await send('PUT', '/household', edited, cookies[PARTNER]!, env)).status).toBe(200);
    expect(((await (await get('/household', cookies[OWNER]!, env)).json()) as Household).defaultBudget).toBe(150);
    expect(((await (await get('/household', cookies[PARTNER]!, env)).json()) as Household).defaultBudget).toBe(999);
    expect(((await (await get('/household', cookies[OWNER]!, env)).json()) as Household).people.map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect(raw.prepare('SELECT count(*) AS n FROM households').get()).toEqual({ n: 2 });
  });

  it('plans from its own pantry only', async () => {
    const { raw, env, cookies } = await twoHouseholds();
    await send('POST', '/pantry', { ingredientId: 'cheddar', qty: 2 }, cookies[OWNER]!, env);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const fetchMock = vi.fn(async () => claudeReply());
    vi.stubGlobal('fetch', fetchMock);
    const planEnv = { ...(env as object), ...KEY } as never;
    const req: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };
    // The planner's payload is JSON inside the request's message content.
    const sentBy = () =>
      fetchMock.mock.calls.map((c) => {
        const body = JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { messages: { content: unknown }[] };
        return JSON.stringify(sentPlannerPayload(body));
      });

    // Positive control: the owner's plan uses its pantry stock, so the request carries it.
    expect((await send('POST', '/plan', req, cookies[OWNER]!, planEnv)).status).toBe(200);
    expect(sentBy().some((body) => body.includes('"source":"pantry"'))).toBe(true);

    // The partner's household has no stock, so its request carries none.
    fetchMock.mockClear();
    expect((await send('POST', '/plan', req, cookies[PARTNER]!, planEnv)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(sentBy().some((body) => body.includes('"source":"pantry"'))).toBe(false);
    expect(count(raw, 'meal_plans')).toBe(2);
  });
});

describe('monthly caps', () => {
  const planReq: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  it('stops a household at its plan cap for the month, and counts each household separately', async () => {
    const fetchMock = vi.fn(async () => claudeReply());
    vi.stubGlobal('fetch', fetchMock);
    const { raw, env, cookies } = await setup([OWNER, PARTNER], { ...ALLOW_BOTH, ...KEY, PLAN_CAP_MONTHLY: '1' });
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    await householdWith(raw, env, cookies[PARTNER]!, PARTNER, household());

    expect((await send('POST', '/plan', planReq, cookies[OWNER]!, env)).status).toBe(200);
    const again = await send('POST', '/plan', planReq, cookies[OWNER]!, env);
    expect(again.status).toBe(429);
    expect(await again.text()).toBe('This household has used its 1 plan for this month. Resets on December 1, 2026.');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect((await send('POST', '/plan', planReq, cookies[PARTNER]!, env)).status).toBe(200);
    expect(count(raw, 'usage', "kind = 'plan'")).toBe(2);

    const usage = (await (await get('/usage', cookies[OWNER]!, env)).json()) as { month: string; caps: object; counts: object; resetsOn: string };
    expect(usage).toMatchObject({ month: '2026-11', resetsOn: '2026-12-01', counts: { plan: 1, receipt: 0, prep: 0 } });
    expect(usage.caps).toEqual({ plan: 1, receipt: 30, prep: 30, swap: 60 });
  });

  it('refuses receipt scans and prep refreshes at a cap of zero, before calling Claude', async () => {
    const fetchMock = vi.fn(async () => claudeReply());
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup([OWNER], { ...KEY, RECEIPT_CAP_MONTHLY: '0', PREP_CAP_MONTHLY: '0' });
    await get('/household', cookies[OWNER]!, env);

    const receipt = await send('POST', '/receipts/parse', { image: 'abc' }, cookies[OWNER]!, env);
    expect(receipt.status).toBe(429);
    expect(await receipt.text()).toBe('This household has used its 0 receipt scans for this month. Resets on December 1, 2026.');

    const prep = await bare('POST', '/plan/2026-11-01/prep', cookies[OWNER]!, env);
    expect(prep.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the default caps when the cap variables are not numbers', async () => {
    const { env, cookies } = await setup([OWNER], { PLAN_CAP_MONTHLY: 'twenty', RECEIPT_CAP_MONTHLY: '-1' });
    const usage = (await (await get('/usage', cookies[OWNER]!, env)).json()) as { caps: object };
    expect(usage.caps).toEqual({ plan: 20, receipt: 30, prep: 30, swap: 60 });
  });

  it('never refuses a household with an admin in it, still counts its calls, and says it has no limits', async () => {
    const fetchMock = vi.fn(async () => claudeReply());
    vi.stubGlobal('fetch', fetchMock);
    const { raw, env, cookies } = await setup([ADMIN, PARTNER], {
      ADMIN_EMAILS: ADMIN,
      ALLOWED_EMAILS: PARTNER,
      ...KEY,
      PLAN_CAP_MONTHLY: '1',
    });
    await householdWith(raw, env, cookies[ADMIN]!, ADMIN, household());
    await householdWith(raw, env, cookies[PARTNER]!, PARTNER, household());

    expect((await send('POST', '/plan', planReq, cookies[ADMIN]!, env)).status).toBe(200);
    expect((await send('POST', '/plan', planReq, cookies[ADMIN]!, env)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both calls are still counted: one usage row for the household, with the total.
    expect(rows(raw, "SELECT count FROM usage WHERE household_id = ? AND kind = 'plan'", householdOf(raw, ADMIN))).toEqual([{ count: 2 }]);
    const adminUsage = (await (await get('/usage', cookies[ADMIN]!, env)).json()) as { unlimited: boolean; counts: object; caps: object };
    expect(adminUsage).toMatchObject({ unlimited: true, counts: { plan: 2, receipt: 0, prep: 0 }, caps: { plan: 1, receipt: 30, prep: 30 } });

    // The partner's household has no admin, so it stops at its cap as before.
    expect((await send('POST', '/plan', planReq, cookies[PARTNER]!, env)).status).toBe(200);
    expect((await send('POST', '/plan', planReq, cookies[PARTNER]!, env)).status).toBe(429);
    const partnerUsage = (await (await get('/usage', cookies[PARTNER]!, env)).json()) as { unlimited: boolean };
    expect(partnerUsage.unlimited).toBe(false);
  });
});

describe('the members view', () => {
  it('is 401 without a session', async () => {
    const { env } = await setup([OWNER], {});
    expect((await call(`${H}/members`, {}, env)).status).toBe(401);
  });

  it('removes a member’s own address by leaving, the same as the leave route', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], {});
    await get('/household', cookies[OWNER]!, env);
    await send('POST', '/invites', { email: PARTNER }, cookies[OWNER]!, env);
    await get('/household', cookies[PARTNER]!, env);
    expect((await bare('DELETE', `/members/${PARTNER}`, cookies[PARTNER]!, env)).status).toBe(200);
    expect(count(raw, 'household_members', 'email = ?', PARTNER)).toBe(0);
  });
});


