import { describe, expect, it } from 'vitest';
import { THEME_KEY, applyTheme, readTheme, saveTheme } from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

describe('theme', () => {
  it('reads Black only when it is stored, and Dark otherwise', () => {
    expect(readTheme(memoryStorage())).toBe('dark');
    expect(readTheme(memoryStorage({ [THEME_KEY]: 'black' }))).toBe('black');
    expect(readTheme(memoryStorage({ [THEME_KEY]: 'purple' }))).toBe('dark');
  });

  it('falls back to Dark when storage cannot be read', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readTheme(broken)).toBe('dark');
    expect(readTheme(undefined)).toBe('dark');
  });

  it('sets data-theme for Black and removes it for Dark', () => {
    const root = fakeRoot();
    applyTheme('black', root);
    expect(root.attrs.get('data-theme')).toBe('black');
    applyTheme('dark', root);
    expect(root.attrs.has('data-theme')).toBe(false);
  });

  it('saves the choice to storage and applies it, even when the write fails', () => {
    const storage = memoryStorage();
    const root = fakeRoot();
    saveTheme('black', storage, root as never);
    expect(storage.data.get(THEME_KEY)).toBe('black');
    expect(root.attrs.get('data-theme')).toBe('black');

    const blocked = {
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    const root2 = fakeRoot();
    expect(() => saveTheme('black', blocked, root2 as never)).not.toThrow();
    expect(root2.attrs.get('data-theme')).toBe('black');
  });
});
