import type { ReactNode } from 'react';

// Content column. The bottom padding keeps content clear of the fixed TabBar.
// On desktop the app shell supplies the width and gutters; `centered` is the narrow sign-in card.
export function Page({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  return (
    <main
      className={
        centered
          ? 'mx-auto max-w-[480px] px-6 pb-28 lg:w-full lg:max-w-[420px] lg:pb-0'
          : 'mx-auto max-w-[480px] px-6 pb-28 lg:max-w-none lg:px-0 lg:pb-16'
      }
    >
      {children}
    </main>
  );
}
