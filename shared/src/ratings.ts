import { z } from 'zod';
import { IsoDateSchema, addDaysIso } from './plan';

export const RATING_KINDS = ['up', 'down', 'never'] as const;
export type RatingKind = (typeof RATING_KINDS)[number];

export const FAVOURITE_LIMIT = 10;
export const AVOID_DAYS = 90;

export const RatingSchema = z.object({
  id: z.string().min(1),
  mealName: z.string().trim().min(1, 'Meal name is required').max(120),
  personId: z.string().min(1),
  rating: z.enum(RATING_KINDS),
  ingredientIds: z.array(z.string()),
  date: IsoDateSchema,
});
export type Rating = z.infer<typeof RatingSchema>;

/** Body for POST /ratings. The server adds the id and the date. */
export const RatingInputSchema = RatingSchema.pick({
  mealName: true,
  personId: true,
  rating: true,
  ingredientIds: true,
});
export type RatingInput = z.infer<typeof RatingInputSchema>;

export interface RatingSignals {
  favourites: string[]; // most recently liked first, at most FAVOURITE_LIMIT
  avoid: string[]; // disliked within AVOID_DAYS
  never: string[]; // ever marked never again
}

/**
 * What the planner should know from ratings. Ratings from people no longer in the household are
 * ignored. Meal names match case-insensitively, and each name is shown as it was most recently rated.
 *
 * - favourites: at least one 'up' and no 'down' or 'never' ever.
 * - avoid: any 'down' dated within AVOID_DAYS of `today`.
 * - never: any 'never', forever.
 */
export function ratingSignals(
  ratings: Rating[],
  people: readonly { id: string }[],
  today: string,
): RatingSignals {
  const inHousehold = new Set(people.map((p) => p.id));
  const cutoff = addDaysIso(today, -AVOID_DAYS);

  interface Group {
    name: string;
    nameDate: string;
    lastUp?: string;
    lastDown?: string;
    hasNever: boolean;
  }
  const groups = new Map<string, Group>();
  for (const r of ratings) {
    if (!inHousehold.has(r.personId)) continue;
    const key = r.mealName.trim().toLowerCase();
    const g = groups.get(key) ?? { name: r.mealName, nameDate: '', hasNever: false };
    if (r.date >= g.nameDate) {
      g.name = r.mealName;
      g.nameDate = r.date;
    }
    if (r.rating === 'up' && (g.lastUp === undefined || r.date > g.lastUp)) g.lastUp = r.date;
    if (r.rating === 'down' && (g.lastDown === undefined || r.date > g.lastDown)) g.lastDown = r.date;
    if (r.rating === 'never') g.hasNever = true;
    groups.set(key, g);
  }

  const favourites: { name: string; lastUp: string }[] = [];
  const avoid: { name: string; lastDown: string }[] = [];
  const never: string[] = [];
  for (const g of groups.values()) {
    if (g.hasNever) never.push(g.name);
    if (g.lastDown !== undefined && g.lastDown >= cutoff) avoid.push({ name: g.name, lastDown: g.lastDown });
    if (g.lastUp !== undefined && g.lastDown === undefined && !g.hasNever) {
      favourites.push({ name: g.name, lastUp: g.lastUp });
    }
  }

  return {
    favourites: favourites
      .sort((a, b) => b.lastUp.localeCompare(a.lastUp) || a.name.localeCompare(b.name))
      .slice(0, FAVOURITE_LIMIT)
      .map((f) => f.name),
    avoid: avoid.sort((a, b) => b.lastDown.localeCompare(a.lastDown) || a.name.localeCompare(b.name)).map((a) => a.name),
    never: never.sort((a, b) => a.localeCompare(b)),
  };
}
