import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarSearch, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDate, formatMinutes, formatTime, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Segmented,
  StatTile,
  Table,
  TableSkeleton,
  Td,
  Th,
  Toolbar,
  Tr,
} from '@/components/ui'
import { AttendanceCalendar, MARKS, markInk } from '@/features/dashboard/AttendanceCalendar'
import type { AttendanceDay, MonthCalendar } from '@/types'

/*
  One person's attendance, one month at a time.

  The figures at the top used to count every day since the employee joined,
  which made them true and useless: "eleven days need attention" says nothing
  about whether this month is going well, and the number never came down,
  because an absence in March stayed in the total for ever. A register is read
  by the month — the unit a payroll run, a leave balance and a conversation with
  somebody all share — so the month is what this page is scoped to, and the
  month is what the stepper moves.

  Shared by the employee's own page and by an administrator looking at somebody
  else's, because the question is identical and only the endpoint differs.
*/

/** A day somebody has to act on: no punch-out, an absence, or short hours. */
export function needsAttention(day: AttendanceDay): boolean {
  return (
    day.status === 'MISSING_PUNCH_OUT' ||
    day.status === 'ABSENT' ||
    day.status === 'HALF_DAY' ||
    day.status === 'SHORT_HOURS' ||
    day.is_late
  )
}

type View = 'all' | 'attention'

export function MonthlyAttendance({
  /** Omit for the signed-in employee; an administrator passes somebody's id. */
  userId,
  /** How the empty state refers to the person — "You" or a first name. */
  who = 'You have',
}: {
  userId?: string
  who?: string
}) {
  const [thisYear, thisMonth] = todayKey().split('-').map(Number)
  const [cursor, setCursor] = useState({ year: thisYear, month: thisMonth })
  const [view, setView] = useState<View>('all')

  // Deliberately the month calendar rather than the stored-days list, and
  // deliberately the key the grid below already uses, so the two share one
  // request and cannot disagree.
  //
  // The distinction matters: the stored list only holds days somebody punched,
  // so an absence — a day with no record at all — was invisible to it. The
  // figures then read "nothing needs attention" above a grid with a red A in
  // it. The month endpoint fills those days in, which is the whole reason it
  // exists.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attendance-calendar', cursor.year, cursor.month, userId ?? 'me'],
    queryFn: () =>
      apiGet<MonthCalendar>('/attendance/calendar', {
        year: cursor.year,
        month: cursor.month,
        user_id: userId,
      }),
    // Keep the previous month on screen while the next one loads, so stepping
    // through months does not flash a skeleton over the whole page.
    placeholderData: (previous) => previous,
  })

  /** Days that have happened. A date still to come judges nobody. */
  const counted = useMemo(
    () =>
      (data?.days ?? []).filter(
        (day) =>
          day.status !== 'UPCOMING' &&
          day.status !== 'NOT_STARTED' &&
          day.status !== 'BEFORE_JOINING',
      ),
    [data],
  )

  const totals = useMemo(
    () => ({
      recorded: counted.filter((day) => (day.sessions?.length ?? 0) > 0).length,
      worked: data?.summary.worked_minutes ?? 0,
      attention: counted.filter(needsAttention).length,
      late: counted.filter((day) => day.is_late).length,
    }),
    [counted, data],
  )

  // A weekly off is a row of dashes; listing thirty of them buries the days
  // that say something. Everything else earns its line, absences included.
  const eventful = useMemo(
    () =>
      counted.filter(
        (day) =>
          (day.sessions?.length ?? 0) > 0 || day.status !== 'WEEKEND',
      ),
    [counted],
  )

  const rows = useMemo(
    () => (view === 'attention' ? eventful.filter(needsAttention) : eventful),
    [eventful, view],
  )

  function step(direction: -1 | 1) {
    setView('all')
    setCursor((current) => {
      const month = current.month + direction
      if (month < 1) return { year: current.year - 1, month: 12 }
      if (month > 12) return { year: current.year + 1, month: 1 }
      return { ...current, month }
    })
  }

  const monthLabel = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const isThisMonth = cursor.year === thisYear && cursor.month === thisMonth
  // The record does not run backwards for ever. Five years is well past
  // anything worth reaching by pressing an arrow.
  const atTheStart = cursor.year <= thisYear - 5

  return (
    <div className="space-y-6">
      {/* The month is the page's subject, so its control sits above everything
          it governs rather than inside the calendar — otherwise the totals and
          the grid could show different months and both look right. */}
      <Toolbar>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => step(-1)}
            disabled={atTheStart}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[9.5rem] px-1 text-center text-[15px] font-medium text-ink-900">
            {monthLabel}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => step(1)}
            disabled={isThisMonth}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {!isThisMonth && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setView('all')
              setCursor({ year: thisYear, month: thisMonth })
            }}
          >
            This month
          </Button>
        )}
      </Toolbar>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Days recorded"
          value={isLoading ? '—' : totals.recorded}
          hint={`In ${monthLabel}`}
        />
        <StatTile
          label="Hours worked"
          value={isLoading ? '—' : formatMinutes(totals.worked)}
          hint={`In ${monthLabel}`}
        />
        <StatTile
          label="Need attention"
          value={isLoading ? '—' : totals.attention}
          tone={totals.attention > 0 ? 'red' : 'neutral'}
          hint="Short, absent or unclosed"
          onClick={() => setView(view === 'attention' ? 'all' : 'attention')}
          active={view === 'attention'}
        />
        <StatTile
          label="Late arrivals"
          value={isLoading ? '—' : totals.late}
          tone={totals.late > 0 ? 'amber' : 'neutral'}
          hint="After the shift grace period"
        />
      </div>

      <AttendanceCalendar size="full" userId={userId} month={cursor} />

      <Card>
        <CardHeader
          title="Recorded days"
          subtitle={
            isLoading
              ? undefined
              : `${rows.length} of ${eventful.length} day${eventful.length === 1 ? '' : 's'} in ${monthLabel}`
          }
          action={
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: 'All days' },
                { value: 'attention', label: 'Need attention' },
              ]}
            />
          }
        />

        {isLoading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : isError ? (
          <EmptyState
            title="Attendance could not be loaded"
            description="The register did not answer. Reload the page, and tell your administrator if it keeps happening."
            action={
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        ) : !eventful.length ? (
          <EmptyState
            icon={<CalendarSearch className="size-6" />}
            title={`Nothing recorded in ${monthLabel}`}
            description={`${who} no punches on record for this month. Step back to an earlier month to see older days.`}
          />
        ) : !rows.length ? (
          <EmptyState
            title="No days need attention"
            description="Every recorded day this month is a full day, punched in and out."
            action={
              <Button variant="secondary" size="sm" onClick={() => setView('all')}>
                Show every day
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                {/* The mark column, the way the register has it: one letter per
                    row, before anything is spelled out. */}
                <Th className="w-8 text-center">Mk</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th numeric>First in</Th>
                <Th numeric>Last out</Th>
                <Th numeric>Worked</Th>
                <Th numeric>Shortfall</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((day) => (
                <Tr key={day.date}>
                  <Td>
                    <span aria-hidden className={cn('mark text-[15px]', markInk(day.color))}>
                      {MARKS[day.status] ?? ''}
                    </span>
                  </Td>
                  <Td className="tabular whitespace-nowrap text-ink-900">{formatDate(day.date)}</Td>
                  <Td>
                    {/* The mark in the first column already carries the colour;
                        spelling the status out a second time in a tinted pill
                        would say it twice. */}
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink-800">{day.status_label}</span>
                      {day.is_late && <Badge tone="amber">Late</Badge>}
                      {day.is_manually_adjusted && <Badge tone="blue">Adjusted</Badge>}
                    </span>
                  </Td>
                  <Td numeric>{formatTime(day.first_punch_in)}</Td>
                  <Td numeric>{formatTime(day.last_punch_out)}</Td>
                  <Td numeric className="font-medium text-ink-900">
                    {formatMinutes(day.worked_minutes)}
                  </Td>
                  <Td numeric className={day.shortfall_minutes > 0 ? 'text-status-amber' : ''}>
                    {day.shortfall_minutes > 0 ? formatMinutes(day.shortfall_minutes) : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
