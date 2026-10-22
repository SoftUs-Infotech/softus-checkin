import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarOff,
  CheckCircle2,
  MapPinOff,
  Palmtree,
  Smartphone,
  TimerOff,
  UserX,
} from 'lucide-react'
import { apiGet, messageOf } from '@/lib/api'
import { formatTime, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Badge,
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  ErrorNote,
  PageHeader,
  Skeleton,
  StatTile,
  type BadgeTone,
} from '@/components/ui'
import { useAuth } from '@/store/auth'
import type { AttendanceDay, DashboardSummary } from '@/types'

/*
  What an administrator opens in the morning.

  Not a roster — a roster of forty people tells you nothing. This is the list of
  things that are wrong today and the decisions nobody has made yet. Everything
  else is one click away on the register.

  The feed is the hero: the first thing the eye lands on is either a calm "today
  is clear" or a count of the things that are not. The tallies above it are the
  filter for that feed, so a question like "who is late" is one click, not a
  trip to the register.
*/

type ExceptionKind = 'missing_out' | 'absent' | 'late' | 'geo' | 'device' | 'no_shift'

/** A shift is a planned window; the flag says the window lapsed while the work
    did not. It belongs on this list, but it is a planning signal rather than a
    fault, so it is drawn in ink and it sorts last. */
type OpsRow = AttendanceDay & { no_shift_assigned?: boolean }

type ExceptionTone = 'red' | 'amber' | 'neutral'

interface Exception {
  key: string
  kind: ExceptionKind
  row: OpsRow
  label: string
  tone: ExceptionTone
}

const KINDS: {
  kind: ExceptionKind
  label: string
  short: string
  icon: typeof UserX
  tone: BadgeTone
}[] = [
  { kind: 'missing_out', label: 'Never punched out', short: 'No punch out', icon: TimerOff, tone: 'red' },
  { kind: 'absent', label: 'Absent, no leave', short: 'Absent', icon: UserX, tone: 'red' },
  { kind: 'late', label: 'Late arrival', short: 'Late', icon: TimerOff, tone: 'amber' },
  { kind: 'geo', label: 'Punched away from the office', short: 'Away from office', icon: MapPinOff, tone: 'amber' },
  { kind: 'device', label: 'Punched from a phone', short: 'From a phone', icon: Smartphone, tone: 'amber' },
  { kind: 'no_shift', label: 'Shift window has lapsed', short: 'Shift window lapsed', icon: CalendarOff, tone: 'neutral' },
]

const KIND_INDEX = new Map(KINDS.map((entry, index) => [entry.kind, index]))
const KIND_BY_NAME = new Map(KINDS.map((entry) => [entry.kind, entry]))

/* Ink for the signal that is not a verdict; the legend's colours for the ones
   that are. Nothing else on this page is allowed either. */
const TONE_INK: Record<ExceptionTone, string> = {
  red: 'text-status-red',
  amber: 'text-status-amber',
  neutral: 'text-ink-400',
}

function exceptionsOf(rows: OpsRow[]): Exception[] {
  const found: Exception[] = []

  for (const row of rows) {
    if (row.status === 'MISSING_PUNCH_OUT') {
      found.push({
        key: `${row.date}-out-${row.user_id}`,
        kind: 'missing_out',
        row,
        label: 'Never punched out',
        tone: 'red',
      })
    }
    if (row.status === 'ABSENT') {
      found.push({
        key: `${row.date}-absent-${row.user_id}`,
        kind: 'absent',
        row,
        label: 'Absent, no leave',
        tone: 'red',
      })
    }
    if (row.is_late) {
      found.push({
        key: `${row.date}-late-${row.user_id}`,
        kind: 'late',
        row,
        label: 'Late arrival',
        tone: 'amber',
      })
    }
    if (row.sessions?.some((session) => session.punch_in?.outside_office)) {
      found.push({
        key: `${row.date}-geo-${row.user_id}`,
        kind: 'geo',
        row,
        label: 'Punched away from the office',
        tone: 'amber',
      })
    }
    if (row.sessions?.some((session) => session.punch_in?.device_class === 'MOBILE')) {
      found.push({
        key: `${row.date}-device-${row.user_id}`,
        kind: 'device',
        row,
        label: 'Punched from a phone',
        tone: 'amber',
      })
    }
    if (row.no_shift_assigned) {
      found.push({
        key: `${row.date}-shift-${row.user_id}`,
        kind: 'no_shift',
        row,
        label: 'Shift window has lapsed',
        tone: 'neutral',
      })
    }
  }

  // Worst first, then in the order the legend reads. An administrator works
  // down the list, so the list has to be in the order the work is done.
  return found.sort(
    (left, right) => (KIND_INDEX.get(left.kind) ?? 0) - (KIND_INDEX.get(right.kind) ?? 0),
  )
}

export function OperationsPage() {
  const user = useAuth((state) => state.user)
  const navigate = useNavigate()
  const today = todayKey()
  const [kind, setKind] = useState<ExceptionKind | null>(null)

  const {
    data: register,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['register', today],
    queryFn: () => apiGet<AttendanceDay[]>('/attendance/register', { day: today }),
    refetchInterval: 120_000,
  })

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<DashboardSummary>('/dashboard/summary'),
  })

  const rows: OpsRow[] = register ?? []
  const exceptions = exceptionsOf(rows)
  const shown = kind ? exceptions.filter((exception) => exception.kind === kind) : exceptions
  const byKind = exceptions.reduce<Record<string, number>>((accumulator, exception) => {
    accumulator[exception.kind] = (accumulator[exception.kind] ?? 0) + 1
    return accumulator
  }, {})

  const working = rows.filter((row) => row.status === 'IN_PROGRESS').length
  const done = rows.filter((row) => row.status === 'PRESENT').length
  const onLeave = rows.filter((row) => row.status === 'ON_LEAVE').length
  const pending =
    (summary?.pending?.corrections ?? 0) +
    (summary?.pending?.leave ?? 0) +
    (summary?.pending?.tasks ?? 0)

  // Three quite different silences, and the page has to say which one it is:
  // nothing has loaded, nothing was recorded, or nothing is wrong.
  const loaded = !isLoading && !error
  const activeKind = KINDS.find((entry) => entry.kind === kind)

  // The headline count takes the colour of the worst thing in it. A morning
  // whose only entries are lapsed shift windows is not a red morning.
  const worst: BadgeTone = exceptions.some((exception) => exception.tone === 'red')
    ? 'red'
    : exceptions.some((exception) => exception.tone === 'amber')
      ? 'amber'
      : 'neutral'

  return (
    <>
      <PageHeader
        title={`Good day, ${user?.first_name || 'there'}`}
        description={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />

      {error && <ErrorNote className="mb-4" message={messageOf(error)} />}

      {/* The exception tallies come first and double as the feed's filter —
          the number and the thing it counts are the same control. */}
      {isLoading ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[76px]" />
          ))}
        </div>
      ) : (
        exceptions.length > 0 && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Needs attention"
              value={exceptions.length}
              hint={kind ? 'Show everything' : 'Everything below'}
              tone={worst}
              active={kind === null}
              onClick={() => setKind(null)}
            />
            {KINDS.filter((entry) => byKind[entry.kind]).map((entry) => (
              <StatTile
                key={entry.kind}
                label={entry.short}
                value={byKind[entry.kind]}
                hint={kind === entry.kind ? 'Filtering the feed' : 'Filter the feed'}
                tone={entry.tone}
                active={kind === entry.kind}
                onClick={() => setKind(kind === entry.kind ? null : entry.kind)}
              />
            ))}
          </div>
        )
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Needs attention
                {loaded && (
                  <Badge tone={exceptions.length ? worst : 'green'}>
                    {exceptions.length === 0 ? 'All clear' : `${exceptions.length} today`}
                  </Badge>
                )}
              </span>
            }
            subtitle={
              activeKind
                ? `Showing ${activeKind.label.toLowerCase()} only`
                : 'Today, in the order it matters'
            }
            action={
              <Link
                to="/admin/register"
                className="rounded text-[12px] text-ink-700 underline decoration-ink-200 underline-offset-2 hover:decoration-ink-700"
              >
                Full register
              </Link>
            }
          />
          {isLoading ? (
            <ul className="divide-y divide-rule">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="size-2 rounded-full" />
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="ml-auto h-3.5 w-24" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <EmptyState
              title="Today could not be loaded"
              description="The register did not come back. The message above says why."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet today"
              description="No attendance has been logged for today, so there is nothing to check."
              action={
                <Link to="/admin/register" className="text-[13px] text-ink-700 underline decoration-ink-200 underline-offset-2 hover:decoration-ink-700">
                  Open the register
                </Link>
              }
            />
          ) : exceptions.length === 0 ? (
            <EmptyState
              // Good news, said quietly: the tick is the legend's green because
              // that is what a clear day is, and nothing else here is coloured.
              icon={<CheckCircle2 className="size-6" />}
              tone="green"
              title="Today is clear"
              description="Everyone who should have punched has, and nobody is where they should not be."
            />
          ) : shown.length === 0 ? (
            <EmptyState
              title="Nothing of that kind today"
              description={`No ${activeKind?.label.toLowerCase() ?? 'matching'} entries. The other tallies still have rows.`}
              action={
                <button
                  type="button"
                  onClick={() => setKind(null)}
                  className="text-[13px] text-ink-700 underline decoration-ink-200 underline-offset-2 hover:decoration-ink-700"
                >
                  Show everything
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-rule">
              {shown.map((exception) => {
                const Icon = KIND_BY_NAME.get(exception.kind)?.icon ?? UserX
                return (
                  <li key={exception.key} className="flex items-center gap-3 px-5 py-2.5">
                    <Icon
                      aria-hidden
                      className={cn('size-4 shrink-0', TONE_INK[exception.tone])}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink-900">
                        {exception.row.employee_name ||
                          exception.row.user_name ||
                          exception.row.user_email}
                      </span>
                      <span
                        className={cn(
                          'text-[12px]',
                          exception.tone === 'neutral' ? 'text-ink-400' : TONE_INK[exception.tone],
                        )}
                      >
                        {exception.label}
                      </span>
                    </span>
                    {/* Stamped figures, right-aligned, so a column of times reads
                        down the feed the way it does down a register. */}
                    <span className="tabular hidden text-right text-[12px] text-ink-400 sm:block">
                      {formatTime(exception.row.first_punch_in)} —{' '}
                      {formatTime(exception.row.last_punch_out)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          {/* The day's shape, once the exceptions have been dealt with. */}
          {isLoading ? (
            <Card>
              <CardSkeleton lines={3} />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Working now" value={working} tone="blue" />
              <StatTile label="Full day done" value={done} tone="green" />
              <StatTile label="On leave" value={onLeave} tone="violet" />
              <StatTile
                label="Awaiting you"
                value={summaryLoading ? '—' : pending}
                hint={pending > 0 ? 'Open the queue' : 'The queue is empty'}
                tone="neutral"
                onClick={() => navigate('/admin/approvals')}
              />
            </div>
          )}

          <Card>
            <CardHeader title="Waiting for a decision" />
            {summaryLoading ? (
              <CardSkeleton lines={3} />
            ) : (
              <ul className="divide-y divide-rule">
                <PendingRow label="Corrections" count={summary?.pending?.corrections ?? 0} />
                <PendingRow label="Leave requests" count={summary?.pending?.leave ?? 0} />
                <PendingRow label="Daily tasks" count={summary?.pending?.tasks ?? 0} />
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Away today" />
            {summaryLoading ? (
              <CardSkeleton lines={2} />
            ) : summary?.on_leave_today?.length ? (
              <ul className="divide-y divide-rule">
                {summary.on_leave_today.map((entry) => (
                  <li key={entry.user_id} className="flex items-center gap-2.5 px-5 py-2.5">
                    <Palmtree className="size-3.5 shrink-0 text-status-violet" aria-hidden />
                    <span className="flex-1 truncate text-[13px] text-ink-700">
                      {entry.user_name}
                    </span>
                    <span className="text-[11px] text-ink-400">{entry.leave_type_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-ink-400">Everyone is in today.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function PendingRow({ label, count }: { label: string; count: number }) {
  return (
    <li>
      <Link
        to="/admin/approvals"
        className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-ink-50"
      >
        <span className="text-[13px] text-ink-700">{label}</span>
        <span
          // A queue is not an attendance verdict, so it is emphasis rather than
          // colour: ink when there is work in it, faint when there is not.
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
