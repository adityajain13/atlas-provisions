import { describe, expect, it, vi } from 'vitest';
import type { MealPlan } from '@provisions/shared';
import { anthropicPrepClient } from './claude';
import { attachPrep, buildPrepPayload, generatePrep, prepSystemPrompt, type PrepClient } from './prep';

function plan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    weekOf: '2026-11-12',
    request: { weekOf: '2026-11-12', budget: 150, cravings: [], overrides: [], useItUp: false },
    meals: [
      {
        id: 'thu-dinner',
        day: 'thu',
        slot: 'dinner',
        name: 'Sheet-pan chicken',
        eaters: ['ann'],
        ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.5, unit: 'kg' }],
        activeMinutes: 30,
        steps: [],
        tags: [],
      },
      {
        id: 'fri-lunch',
        day: 'fri',
        slot: 'lunch',
        name: 'Chicken wraps',
        eaters: ['ann'],
        ingredients: [],
        activeMinutes: 5,
        steps: [],
        tags: [],
      },
    ],
    fixedMeals: [],
    list: [],
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '2026-11-12T00:00:00.000Z',
    notes: '',
    ...over,
  };
}

const GOOD = {
  steps: [
    { task: 'Cook a tray of chicken thighs', minutes: 12.4, forMeals: ['thu-dinner', 'not-a-meal'], storage: 'fridge, 3 days' },
    { task: 'Chop onions', minutes: 5, forMeals: ['fri-lunch'] },
  ],
};

function fakeClient(reply: unknown) {
  const submitPrep = vi.fn(async () => reply);
  const client: PrepClient = { submitPrep };
  return { client, submitPrep };
}

describe('generatePrep', () => {
  it('returns a checked prep plan with ids, rounded minutes and only the plan\'s meal ids', async () => {
    const { client } = fakeClient(GOOD);
    const out = await generatePrep(plan(), 'sun', client);

    expect(out.day).toBe('sun');
    expect(out.steps).toEqual([
      { id: 'prep-1', task: 'Cook a tray of chicken thighs', minutes: 12, forMeals: ['thu-dinner'], storage: 'fridge, 3 days' },
      { id: 'prep-2', task: 'Chop onions', minutes: 5, forMeals: ['fri-lunch'] },
    ]);
    expect(out.totalMinutes).toBe(17);
  });

  it('sends the prep day by name and the meals with ingredient names and shelf lives', async () => {
    const { client, submitPrep } = fakeClient(GOOD);
    await generatePrep(plan(), 'sun', client);

    const [system, payload] = submitPrep.mock.calls[0] as unknown as [string, ReturnType<typeof buildPrepPayload>];
    expect(system).toContain('batch-prep list for Sunday');
    expect(system).toBe(prepSystemPrompt('sun'));
    expect(payload.prepDay).toBe('Sunday');
    expect(payload.meals[0]).toMatchObject({ id: 'thu-dinner', day: 'Thursday', slot: 'dinner' });
    expect(payload.meals[0]!.ingredients[0]).toEqual({ name: 'Boneless chicken thighs', qty: 0.5, unit: 'kg' });
    expect(payload.shelfLifeDays['Boneless chicken thighs']).toBeGreaterThan(0);
  });

  it('throws when the output has the wrong shape', async () => {
    await expect(generatePrep(plan(), 'sun', fakeClient({ steps: [{ task: '', minutes: 5, forMeals: [] }] }).client)).rejects.toThrow(
      'not in the expected shape',
    );
    await expect(generatePrep(plan(), 'sun', fakeClient({ nope: true }).client)).rejects.toThrow('not in the expected shape');
  });
});

describe('attachPrep', () => {
  it('keeps the plan when the prep client throws, and adds a warning', async () => {
    const client: PrepClient = { submitPrep: vi.fn(async () => { throw new Error('Claude API returned 503: busy'); }) };
    const before = plan();
    const out = await attachPrep(before, 'sun', client);

    expect(out.meals).toEqual(before.meals);
    expect(out.prep).toBeUndefined();
    expect(out.issues).toEqual([
      { check: 'prep', severity: 'warning', message: "Prep plan couldn't be generated: Claude API returned 503: busy" },
    ]);
  });

  it('attaches the prep plan on success', async () => {
    const out = await attachPrep(plan(), 'sun', fakeClient(GOOD).client);
    expect(out.prep?.steps).toHaveLength(2);
    expect(out.issues.filter((i) => i.check === 'prep')).toEqual([]);
  });

  it('does not call the model when there is no prep day', async () => {
    const { client, submitPrep } = fakeClient(GOOD);
    const out = await attachPrep(plan(), null, client);
    expect(submitPrep).not.toHaveBeenCalled();
    expect(out.prep).toBeUndefined();
  });

  it('replaces an earlier prep warning rather than stacking them', async () => {
    const failing: PrepClient = { submitPrep: async () => { throw new Error('down'); } };
    const once = await attachPrep(plan(), 'sun', failing);
    const twice = await attachPrep(once, 'sun', failing);
    expect(twice.issues.filter((i) => i.check === 'prep')).toHaveLength(1);
  });
});

describe('anthropicPrepClient', () => {
  it('calls the submit_prep tool and returns its input', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_prep', input: GOOD }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await anthropicPrepClient('key', 'haiku-test', fetchImpl).submitPrep('SYS', { a: 1 });

    expect(out).toEqual(GOOD);
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('haiku-test');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_prep' });
    expect(body.max_tokens).toBe(4000);
  });
});
