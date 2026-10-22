import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarRange, Lock, Plus, Star } from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatMinutes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { refreshCalendarDependents } from '@/lib/refresh'
import {
  Badge,
  Button,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  useToast,
} from '@/components/ui'
import type { Shift } from '@/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

/* Sunday is the weekly off for the whole organisation and no shift opens it.
   Saturday is a different case: a shift may well cover Saturdays, and *which*
   Saturdays the office is actually open is decided separately — by the
   repeating pattern in Settings and by single dates on the work calendar. So
   Saturday is tickable and Sunday is not. */
const SUNDAY = 6

const schema = z
  .object({
    name: z.string().min(2, 'Name the shift.').max(60),
    code: z.string().min(2, 'Give a short code.').max(20),
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
    end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
    required_hours: z.coerce.number().min(0.5).max(24),
    half_day_hours: z.coerce.number().min(0.25).max(24),
    grace_minutes: z.coerce.number().int().min(0).max(240),
    break_minutes: z.coerce.number().int().min(0).max(480),
    working_weekdays: z.array(z.number()).min(1, 'Pick at least one working day.'),
    description: z.string().max(500).optional(),
  })
  .refine((values) => values.half_day_hours < values.required_hours, {
    path: ['half_day_hours'],
    message: 'A half day must be shorter than a full day.',
  })

/*
  `z.coerce` reads strings from the form and hands back numbers, so the input
  and output types differ. React Hook Form takes both, which keeps the submit
  handler typed as numbers without any casting.
*/
type Input = z.input<typeof schema>
type Values = z.output<typeof schema>

export function ShiftsPage() {
  const [editing, setEditing] = useState<Shift | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Shift | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'all'],
    queryFn: () => apiGet<Shift[]>('/shifts', { include_inactive: true }),
  })

  const makeDefault = useMutation({
    mutationFn: (id: string) => apiPatch(`/shifts/${id}`, { is_default: true }),
    onSuccess: () => {
      refreshCalendarDependents(queryClient)
      setError(null)
      toast.success('Default shift changed.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError)
      setError(message)
      toast.error(message)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/shifts/${id}`),
    onSuccess: () => {
      setError(null)
      setDeleting(null)
      refreshCalendarDependents(queryClient)
      toast.success('Shift deleted.')
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError)
      setError(message)
      toast.error(message)
    },
  })

  return (
    <>
      <PageHeader
        title="Shifts"
        description="A shift decides what counts as a full day, a half day, and which weekdays it covers. Its hours are the organisation's — who is on it, and for how long, is set on the Employees page."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Create a shift
          </Button>
        }
      />

      {error && <ErrorNote message={error} className="mb-4" />}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardSkeleton lines={4} />
          </Card>
          <Card>
            <CardSkeleton lines={4} />
          </Card>
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<CalendarRange className="size-8" />}
            title="No shifts yet"
            description="Create one so attendance has something to measure against."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Create a shift
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((shift) => (
            <Card key={shift.id} className="flex flex-col px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] text-ink-900">{shift.name}</h3>
                    <span className="tabular rounded bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
                      {shift.code}
                    </span>
                    {shift.is_default && (
                      <Badge tone="brand">
                        <Star className="size-3" aria-hidden />
                        Default
                      </Badge>
                    )}
                    {!shift.is_active && <Badge>Inactive</Badge>}
                  </div>
                </div>
                <p className="tabular shrink-0 text-[12px] text-ink-400">
                  {shift.assigned_count ?? 0} assigned
                </p>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Figure
                  label="Hours"
                  value={`${shift.start_time}–${shift.end_time}`}
                  hint={shift.crosses_midnight ? 'Overnight' : undefined}
                />
                <Figure label="Full day" value={formatMinutes(shift.required_minutes)} />
                <Figure label="Half day" value={formatMinutes(shift.half_day_minutes)} />
                <Figure
                  label="Grace"
                  value={`${shift.grace_minutes}m`}
                  hint={shift.break_minutes ? `${shift.break_minutes}m break` : undefined}
                />
              </dl>

              <div className="mt-3">
                <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                  Working days
                </p>
                <ul className="mt-1.5 flex gap-1">
                  {WEEKDAYS.map((label, index) => {
                    const working = shift.working_weekdays.includes(index)
                    return (
                      <li
                        key={label}
                        title={`${WEEKDAY_NAMES[index]} — ${working ? 'working day' : 'not a working day'}`}
                        className={cn(
                          'flex-1 rounded py-1 text-center text-[11px]',
                          working
                            ? 'bg-ink-100 font-medium text-ink-800'
                            : 'bg-ink-50 text-ink-300',
                        )}
                      >
                        {label}
                        <span className="sr-only">
                          {working ? ' is a working day' : ' is not a working day'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {shift.description && (
                <p className="mt-3 text-[13px] text-ink-500">{shift.description}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-1 border-t border-ink-100 pt-3">
                {!shift.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={makeDefault.isPending && makeDefault.variables === shift.id}
                    onClick={() => makeDefault.mutate(shift.id)}
                  >
                    Make default
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setEditing(shift)}>
                  Edit
                </Button>
                {!shift.is_default && (
                  <>
                    <span className="mx-1 h-5 w-px bg-ink-100" aria-hidden />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-status-red hover:bg-status-red-soft hover:text-status-red"
                      onClick={() => setDeleting(shift)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete shift
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          {deleting?.assigned_count
            ? `${deleting.assigned_count} ${deleting.assigned_count === 1 ? 'person is' : 'people are'} on this shift. Move them to another shift first — attendance already recorded keeps the hours it was measured against.`
            : 'Attendance already recorded keeps the hours it was measured against. Nobody is on this shift.'}
        </p>
      </Modal>

      <ShiftModal
        open={creating || Boolean(editing)}
        shift={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </>
  )
}

/** One figure with the word that makes it mean something. Times and durations
    are monospaced so two shift cards side by side line up. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{label}</dt>
      <dd className="tabular truncate text-[13px] text-ink-800">
        {value}
        {hint && <span className="block text-[11px] text-ink-400">{hint}</span>}
      </dd>
    </div>
  )
}

function ShiftModal({
  open,
  shift,
  onClose,
}: {
  open: boolean
  shift: Shift | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    values: {
      name: shift?.name ?? '',
      code: shift?.code ?? '',
      start_time: shift?.start_time ?? '09:30',
      end_time: shift?.end_time ?? '18:30',
      required_hours: (shift?.required_minutes ?? 540) / 60,
      half_day_hours: (shift?.half_day_minutes ?? 240) / 60,
      grace_minutes: shift?.grace_minutes ?? 15,
      break_minutes: shift?.break_minutes ?? 0,
      working_weekdays: shift?.working_weekdays ?? [0, 1, 2, 3, 4],
      description: shift?.description ?? '',
    },
  })

  const weekdays = watch('working_weekdays')
  const requiredHours = Number(watch('required_hours'))
  const halfDayHours = Number(watch('half_day_hours'))
  const graceMinutes = Number(watch('grace_minutes'))
  const startTime = watch('start_time')
  const endTime = watch('end_time')

  // The same numbers, read back as a sentence. Nine fields of digits do not
  // tell anybody what the shift will feel like on a Tuesday morning.
  const summary =
    Number.isFinite(requiredHours) && Number.isFinite(halfDayHours)
      ? `A full day is ${formatHours(requiredHours)}, a half day ${formatHours(halfDayHours)}. ` +
        `Arriving after ${addGrace(startTime, graceMinutes)} counts as a late arrival.`
      : null

  async function onSubmit(values: Values) {
    setError(null)
    const payload = {
      name: values.name,
      start_time: values.start_time,
      end_time: values.end_time,
      required_minutes: Math.round(values.required_hours * 60),
      half_day_minutes: Math.round(values.half_day_hours * 60),
      grace_minutes: values.grace_minutes,
      break_minutes: values.break_minutes,
      working_weekdays: values.working_weekdays,
      description: values.description || null,
    }
    try {
      if (shift) await apiPatch(`/shifts/${shift.id}`, payload)
      else await apiPost('/shifts', { ...payload, code: values.code })
      // Timings and working weekdays decide which days are open.
      refreshCalendarDependents(queryClient)
      toast.success(shift ? 'Changes saved.' : 'Shift created.')
      onClose()
    } catch (submitError) {
      const message = messageOf(submitError, 'The shift was not saved.')
      setError(message)
      toast.error(message)
    }
  }

  if (!open) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={shift ? `Edit ${shift.name}` : 'Create a shift'}
      description="These numbers decide the colour of every day on the calendar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {shift ? 'Save changes' : 'Create shift'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {error && <ErrorNote message={error} />}

        <section className="space-y-3">
          <SectionLabel>What it is called</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={errors.name?.message} required>
              <Input placeholder="General shift" {...register('name')} />
            </Field>
            <Field
              label="Code"
              hint={shift ? 'A code cannot be changed once attendance refers to it.' : undefined}
              error={errors.code?.message}
              required
            >
              <Input
                className="tabular"
                placeholder="GENERAL"
                disabled={Boolean(shift)}
                {...register('code')}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>When the day runs</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" error={errors.start_time?.message} required>
              <Input type="time" className="tabular" {...register('start_time')} />
            </Field>
            <Field
              label="Ends"
              hint="An end before the start means an overnight shift."
              error={errors.end_time?.message}
              required
            >
              <Input type="time" className="tabular" {...register('end_time')} />
            </Field>
          </div>
          {endTime && startTime && endTime <= startTime && (
            <p className="text-[12px] text-ink-500">
              This shift runs overnight and finishes the next morning.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full day (hours)" error={errors.required_hours?.message} required>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                className="tabular"
                {...register('required_hours')}
              />
            </Field>
            <Field label="Half day (hours)" error={errors.half_day_hours?.message} required>
              <Input
                type="number"
                step="0.5"
                min="0.25"
                max="24"
                className="tabular"
                {...register('half_day_hours')}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Grace (minutes)"
              hint="Later than this counts as a late arrival."
              error={errors.grace_minutes?.message}
            >
              <Input
                type="number"
                min="0"
                max="240"
                className="tabular"
                {...register('grace_minutes')}
              />
            </Field>
            <Field
              label="Break (minutes)"
              hint="Deducted only when the day is one unbroken session."
              error={errors.break_minutes?.message}
            >
              <Input
                type="number"
                min="0"
                max="480"
                className="tabular"
                {...register('break_minutes')}
              />
            </Field>
          </div>

          {summary && (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-600">{summary}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>Which days it covers</SectionLabel>
          <Field label="Working days" error={errors.working_weekdays?.message} required>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {WEEKDAYS.map((label, index) => {
                const active = weekdays?.includes(index)
                const decidedElsewhere = index === SUNDAY
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={decidedElsewhere}
                    aria-pressed={Boolean(active)}
                    aria-label={WEEKDAY_NAMES[index]}
                    title={
                      decidedElsewhere
                        ? 'Sunday is the weekly off for everybody.'
                        : WEEKDAY_NAMES[index]
                    }
                    onClick={() =>
                      setValue(
                        'working_weekdays',
                        active
                          ? weekdays.filter((day) => day !== index)
                          : [...weekdays, index].sort((a, b) => a - b),
                        { shouldValidate: true },
                      )
                    }
                    className={cn(
                      'flex flex-col items-center justify-center rounded-lg border py-2 text-[12px] transition-colors',
                      active
                        ? 'border-ink-900 bg-ink-900 font-medium text-white'
                        : 'border-ink-200 text-ink-400 hover:bg-ink-50',
                      decidedElsewhere &&
                        'cursor-not-allowed border-ink-100 bg-ink-50 text-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {decidedElsewhere && <Lock className="mb-0.5 size-3" aria-hidden />}
                    {label}
                  </button>
                )
              })}
            </div>
          </Field>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
            <span className="font-medium text-ink-800">Sunday is the weekly off</span> for the whole
            organisation, so no shift covers it. Tick Saturday if this shift runs on Saturdays —
            <span className="font-medium text-ink-800"> which</span> Saturdays the office is actually
            open is decided separately by the pattern in Settings and by single dates on the work
            calendar.
          </p>
        </section>

        <section className="border-t border-ink-100 pt-4">
          <Field label="Description" error={errors.description?.message}>
            <Input placeholder="Standard Monday to Friday shift." {...register('description')} />
          </Field>
        </section>
      </form>
    </Modal>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{children}</p>
  )
}

/** `8.5` → `8h 30m`, so the summary sentence reads the way a person says it. */
function formatHours(hours: number): string {
  return formatMinutes(Math.round(hours * 60))
}

/** The moment lateness begins: the start time plus the grace period. */
function addGrace(start: string, graceMinutes: number): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(start ?? '')
  if (!match || !Number.isFinite(graceMinutes)) return start
  const total = (Number(match[1]) * 60 + Number(match[2]) + graceMinutes) % (24 * 60)
  const hours = String(Math.floor(total / 60)).padStart(2, '0')
  const minutes = String(total % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}
