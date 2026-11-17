import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Coffee, LogIn, LogOut, ScreenShareOff } from 'lucide-react'
import { apiGet, messageOf } from '@/lib/api'
import { formatDate, formatMinutes, formatTime, statusStyle, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import { SCREEN_SHARE_STOPPED } from '@/lib/punch'
import { Badge, Button, ErrorNote, Input, Skeleton } from '@/components/ui'
import type { AttendanceDay, AttendanceSession, DayBreak, User } from '@/types'

/** `2026-11-16` moved by `days`, as a date key. */
function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}

function minutesBetween(start: string, end: string | number): number {
  const until = typeof end === 'number' ? end : new Date(end).getTime()
  return Math.max(0, Math.floor((until - new Date(start).getTime()) / 60_000))
}

/*
  One employee's day, opened from their row on the Employees page: every punch
  in and out, how long each stretch of work lasted, and every break between —
  so "where did the afternoon go" has an answer without opening the register.
*/
export function EmployeeDayPunches({ employee }: { employee: User }) {
  const [day, setDay] = useState(todayKey())
  const isToday = day === todayKey()
  const tracked = employee.status === 'ACTIVE'

  const { data, isLoading, error } = useQuery({
    queryKey: ['employee-day', employee.id, day],
    queryFn: () =>
      apiGet<AttendanceDay[]>(`/attendance/employee/${employee.id}`, {
        from_date: day,
        to_date: day,
      }),
    enabled: tracked,
    // Today is still happening.
    refetchInterval: isToday ? 60_000 : false,
  })

  const record = data?.[0]

  return (
    <div className="rounded-lg border border-rule bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous day"
            onClick={() => setDay(shiftDay(day, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            aria-label="Day"
            className="tabular h-8 w-auto py-1 text-[13px]"
            value={day}
            max={todayKey()}
            onChange={(event) => setDay(event.target.value || todayKey())}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => setDay(shiftDay(day, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDay(todayKey())}>
              Today
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {record && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase',
                statusStyle(record.color).chip,
              )}
            >
              {record.status_label}
            </span>
          )}
          {record?.is_late && <Badge tone="amber">Late arrival</Badge>}
          {record?.is_manually_adjusted && <Badge tone="blue">Adjusted</Badge>}
          {employee.work_mode === 'WFH' && <Badge>Work from home</Badge>}
        </div>
      </div>

      <div className="px-4 py-4">
        {!tracked ? (
          <Quiet>
            {employee.status === 'INVITED'
              ? 'They have not accepted their invitation yet, so there are no punches to show.'
              : 'This account is suspended.'}
          </Quiet>
        ) : isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <ErrorNote message={messageOf(error, 'The day could not be loaded.')} />
        ) : !record || record.sessions.length === 0 ? (
          <Quiet>
            {employee.can_punch === false
              ? 'This account does not punch in — administrators review attendance rather than record it.'
              : isToday
                ? 'No punches recorded today.'
                : `No punches recorded on ${formatDate(day)}.`}
          </Quiet>
        ) : (
          <DayDetail record={record} isToday={isToday} employeeId={employee.id} />
        )}
      </div>
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[13px] text-ink-400">{children}</p>
}

function DayDetail({
  record,
  isToday,
  employeeId,
}: {
  record: AttendanceDay
  isToday: boolean
  employeeId: string
}) {
  const now = Date.now()
  const sessions = [...record.sessions].sort(
    (a, b) => new Date(a.punch_in.at).getTime() - new Date(b.punch_in.at).getTime(),
  )
  const breaks = record.breaks ?? []
  const open = sessions.find((session) => !session.punch_out && !session.auto_closed)

  // Worked so far, counting a session still running up to now.
  const liveWorked =
    record.worked_minutes +
    (open && isToday
      ? Math.max(0, minutesBetween(open.punch_in.at, now) - open.duration_minutes)
      : 0)
  const takenBreaks = breaks.filter((gap) => gap.kind === 'BREAK')
  const lastOut = [...sessions].reverse().find((session) => session.punch_out)?.punch_out?.at

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure term="Punch-ins" value={String(sessions.length)} />
        <Figure term="Worked" value={formatMinutes(liveWorked)} />
        <Figure
          term="Breaks"
          value={
            takenBreaks.length
              ? `${takenBreaks.length} · ${formatMinutes(record.break_minutes ?? 0)}`
              : 'None'
          }
        />
        <Figure
          term="First in → last out"
          value={`${formatTime(sessions[0].punch_in.at)} → ${open ? 'working' : formatTime(lastOut)}`}
        />
        {(record.unshared_minutes ?? 0) > 0 && (
          <Figure
            term="Away — sharing stopped"
            value={formatMinutes(record.unshared_minutes ?? 0)}
          />
        )}
      </dl>

      <DayBar sessions={sessions} breaks={breaks} until={open && isToday ? now : null} />

      <ol className="divide-y divide-rule rounded-lg border border-rule">
        {sessions.map((session, index) => {
          const outAt = session.punch_out ? new Date(session.punch_out.at).getTime() : null
          const gap = breaks.find((item) => new Date(item.start).getTime() === outAt)
          return (
            <SessionRows
              key={session.punch_in.at}
              number={index + 1}
              session={session}
              gap={gap}
              live={session === open && isToday ? now : null}
            />
          )
        })}
      </ol>

      <p className="text-right text-[12px]">
        <Link
          to={`/admin/employees/${employeeId}/attendance`}
          className="text-ink-500 underline underline-offset-2 hover:text-ink-900"
        >
          Whole month
        </Link>
      </p>
    </div>
  )
}

function Figure({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase">{term}</dt>
      <dd className="tabular mt-0.5 text-[15px] font-semibold text-ink-900">{value}</dd>
    </div>
  )
}

/*
  The day as one bar, from the first punch-in to the last punch-out: stretches
  of work in ink, breaks as paper, and time away after sharing stopped hatched,
  so a choppy afternoon is visible at a glance.
*/
function DayBar({
  sessions,
  breaks,
  until,
}: {
  sessions: AttendanceSession[]
  breaks: DayBreak[]
  until: number | null
}) {
  const start = new Date(sessions[0].punch_in.at).getTime()
  const ends = sessions
    .map((session) => (session.punch_out ? new Date(session.punch_out.at).getTime() : until))
    .filter((value): value is number => value !== null)
  const end = Math.max(start + 60_000, ...ends)
  const span = end - start
  const place = (from: number, to: number) => ({
    left: `${((from - start) / span) * 100}%`,
    width: `${Math.max(0.4, ((to - from) / span) * 100)}%`,
  })

  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-ink-50" aria-hidden>
        {sessions.map((session) => {
          const from = new Date(session.punch_in.at).getTime()
          const to = session.punch_out ? new Date(session.punch_out.at).getTime() : until
          if (to === null) return null
          return (
            <span
              key={session.punch_in.at}
              className="absolute inset-y-0 bg-ink-800"
              style={place(from, to)}
            />
          )
        })}
        {breaks
          .filter((gap) => gap.kind === SCREEN_SHARE_STOPPED)
          .map((gap) => (
            <span
              key={gap.start}
              className="absolute inset-y-0"
              style={{
                ...place(new Date(gap.start).getTime(), new Date(gap.end).getTime()),
                background:
                  'repeating-linear-gradient(135deg, var(--color-ink-300) 0 3px, transparent 3px 6px)',
              }}
            />
          ))}
      </div>
      <div className="tabular mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{formatTime(new Date(start).toISOString())}</span>
        <span>{until ? 'now' : formatTime(new Date(end).toISOString())}</span>
      </div>
    </div>
  )
}

function SessionRows({
  number,
  session,
  gap,
  live,
}: {
  number: number
  session: AttendanceSession
  gap?: DayBreak
  live: number | null
}) {
  const stoppedSharing = session.closed_reason === SCREEN_SHARE_STOPPED
  const outcome = session.punch_out
    ? stoppedSharing
      ? `Punched out automatically — screen sharing stopped · worked ${formatMinutes(session.duration_minutes)}`
      : `Worked ${formatMinutes(session.duration_minutes)}`
    : session.auto_closed
      ? 'Never punched out'
      : live
        ? `Working now · ${formatMinutes(minutesBetween(session.punch_in.at, live))} so far`
        : 'Open'

  return (
    <>
      <li className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
        <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
          {number}
        </span>
        <span className="tabular flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-ink-900">
            <LogIn className="size-3.5 text-ink-400" aria-hidden />
            {formatTime(session.punch_in.at)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-900">
            <LogOut className="size-3.5 text-ink-400" aria-hidden />
            {session.punch_out ? formatTime(session.punch_out.at) : '—'}
          </span>
          <span
            className={cn(
              'text-ink-500',
              session.auto_closed && !session.punch_out && 'text-status-red',
              live && 'text-status-blue',
            )}
          >
            {outcome}
          </span>
        </span>
      </li>
      {gap && (
        <li className="flex items-center gap-3 bg-ink-50/60 px-3 py-2 text-[12px] text-ink-500">
          <span className="grid size-6 shrink-0 place-items-center">
            {gap.kind === SCREEN_SHARE_STOPPED ? (
              <ScreenShareOff className="size-3.5" aria-hidden />
            ) : (
              <Coffee className="size-3.5" aria-hidden />
            )}
          </span>
          <span className="tabular">
            <span className="font-semibold text-ink-700">
              {gap.kind === SCREEN_SHARE_STOPPED ? 'Away — sharing stopped' : 'Break'} ·{' '}
              {formatMinutes(gap.minutes)}
            </span>{' '}
            ({formatTime(gap.start)} – {formatTime(gap.end)})
          </span>
        </li>
      )}
    </>
  )
}
