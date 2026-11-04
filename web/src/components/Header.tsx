import type { ReactNode } from 'react';

type HeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  size?: 'md' | 'lg';
  // Login sits outside the app shell, so it keeps the brand row on desktop too.
  desktopBrand?: boolean;
};

/** The globe mark and the wordmark. Shown in the phone header and in the desktop sidebar. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7DB46C"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </svg>
      <span className="text-[12px] uppercase tracking-[0.18em] text-muted">Atlas Provisions</span>
    </div>
  );
}

export function Header({ title, subtitle, action, size = 'md', desktopBrand = false }: HeaderProps) {
  return (
    <header className="pt-8 lg:pt-0">
      <div className={`flex items-center justify-between gap-4${desktopBrand ? '' : ' lg:hidden'}`}>
        <Brand />
        {action}
      </div>
      {subtitle && <p className="mt-6 text-[13px] text-muted lg:mt-0">{subtitle}</p>}
      <h1
        className={`${subtitle ? 'mt-2 lg:mt-1' : 'mt-6 lg:mt-0'} font-display font-normal text-paper lg:text-5xl lg:leading-[1.08] ${
          size === 'lg' ? 'text-[40px] leading-[1.08]' : 'text-[36px] leading-[1.1]'
        }`}
      >
        {title}
      </h1>
    </header>
  );
}
