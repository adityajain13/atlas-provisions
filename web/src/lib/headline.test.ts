import { describe, expect, it } from 'vitest';
import { headlineName } from './headline';

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
