import { z } from 'zod';
import { DAYS, DAY_LONG, type Day } from './calendar';
import type { PlannedMeal, ValidationIssue } from './plan';

// Batch prep (milestone 3B) and when each step is done. The planner model writes the steps; the worker
// validates them against the plan's meal ids before saving. Plans saved before the schedule and the
// storage object existed are read through readStoredPlan(), which fills in the missing parts.

export const PREP_TIMES = ['morning', 'afternoon', 'evening'] as const;
export type PrepTime = (typeof PREP_TIMES)[number];

export const STORAGE_METHODS = ['fridge', 'freezer', 'counter', 'pantry'] as const;
export type StorageMethod = (typeof STORAGE_METHODS)[number];

export const STORAGE_LABEL: Record<StorageMethod, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  counter: 'Counter',
  pantry: 'Pantry',
};

/** Where a prepped item is kept, how, and for how many days from the step's day. keepsDays is null when unknown. */
export interface PrepStorage {
  method: StorageMethod;
  how: string; // the container or wrapping, e.g. "airtight container"; may be empty
  keepsDays: number | null;
}

const StorageObjectSchema = z.object({
  method: z.enum(STORAGE_METHODS),
  how: z.string().trim().max(200),
  keepsDays: z.number().min(0).max(365).nullable(),
});

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

/** Reads one line of the older storage text, such as "fridge, 3 days" or "airtight container in freezer, 2 weeks". */
export function parseStorageText(text: string): PrepStorage {
  const lower = text.toLowerCase();
  const method: StorageMethod = /freez/.test(lower)
    ? 'freezer'
    : /fridge|refrig/.test(lower)
      ? 'fridge'
      : /pantry|cupboard|dry/.test(lower)
        ? 'pantry'
        : /counter|room temp|out of the fridge/.test(lower)
          ? 'counter'
          : 'fridge';
  const match = /(\d+)\s*(day|week|month)s?/.exec(lower);
  const keepsDays = match ? Number(match[1]) * UNIT_DAYS[match[2]!]! : null;
  const how = text
    .replace(/\b\d+\s*(?:days?|weeks?|months?)\b/gi, '')
    .replace(/\b(?:freezer|fridge|refrigerator|counter|pantry)\b/gi, '')
    .replace(/\b(?:in|for|on|keeps?|until)\b\s*(?=[,;]|$)/gi, '')
    .replace(/[,;\s]+/g, ' ')
    .replace(/^\s*[,;]?\s*|\s*[,;]?\s*$/g, '')
    .trim();
  return { method, how, keepsDays };
}

/**
 * Storage as saved or as the model returned it: the object, or the older one-line text. Undefined when
 * there is nothing usable.
 */
export function readStorage(raw: unknown): PrepStorage | undefined {
  if (typeof raw === 'string') return raw.trim() ? parseStorageText(raw) : undefined;
  const parsed = StorageObjectSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { keepsDays } = parsed.data;
  return { ...parsed.data, keepsDays: keepsDays === null ? null : Math.round(keepsDays) };
}

/** "Fridge, airtight container · keeps 3 days". The container is left out when it is empty or only repeats the method. */
export function storageSentence(s: PrepStorage): string {
  const label = STORAGE_LABEL[s.method];
  const head = s.how && s.how.toLowerCase() !== s.method ? `${label}, ${s.how}` : label;
  if (s.keepsDays === null) return head;
  return `${head} · keeps ${s.keepsDays} ${s.keepsDays === 1 ? 'day' : 'days'}`;
}

export const PrepStepSchema = z.object({
  id: z.string().min(1),
  task: z.string().trim().min(1).max(200),
  minutes: z.number().int().min(0).max(480),
  forMeals: z.array(z.string()), // meal ids from the plan this step serves
  day: z.enum(DAYS), // the day to do it: on or before the first meal it serves
  time: z.enum(PREP_TIMES).optional(), // when on that day, if it matters
  storage: z.preprocess(readStorage, StorageObjectSchema.optional()),
  useNote: z.string().trim().max(300).optional(), // how to split the item across days, and where the rest is kept
});
export type PrepStep = z.infer<typeof PrepStepSchema>;

/** A stored prep list. Steps saved before they had a day are done on the plan's prep day. */
export const PrepPlanSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const plan = raw as { day?: unknown; steps?: unknown };
    if (!Array.isArray(plan.steps)) return raw;
    return {
      ...plan,
      steps: plan.steps.map((s) => (s && typeof s === 'object' && (s as { day?: unknown }).day === undefined ? { ...s, day: plan.day } : s)),
    };
  },
  z.object({
    day: z.enum(DAYS),
    steps: z.array(PrepStepSchema),
    totalMinutes: z.number().int().min(0),
  }),
);
export type PrepPlan = z.infer<typeof PrepPlanSchema>;

/** What the model returns through the submit_prep tool, before ids and totals are added. */
export const RawPrepSchema = z.object({
  day: z.enum(DAYS).optional(),
  steps: z
    .array(
      z.object({
        task: z.string().trim().min(1).max(200),
        minutes: z.number().min(0).max(480),
        forMeals: z.array(z.string()),
        day: z.enum(DAYS).optional(),
        time: z.enum(PREP_TIMES).optional(),
        storage: z.preprocess(readStorage, StorageObjectSchema.optional()),
        useNote: z.string().trim().max(300).optional(),
      }),
    )
    .max(30),
});
export type RawPrep = z.infer<typeof RawPrepSchema>;

/** A stored prep list in the current shape, or undefined when it cannot be read. */
export function readStoredPrep(raw: unknown): PrepPlan | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = PrepPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A stored plan with its prep read into the current shape. A prep list that cannot be read is dropped. */
export function readStoredPlan<P extends { prep?: unknown }>(plan: P): Omit<P, 'prep'> & { prep?: PrepPlan } {
  const { prep: raw, ...rest } = plan;
  const prep = readStoredPrep(raw);
  return prep ? { ...rest, prep } : rest;
}

const TIME_ORDER: Record<PrepTime | 'batch', number> = { batch: 0, morning: 1, afternoon: 2, evening: 3 };

/** The sort key for a step's time: untimed steps first, then morning, afternoon and evening. */
export function prepTimeRank(time: PrepTime | undefined): number {
  return TIME_ORDER[time ?? 'batch'];
}

/**
 * Timing warnings for a prep list against the plan's meals. A step must be done on or before the first
 * meal it serves, and its storage must keep until the last meal it serves. Each breach is a warning, so
 * the plan keeps its meals and the household sees the fix. A breach never retries the planner.
 */
export function prepTimingIssues(prep: PrepPlan, meals: { id: string; day: Day }[]): ValidationIssue[] {
  const dayOf = new Map(meals.map((m) => [m.id, DAYS.indexOf(m.day)]));
  const name = (index: number) => DAY_LONG[DAYS[index]!];
  const issues: ValidationIssue[] = [];

  for (const step of prep.steps) {
    const uses = step.forMeals.map((id) => dayOf.get(id)).filter((d): d is number => d !== undefined);
    if (uses.length === 0) continue;
    const doneOn = DAYS.indexOf(step.day);
    const firstUse = Math.min(...uses);
    const lastUse = Math.max(...uses);
    const keeps = step.storage?.keepsDays ?? null;

    if (doneOn > firstUse) {
      issues.push({
        check: 'prep-timing',
        severity: 'warning',
        message: `${step.task} is due ${name(doneOn)} but the first meal it serves is ${name(firstUse)}: move it to ${name(firstUse)} or earlier.`,
      });
      continue;
    }
    if (keeps !== null && lastUse - doneOn > keeps) {
      const suggested = lastUse - keeps;
      const fix =
        suggested <= firstUse
          ? `prep it ${name(suggested)} instead.`
          : 'split it into two steps so each batch keeps.';
      issues.push({
        check: 'prep-timing',
        severity: 'warning',
        message: `${step.task} keeps ${keeps} ${keeps === 1 ? 'day' : 'days'} but is used ${lastUse - doneOn} days later: ${fix}`,
      });
    }
  }
  return issues;
}

/** A step that says food was cooked ahead: it needs a prep step that serves its meal. */
const PREPPED_WORD = /\b(prepped|pre-?cooked|batch[- ]cooked)\b/i;

/**
 * A warning for each meal whose steps say the food is prepped, batch-cooked or pre-cooked when no prep step serves that
 * meal (no prep list at all counts as none). The planner is told to refer to prepped items only when they are in `prep`.
 */
export function prepRefIssues(meals: PlannedMeal[], prep: PrepPlan | undefined): ValidationIssue[] {
  const served = new Set(prep?.steps.flatMap((s) => s.forMeals) ?? []);
  return meals
    .filter((m) => m.steps.some((s) => PREPPED_WORD.test(s)) && !served.has(m.id))
    .map((m) => ({
      check: 'prep-ref' as const,
      severity: 'warning' as const,
      message: `"${m.name}" uses prepped food, but no prep step covers that meal. Cook it within the meal, or tap Regenerate prep.`,
    }));
}
