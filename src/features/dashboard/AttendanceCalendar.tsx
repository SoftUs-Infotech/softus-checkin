import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDate, formatMinutes, formatTime, statusStyle, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, CalendarSkeleton, Card, Modal } from '@/components/ui'
import type { AttendanceDay, MonthCalendar } from '@/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/*
  The muster mark.

  A register does not colour its cells in; it writes a letter in them. P for
  present, A for absent, L for leave, H for a holiday — a rule that has held
  since attendance was kept in a ledger, and still the densest way to show a
  month. The colour is the second reading, not the first: an operator who is
  colour-blind, or printing the page, still has the letter.

  Half a day is ½ because that is what a clerk would write. A day whose
  punch-out never came is ! — an entry that is wrong rather than a state the
  employee chose. A weekly off is an em rule, the mark for "nothing was due
  here". A day still running is a mid dot: the entry is open, not yet closed.
*/
export const MARKS: Record<string, string> = {
  PRESENT: 'P',
  HALF_DAY: '½',
  SHORT_HOURS: 'S',
  IN_PROGRESS: '·',
  MISSING_PUNCH_OUT: '!',
  ABSENT: 'A',
  ON_LEAVE: 'L',
  HOLIDAY: 'H',
  WEEKEND: '—',
  NOT_STARTED: '',
  UPCOMING: '',
  BEFORE_JOINING: '',
}

/*
  Ink for a mark, from the colour name the server sends with the day.
  `statusStyle` gives a filled chip, which is what a heatmap wants; a written
  mark wants the colour on the letter itself and nothing behind it.
*/
const MARK_INK: Record<string, string> = {
  green: 'text-status-green',
  amber: 'text-status-amber',
  red: 'text-status-red',
  violet: 'text-status-violet',
  yellow: 'text-status-yellow',
  blue: 'text-status-blue',
  grey: 'text-status-grey',
}

export function markInk(color: string): string {
  return MARK_INK[color] ?? MARK_INK.grey
}

/** Days on which nothing was due. They sit back so the working week reads. */
const NOT_DUE = new Set(['WEEKEND', 'HOLIDAY', 'UPCOMING', 'BEFORE_JOINING'])

/** Legend entries, in the order an employee cares about them. */
const LEGEND: { status: string; label: string }[] = [
  { status: 'PRESENT', label: 'Full day' },
  { status: 'HALF_DAY', label: 'Half day' },
  { status: 'SHORT_HOURS', label: 'Short hours' },
  { status: 'MISSING_PUNCH_OUT', label: 'Missing punch-out' },
  { status: 'ABSENT', label: 'Absent' },
  { status: 'ON_LEAVE', label: 'Leave' },
  { status: 'HOLIDAY', label: 'Holiday' },
  { status: 'WEEKEND', label: 'Weekly off' },
]

/*
  The month asks two questions and nothing else: "which days were a problem"
  and "what happened on this one". The figures along the top answer the first —
  each one is a filter, and pressing it dims every day it does not describe, so
  four absences in a month of thirty cells stop being a hunt. The cells answer
  the second by opening the day.
*/
type Highlight =
  { kind: 'status'; value: string; label: string } | { kind: 'late'; value: 'late'; label: string }

function matches(day: AttendanceDay, highlight: Highlight | null): boolean {
  if (!highlight) return true
  if (highlight.kind === 'late') return day.is_late
  return day.status === highlight.value
}

type Size = 'compact' | 'full'

export type MonthCursor = { year: number; month: number }

export function AttendanceCalendar({
  userId,
  /** `full` is the employee's own month given a page to itself: the marks at a
      size you can read across a desk, and the key at the foot like a form. */
  size = 'compact',
  /** Pass a month to hand navigation to the page around it.
   *
   *  On a page that also totals the month — days recorded, hours worked — two
   *  independent month controls would let the figures and the grid describe
   *  different months while both looked right. When this is set the calendar
   *  drops its own arrows and follows. */
  month: controlled,
}: {
  userId?: string
  size?: Size
  month?: MonthCursor
}) {
  // Organisation time, not the reader's: near a month boundary a browser in
  // another zone opens the calendar on the wrong month — and then queries it.
  const [thisYear, thisMonth] = todayKey().split('-').map(Number)
  const [own, setOwn] = useState({ year: thisYear, month: thisMonth })
  const cursor = controlled ?? own
  const setCursor = controlled ? () => {} : setOwn
  const [selected, setSelected] = useState<AttendanceDay | null>(null)
  const [highlight, setHighlight] = useState<Highlight | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-calendar', cursor.year, cursor.month, userId ?? 'me'],
    queryFn: () =>
      apiGet<MonthCalendar>('/attendance/calendar', {
        year: cursor.year,
        month: cursor.month,
        user_id: userId,
      }),
    // An administrator closing a day changes what everybody else's calendar
    // should say. Nobody reloads the page to find out, so the month refetches
    // when the tab is looked at again.
    refetchOnWindowFocus: true,
  })

  // A highlight is a filter on one month's days; carrying it into the next
  // month would silently hide everything that does not match.
  useEffect(() => {
    setHighlight(null)
  }, [cursor.year, cursor.month])

  // Monday-first grid: pad the leading blanks so weekday columns line up.
  const leadingBlanks = useMemo(() => {
    if (!data?.days.length) return 0
    return (new Date(`${data.days[0].date}T00:00:00`).getDay() + 6) % 7
  }, [data])

  function step(direction: -1 | 1) {
    setHighlight(null)
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

  function toggle(next: Highlight) {
    setHighlight((current) =>
      current && current.kind === next.kind && current.value === next.value ? null : next,
    )
  }

  const full = size === 'full'

  const legend = data ? (
    <ul
      className={cn(
        // The key sits at the foot of the sheet in both sizes. It used to move
        // to a column beside the month at `md`, which was fine on a page and
        // wrong in a 288px rail — the month was squeezed to 23px cells to make
        // room for it.
        'flex flex-wrap gap-x-4 gap-y-2 border-t border-rule',
        full ? 'justify-start px-4 py-3 sm:px-5' : 'justify-center px-4 py-3',
      )}
    >
      {LEGEND.map((entry) => (
        <li key={entry.status} className="flex items-center gap-1.5 text-[11px] text-ink-500">
          <span
            aria-hidden
            className={cn(
              'mark size-4 shrink-0 text-[12px]',
              markInk(data.legend[entry.status] ?? 'grey'),
            )}
          >
            {MARKS[entry.status]}
          </span>
          {entry.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <span aria-hidden className="mark size-4 shrink-0 text-[12px] text-status-amber">
          *
        </span>
        Late arrival
      </li>
    </ul>
  ) : null

  return (
    <Card>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className={cn('text-ink-900', full ? 'text-[17px]' : 'text-[14px]')}>{monthLabel}</h2>
          {data && (
            <p className="tabular mt-0.5 text-[11px] text-ink-400">
              {data.summary.worked_display} across {data.summary.working_days} working{' '}
              {data.summary.working_days === 1 ? 'day' : 'days'}
            </p>
          )}
        </div>
        {/* Not rendered at all when the page owns the month — a hidden second
            set of month arrows is still there for a keyboard and for a test. */}
        {!controlled && (
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isThisMonth}
              onClick={() => {
                setHighlight(null)
                setCursor({
                  year: thisYear,
                  month: thisMonth,
                })
              }}
            >
              Today
            </Button>
            <Button variant="ghost" size="sm" onClick={() => step(1)} aria-label="Next month">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </header>

      {isLoading || !data ? (
        <div className="px-4 py-4">
          <CalendarSkeleton />
        </div>
      ) : (
        <>
          {/* The month in figures — the total at the foot of a column, moved to
              the head of it. Each figure is also the filter for what it counts. */}
          <div className="flex flex-wrap gap-x-1 gap-y-0.5 border-b border-rule bg-ink-50/60 px-3 py-2">
            <Stat
              label="Present"
              value={data.summary.present_days}
              active={highlight?.value === 'PRESENT'}
              onClick={() => toggle({ kind: 'status', value: 'PRESENT', label: 'full days' })}
            />
            <Stat
              label="Half"
              value={data.summary.half_days}
              active={highlight?.value === 'HALF_DAY'}
              onClick={() =>
                toggle({
                  kind: 'status',
                  value: 'HALF_DAY',
                  label: 'half days',
                })
              }
            />
            <Stat
              label="Absent"
              value={data.summary.absent_days}
              active={highlight?.value === 'ABSENT'}
              onClick={() => toggle({ kind: 'status', value: 'ABSENT', label: 'absences' })}
            />
            <Stat
              label="Missed out"
              value={data.summary.missing_punch_out_days}
              active={highlight?.value === 'MISSING_PUNCH_OUT'}
              onClick={() =>
                toggle({
                  kind: 'status',
                  value: 'MISSING_PUNCH_OUT',
                  label: 'days with no punch-out',
                })
              }
            />
            <Stat
              label="Leave"
              value={data.summary.leave_days}
              active={highlight?.value === 'ON_LEAVE'}
              onClick={() =>
                toggle({
                  kind: 'status',
                  value: 'ON_LEAVE',
                  label: 'leave days',
                })
              }
            />
            <Stat
              label="Holidays"
              value={data.summary.holidays}
              active={highlight?.value === 'HOLIDAY'}
              onClick={() => toggle({ kind: 'status', value: 'HOLIDAY', label: 'holidays' })}
            />
            <Stat
              label="Late"
              value={data.summary.late_days}
              active={highlight?.kind === 'late'}
              onClick={() => toggle({ kind: 'late', value: 'late', label: 'late arrivals' })}
            />
          </div>

          {highlight && (
            <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 text-[12px] text-ink-500 sm:px-5">
              <span>
                Showing {highlight.label} in {monthLabel}.
              </span>
              <button
                type="button"
                onClick={() => setHighlight(null)}
                className="font-medium text-ink-900 underline underline-offset-2"
              >
                Show every day
              </button>
            </div>
          )}

          {/* The month, then the key ruled off at its foot — a register page
              reads down, and the key is the last thing on it. */}
          <div className={cn('px-4 py-4', full && 'sm:px-5')}>
            <div
              className={cn(
                'mx-auto grid w-full grid-cols-7',
                full ? 'gap-1 sm:gap-1.5' : 'max-w-[30rem] gap-1',
              )}
            >
              {WEEKDAY_LABELS.map((label, index) => (
                <div
                  key={index}
                  className="border-b border-rule pb-1 text-center text-[10px] font-semibold tracking-wide text-ink-400"
                >
                  {label}
                </div>
              ))}

              {Array.from({ length: leadingBlanks }).map((_, index) => (
                <div key={`blank-${index}`} />
              ))}

              {data.days.map((day) => (
                <DayCell
                  key={day.date}
                  day={day}
                  size={size}
                  dimmed={!matches(day, highlight)}
                  onSelect={() => setSelected(day)}
                />
              ))}
            </div>
          </div>

          {legend}
        </>
      )}

      <DayDetail day={selected} onClose={() => setSelected(null)} />
    </Card>
  )
}

function Stat({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={value === 0}
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
        'disabled:cursor-default disabled:opacity-60',
        // A pressed filter is ink, not colour: the filter is chrome, and only
        // the record itself gets a hue.
        active ? 'bg-ink-900 text-white' : 'text-ink-400 enabled:hover:bg-white',
      )}
    >
      {label}{' '}
      <span className={cn('tabular font-semibold', active ? 'text-white' : 'text-ink-800')}>
        {value}
      </span>
    </button>
  )
}

function DayCell({
  day,
  size,
  dimmed,
  onSelect,
}: {
  day: AttendanceDay
  size: Size
  dimmed?: boolean
  onSelect: () => void
}) {
  const full = size === 'full'
  const dayNumber = Number(day.date.slice(8, 10))
  // The organisation's today, not the browser's: `toISOString` is UTC, so
  // before 05:30 IST the ring was drawn around yesterday.
  const isToday = day.date === todayKey()
  const worked = day.worked_minutes > 0 ? formatMinutes(day.worked_minutes) : null
  const mark = MARKS[day.status] ?? ''
  const ink = markInk(day.color)
  const notDue = NOT_DUE.has(day.status)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${formatDate(day.date)} — ${day.status_label}${worked ? `, ${worked} worked` : ''}${
        day.is_late ? ', late arrival' : ''
      }`}
      title={`${day.date} · ${day.status_label}${worked ? ` · ${worked}` : ''}`}
      className={cn(
        // A ruled cell on paper, not a coloured tile: the mark inside it is
        // what carries the meaning.
        'relative flex flex-col items-center justify-center rounded-[5px] border text-center',
        'transition duration-200 hover:border-ink-400 hover:z-10',
        notDue ? 'border-rule bg-ink-50/70' : 'border-rule bg-white',
        full ? 'min-h-16 gap-0.5 py-1.5' : 'aspect-square',
        isToday && 'border-ink-900 ring-1 ring-ink-900',
        // Dimmed rather than hidden: the shape of the month has to survive
        // a filter, or the reader loses which weekday a day sat on.
        dimmed && 'opacity-30 hover:opacity-70',
      )}
    >
      <span
        className={cn(
          'tabular leading-none',
          full ? 'text-[11px]' : 'text-[10px]',
          isToday ? 'font-semibold text-ink-900' : 'text-ink-400',
        )}
      >
        {dayNumber}
      </span>

      <span
        aria-hidden
        className={cn('mark leading-none', ink, full ? 'text-[20px]' : 'text-[13px]')}
      >
        {mark}
      </span>

      {full && (
        <span className="tabular text-[9px] leading-none text-ink-400">{worked ?? ' '}</span>
      )}

      {/* The clerk's asterisk for a late arrival — a note in the margin of the
          mark, not a second mark. */}
      {day.is_late && (
        <span
          aria-hidden
          className={cn(
            'tabular absolute top-0.5 right-1 leading-none font-bold text-status-amber',
            full ? 'text-[12px]' : 'text-[10px]',
          )}
        >
          *
        </span>
      )}
    </button>
  )
}

function DayDetail({ day, onClose }: { day: AttendanceDay | null; onClose: () => void }) {
  if (!day) return null
  const style = statusStyle(day.color)

  return (
    <Modal open onClose={onClose} title={formatDate(day.date)} description={day.status_label}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'mark size-8 shrink-0 rounded-md border border-rule text-[18px]',
              markInk(day.color),
            )}
          >
            {MARKS[day.status] ?? ''}
          </span>
          <span className={cn('rounded-full px-2.5 py-1 text-[12px] font-medium', style.chip)}>
            {day.status_label}
          </span>
          {day.is_late && <Badge tone="amber">Late arrival</Badge>}
          {day.is_open && <Badge tone="blue">Still open</Badge>}
          {day.is_manually_adjusted && <Badge tone="blue">Adjusted by an administrator</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <Detail term="Worked" value={formatMinutes(day.worked_minutes)} />
          <Detail term="Expected" value={formatMinutes(day.expected_minutes)} />
          <Detail term="First punch in" value={formatTime(day.first_punch_in)} />
          <Detail term="Last punch out" value={formatTime(day.last_punch_out)} />
        </dl>

        {day.shortfall_minutes > 0 && (
          <p className="rounded-lg bg-status-amber-soft px-3 py-2 text-[13px] text-status-amber">
            <span className="tabular font-medium">{formatMinutes(day.shortfall_minutes)}</span>{' '}
            short of the expected day.
          </p>
        )}
        {day.holiday_name && (
          <p className="rounded-lg bg-status-yellow-soft px-3 py-2 text-[13px] text-status-yellow">
            {day.holiday_name}
          </p>
        )}
        {day.leave_type && (
          <p className="rounded-lg bg-status-violet-soft px-3 py-2 text-[13px] text-status-violet">
            {day.leave_type}
            {day.leave_day_part && day.leave_day_part !== 'FULL'
              ? ` · ${day.leave_day_part.toLowerCase().replace('_', ' ')}`
              : ''}
          </p>
        )}
        {day.adjustment_note && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
            {day.adjustment_note}
          </p>
        )}

        {day.sessions.length > 0 ? (
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
              Sessions
            </p>
            <ul className="divide-y divide-rule rounded-lg border border-rule">
              {day.sessions.map((session, index) => (
                <li key={index} className="px-3 py-2">
                  <div className="tabular flex items-center justify-between gap-3 text-[13px]">
                    <span>
                      {formatTime(session.punch_in.at)} — {formatTime(session.punch_out?.at)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0',
                        session.auto_closed && !session.punch_out
                          ? 'text-status-red'
                          : 'text-ink-500',
                      )}
                    >
                      {session.punch_out
                        ? formatMinutes(session.duration_minutes)
                        : session.auto_closed
                          ? 'Never punched out'
                          : 'Open'}
                    </span>
                  </div>
                  {session.punch_in.address && (
                    <p className="mt-0.5 text-[12px] text-ink-400">{session.punch_in.address}</p>
                  )}
                  {session.punch_in.latitude != null && !session.punch_in.address && (
                    <p className="tabular mt-0.5 text-[12px] text-ink-400">
                      {session.punch_in.latitude.toFixed(4)},{' '}
                      {session.punch_in.longitude?.toFixed(4)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg bg-ink-50 px-3 py-3 text-[13px] text-ink-400">
            No punches were recorded on this day.
          </p>
        )}
      </div>
    </Modal>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <dt className="text-[11px] tracking-wide text-ink-400 uppercase">{term}</dt>
      <dd className="tabular mt-0.5 text-[14px] font-medium text-ink-900">{value}</dd>
    </div>
  )
}
