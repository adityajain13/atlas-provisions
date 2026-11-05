import { describe, expect, it } from 'vitest';
import { headlineName, stripPortionNotes } from './headline';

describe('headlineName', () => {
  it('lowercases the first letter of an ordinary dish name', () => {
    expect(headlineName('Sheet-pan salmon with lemon')).toBe('sheet-pan salmon with lemon');
    expect(headlineName('Butter shrimp with basmati rice')).toBe('butter shrimp with basmati rice');
  });

  it('keeps a proper adjective capitalised', () => {
    expect(headlineName('Italian sausage and peppers')).toBe('Italian sausage and peppers');
    expect(headlineName('Thai basil chicken')).toBe('Thai basil chicken');
    expect(headlineName('Mexican chicken tacos')).toBe('Mexican chicken tacos');
  });

  it('keeps names whose second letter is not lowercase', () => {
    expect(headlineName('BBQ ribs')).toBe('BBQ ribs');
    expect(headlineName('ABC soup')).toBe('ABC soup');
  });

  it('leaves names that already start lowercase or are not letters alone', () => {
    expect(headlineName('quick dal')).toBe('quick dal');
    expect(headlineName('')).toBe('');
    expect(headlineName('1-pot pasta')).toBe('1-pot pasta');
  });
});

describe('headlineName drops portion notes', () => {
  it('drops a trailing portion count in parentheses', () => {
    expect(headlineName('Pepperoni potato frittata (2 portions)')).toBe('pepperoni potato frittata');
  });

  it('drops (serves N) and (xN)', () => {
    expect(headlineName('Lentil dal (serves 4)')).toBe('lentil dal');
    expect(headlineName('Chicken fajitas (x2)')).toBe('chicken fajitas');
  });

  it('drops a dash portion note', () => {
    expect(headlineName('Shrimp and tomato pasta – 2 portions')).toBe('shrimp and tomato pasta');
    expect(headlineName('Shrimp and tomato pasta - serves 3')).toBe('shrimp and tomato pasta');
  });

  it('drops a comma serving note', () => {
    expect(headlineName('Ham and hummus wrap, serves 2')).toBe('ham and hummus wrap');
  });

  it('keeps parentheses in the middle of a name, and keeps the proper-adjective rule', () => {
    expect(headlineName('Chicken (thighs) with rice')).toBe('chicken (thighs) with rice');
    expect(headlineName('Italian sausage and peppers (2 portions)')).toBe('Italian sausage and peppers');
  });

  it('keeps the name when stripping would leave nothing', () => {
    expect(stripPortionNotes('(2 portions)')).toBe('(2 portions)');
  });
});
