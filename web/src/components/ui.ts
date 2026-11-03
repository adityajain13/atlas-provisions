export const eyebrow = 'text-[11px] uppercase tracking-[0.14em] text-muted';

export const fieldCls =
  'h-11 w-full rounded-md border border-edge bg-field px-3 text-[16px] text-paper placeholder:text-faint focus:border-herb focus:outline-none';

export const chipBase = 'inline-flex h-11 items-center rounded-full border text-[14px]';

export const ctaBtn =
  'h-[52px] w-full rounded-lg bg-herb text-[16px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40';

export const addBtn = 'h-11 shrink-0 rounded-lg bg-herb px-4 text-[14px] font-medium text-ink';

export const secondaryBtn =
  'flex h-11 items-center justify-center rounded-lg border border-edge px-4 text-[14px] text-paper';

export const linkBtn = 'min-h-11 text-[14px] text-herb';

export const removeIconBtn =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[18px] text-muted';

export function chipTone(selected: boolean): string {
  return selected ? 'border-herb text-herbLight' : 'border-edge text-muted';
}
