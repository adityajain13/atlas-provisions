// The Black (AMOLED) appearance. It is per device: the choice is kept in localStorage, and the inline script in
// index.html reads the same key before the first paint. Every read and write is guarded, since storage can be blocked.

export type Theme = 'dark' | 'black';

/** localStorage key. Keep in step with the inline script in web/index.html. */
export const THEME_KEY = 'atlas-theme';

export const THEMES: readonly Theme[] = ['dark', 'black'];

export const THEME_LABEL: Record<Theme, string> = { dark: 'Dark', black: 'Black' };

interface RootLike {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The stored appearance, or Dark when nothing is stored or storage cannot be read. */
export function readTheme(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Theme {
  try {
    return storage?.getItem(THEME_KEY) === 'black' ? 'black' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Puts the appearance on the page root: data-theme="black" for Black, none for Dark. */
export function applyTheme(theme: Theme, root: RootLike | undefined = safeRoot()): void {
  if (!root) return;
  if (theme === 'black') root.setAttribute('data-theme', 'black');
  else root.removeAttribute('data-theme');
}

/** Stores the appearance for this device and applies it. A failed write still applies it for this visit. */
export function saveTheme(
  theme: Theme,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
  root: RootLike | undefined = safeRoot(),
): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Storage is blocked or full: the choice lasts until the page is closed.
  }
  applyTheme(theme, root);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function safeRoot(): RootLike | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}
