import { describe, expect, it } from 'vitest';
import { FAVOURITE_LIMIT, RatingInputSchema, ratingSignals, type Rating } from './ratings';

const people = [{ id: 'ann' }, { id: 'ben' }];
const TODAY = '2026-11-10';

let n = 0;
function rating(over: Partial<Rating> & Pick<Rating, 'mealName' | 'rating' | 'date'>): Rating {
  n++;
  return { id: `r${n}`, personId: 'ann', ingredientIds: [], ...over };
}

describe('ratingSignals', () => {
  it('lists a liked meal as a favourite, and nothing else', () => {
    const out = ratingSignals([rating({ mealName: 'Chili', rating: 'up', date: '2026-10-01' })], people, TODAY);
    expect(out).toEqual({ favourites: ['Chili'], avoid: [], never: [] });
  });

  it('keeps a meal out of favourites once anyone has disliked it', () => {
    const out = ratingSignals(
      [
        rating({ mealName: 'Chili', rating: 'up', date: '2026-10-01', personId: 'ann' }),
        rating({ mealName: 'Chili', rating: 'down', date: '2026-10-05', personId: 'ben' }),
      ],
      people,
      TODAY,
    );
    expect(out.favourites).toEqual([]);
    expect(out.avoid).toEqual(['Chili']);
  });

  it('avoids a disliked meal for 90 days, and no longer', () => {
    const recent = rating({ mealName: 'Fish tacos', rating: 'down', date: '2026-09-02' }); // 69 days before
    const old = rating({ mealName: 'Meatloaf', rating: 'down', date: '2026-07-01' }); // 132 days before
    const out = ratingSignals([recent, old], people, TODAY);
    expect(out.avoid).toEqual(['Fish tacos']);
  });

  it('never-again applies forever', () => {
    const out = ratingSignals([rating({ mealName: 'Liver', rating: 'never', date: '2024-01-01' })], people, TODAY);
    expect(out.never).toEqual(['Liver']);
    expect(out.avoid).toEqual([]);
    expect(out.favourites).toEqual([]);
  });

  it('matches meal names case-insensitively and shows the latest spelling', () => {
    const out = ratingSignals(
      [
        rating({ mealName: 'butter chicken', rating: 'up', date: '2026-10-01' }),
        rating({ mealName: 'Butter Chicken', rating: 'up', date: '2026-10-20' }),
      ],
      people,
      TODAY,
    );
    expect(out.favourites).toEqual(['Butter Chicken']);
  });

  it('ignores ratings from people no longer in the household', () => {
    const out = ratingSignals([rating({ mealName: 'Soup', rating: 'never', date: '2026-10-01', personId: 'gone' })], people, TODAY);
    expect(out.never).toEqual([]);
  });

  it('keeps the 10 most recently liked favourites', () => {
    const liked = Array.from({ length: 12 }, (_, i) =>
      rating({ mealName: `Meal ${i}`, rating: 'up', date: `2026-10-${String(i + 1).padStart(2, '0')}` }),
    );
    const out = ratingSignals(liked, people, TODAY);
    expect(out.favourites).toHaveLength(FAVOURITE_LIMIT);
    expect(out.favourites[0]).toBe('Meal 11');
    expect(out.favourites).not.toContain('Meal 0');
  });
});

describe('RatingInputSchema', () => {
  it('accepts a rating and rejects an unknown kind', () => {
    const body = { mealName: 'Chili', personId: 'ann', rating: 'up', ingredientIds: ['beans'] };
    expect(RatingInputSchema.safeParse(body).success).toBe(true);
    expect(RatingInputSchema.safeParse({ ...body, rating: 'meh' }).success).toBe(false);
  });
});
