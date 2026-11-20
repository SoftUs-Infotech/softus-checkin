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
import { HourLabels, HourLines, Legend, Swatch, type LegendItem } from './Timeline'
import { clock, spanStyle, timeScale } from './timeScale'

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
            term="Away — punched out automatically"
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

/** Why the system punched somebody out, for the administrator. */
const AUTO_OUT_REASON: Record<string, string> = {
  IDLE: 'PC idle',
  SETTING_OFF: 'a setting was turned off',
  SCREEN_NOT_VISIBLE: 'screen could not be seen',
  NO_SCREENSHOTS: 'no screenshots',
  NO_CHECKINS: 'app stopped checking in',
  APP_CLOSED: 'app closed',
  SHARING_STOPPED: 'sharing stopped',
  WORK_MODE_CHANGED: 'switched to work from home',
}

function autoOutReason(detail?: string | null): string {
  return AUTO_OUT_REASON[detail ?? ''] ?? 'sharing stopped'
}

const at = (iso: string) => new Date(iso).getTime()

/** A punch in or out, above the bar; red when the system punched them out. */
function Marker({ auto = false }: { auto?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block size-0 border-x-[4px] border-t-[6px] border-x-transparent',
        auto ? 'border-t-status-red' : 'border-t-ink-700',
      )}
    />
  )
}

interface Piece {
  from: number
  to: number
  className: string
  label: string
}

/*
  The day on a timeline: the hours across the top, a mark at every punch-in
  and punch-out, work in ink, breaks in grey, time away after the system
  punched them out in red, and a line at now. Hover a piece for its times; the
  list below says the same in words.
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
  const first = at(sessions[0].punch_in.at)
  const ends = sessions
    .map((session) => (session.punch_out ? at(session.punch_out.at) : until))
    .filter((value): value is number => value !== null)
  const scale = timeScale(first, Math.max(first + 60_000, ...ends))

  const pieces: Piece[] = []
  const marks: { at: number; auto: boolean; label: string }[] = []
  for (const session of sessions) {
    const from = at(session.punch_in.at)
    const to = session.punch_out ? at(session.punch_out.at) : until
    marks.push({ at: from, auto: false, label: `Punched in ${clock(from)}` })
    if (to === null) continue
    pieces.push({
      from,
      to,
      className: 'bg-ink-800',
      label: `Worked · ${clock(from)} – ${session.punch_out ? clock(to) : 'now'} · ${formatMinutes(Math.round((to - from) / 60_000))}`,
    })
    if (!session.punch_out) continue
    const auto = session.closed_reason === SCREEN_SHARE_STOPPED
    marks.push({
      at: to,
      auto,
      label: auto
        ? `Punched out automatically ${clock(to)} — ${autoOutReason(session.closed_detail)}`
        : `Punched out ${clock(to)}`,
    })
  }
  for (const gap of breaks) {
    const away = gap.kind === SCREEN_SHARE_STOPPED
    pieces.push({
      from: at(gap.start),
      to: at(gap.end),
      className: away ? 'bg-status-red/60' : 'bg-ink-300',
      label: `${away ? `Away — ${autoOutReason(gap.detail)}` : 'Break'} · ${formatTime(gap.start)} – ${formatTime(gap.end)} · ${formatMinutes(gap.minutes)}`,
    })
  }

  const legend: LegendItem[] = [
    { swatch: <Swatch className="bg-ink-800" />, label: 'Worked' },
    { swatch: <Swatch className="bg-ink-300" />, label: 'Break' },
  ]
  if (breaks.some((gap) => gap.kind === SCREEN_SHARE_STOPPED)) {
    legend.push({ swatch: <Swatch className="bg-status-red/60" />, label: 'Away after an automatic punch-out' })
  }
  legend.push({ swatch: <Marker />, label: 'Punch in / out' })
  if (marks.some((mark) => mark.auto)) legend.push({ swatch: <Marker auto />, label: 'Punched out automatically' })
  if (until !== null) {
    legend.push({ swatch: <span aria-hidden className="h-3 w-0.5 rounded-full bg-status-blue" />, label: 'Now' })
  }

  return (
    <figure data-testid="day-timeline" aria-label="The day on a timeline; the list below gives every punch in and out">
      <HourLabels scale={scale} />
      <div className="relative h-7">
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-4 rounded-[4px] bg-ink-50" />
        <HourLines scale={scale} className="inset-y-0" />
        <div className="absolute inset-x-0 bottom-0 h-4">
          {pieces.map((piece) => (
            <span
              key={`${piece.from}-${piece.className}`}
              title={piece.label}
              className={cn('absolute inset-y-0 rounded-[3px]', piece.className)}
              style={spanStyle(scale, piece.from, piece.to)}
            />
          ))}
        </div>
        {marks.map((mark) => (
          <span
            key={`${mark.at}-${mark.label}`}
            title={mark.label}
            className="absolute top-0 -translate-x-1/2 px-1"
            style={{ left: `${scale.at(mark.at)}%` }}
          >
            <Marker auto={mark.auto} />
          </span>
        ))}
        {until !== null && (
          <span
            title={`Now ${clock(until)}`}
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-status-blue"
            style={{ left: `${scale.at(until)}%` }}
          />
        )}
      </div>
      <Legend items={legend} />
    </figure>
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
      ? `Punched out automatically — ${autoOutReason(session.closed_detail)} · worked ${formatMinutes(session.duration_minutes)}`
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
              {gap.kind === SCREEN_SHARE_STOPPED ? `Away — ${autoOutReason(gap.detail)}` : 'Break'} ·{' '}
              {formatMinutes(gap.minutes)}
            </span>{' '}
            ({formatTime(gap.start)} – {formatTime(gap.end)})
          </span>
        </li>
      )}
    </>
  )
}
