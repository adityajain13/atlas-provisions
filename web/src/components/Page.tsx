import type { ReactNode } from 'react';

// Content column. The bottom padding keeps content clear of the fixed TabBar.
export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[480px] px-6 pb-28">{children}</main>;
}
