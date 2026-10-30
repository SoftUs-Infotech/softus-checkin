import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { refreshCalendarDependents } from '@/lib/refresh'
import {
  Badge,
  Button,
  CalendarSkeleton,
  Card,
  CardHeader,
  CardSkeleton,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  StatTile,
  useToast,
} from '@/components/ui'
import type { CompOff, Holiday, WorkCalendarDay, WorkCalendarMonth } from '@/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/*
  Which days the office is open.

  The Saturday pattern lives in Settings because it is policy. This page is for
  the exceptions: opening a day by hand, closing one, and swapping a pair so the
  month keeps the same number of working days — which is what keeps everybody's
  per-day rate honest. And counting a day as a full day for everybody who came
  in, for the Saturday the office opens for three hours on purpose.
*/

export function WorkCalendarPage() {
  const today = new Date()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 })
  const [selected, setSelected] = useState<WorkCalendarDay | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['work-calendar', cursor.year, cursor.month],
    queryFn: () =>
      apiGet<WorkCalendarMonth>('/work-calendar/month', {
        year: cursor.year,
        month: cursor.month,
      }),
  })

  // The organisation's ledger, not the administrator's own: a comp-off is
  // earned by working the day that was later given back, and whoever gave it
  // back is not usually the person who worked it.
  const compOffs = useQuery({
    queryKey: ['comp-offs', 'org'],
    queryFn: () => apiGet<CompOff[]>('/work-calendar/comp-offs', { scope: 'org' }),
  })

  // The holidays themselves, so a day can be declared or withdrawn from here
  // rather than only from the separate holidays page.
  const holidays = useQuery({
    queryKey: ['holidays', cursor.year],
    queryFn: () => apiGet<Holiday[]>('/holidays', { year: cursor.year }),
  })

  const holidayOn = (date: string) => holidays.data?.find((entry) => entry.date === date)

  // Every screen that reads "is the office open" — see lib/refresh.
  const refresh = () => refreshCalendarDependents(queryClient)

  const rule = useMutation({
    mutationFn: ({ date, working, reason }: { date: string; working: boolean; reason: string }) =>
      apiPost('/work-calendar/overrides', {
        date,
        kind: working ? 'WORKING' : 'OFF',
        reason,
      }),
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Calendar updated.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The ruling was not saved.')
      setError(message)
      toast.error(message)
    },
  })

  const clearRule = useMutation({
    mutationFn: (date: string) => apiDelete(`/work-calendar/overrides/${date}`),
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Back to the pattern.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The ruling was not removed.')
      setError(message)
      toast.error(message)
    },
  })

  // Changing the pattern is a settings change, not a per-date ruling: it is
  // how "the second and fourth Saturday are working" is expressed.
  const pattern = useMutation({
    mutationFn: async ({ ordinal, working }: { ordinal: number; working: boolean }) => {
      const current = await apiGet<{ working_saturdays: number[] }>('/settings')
      const next = new Set(current.working_saturdays ?? [])
      if (working) next.add(ordinal)
      else next.delete(ordinal)
      return apiPatch('/settings', { working_saturdays: [...next].sort() })
    },
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Saturday pattern changed for every month.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The pattern was not changed.')
      setError(message)
      toast.error(message)
    },
  })

  // A holiday closes the day everywhere at once — the calendar, everybody's
  // dashboard and the working-day count the day rate is divided by.
  const declareHoliday = useMutation({
    mutationFn: ({ date, name }: { date: string; name: string }) =>
      apiPost('/holidays', { date, name, type: 'COMPANY' }),
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Holiday added. The month has one fewer working day.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The holiday was not added.')
      setError(message)
      toast.error(message)
    },
  })

  const withdrawHoliday = useMutation({
    mutationFn: (id: string) => apiDelete(`/holidays/${id}`),
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Holiday removed. The day is a working day again.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The holiday was not removed.')
      setError(message)
      toast.error(message)
    },
  })

  // A short day the owner chose: whoever came in gets a full day, whatever the
  // clock says. Re-judged on the server for everybody, so the register, every
  // month and the salary projection all move — hence the full refresh.
  const fullDay = useMutation({
    mutationFn: ({ date, on, reason }: { date: string; on: boolean; reason: string }) =>
      on
        ? apiPost('/work-calendar/full-days', { date, reason })
        : apiDelete(`/work-calendar/full-days/${date}`),
    onSuccess: (_, { on }) => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success(
        on
          ? 'Counted as a full day for everybody who came in.'
          : 'The day is judged by hours worked again.',
      )
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The day was not changed.')
      setError(message)
      toast.error(message)
    },
  })

  const undoSwap = useMutation({
    mutationFn: (date: string) => apiDelete(`/work-calendar/swaps/${date}`),
    onSuccess: () => {
      refresh()
      setSelected(null)
      setError(null)
      toast.success('Swap undone. Both dates are back on the pattern.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'The swap was not removed.')
      setError(message)
      toast.error(message)
    },
  })

  const leadingBlanks = useMemo(() => {
    if (!data?.days.length) return 0
    return (new Date(`${data.days[0].date}T00:00:00`).getDay() + 6) % 7
  }, [data])

  function step(direction: -1 | 1) {
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

  return (
    <>
      <PageHeader
        title="Work calendar"
        description="Which Saturdays are open, and every exception to the pattern."
        action={
          <Button variant="secondary" onClick={() => setSwapping(true)}>
            <ArrowLeftRight className="size-4" />
            Swap two days
          </Button>
        }
      />

      {error && <ErrorNote message={error} className="mb-4" />}

      {/* The month in four figures. "Working days" is the one that matters:
          it is what every salary in the organisation is divided by, so a
          holiday or a closed Saturday has to be visible as a number, not only
          as a colour somewhere in the grid. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Working days"
          value={data?.working_days ?? '—'}
          hint="Divides every day rate"
        />
        <StatTile
          label="Office closed"
          value={data ? data.days.length - data.working_days : '—'}
          hint="Weekly offs, holidays and closures"
        />
        <StatTile
          label="Holidays"
          value={data ? data.days.filter((day) => day.holiday_name).length : '—'}
          tone="yellow"
        />
        <StatTile
          label="Set by hand"
          value={
            data
              ? data.days.filter((day) => day.source === 'OVERRIDE' || day.source === 'SWAP').length
              : '—'
          }
          hint="Overrides and swaps this month"
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
            <div>
              <h2 className="text-[14px] text-ink-900">{monthLabel}</h2>
              {data && (
                <p className="tabular mt-0.5 text-[11px] text-ink-400">
                  {data.working_days} working days — the denominator of everybody's day rate
                </p>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" onClick={() => step(-1)} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() + 1 })}
              >
                Today
              </Button>
              <Button variant="ghost" size="sm" onClick={() => step(1)} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </header>

          {isLoading || !data ? (
            <div className="px-4 py-4">
              <CalendarSkeleton />
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="mx-auto grid max-w-[28rem] grid-cols-7 gap-1.5">
                {WEEKDAY_LABELS.map((label, index) => (
                  <div key={index} className="pb-1 text-center text-[10px] font-semibold text-ink-300">
                    {label}
                  </div>
                ))}
                {Array.from({ length: leadingBlanks }).map((_, index) => (
                  <div key={`blank-${index}`} />
                ))}
                {data.days.map((entry) => (
                  <button
                    key={entry.date}
                    type="button"
                    onClick={() => setSelected(entry)}
                    title={entry.reason}
                    className={cn(
                      'relative flex aspect-square flex-col items-center justify-center rounded-md text-center transition hover:brightness-95',
                      entry.source === 'HOLIDAY'
                        ? 'bg-status-yellow-soft text-status-yellow'
                        : entry.is_undecided
                          ? 'bg-status-amber-soft text-status-amber'
                          : entry.is_working
                            ? 'bg-status-green-soft text-status-green'
                            : 'bg-ink-50 text-ink-400',
                    )}
                  >
                    <span className="tabular text-[12px] leading-none font-semibold">
                      {Number(entry.date.slice(8, 10))}
                    </span>
                    {/* Only a human decision is worth a mark. Labelling every
                        Saturday "pattern" is noise, and it overflowed the cell. */}
                    {/* The label names whatever actually decided the day. A
                        holiday somebody has reopened by hand is a working day
                        because of the ruling, not the holiday — labelling it
                        with the holiday's name made a green cell read as a
                        holiday that had somehow gone green. */}
                    {(entry.source === 'OVERRIDE' ||
                      entry.source === 'SWAP' ||
                      entry.holiday_name ||
                      entry.full_day) && (
                      <span className="mt-0.5 max-w-full truncate px-0.5 text-[8px] leading-none tracking-wide uppercase opacity-70">
                        {entry.source === 'SWAP'
                          ? 'swap'
                          : entry.source === 'OVERRIDE'
                            ? 'set'
                            : entry.holiday_name || 'full day'}
                      </span>
                    )}
                    {/* A holiday the ruling overrode still deserves a mark:
                        somebody is being asked to work a day the organisation
                        calls a holiday. */}
                    {entry.holiday_name && entry.source !== 'HOLIDAY' && (
                      <span
                        aria-hidden
                        className="absolute top-1 right-1 size-1.5 rounded-full bg-status-yellow"
                      />
                    )}
                    {entry.full_day && (
                      <span
                        aria-label="Counted as a full day"
                        className="absolute top-1 left-1 size-1.5 rounded-full bg-ink-900"
                      />
                    )}
                  </button>
                ))}
              </div>

              <ul className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1.5 border-t border-ink-100 pt-3 text-[11px] text-ink-500">
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-green" /> Working
                </li>
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-grey" /> Off
                </li>
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-yellow" /> Holiday
                </li>
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-amber" /> Undecided fifth Saturday
                </li>
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-ink-900" /> Counted as a full day
                </li>
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Comp-off ledger"
            subtitle="Earned when a worked day is later given back"
          />
          {compOffs.isLoading ? (
            <CardSkeleton lines={4} />
          ) : compOffs.data?.length ? (
            <ul className="divide-y divide-ink-50">
              {compOffs.data.slice(0, 12).map((entry) => (
                <li key={entry.id} className="px-5 py-2.5">
                  <p className="flex items-center justify-between gap-2 text-[13px] text-ink-800">
                    <span className="truncate">{entry.user_name || entry.user_email || entry.user_id}</span>
                    <Badge tone={entry.status === 'AVAILABLE' ? 'green' : 'neutral'}>
                      {entry.status.toLowerCase()}
                    </Badge>
                  </p>
                  <p className="tabular mt-0.5 text-[11px] text-ink-400">
                    Earned {formatDate(entry.earned_on)}
                    {entry.expires_on ? ` · expires ${formatDate(entry.expires_on)}` : ' · no expiry'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-ink-400">Nobody has earned a comp-off yet.</p>
          )}
        </Card>
      </div>

      <DayModal
        // A fresh dialog per day: another day's typed reason must not carry over.
        key={selected?.date ?? 'closed'}
        day={selected}
        holiday={selected ? holidayOn(selected.date) : undefined}
        onClose={() => setSelected(null)}
        onRule={(working, reason) =>
          rule.mutate({ date: selected!.date, working, reason })
        }
        onClear={() => clearRule.mutate(selected!.date)}
        onPattern={(working) =>
          pattern.mutate({ ordinal: Math.ceil(Number(selected!.date.slice(8, 10)) / 7), working })
        }
        onHoliday={(name) => declareHoliday.mutate({ date: selected!.date, name })}
        onWithdrawHoliday={(id) => withdrawHoliday.mutate(id)}
        onUndoSwap={() => undoSwap.mutate(selected!.date)}
        onFullDay={(on, reason) => fullDay.mutate({ date: selected!.date, on, reason })}
        busy={
          rule.isPending ||
          clearRule.isPending ||
          pattern.isPending ||
          declareHoliday.isPending ||
          withdrawHoliday.isPending ||
          undoSwap.isPending ||
          fullDay.isPending
        }
      />

      {swapping && <SwapModal open onClose={() => setSwapping(false)} onDone={refresh} />}
    </>
  )
}

function DayModal({
  day,
  holiday,
  onClose,
  onRule,
  onClear,
  onPattern,
  onHoliday,
  onWithdrawHoliday,
  onUndoSwap,
  onFullDay,
  busy,
}: {
  day: WorkCalendarDay | null
  holiday?: Holiday
  onClose: () => void
  onRule: (working: boolean, reason: string) => void
  onClear: () => void
  onPattern: (working: boolean) => void
  onHoliday: (name: string) => void
  onWithdrawHoliday: (id: string) => void
  onUndoSwap: () => void
  onFullDay: (on: boolean, reason: string) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  const [holidayName, setHolidayName] = useState('')
  const [fullDayReason, setFullDayReason] = useState('')
  // What the box was just set to, shown while the save is in flight so the tick
  // lands on click; the server's answer takes over once it is back.
  const [fullDayIntent, setFullDayIntent] = useState<boolean | null>(null)
  if (!day) return null

  // A reason is worth keeping in the audit trail but is not worth blocking the
  // work on: a disabled button with no explanation reads as "you are not
  // allowed to do this", which is the opposite of what is true here.
  const ruling = reason.trim() || 'Set from the work calendar.'

  const ruled = day.source === 'OVERRIDE' || day.source === 'SWAP'
  const isSaturday = day.weekday === 'Saturday'
  const ordinal = Math.ceil(Number(day.date.slice(8, 10)) / 7)
  const ordinalName = ['first', 'second', 'third', 'fourth', 'fifth'][ordinal - 1]

  return (
    <Modal
      open
      onClose={onClose}
      title={formatDate(day.date)}
      description={day.weekday}
    >
      <div className="space-y-4">
        {/* What the day is now, and which rule decided it — before offering to
            change it. The old dialog asked for a decision without saying what
            it was changing. */}
        <div
          className={cn(
            'flex items-center justify-between rounded-lg px-3 py-2.5',
            day.is_working
              ? 'bg-status-green-soft text-status-green'
              : 'bg-ink-50 text-ink-600',
          )}
        >
          <span className="text-[14px] font-medium">
            {day.is_working ? 'The office is open' : 'The office is closed'}
          </span>
          <span className="text-[12px] opacity-80">{day.reason}</span>
        </div>

        {/* Independent of whether the day was opened by the pattern, by hand or
            by a swap: any open day can be a short one. */}
        {(day.is_working || day.full_day) && (
          <div className="space-y-3 border-b border-ink-100 pb-4">
            <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
              Short day
            </p>
            {/* Before the box, not after it: ticking saves straight away. */}
            {!day.full_day && (
              <Field label="Why it is short" hint="Optional. Kept in the audit trail.">
                <Input
                  value={fullDayReason}
                  onChange={(event) => setFullDayReason(event.target.value)}
                  placeholder="Office open 10 am to 1 pm"
                />
              </Field>
            )}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-100 px-3 py-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-ink-900"
                checked={busy && fullDayIntent !== null ? fullDayIntent : Boolean(day.full_day)}
                disabled={busy}
                onChange={(event) => {
                  setFullDayIntent(event.target.checked)
                  onFullDay(
                    event.target.checked,
                    fullDayReason.trim() || 'Short day, counted as a full day.',
                  )
                }}
              />
              <span>
                <span className="block text-[13px] font-medium text-ink-800">
                  Count as a full day for everyone who comes in
                </span>
                <span className="block text-[12px] text-ink-500">
                  For a day the office opens for only a few hours. Anybody who punched in is
                  present for a full day — no half day, no short hours, no late mark — however long
                  they stayed. Their punches are still recorded. Leave stays leave, and anybody who
                  did not come stays absent. Tick it before or after the day; untick to go back to
                  judging by hours.
                </span>
                {day.full_day && day.full_day_reason && (
                  <span className="mt-1 block text-[12px] text-ink-400">
                    Reason: {day.full_day_reason}
                  </span>
                )}
              </span>
            </label>
          </div>
        )}

        {day.swap_with_date ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
              Swapped with {formatDate(day.swap_with_date)}. Undoing it returns both dates to the
              pattern.
            </p>
            <Button variant="secondary" disabled={busy} onClick={onUndoSwap}>
              Undo this swap
            </Button>
          </div>
        ) : (
          <>
            <Field label="Reason" hint="Optional. Kept in the audit trail with your name.">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={day.is_working ? 'Given back after the quarter close' : 'Quarter close'}
              />
            </Field>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                This date only
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={day.is_working ? 'primary' : 'secondary'}
                  disabled={busy || !day.is_working}
                  onClick={() => onRule(false, ruling)}
                >
                  Close this day
                </Button>
                <Button
                  variant={day.is_working ? 'secondary' : 'primary'}
                  disabled={busy || day.is_working}
                  onClick={() => onRule(true, ruling)}
                >
                  Open this day
                </Button>
                {ruled && (
                  <Button variant="ghost" disabled={busy} onClick={onClear}>
                    Back to the pattern
                  </Button>
                )}
              </div>
            </div>

            <div className="border-t border-ink-100 pt-4">
              <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                Holiday
              </p>
              {holiday ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-status-yellow-soft px-2 py-0.5 text-[12px] text-status-yellow">
                    {holiday.name}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onWithdrawHoliday(holiday.id)}
                  >
                    Remove the holiday
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Name" className="min-w-[14rem] flex-1">
                    <Input
                      value={holidayName}
                      onChange={(event) => setHolidayName(event.target.value)}
                      placeholder="Diwali"
                    />
                  </Field>
                  <Button
                    disabled={busy || holidayName.trim().length < 2}
                    onClick={() => onHoliday(holidayName.trim())}
                  >
                    Mark as a holiday
                  </Button>
                </div>
              )}
              <p className="mt-2 text-[12px] text-ink-400">
                A holiday closes the day for everybody and takes it out of the month's working days,
                so the per-day rate follows it automatically.
              </p>
            </div>

            {isSaturday && (
              <div className="border-t border-ink-100 pt-4">
                <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                  Every {ordinalName} Saturday
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onPattern(false)}
                  >
                    Close every {ordinalName} Saturday
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => onPattern(true)}>
                    Open every {ordinalName} Saturday
                  </Button>
                </div>
                <p className="mt-2 text-[12px] text-ink-400">
                  This changes the organisation's pattern, so it applies to every month — not
                  only this one. Dates you have already ruled on by hand keep their ruling.
                </p>
              </div>
            )}
          </>
        )}

      </div>
    </Modal>
  )
}

function SwapModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [offDate, setOffDate] = useState('')
  const [workingDate, setWorkingDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const swap = useMutation({
    mutationFn: () =>
      apiPost('/work-calendar/swaps', {
        off_date: offDate,
        working_date: workingDate,
        reason,
      }),
    onSuccess: () => {
      onDone()
      onClose()
      setError(null)
    },
    onError: (mutationError) => setError(messageOf(mutationError, 'The swap was refused.')),
  })

  if (!open) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="Swap two days"
      description="One working day off, one day off opened — so the month keeps its count."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={swap.isPending}
            disabled={!offDate || !workingDate || reason.trim().length < 3}
            onClick={() => swap.mutate()}
          >
            Swap them
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Give this day off" hint="A day that is currently working.">
            <Input type="date" value={offDate} onChange={(e) => setOffDate(e.target.value)} />
          </Field>
          <Field label="Work this day instead" hint="A day that is currently off.">
            <Input
              type="date"
              value={workingDate}
              onChange={(e) => setWorkingDate(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Reason">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Diwali falls midweek"
          />
        </Field>

        <p className="text-[12px] text-ink-400">
          Both dates must be in the same month. Anyone who already worked the day you are giving
          back earns a comp-off automatically.
        </p>
      </div>
    </Modal>
  )
}
