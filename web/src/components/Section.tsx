import type { ReactNode } from 'react';

type SectionProps = {
  title: string;
  caption?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

export function Section({ title, caption, action, children }: SectionProps) {
  return (
    <section className="mt-10 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-[22px] font-normal text-paper">{title}</h2>
        {action}
      </div>
      {caption && <p className="mt-1 text-[13px] text-muted">{caption}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
