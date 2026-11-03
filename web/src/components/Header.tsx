import type { ReactNode } from 'react';

type HeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  size?: 'md' | 'lg';
};

export function Header({ title, subtitle, action, size = 'md' }: HeaderProps) {
  return (
    <header className="pt-8">
      <div className="flex items-center justify-between gap-4">
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
        {action}
      </div>
      {subtitle && <p className="mt-6 text-[13px] text-muted">{subtitle}</p>}
      <h1
        className={`${subtitle ? 'mt-2' : 'mt-6'} font-display font-normal text-paper ${
          size === 'lg' ? 'text-[40px] leading-[1.08]' : 'text-[36px] leading-[1.1]'
        }`}
      >
        {title}
      </h1>
    </header>
  );
}
