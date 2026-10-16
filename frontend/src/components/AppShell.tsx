import { clsx } from 'clsx';
import { ArrowLeftRight, Dumbbell, History, type LucideIcon, PlusCircle, Trophy } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import type { WeightUnit } from '../api/types';
import { shortId } from '../lib/uuid';
import { useActiveSession } from '../session/session';
import { SegmentedControl } from './ui/SegmentedControl';

interface NavItem {
  to: string;
  label: string;
  /** Label in the mobile tab bar. */
  shortLabel: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/history', label: 'History', shortLabel: 'History', icon: History },
  { to: '/records', label: 'Personal records', shortLabel: 'Records', icon: Trophy },
  { to: '/log', label: 'Log workout', shortLabel: 'Log', icon: PlusCircle },
];

const UNIT_OPTIONS: readonly { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

/** Sidebar on desktop, top bar on every size, bottom tab bar on mobile. */
export function AppShell() {
  const { userId, unit, setUnit } = useActiveSession();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-white/10 bg-zinc-950/60 px-4 py-5 lg:flex">
        <Brand />
        <nav aria-label="Main" className="mt-10 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-zinc-950/70 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SegmentedControl label="Display unit" options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
            <ClientChip userId={userId} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 sm:px-6 lg:px-10 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main mobile"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-white/10 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <TabLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/history" className="flex items-center gap-2.5 px-1 font-semibold tracking-tight">
      <span className="grid size-9 place-items-center rounded-xl bg-lime-400 text-zinc-950 shadow-lg shadow-lime-400/25">
        <Dumbbell aria-hidden="true" className="size-5" />
      </span>
      <span className="hidden sm:inline">Workout Log</span>
    </Link>
  );
}

function SidebarLink({ item: { to, label, icon: Icon } }: { item: NavItem }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon aria-hidden="true" className={clsx('size-4', isActive && 'text-lime-300')} />
          {label}
        </>
      )}
    </NavLink>
  );
}

function TabLink({ item: { to, shortLabel, icon: Icon } }: { item: NavItem }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium',
          isActive ? 'text-lime-300' : 'text-zinc-500',
        )
      }
    >
      <Icon aria-hidden="true" className="size-5" />
      {shortLabel}
    </NavLink>
  );
}

function ClientChip({ userId }: { userId: string }) {
  return (
    <Link
      to="/welcome"
      title={`Client ${userId} – switch client`}
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1 pr-3 pl-1 text-sm transition-colors hover:bg-white/10"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-lime-300 to-emerald-500 text-[11px] font-bold text-zinc-950"
      >
        {userId.slice(0, 2).toUpperCase()}
      </span>
      <span className="hidden font-mono text-xs text-zinc-300 sm:inline">{shortId(userId)}</span>
      <ArrowLeftRight aria-hidden="true" className="size-3.5 text-zinc-500" />
      <span className="sr-only">Switch client</span>
    </Link>
  );
}
