import {
  DAYS,
  DAY_LONG,
  INGREDIENT_BY_ID,
  PrepPlanSchema,
  RawPrepSchema,
  type Day,
  type MealPlan,
  type PrepPlan,
  type PrepStep,
} from '@provisions/shared';

/** Batch prep: one extra model call per plan, after the meals are checked. */

export interface PrepClient {
  submitPrep(system: string, payload: unknown): Promise<unknown>;
}

export const PREP_TOOL = {
  name: 'submit_prep',
  description: 'Submit the batch-prep steps for the prep day. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      day: { type: 'string', enum: [...DAYS], description: 'The prep day, as given in `prepDay` (its key)' },
      steps: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'What to do, e.g. "Cook a tray of chicken thighs"' },
            minutes: { type: 'number', description: 'Active minutes for this step' },
            forMeals: {
              type: 'array',
              items: { type: 'string' },
              description: 'Meal ids from `meals` that this step serves',
            },
            storage: { type: 'string', description: 'How to store it and until when, e.g. "fridge, 3 days"' },
          },
          required: ['task', 'minutes', 'forMeals'],
        },
      },
    },
    required: ['day', 'steps'],
  },
} as const;

export function prepSystemPrompt(prepDay: Day): string {
  return [
    `Turn this week's meals into a batch-prep list for ${DAY_LONG[prepDay]}: what to cook ahead (grains, proteins, sauces), what to wash and chop, what to marinate, with minutes and how to store each.`,
    "Only prep things that keep until they're eaten (respect shelf life: no cut avocado for 4 days). Use `shelfLifeDays` for each ingredient.",
    'Link each step to the meal ids it serves, in `forMeals`. Keep it under 90 minutes total when possible.',
    'Return the prep only via the submit_prep tool.',
  ].join('\n');
}

/** What the model sees: the week's meals with ingredient names, and shelf lives by name. */
export function buildPrepPayload(plan: MealPlan, prepDay: Day) {
  const shelfLifeDays: Record<string, number> = {};
  return {
    weekOf: plan.weekOf,
    prepDay: DAY_LONG[prepDay],
    meals: plan.meals.map((m) => ({
      id: m.id,
      day: DAY_LONG[m.day],
      slot: m.slot,
      name: m.name,
      activeMinutes: m.activeMinutes,
      ingredients: m.ingredients.map((i) => {
        const ing = INGREDIENT_BY_ID[i.ingredientId];
        if (ing) shelfLifeDays[ing.name] = ing.shelfLifeDays;
        return { name: ing?.name ?? i.ingredientId, qty: i.qty, unit: i.unit };
      }),
    })),
    shelfLifeDays,
  };
}

/**
 * Ask the model for the prep list and check it. Ids are assigned here, minutes are rounded, and
 * meal ids that are not in the plan are dropped. Throws when the output does not match the shape.
 */
export async function generatePrep(plan: MealPlan, prepDay: Day, client: PrepClient): Promise<PrepPlan> {
  const raw = await client.submitPrep(prepSystemPrompt(prepDay), buildPrepPayload(plan, prepDay));
  const parsed = RawPrepSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? ` (${first.path.join('.') || 'input'}: ${first.message})` : '';
    throw new Error(`The prep list was not in the expected shape${where}`);
  }

  const mealIds = new Set(plan.meals.map((m) => m.id));
  const steps: PrepStep[] = parsed.data.steps.map((s, i) => ({
    id: `prep-${i + 1}`,
    task: s.task,
    minutes: Math.round(s.minutes),
    forMeals: s.forMeals.filter((id) => mealIds.has(id)),
    ...(s.storage ? { storage: s.storage } : {}),
  }));
  const totalMinutes = steps.reduce((sum, s) => sum + s.minutes, 0);
  return PrepPlanSchema.parse({ day: prepDay, steps, totalMinutes });
}

/**
 * Attach batch prep to a plan for the household's prep day. Never throws: a failure becomes a
 * warning on the plan, and the meals are kept. Any earlier prep warning is replaced. With no prep
 * day the plan comes back without prep.
 */
export async function attachPrep(plan: MealPlan, prepDay: Day | null, client: PrepClient): Promise<MealPlan> {
  const { prep: _stale, ...rest } = plan;
  const issues = plan.issues.filter((i) => i.check !== 'prep');
  if (!prepDay) return { ...rest, issues };
  try {
    const prep = await generatePrep(plan, prepDay, client);
    return { ...rest, issues, prep };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error';
    return {
      ...rest,
      issues: [
        ...issues,
        { check: 'prep', severity: 'warning', message: `Prep plan couldn't be generated: ${reason}` },
      ],
    };
  }
}
