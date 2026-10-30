import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarOff, MapPin, MonitorSmartphone, ShieldAlert, Timer } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { looksLikeAComputer } from '@/lib/device'
import { currentPosition } from '@/lib/location'
import { formatMinutes, formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Card, ErrorNote, Skeleton, useToast, type BadgeTone } from '@/components/ui'
import type { AttendanceDay, TodayState } from '@/types'
import { PunchDial } from './PunchDial'

/*
  The card is ink and paper; the dial in the middle of it is the only coloured
  thing. Everything that used to be tinted here — the "done" figures, the
  amber notices, the red punch-out — is now ink, because none of it was the
  record. What survives in colour is what the calendar would also colour: the
  status of today, and the dial's arc.
*/

/** The badge for today agrees with the day's own colour, so the card and the
    calendar can never disagree about what today is. */
const TONE_FOR_COLOUR: Record<string, BadgeTone> = {
  green: 'green',
  amber: 'amber',
  red: 'red',
  violet: 'violet',
  yellow: 'yellow',
  blue: 'blue',
  grey: 'neutral',
}

export function PunchCard() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: () => apiGet<TodayState>('/attendance/today'),
    refetchInterval: 120_000,
  })

  /*
    Drives the live elapsed counter while a session is open.

    `tick` means "half-minutes since the figure below it was fetched", so it
    has to restart whenever that figure is replaced — which is what
    `dataUpdatedAt` marks. Without it the counter only reset on mount: punch
    out and back in on the same day and the first session's minutes were still
    being added on top of the server's total, so the day over-read until the
    next refetch happened to correct it.
  */
  useEffect(() => {
    if (!data?.can_punch_out) return
    setTick(0)
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [data?.can_punch_out, dataUpdatedAt])

  const onAComputer = useMemo(() => looksLikeAComputer(), [])

  const punch = useMutation({
    mutationFn: async (action: 'punch-in' | 'punch-out') => {
      let location: Record<string, number> | undefined
      if (data?.geolocation_required !== false) {
        const position = await currentPosition()
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_metres: position.coords.accuracy,
        }
      }
      return apiPost<AttendanceDay>(`/attendance/${action}`, {
        location,
        // A stable key per action per minute: a double-click cannot punch twice.
        request_key: `${action}-${new Date().toISOString().slice(0, 16)}`,
      })
    },
    onMutate: () => setError(null),
    onSuccess: (_result, action) => {
      queryClient.invalidateQueries({ queryKey: ['attendance-today'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-calendar'] })
      // The words the button used, in the past tense.
      toast.success(action === 'punch-in' ? 'Punched in' : 'Punched out')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'Your punch was not recorded.')
      // The note stays on the card; the toast is only so the failure is not
      // missed by somebody whose eyes were on the dial.
      setError(message)
      toast.error(message)
    },
  })

  if (isLoading || !data) return <PunchCardSkeleton />

  const { day, shift } = data
  /*
    A shift is a planned window for a piece of work. When none covers today the
    employee can still punch and the punch is still recorded — so this is a
    note, never a block, and nothing below is disabled because of it. The field
    is read defensively so an older API response degrades to the same answer.
  */
  const noShift = data.no_shift_assigned ?? !shift

  /*
    What a full day is worth today.

    The 9-hour fallback is a last resort for a response that carries neither an
    expectation nor a shift. It must not become the *target* when nobody has
    assigned a shift: the dial would then measure somebody against a day the
    organisation never planned, and tell them they were short of it. Where there
    is no expectation to measure, the dial counts up instead of filling.
  */
  const required = day.expected_minutes || shift?.required_minutes || 540
  const hasTarget = Boolean(day.expected_minutes || shift?.required_minutes)
  const halfDay = shift?.half_day_minutes ?? Math.round(required / 2)
  const working = data.can_punch_out
  const liveMinutes = working ? day.worked_minutes + Math.floor(tick / 2) : day.worked_minutes
  const remaining = Math.max(0, required - liveMinutes)
  const complete = hasTarget && liveMinutes >= required

  // Four states, and only one of them can be true. The heading, the badge and
  // the ring all have to agree, so they are decided here rather than inline.
  const blocked = !working && !data.can_punch_in
  const state: 'blocked' | 'working' | 'complete' | 'idle' = blocked
    ? 'blocked'
    : working
      ? 'working'
      : complete
        ? 'complete'
        : 'idle'

  const HEADING: Record<typeof state, string> = {
    blocked: 'Punching unavailable',
    working: 'Currently working',
    complete: 'Day complete',
    idle: liveMinutes > 0 ? 'Not punched in' : "Today's total",
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col items-center gap-5 px-5 py-6">
        <PunchDial
          workedMinutes={liveMinutes}
          requiredMinutes={required}
          halfDayMinutes={halfDay}
          mode={working ? 'out' : 'in'}
          disabled={working ? false : !data.can_punch_in}
          loading={punch.isPending}
          onPunch={() => punch.mutate(working ? 'punch-out' : 'punch-in')}
        />

        <div className="w-full min-w-0 text-center">
          <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
            {state === 'working' && (
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-status-blue" />
            )}
            {HEADING[state]}
          </p>
          <p className="tabular mt-1 font-display text-4xl leading-none font-semibold text-ink-900">
            {formatMinutes(liveMinutes)}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            <Badge tone={TONE_FOR_COLOUR[day.color] ?? 'neutral'}>{day.status_label}</Badge>
            {day.is_late && <Badge tone="amber">Late arrival</Badge>}
            {day.is_manually_adjusted && <Badge tone="blue">Adjusted</Badge>}
          </div>

          {/* Only shown against a real expectation. With no shift assigned there
              is nothing to be short of, so the card reports the time worked and
              says so, rather than measuring against an invented nine hours. */}
          {hasTarget ? (
            <dl className="mt-4 grid grid-cols-2 border-t border-rule text-left">
              <Figure
                term={remaining > 0 ? 'Left to a full day' : 'Full day'}
                value={remaining > 0 ? formatMinutes(remaining) : 'Complete'}
                done={remaining === 0}
              />
              <Figure
                term="Half day at"
                value={formatMinutes(halfDay)}
                done={liveMinutes >= halfDay}
              />
            </dl>
          ) : (
            <dl className="mt-4 grid grid-cols-1 border-t border-rule text-left">
              <Figure term="Recorded today" value={formatMinutes(liveMinutes)} />
            </dl>
          )}

          {shift && (
            <p className="tabular mt-3 text-[11px] text-ink-400">
              {shift.name} · {shift.start_time}–{shift.end_time}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 px-5 pb-5">
        {error && <ErrorNote message={error} />}

        {/* A block has to end in something the reader can do, not only in what
            went wrong. Each of these carries its own next step. */}
        {!onAComputer && (
          <Notice
            icon={<MonitorSmartphone className="mt-0.5 size-4 shrink-0" />}
            title="Punching needs a computer"
            body="This looks like a phone or tablet. Open the dashboard on your laptop or desktop to punch in — everything else here still works from this device."
          />
        )}

        {data.blocked_reason && (
          <Notice
            icon={<ShieldAlert className="mt-0.5 size-4 shrink-0" />}
            title="Punching is blocked"
            body={data.blocked_reason}
            action={
              <Link
                to="/corrections"
                className="font-medium text-ink-900 underline underline-offset-2"
              >
                Request a correction instead
              </Link>
            }
          />
        )}

        {noShift && (
          <Notice
            icon={<CalendarOff className="mt-0.5 size-4 shrink-0" />}
            title="No shift is assigned right now"
            body="Your punches are still being recorded and counted as normal. Ask your administrator to assign a shift so the day gets an expected start, end and total."
          />
        )}

        {data.geolocation_required && (
          <p className="flex items-center gap-2 text-[12px] text-ink-400">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            Your location is recorded with each punch.
          </p>
        )}
      </div>

      <div className="border-t border-rule">
        <p className="flex items-center gap-1.5 px-5 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
          <Timer className="size-3.5" aria-hidden />
          Today&apos;s sessions
        </p>
        {day.sessions.length > 0 ? (
          <ul className="divide-y divide-rule">
            {day.sessions.map((session, index) => {
              const open = !session.punch_out
              return (
                <li key={index} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="tabular text-[13px] text-ink-700">
                    {formatTime(session.punch_in.at)} — {formatTime(session.punch_out?.at)}
                  </span>
                  <span
                    className={cn(
                      'tabular shrink-0 text-[13px]',
                      session.auto_closed && open
                        ? 'text-status-red'
                        : open
                          ? 'text-status-blue'
                          : 'text-ink-500',
                    )}
                  >
                    {session.punch_out
                      ? formatMinutes(session.duration_minutes)
                      : session.auto_closed
                        ? 'Never punched out'
                        : 'In progress'}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-[13px] text-ink-400">
            Nothing recorded yet. Your first punch of the day will appear here.
          </p>
        )}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

/* Two figures at the foot of the column, ruled off rather than boxed in — the
   totals line of a register. `done` is weight, not colour. */
function Figure({ term, value, done }: { term: string; value: string; done?: boolean }) {
  return (
    <div className="px-1 py-2 first:pr-3 last:border-l last:border-rule last:pl-3">
      <dt className="text-[10px] tracking-wide text-ink-400 uppercase">{term}</dt>
      <dd
        className={cn(
          'tabular mt-0.5 text-[14px]',
          done ? 'font-semibold text-ink-900' : 'font-medium text-ink-700',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/* A note on the sheet. It is ink on a ruled panel whatever it says: a notice
   painted amber or red would be the loudest thing on a page whose only colour
   is meant to be the record. Urgency is carried by the words. */
function Notice({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rule bg-ink-50/70 px-3 py-2 text-[12px] text-ink-600">
      {icon}
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block">{body}</span>
        {action && <span className="mt-1 block">{action}</span>}
      </span>
    </div>
  )
}

/** The card's own shape, so nothing shifts when today's state arrives. */
function PunchCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex flex-col items-center gap-5 px-5 py-6"
        aria-busy="true"
        aria-label="Loading today"
      >
        <Skeleton className="aspect-square w-full max-w-[200px] rounded-full" />
        <div className="w-full space-y-2">
          <Skeleton className="mx-auto h-3 w-24" />
          <Skeleton className="mx-auto h-9 w-32" />
          <Skeleton className="mx-auto h-3.5 w-40" />
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
    </Card>
  )
}
