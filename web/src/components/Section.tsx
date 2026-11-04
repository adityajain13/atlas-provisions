import type { ReactNode } from 'react';

type SectionProps = {
  title: string;
  caption?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

// Desktop columns space their sections with a gap, so the section's own top margin drops out at lg.
export function Section({ title, caption, action, children, className = '' }: SectionProps) {
  return (
    <section className={`mt-10 border-t border-line pt-4 lg:mt-0 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display font-semibold tracking-[-0.01em] text-paper text-[22px]">{title}</h2>
        {action}
      </div>
      {caption && <p className="mt-1 text-[13px] text-muted">{caption}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
