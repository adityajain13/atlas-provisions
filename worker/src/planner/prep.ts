import {
  DAYS,
  DAY_LONG,
  INGREDIENT_BY_ID,
  PREP_TIMES,
  PrepPlanSchema,
  RawPrepSchema,
  STORAGE_METHODS,
  prepTimingIssues,
  type Day,
  type MealPlan,
  type PrepPlan,
  type PrepStep,
} from '@provisions/shared';

/** Batch prep: one extra model call per plan, after the meals are checked. */

export interface PrepClient {
  submitPrep(system: string, payload: unknown): Promise<unknown>;
}

/** The prep rules the planner follows. Shared by the meal call's system prompt and the regenerate call. */
export const PREP_RULES = [
  'Batch most steps on the prep day. Put a step on a later day or time when the item would not keep until its last meal, when it must be done close to cooking (thawing, soaking, marinating), or when it is quick and better fresh.',
  'Each step has a `day` (Sunday to Saturday) on or before the first meal it serves in `forMeals`. Use `time` (morning, afternoon or evening) when the time of day matters, for example thawing in the morning for dinner.',
  '`storage` has a `method` (fridge, freezer, counter or pantry), a `how` (the container or wrapping, such as "airtight container" or "wrapped in a damp paper towel"), and `keepsDays`: how many days the item stays good from the step\'s day to the last meal it serves. If it cannot keep that long, split the step into two so each batch keeps.',
  'When one prepped item serves meals on different days, say in `useNote` how to split it and where the rest is kept, for example "Use half Monday; the rest is for Wednesday, in the fridge."',
  'Only prep what keeps until it is eaten: respect each ingredient\'s `shelfLifeDays`. Link each step to the meal ids it serves in `forMeals`. Keep active prep under 90 minutes in total when possible.',
];

/** The step properties of the prep list, shared by the meal call and the regenerate call. */
export const PREP_STEP_PROPERTIES = {
  task: { type: 'string', description: 'What to do, e.g. "Cook a tray of chicken thighs"' },
  minutes: { type: 'number', description: 'Active minutes for this step' },
  forMeals: {
    type: 'array',
    items: { type: 'string' },
    description: 'Meal ids from `meals` that this step serves',
  },
  day: { type: 'string', enum: [...DAYS], description: 'The day to do this step, on or before its first meal' },
  time: { type: 'string', enum: [...PREP_TIMES], description: 'When that day, if it matters' },
  storage: {
    type: 'object',
    description: 'Where the prepped item is kept and for how long from this step',
    properties: {
      method: { type: 'string', enum: [...STORAGE_METHODS] },
      how: { type: 'string', description: 'The container or wrapping, e.g. "airtight container"' },
      keepsDays: { type: 'number', description: 'Days it stays good from this step to its last meal' },
    },
    required: ['method', 'how', 'keepsDays'],
  },
  useNote: {
    type: 'string',
    description: 'When one item serves several days: how to split it and where the rest is kept',
  },
} as const;

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
          properties: PREP_STEP_PROPERTIES,
          required: ['task', 'minutes', 'forMeals', 'day', 'storage'],
        },
      },
    },
    required: ['day', 'steps'],
  },
} as const;

export function prepSystemPrompt(prepDay: Day): string {
  return [
    `Turn this week's meals into a batch-prep list, mostly for ${DAY_LONG[prepDay]}: what to cook ahead (grains, proteins, sauces), what to wash and chop, what to marinate or thaw, with minutes, the day and time to do each, and how to store each.`,
    ...PREP_RULES,
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
 * Check a model's prep output and turn it into a PrepPlan. Ids are assigned here (the model's
 * step ids are ignored), minutes are rounded, and meal ids not in `mealIds` are dropped. The day
 * is `prepDay`, the household's setting. Throws when the output does not match the shape.
 */
export function normalisePrep(raw: unknown, prepDay: Day, mealIds: ReadonlySet<string>): PrepPlan {
  const parsed = RawPrepSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? ` (${first.path.join('.') || 'input'}: ${first.message})` : '';
    throw new Error(`The prep list was not in the expected shape${where}`);
  }

  const steps: PrepStep[] = parsed.data.steps.map((s, i) => ({
    id: `prep-${i + 1}`,
    task: s.task,
    minutes: Math.round(s.minutes),
    forMeals: s.forMeals.filter((id) => mealIds.has(id)),
    day: s.day ?? prepDay,
    ...(s.time ? { time: s.time } : {}),
    ...(s.storage ? { storage: s.storage } : {}),
    ...(s.useNote ? { useNote: s.useNote } : {}),
  }));
  const totalMinutes = steps.reduce((sum, s) => sum + s.minutes, 0);
  return PrepPlanSchema.parse({ day: prepDay, steps, totalMinutes });
}

/**
 * Ask the model for the prep list and check it. Used by the on-demand regenerate path. Throws
 * when the output does not match the shape.
 */
export async function generatePrep(plan: MealPlan, prepDay: Day, client: PrepClient): Promise<PrepPlan> {
  const raw = await client.submitPrep(prepSystemPrompt(prepDay), buildPrepPayload(plan, prepDay));
  return normalisePrep(raw, prepDay, new Set(plan.meals.map((m) => m.id)));
}

/**
 * Attach batch prep to a plan for the household's prep day. Never throws: a failure becomes a
 * warning on the plan, and the meals are kept. Any earlier prep warning is replaced. With no prep
 * day the plan comes back without prep.
 */
export async function attachPrep(plan: MealPlan, prepDay: Day | null, client: PrepClient): Promise<MealPlan> {
  const { prep: _stale, ...rest } = plan;
  const issues = plan.issues.filter((i) => i.check !== 'prep' && i.check !== 'prep-timing');
  if (!prepDay) return { ...rest, issues };
  try {
    const prep = await generatePrep(plan, prepDay, client);
    return { ...rest, issues: [...issues, ...prepTimingIssues(prep, plan.meals)], prep };
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
