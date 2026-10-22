import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock,
  FileClock,
  Gauge,
  LogOut,
  Megaphone,
  Menu,
  Palmtree,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { cn } from '@/lib/cn'
import { orgNowParts, orgTimeZoneName, setOrgTimeZone } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { NotificationPanel } from './NotificationPanel'

interface NavItem {
  to: string
  label: string
  icon: typeof Gauge
  badge?: 'corrections' | 'leave' | 'tasks'
}

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/attendance', label: 'My attendance', icon: CalendarDays },
  { to: '/corrections', label: 'Corrections', icon: FileClock },
  { to: '/tasks', label: 'Daily tasks', icon: ClipboardList },
  { to: '/leave', label: 'Leave', icon: Palmtree },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

/*
  A manager is a third shape, not a smaller administrator: they decide for their
  own reports and keep their own employee pages. Everything else in the admin
  product answers 403 for them, and a link that dead-ends is worse than no link.
*/
const MANAGER_NAV: NavItem[] = [
  { to: '/admin/approvals', label: 'Approvals', icon: ShieldCheck, badge: 'corrections' },
  { to: '/admin/tasks', label: 'Team tasks', icon: ClipboardList },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Operations', icon: Gauge },
  { to: '/admin/register', label: 'Daily register', icon: Clock },
  { to: '/admin/approvals', label: 'Approvals', icon: ShieldCheck, badge: 'corrections' },
  { to: '/admin/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/admin/employees', label: 'Employees', icon: Users },
  { to: '/admin/shifts', label: 'Shifts', icon: CalendarRange },
  { to: '/admin/leave-types', label: 'Leave types', icon: Palmtree },
  { to: '/admin/holidays', label: 'Holidays', icon: CalendarDays },
  { to: '/admin/work-calendar', label: 'Work calendar', icon: CalendarRange },
  { to: '/admin/salary', label: 'Salary', icon: Wallet },
  { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/admin/audit', label: 'Audit trail', icon: ScrollText },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { user, signOut, isAdmin, hasPersonalSpace } = useAuth()
  const isManager = user?.role === 'MANAGER'
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)

  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<import('@/types').DashboardSummary>('/dashboard/summary'),
    refetchInterval: 60_000,
  })

  /*
    The organisation's timezone, read once and handed to the formatters.

    It is server-owned and read-only — the API reports whatever `ORG_TIMEZONE`
    is set to — so a deployment elsewhere needs no frontend change. Until it
    arrives the formatters use their compiled-in default, which matches the
    server's own.
  */
  const { data: orgSettings } = useQuery({
    queryKey: ['settings', 'timezone'],
    queryFn: () => apiGet<{ timezone: string }>('/settings'),
    staleTime: Infinity,
  })

  useEffect(() => {
    setOrgTimeZone(orgSettings?.timezone)
  }, [orgSettings?.timezone])

  const pendingTotal =
    (summary?.pending?.corrections ?? 0) +
    (summary?.pending?.leave ?? 0) +
    (summary?.pending?.tasks ?? 0)

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Escape closes the mobile drawer. Without it the only way out is the small
  // × or a tap on the scrim, which is not obvious on a narrow screen.
  useEffect(() => {
    if (!menuOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-rule bg-white text-ink-600 transition-transform lg:static lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            {/* A punch mark: the ring of the dial, filled. The signature shape
                of the product, at the size of a favicon. */}
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink-900 text-ink-900"
            >
              <span className="size-2.5 rounded-full bg-ink-900" />
            </span>
            <span>
              <span className="font-display block text-[17px] leading-none font-bold tracking-tight text-ink-900">
                Softus
              </span>
              <span className="tabular mt-1 block text-[10px] tracking-[0.22em] text-ink-400 uppercase">
                Checkin
              </span>
            </span>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-ink-400 hover:text-ink-900 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          {/* An administrator who does not punch has no personal section at
              all — showing them a punch widget they must never use is worse
              than showing them nothing. */}
          {hasPersonalSpace() && (
            <NavGroup label="You" items={EMPLOYEE_NAV} onNavigate={() => setMenuOpen(false)} />
          )}
          {isAdmin() && (
            <NavGroup
              label="Administration"
              items={ADMIN_NAV}
              pending={summary?.pending}
              onNavigate={() => setMenuOpen(false)}
            />
          )}
          {isManager && (
            <NavGroup
              label="Your team"
              items={MANAGER_NAV}
              pending={summary?.pending}
              onNavigate={() => setMenuOpen(false)}
            />
          )}
        </nav>

        <div className="border-t border-rule px-3 py-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">
              {(user?.first_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink-900">
                {user?.full_name || user?.email}
              </span>
              <span className="block truncate text-[11px] text-ink-400">
                {user?.designation ||
                  (user?.role === 'ADMIN'
                    ? 'Administrator'
                    : user?.role === 'MANAGER'
                      ? 'Manager'
                      : 'Employee')}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-rule bg-paper/90 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-50 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          {/* The clock is not decoration. This is a product about what time
              somebody arrived, and every question it answers is anchored to
              today — so today, and the time, are always on screen. */}
          <HeaderClock />

          <div className="hidden lg:block">
            {(isAdmin() || isManager) && pendingTotal > 0 && (
              <p className="text-[13px] text-ink-500">
                <span className="tabular font-semibold text-ink-900">{pendingTotal}</span> item
                {pendingTotal === 1 ? '' : 's'} waiting for your approval
              </p>
            )}
          </div>

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setBellOpen((open) => !open)}
              className="relative rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              {(summary?.unread_notifications ?? 0) > 0 && (
                <span className="tabular absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full bg-status-red px-1 text-[10px] font-semibold text-white">
                  {summary!.unread_notifications > 9 ? '9+' : summary!.unread_notifications}
                </span>
              )}
            </button>
            {bellOpen && <NotificationPanel onClose={() => setBellOpen(false)} />}
          </div>
        </header>

        {/* Capped so a very wide monitor stretches the margins, not the content. */}
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1480px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

/*
  Its own component so the second hand does not re-render the sidebar, the
  navigation badges and the whole page body sixty times a minute.
*/
function HeaderClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Tick on the minute boundary rather than every second: the display has
    // minute resolution, so a per-second timer would be wasted work.
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // Organisation time, not the reader's. On a machine in another zone the two
  // differ, and the one that decides which day a punch lands on is this one.
  const { time, date } = orgNowParts(now)

  return (
    <div className="hidden items-baseline gap-2 sm:flex" title={`Office time · ${orgTimeZoneName()}`}>
      <span className="tabular text-[15px] font-semibold text-ink-900">{time}</span>
      <span className="text-[12px] text-ink-400">{date}</span>
    </div>
  )
}

function NavGroup({
  label,
  items,
  pending,
  onNavigate,
}: {
  label: string
  items: NavItem[]
  pending?: { corrections: number; leave: number; tasks: number }
  onNavigate: () => void
}) {
  return (
    <div className="mb-5">
      <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] text-ink-400 uppercase">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const count =
            item.badge && pending
              ? item.badge === 'corrections'
                ? pending.corrections + pending.leave + pending.tasks
                : pending[item.badge]
              : 0
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/' || item.to === '/admin'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors',
                    isActive
                      ? 'bg-ink-900 font-medium text-white'
                      : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
                  )
                }
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {count > 0 && (
                  <span className="tabular rounded-full bg-status-red px-1.5 text-[10px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
