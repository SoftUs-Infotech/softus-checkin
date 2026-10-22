import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarClock, Megaphone, Palmtree, PartyPopper } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDayMonth, orgTimeZoneName, relativeTime } from '@/lib/format'
import { Button, Card, CardHeader, CardSkeleton, EmptyState } from '@/components/ui'
import { useAuth } from '@/store/auth'
import type { DashboardSummary } from '@/types'
import { AttendanceCalendar } from './AttendanceCalendar'
import { PunchCard } from './PunchCard'

export function DashboardPage() {
  const user = useAuth((state) => state.user)
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<DashboardSummary>('/dashboard/summary'),
  })

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-6">
      {/* The masthead of the sheet: a name, a date, and a rule under both —
          the way a register page is headed before anything is written on it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-3">
        <h1 className="font-display text-2xl text-ink-900">
          {greeting}, {user?.first_name || 'there'}
        </h1>
        <p className="tabular text-[13px] text-ink-400">
          {/* The organisation's date, like every other date on the page. */}
          {new Date().toLocaleDateString(undefined, {
            timeZone: orgTimeZoneName(),
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {/*
        Punch, month and rail sit side by side once the screen can hold them.
        Below 1280 the rail is not a column at all — it becomes a row of cards
        under the month, so it reflows instead of being squeezed into a strip
        too narrow to read a leave balance in.
      */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(272px,300px)_minmax(0,1fr)] xl:grid-cols-[288px_minmax(0,1fr)_288px]">
        <PunchCard />
        <AttendanceCalendar />

        <aside className="grid items-start gap-5 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3 xl:col-span-1 xl:grid-cols-1">
          {isLoading ? (
            <>
              <RailSkeleton />
              <RailSkeleton />
              <RailSkeleton />
            </>
          ) : (
            <>
              {data?.pending && (
                <Card>
                  <CardHeader title="Waiting for you" subtitle="Approvals from your team" />
                  <ul className="divide-y divide-rule">
                    <PendingRow
                      label="Corrections"
                      count={data.pending.corrections}
                      to="/admin/approvals"
                    />
                    <PendingRow
                      label="Leave requests"
                      count={data.pending.leave}
                      to="/admin/approvals"
                    />
                    <PendingRow
                      label="Daily tasks"
                      count={data.pending.tasks}
                      to="/admin/approvals"
                    />
                  </ul>
                </Card>
              )}

              <Card>
                <CardHeader
                  title="Leave balance"
                  action={
                    <Link
                      to="/leave"
                      className="text-[12px] font-medium text-ink-900 underline underline-offset-2"
                    >
                      Apply
                    </Link>
                  }
                />
                {data?.leave_balances?.length ? (
                  <ul className="divide-y divide-rule">
                    {data.leave_balances.map((balance) => (
                      <li
                        key={balance.leave_type_id}
                        className="flex items-center gap-3 px-5 py-2.5"
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: balance.color }}
                        />
                        <span className="flex-1 truncate text-[13px] text-ink-700">
                          {balance.leave_type_name}
                        </span>
                        <span className="tabular text-[13px] font-medium text-ink-900">
                          {balance.available}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="No leave types yet"
                    description="Once your administrator sets leave types up, your balances appear here."
                  />
                )}
              </Card>

              <Card>
                <CardHeader title="Announcements" />
                {data?.announcements?.length ? (
                  <ul className="divide-y divide-rule">
                    {data.announcements.map((item) => (
                      <li key={item.id} className="px-5 py-3">
                        <p className="flex items-start gap-2 text-[13px] font-medium text-ink-900">
                          <Megaphone className="mt-0.5 size-3.5 shrink-0 text-ink-300" />
                          {item.title}
                        </p>
                        <p className="mt-1 line-clamp-2 pl-5.5 text-[12px] text-ink-500">
                          {item.body}
                        </p>
                        <p className="tabular mt-1 pl-5.5 text-[11px] text-ink-300">
                          {relativeTime(item.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={<Megaphone className="size-5" />}
                    title="Nothing posted yet"
                    description="Company announcements will show up here."
                  />
                )}
              </Card>

              <Card>
                <CardHeader title="Coming up" />
                {(data?.upcoming_events?.length ?? 0) + (data?.upcoming_holidays?.length ?? 0) >
                0 ? (
                  <ul className="divide-y divide-rule">
                    {(data?.upcoming_events ?? []).map((event) => (
                      <li key={event.id} className="flex items-start gap-2.5 px-5 py-3">
                        <PartyPopper className="mt-0.5 size-3.5 shrink-0 text-ink-300" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink-800">
                            {event.title}
                          </span>
                          <span className="tabular block text-[11px] text-ink-400">
                            {formatDayMonth(event.event_date)}
                            {event.event_time ? ` · ${event.event_time}` : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                    {(data?.upcoming_holidays ?? []).map((holiday) => (
                      <li key={holiday.id} className="flex items-start gap-2.5 px-5 py-3">
                        <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-status-yellow" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink-800">
                            {holiday.name}
                          </span>
                          <span className="tabular block text-[11px] text-ink-400">
                            {formatDayMonth(holiday.date)} · {holiday.weekday}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={<CalendarClock className="size-5" />}
                    title="Nothing scheduled"
                    description="No events or holidays are coming up. Plan time off while it is quiet."
                    action={
                      <Link to="/leave">
                        <Button variant="secondary" size="sm">
                          Apply for leave
                        </Button>
                      </Link>
                    }
                  />
                )}
              </Card>

              {(data?.on_leave_today?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader title="Away today" />
                  <ul className="divide-y divide-rule">
                    {data!.on_leave_today.map((entry) => (
                      <li key={entry.user_id} className="flex items-center gap-2.5 px-5 py-2.5">
                        <Palmtree className="size-3.5 shrink-0 text-status-violet" />
                        <span className="flex-1 truncate text-[13px] text-ink-700">
                          {entry.user_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-400">
                          {entry.leave_type_name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function RailSkeleton() {
  return (
    <Card>
      <div className="border-b border-rule px-5 py-4">
        <span className="skeleton block h-3.5 w-28 rounded-md" aria-hidden />
      </div>
      <CardSkeleton lines={3} />
    </Card>
  )
}

function PendingRow({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-ink-50"
      >
        <span className="text-[13px] text-ink-700">{label}</span>
        <span
          // A queue of approvals is not an attendance status, so it is counted
          // in ink. The status palette stays on the record.
          className={
            count > 0
              ? 'tabular rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-white'
              : 'tabular text-[13px] text-ink-300'
          }
        >
          {count}
        </span>
      </Link>
    </li>
  )
}
