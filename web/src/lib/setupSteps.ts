import {
  DAYS,
  DEFAULT_ON_HAND,
  DEFAULT_STORAGE,
  SLOTS,
  defaultCuisines,
  defaultHousehold,
  type Household,
} from '@provisions/shared';

/** The setup wizard's steps, in order. Step 1 is the welcome and step 8 the summary: neither has data of its own. */
export const SETUP_STEP_COUNT = 8;

export interface SetupStepInfo {
  step: number;
  title: string;
  /** One sentence on why this step matters. */
  why: string;
  /** Short name for the summary checklist. */
  short: string;
}

export const SETUP_STEPS: SetupStepInfo[] = [
  { step: 1, title: 'Welcome', why: 'A few answers now mean your first plan fits your week.', short: 'Welcome' },
  { step: 2, title: 'Who eats at home?', why: 'Every plan is made for these people, with their own schedule and allergies.', short: 'People' },
  { step: 3, title: 'Meals and schedule', why: 'Plans only fill the meals people actually eat, and fixed meals stay put.', short: 'Meals and schedule' },
  { step: 4, title: 'Where do you shop?', why: 'Prices come from these stores, and the plan picks the cheapest mix of them.', short: 'Stores' },
  { step: 5, title: 'What do you want to spend?', why: 'Each new plan starts from this amount. You can change it for any one week.', short: 'Budget' },
  { step: 6, title: 'What do you like to eat?', why: 'Cuisines, dishes and ingredients you want more or less of shape every plan.', short: 'Food you like' },
  { step: 7, title: 'Safety and kitchen', why: 'Allergies are a hard block. Equipment and storage limit which recipes make sense.', short: 'Safety and kitchen' },
  { step: 8, title: 'All set', why: 'Here is what is in place. Anything skipped can be added later on Household.', short: 'All set' },
];

/** Whether any person has a meal off, or missing, rather than the all-on default a new person gets. */
function scheduleChanged(h: Household): boolean {
  return Object.values(h.schedule).some((days) =>
    DAYS.some((d) => SLOTS.some((s) => days[d]?.[s] !== true)),
  );
}

/** Whether the step has anything set in it, judged from the household alone. Steps 1 and 8 are never "done" by data. */
export function stepDone(h: Household, step: number): boolean {
  const defaults = defaultHousehold();
  switch (step) {
    case 2:
      return h.people.length > 0;
    case 3:
      // A new person starts with every meal on, so only a meal turned off counts as a schedule set.
      return (
        h.fixedMeals.length > 0 ||
        scheduleChanged(h) ||
        h.prepDay !== defaults.prepDay
      );
    case 4:
      return h.stores.some((s) => s.enabled);
    case 5:
      return h.defaultBudget !== defaults.defaultBudget;
    case 6: {
      const base = defaultCuisines();
      const cuisineChanged = Object.entries(h.cuisines).some(([key, level]) => base[key] !== level);
      return h.avoidDishes.length > 0 || h.itemRules.length > 0 || cuisineChanged;
    }
    case 7: {
      const onHandChanged =
        JSON.stringify([...h.onHand].sort()) !== JSON.stringify([...DEFAULT_ON_HAND].sort());
      return (
        h.people.some((p) => p.allergies.length > 0) ||
        h.equipment.some((e) => e.owned) ||
        JSON.stringify(h.storage) !== JSON.stringify(DEFAULT_STORAGE) ||
        onHandChanged
      );
    }
    default:
      return false;
  }
}

/** Whether "Next" may move past a step. Only the people step gates it: a plan cannot be made without anyone to plan for. */
export function canAdvance(h: Household, step: number): boolean {
  return step !== 2 || h.people.length > 0;
}

/** A saved step number, or step 1 when the saved value is missing or out of range. */
export function clampStep(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= SETUP_STEP_COUNT ? n : 1;
}
