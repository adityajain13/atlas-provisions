import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { addWeeks, planWeekOf } from '@provisions/shared';
import { Brand } from './Header';
import { AppearanceControl } from './Appearance';
import { TABS } from './TabBar';
import { useSession } from '../session';

const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-herb';

/** Phone keeps the bottom tab bar. From 1024px up, a fixed sidebar holds the same navigation. */
export default function AppShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useSession();
  const email = state.status === 'in' ? state.email : null;

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-[240px] lg:flex-col lg:border-r lg:border-line lg:bg-ink lg:px-4 lg:py-8">
        <div className="px-3">
          <Brand />
        </div>

        <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] ${RING} ${
                  isActive ? 'bg-chip text-paper' : 'text-muted hover:text-paper'
                }`
              }
            >
              {t.icon}
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>

        <Link
          to={`/plan?week=${addWeeks(planWeekOf(new Date()), 1)}`}
          className={`mt-6 flex h-11 items-center justify-center rounded-lg bg-herb text-[14px] font-medium text-ink hover:bg-herbLight ${RING} focus-visible:ring-offset-2 focus-visible:ring-offset-ink`}
        >
          Plan next week
        </Link>

        <AppearanceControl className="mt-auto px-3 pt-4" />

        {email && (
          <div className="mt-6 px-3 pt-4 text-[12px] text-muted">
            <p className="truncate">Signed in as {email}</p>
            <button
              type="button"
              onClick={() => void signOut()}
              className={`mt-1 min-h-11 text-herb hover:text-herbLight ${RING}`}
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      <div className="lg:pl-[240px]">
        <div className="lg:mx-auto lg:max-w-[1680px] lg:px-10 xl:px-12 lg:py-10">{children}</div>
      </div>
    </>
  );
}
