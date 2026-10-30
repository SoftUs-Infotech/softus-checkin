import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatDate, todayKey } from '@/lib/format'
import { refreshCalendarDependents } from '@/lib/refresh'
import {
  Button,
  Card,
  CardHeader,
  CardSkeleton,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
} from '@/components/ui'
import type { OrgSettings } from '@/types'

/** The form is one long <form>, so the header's Save button has to name it. */
const FORM_ID = 'org-settings-form'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const schema = z.object({
  org_name: z.string().min(1, 'Name your organisation.').max(100),
  correction_window_days: z.coerce.number().int().min(0).max(90),
  auto_close_hour: z.coerce.number().int().min(0).max(23),
  min_punch_gap_seconds: z.coerce.number().int().min(0).max(3600),
  leave_year_start_month: z.coerce.number().int().min(1).max(12),
  geolocation_required: z.boolean(),
  block_mobile_punch: z.boolean(),
  allow_multiple_sessions: z.boolean(),
  tasks_required_daily: z.boolean(),
  support_email: z.string().max(120).optional(),

  late_arrivals_per_half_day: z.coerce.number().int().min(0).max(31),
  retro_approval_months: z.coerce.number().int().min(0).max(24),

  salary_day_basis: z.enum(['WORKING_DAYS', 'CALENDAR_DAYS', 'FIXED_26', 'FIXED_30']),
  salary_deduct_absent: z.boolean(),
  salary_deduct_unpaid_leave: z.boolean(),
  salary_deduct_half_day: z.boolean(),
  salary_deduct_missing_punch_out: z.boolean(),

  working_saturdays: z.string().optional(),
  fifth_saturday: z.enum(['UNDECIDED', 'WORKING', 'OFF']),
  comp_off_expiry_days: z.coerce.number().int().min(0).max(730),
})

/** `"1, 3"` → `[1, 3]`, ignoring anything that is not a Saturday number. */
function parseSaturdays(value: string | undefined): number[] {
  return [...new Set((value ?? '').split(/[^0-9]+/).map(Number))]
    .filter((n) => n >= 1 && n <= 5)
    .sort()
}

/** `[2, 4]` → `the second and fourth Saturday`. The setting is a list of
    numbers; what an administrator means by it is a sentence. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

function saturdaySentence(value: string | undefined): string {
  const list = parseSaturdays(value)
  if (!list.length) return 'Every Saturday is off.'
  const words = list.map((n) => ORDINALS[n - 1]).filter(Boolean)
  const joined =
    words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
  return `The ${joined} Saturday of the month is a working day; the others are off.`
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<OrgSettings>('/settings'),
  })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: data
      ? {
          org_name: data.org_name,
          correction_window_days: data.correction_window_days,
          auto_close_hour: data.auto_close_hour,
          min_punch_gap_seconds: data.min_punch_gap_seconds,
          leave_year_start_month: data.leave_year_start_month,
          geolocation_required: data.geolocation_required,
          block_mobile_punch: data.block_mobile_punch,
          allow_multiple_sessions: data.allow_multiple_sessions,
          tasks_required_daily: data.tasks_required_daily,
          support_email: data.support_email ?? '',


          late_arrivals_per_half_day: data.late_arrivals_per_half_day,
          retro_approval_months: data.retro_approval_months,

          salary_day_basis: data.salary_day_basis,
          salary_deduct_absent: data.salary_deduct_absent,
          salary_deduct_unpaid_leave: data.salary_deduct_unpaid_leave,
          salary_deduct_half_day: data.salary_deduct_half_day,
          salary_deduct_missing_punch_out: data.salary_deduct_missing_punch_out,

          working_saturdays: (data.working_saturdays ?? []).join(', '),
          fifth_saturday:
            data.fifth_saturday_working == null
              ? 'UNDECIDED'
              : data.fifth_saturday_working
                ? 'WORKING'
                : 'OFF',
          comp_off_expiry_days: data.comp_off_expiry_days,
        }
      : undefined,
  })

  const save = useMutation({
    mutationFn: ({ fifth_saturday, ...values }: z.output<typeof schema>) =>
      apiPatch<OrgSettings>('/settings', {
        ...values,
        support_email: values.support_email || null,
        working_saturdays: parseSaturdays(values.working_saturdays),
        fifth_saturday_working:
          fifth_saturday === 'UNDECIDED' ? null : fifth_saturday === 'WORKING',
      }),
    onSuccess: () => {
      refreshCalendarDependents(queryClient)
      setSaved(true)
      setError(null)
      toast.success('Settings saved.')
      window.setTimeout(() => setSaved(false), 2500)
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'Settings were not saved.')
      setError(message)
      toast.error(message)
    },
  })

  const correctionWindow = Number(watch('correction_window_days'))
  const autoCloseHour = Number(watch('auto_close_hour'))
  const leaveYearMonth = Number(watch('leave_year_start_month'))
  const lateThreshold = Number(watch('late_arrivals_per_half_day'))

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Settings" description="Policy that applies to everyone." />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardSkeleton lines={5} />
          </Card>
          <Card>
            <CardSkeleton lines={5} />
          </Card>
          <Card>
            <CardSkeleton lines={4} />
          </Card>
          <Card>
            <CardSkeleton lines={4} />
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Policy that applies to everyone. Every change here takes effect the next time somebody punches."
        action={
          <div className="flex items-center gap-3">
            {saved && <span className="text-[13px] text-status-green">Saved</span>}
            <Button type="submit" form={FORM_ID} loading={isSubmitting || save.isPending}>
              Save settings
            </Button>
          </div>
        }
      />

      <TrackingStartCard startsOn={data.tracking_starts_on ?? null} />

      <form
        id={FORM_ID}
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="grid items-start gap-6 lg:grid-cols-2"
        noValidate
      >
        {error && (
          <div className="lg:col-span-2">
            <ErrorNote message={error} />
          </div>
        )}

        <Card>
          <CardHeader
            title="Organisation"
            subtitle="Names and dates the rest of the product quotes back to employees."
          />
          <div className="space-y-4 px-5 py-4">
            <Field
              label="Organisation name"
              hint="Appears on the sign-in screen and in every emailed notification."
              error={errors.org_name?.message}
              required
            >
              <Input {...register('org_name')} />
            </Field>

            <Field
              label="Support email"
              hint="Where an employee is sent when something is wrong with their attendance."
              error={errors.support_email?.message}
            >
              <Input type="email" placeholder="hr@company.com" {...register('support_email')} />
            </Field>

            <Field
              label="Timezone"
              hint="Set in the server environment. Every attendance date is derived from it — which day a punch at midnight belongs to — so it cannot be changed from here."
            >
              <Input readOnly disabled value={data.timezone} className="tabular" />
            </Field>

            <Field
              label="Leave year starts in month"
              hint={
                Number.isFinite(leaveYearMonth) && MONTHS[leaveYearMonth - 1]
                  ? `Balances reset and carry-forward is worked out on 1 ${MONTHS[leaveYearMonth - 1]}.`
                  : '1 is January.'
              }
              error={errors.leave_year_start_month?.message}
            >
              <Input
                type="number"
                min="1"
                max="12"
                className="tabular"
                {...register('leave_year_start_month')}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Attendance policy"
            subtitle="How a day is opened, closed and put right afterwards."
          />
          <div className="space-y-4 px-5 py-4">
            <Field
              label="Correction window (days)"
              hint={
                correctionWindow === 0
                  ? 'No limit: an employee may ask for any past day to be fixed.'
                  : `An employee may ask for a day to be fixed for ${correctionWindow} day${correctionWindow === 1 ? '' : 's'} after it. Older days need an administrator to edit them directly.`
              }
              error={errors.correction_window_days?.message}
            >
              <Input
                type="number"
                min="0"
                max="90"
                className="tabular"
                {...register('correction_window_days')}
              />
            </Field>

            <Field
              label="Auto-close hour"
              hint={
                Number.isFinite(autoCloseHour)
                  ? `After ${String(autoCloseHour).padStart(2, '0')}:00 local time, a session still open on a past day is marked as a missing punch-out rather than left running.`
                  : 'A session left open on a past day is marked as a missing punch-out after this hour.'
              }
              error={errors.auto_close_hour?.message}
            >
              <Input
                type="number"
                min="0"
                max="23"
                className="tabular"
                {...register('auto_close_hour')}
              />
            </Field>

            <Field
              label="Minimum gap between punches (seconds)"
              hint="Guards against a double tap being recorded as a whole session. Raise it only if people report accidental punches."
              error={errors.min_punch_gap_seconds?.message}
            >
              <Input
                type="number"
                min="0"
                max="3600"
                className="tabular"
                {...register('min_punch_gap_seconds')}
              />
            </Field>

            <div className="space-y-3 border-t border-ink-100 pt-4">
              <Toggle
                label="Block punching from phones and tablets"
                hint="Attendance is a desk activity. Turning this off allows any device."
                {...register('block_mobile_punch')}
              />
              <Toggle
                label="Require location on every punch"
                hint="A punch is refused if the browser will not share a location. Employees will be asked for the permission once."
                {...register('geolocation_required')}
              />
              <Toggle
                label="Allow several sessions in a day"
                hint="Lets employees punch out for lunch and back in. Off means one punch in and one punch out."
                {...register('allow_multiple_sessions')}
              />
              <Toggle
                label="Expect a task log every working day"
                hint="A day without a task log is flagged for review; attendance itself is unaffected."
                {...register('tasks_required_daily')}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Working Saturdays and comp-off"
            subtitle="The repeating pattern. Single dates — closing one, or counting a short Saturday as a full day — are set on the work calendar."
          />
          <div className="space-y-4 px-5 py-4">
            <Field
              label="Saturdays the office is open"
              hint="Which Saturdays of the month, by number. 2, 4 means the second and fourth."
              error={errors.working_saturdays?.message}
            >
              <Input className="tabular" placeholder="2, 4" {...register('working_saturdays')} />
            </Field>
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
              {saturdaySentence(watch('working_saturdays'))} A shift cannot open a Saturday this
              pattern has closed.
            </p>

            <Field
              label="The fifth Saturday"
              hint="Often decided late in the month. Undecided leaves it to the work calendar."
            >
              <Select {...register('fifth_saturday')}>
                <option value="UNDECIDED">Undecided — decide per month</option>
                <option value="WORKING">Working</option>
                <option value="OFF">Off</option>
              </Select>
            </Field>

            <Field
              label="Comp-off expires after (days)"
              hint="Earned when a day somebody already worked is later swapped off. 0 never expires."
              error={errors.comp_off_expiry_days?.message}
            >
              <Input
                type="number"
                min="0"
                max="730"
                className="tabular"
                {...register('comp_off_expiry_days')}
              />
            </Field>

            <Field
              label="Late arrivals that cost half a day"
              hint={
                lateThreshold === 0
                  ? 'Switched off: late arrivals are recorded but never cost anybody half a day.'
                  : `Every ${lateThreshold} late arrival${lateThreshold === 1 ? '' : 's'} in a month is counted as half a day off, which the salary rules below then deduct.`
              }
              error={errors.late_arrivals_per_half_day?.message}
            >
              <Input
                type="number"
                min="0"
                max="31"
                className="tabular"
                {...register('late_arrivals_per_half_day')}
              />
            </Field>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Salary rules"
            subtitle="Administrators only. Nothing here is ever shown to an employee."
          />
          <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
            <div className="space-y-4">
              <Field
                label="A day of pay is"
                hint="This is the divisor behind every deduction. On the working-days basis a month with more holidays has fewer working days, so each day is worth more."
                error={errors.salary_day_basis?.message}
              >
                <Select {...register('salary_day_basis')}>
                  <option value="WORKING_DAYS">The month divided by its working days</option>
                  <option value="CALENDAR_DAYS">The month divided by its calendar days</option>
                  <option value="FIXED_26">The month divided by 26</option>
                  <option value="FIXED_30">The month divided by 30</option>
                </Select>
              </Field>

              <Field
                label="Approvals may reach back (months)"
                hint="Approving older leave than this is refused. The pay difference settles in the current month, never by rewriting a month you have already paid."
                error={errors.retro_approval_months?.message}
              >
                <Input
                  type="number"
                  min="0"
                  max="24"
                  className="tabular"
                  {...register('retro_approval_months')}
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-lg border border-ink-100 px-3.5 py-3.5">
              <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                What deducts pay
              </p>
              <Toggle
                label="Absence deducts"
                hint="A full day at the rate above."
                {...register('salary_deduct_absent')}
              />
              <Toggle
                label="Unpaid leave deducts"
                hint="Leave types marked unpaid on the leave-types page."
                {...register('salary_deduct_unpaid_leave')}
              />
              <Toggle
                label="A half day deducts half"
                hint="Includes half days earned by late arrivals."
                {...register('salary_deduct_half_day')}
              />
              <Toggle
                label="A missing punch-out deducts"
                hint="Usually off — the employee was at work, they forgot to punch."
                {...register('salary_deduct_missing_punch_out')}
              />
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 px-5 py-3">
            {saved && <span className="text-[13px] text-status-green">Saved</span>}
            <Button type="submit" loading={isSubmitting || save.isPending}>
              Save settings
            </Button>
          </footer>
        </Card>
      </form>
    </>
  )
}

const Toggle = function Toggle({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink-900" {...props} />
      <span>
        <span className="block text-[13px] text-ink-800">{label}</span>
        {hint && <span className="block text-[12px] text-ink-400">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * The go-live "reset".
 *
 * Deploying on a working day used to read as a month of absences behind it and
 * a short day for everybody on the day itself. Resetting makes the chosen day
 * day one: nothing earlier counts, the day itself is a grace day, and the
 * ordinary rules begin the next morning. Leave restarts with it: every balance
 * is zero on the day and accrues from there. No record is deleted — choosing
 * another date later rebuilds everything from that date instead.
 */
function TrackingStartCard({ startsOn }: { startsOn: string | null }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(todayKey())
  const [error, setError] = useState<string | null>(null)

  const reset = useMutation({
    mutationFn: () => apiPost<OrgSettings>('/settings/tracking-start', { starts_on: day }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated)
      refreshCalendarDependents(queryClient)
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      toast.success(
        `Attendance and leave now count from ${formatDate(updated.tracking_starts_on)}.`,
      )
      setError(null)
      setOpen(false)
    },
    onError: (mutationError) => setError(messageOf(mutationError, 'Attendance was not reset.')),
  })

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink-900">Attendance and leave start</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {startsOn ? (
              <>
                Attendance counts from{' '}
                <span className="font-medium text-ink-800">{formatDate(startsOn)}</span>. Days
                before it are not tracked, nobody is absent, late or docked for them, and leave
                balances started at zero that day.
              </>
            ) : (
              'Going live? Reset on launch day so the days before it, and the launch day itself, are not counted against anybody, and leave balances start at zero.'
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setDay(todayKey())
            setError(null)
            setOpen(true)
          }}
        >
          Reset attendance and leave
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reset attendance and leave"
        description="Start counting attendance and leave from this day."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => reset.mutate()} loading={reset.isPending} disabled={!day}>
              Reset from {day ? formatDate(day) : 'this day'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <ErrorNote message={error} />}
          <Field label="First day that counts" required>
            <Input
              type="date"
              value={day}
              max={todayKey()}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-600">
            <li>
              Every day before it shows as <span className="font-medium">Not tracked</span>: no
              absences, late marks or deductions, and no corrections can be filed for it.
            </li>
            <li>
              That day itself is a grace day. Anybody who punched is present, with no late or
              short-day mark, and nobody who didn&apos;t is absent.
            </li>
            <li>
              From the next day, the usual rules apply. This month&apos;s salary pays the days up to
              and including it in full.
            </li>
            <li>
              Every leave balance restarts at <span className="font-medium">zero</span> on that
              day. Leave earned, carried over or taken before it no longer counts. From then on each
              leave type accrues under its own rule, so a monthly type credits only the part of this
              month that is left.
            </li>
            <li>
              Nothing is deleted. Picking another date later rebuilds attendance and leave from that
              date. Balances you adjusted by hand need adjusting again.
            </li>
          </ul>
        </div>
      </Modal>
    </Card>
  )
}
