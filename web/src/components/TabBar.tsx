import { NavLink } from 'react-router-dom';
import { HouseholdIcon, ListIcon, PantryIcon, WeekIcon } from './Icons';

export const TABS = [
  { to: '/', label: 'Week', icon: <WeekIcon />, end: true },
  { to: '/list', label: 'List', icon: <ListIcon />, end: false },
  { to: '/pantry', label: 'Pantry', icon: <PantryIcon />, end: false },
  { to: '/household', label: 'Household', icon: <HouseholdIcon />, end: false },
];

export default function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-ink lg:hidden">
      <div className="mx-auto flex max-w-[480px] justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex min-h-[56px] min-w-[64px] flex-1 flex-col items-center justify-center gap-1 pt-1.5 text-[11px] ${
                isActive ? 'text-paper' : 'text-muted'
              }`
            }
          >
            {t.icon}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
