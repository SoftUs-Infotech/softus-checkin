import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarDays, Info, Plus } from 'lucide-react'
import { apiDelete, apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { refreshCalendarDependents } from '@/lib/refresh'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatTile,
  Table,
  TableSkeleton,
  Td,
  Th,
  Toolbar,
  Tr,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { Holiday } from '@/types'

const schema = z.object({
  date: z.string().min(1, 'Choose a date.'),
  name: z.string().min(2, 'Name the holiday.').max(100),
  type: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']),
  description: z.string().max(500).optional(),
})

const TYPE_LABEL: Record<string, string> = {
  PUBLIC: 'Public',
  COMPANY: 'Company',
  OPTIONAL: 'Optional',
}

/* A holiday is the calendar's yellow day, so the badge may say yellow. An
   optional holiday is not a closure for everybody, so it stays neutral. */
const TYPE_TONE: Record<string, BadgeTone> = {
  PUBLIC: 'yellow',
  COMPANY: 'yellow',
  OPTIONAL: 'neutral',
}

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

/** `2026-01-26` → 0 for Monday … 6 for Sunday, without a timezone shifting it. */
function weekdayIndex(iso: string): number {
  const day = new Date(`${iso}T00:00:00`).getDay()
  return (day + 6) % 7
}

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1
}

export function HolidaysPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<Holiday | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => apiGet<Holiday[]>('/holidays', { year, include_inactive: true }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/holidays/${id}`),
    onSuccess: () => {
      refreshCalendarDependents(queryClient)
      setDeleting(null)
      toast.success('Holiday removed.')
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The holiday was not removed.')),
  })

  // How many of these actually cost the month a working day: one landing on a
  // Sunday changes nobody's pay, and that is the difference an administrator
  // most often wants to see before publishing a list.
  const counts = useMemo(() => {
    const items = data ?? []
    const closures = items.filter((holiday) => holiday.type !== 'OPTIONAL')
    const onWorkingDay = closures.filter((holiday) => weekdayIndex(holiday.date) < 5)
    return {
      total: items.length,
      closures: closures.length,
      workingDays: onWorkingDay.length,
      optional: items.length - closures.length,
    }
  }, [data])

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Days the office is closed. They show yellow on every calendar and nobody is expected to punch."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Add a holiday
          </Button>
        }
      />

      <Toolbar>
        <label className="flex items-center gap-2 text-[13px] text-ink-500">
          Year
          <Select
            className="w-28"
            aria-label="Holiday year"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {[currentYear - 1, currentYear, currentYear + 1].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>

      {!isLoading && counts.total > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatTile label="Holidays" value={counts.total} hint={`Listed for ${year}`} />
          <StatTile
            label="Office closures"
            value={counts.closures}
            hint={counts.optional ? `${counts.optional} optional, taken individually` : 'Everybody is off'}
          />
          <StatTile
            label="Working days lost"
            value={counts.workingDays}
            hint="Closures that fall Monday to Friday"
          />
        </div>
      )}

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-ink-100 bg-white px-3.5 py-2.5 text-[12px] text-ink-600">
        <Info className="mt-px size-4 shrink-0 text-ink-400" aria-hidden />
        <span>
          <span className="font-medium text-ink-800">A holiday changes pay, not just the calendar.</span>{' '}
          The office closes, so the month has one working day fewer. Where a day of pay is worked
          out from the month's working days, every remaining day in that month is worth slightly
          more — check the basis under Settings → Salary rules before you publish a year.
        </span>
      </p>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : !data?.length ? (
          <EmptyState
            icon={<CalendarDays className="size-8" />}
            title={`No holidays listed for ${year}`}
            description="Until they are listed, everyone is expected at work on those days and will be marked absent."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Add a holiday
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Day</Th>
                <Th>Holiday</Th>
                <Th>Type</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((holiday, index) => {
                const month = monthIndex(holiday.date)
                const newMonth = index === 0 || month !== monthIndex(data[index - 1].date)
                const weekend = weekdayIndex(holiday.date) >= 5
                return (
                  <Fragment key={holiday.id}>
                    {newMonth && (
                      <tr>
                        <td
                          colSpan={5}
                          className="border-b border-ink-100 bg-ink-50/60 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase"
                        >
                          {MONTHS[month]}
                        </td>
                      </tr>
                    )}
                    <Tr>
                      <Td className="tabular whitespace-nowrap">{formatDate(holiday.date)}</Td>
                      <Td className="text-ink-500">
                        {holiday.weekday}
                        {weekend && (
                          <span className="block text-[11px] text-ink-400">
                            Already a non-working day
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="block font-medium text-ink-900">{holiday.name}</span>
                        {holiday.description && (
                          <span className="block text-[12px] text-ink-400">
                            {holiday.description}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={TYPE_TONE[holiday.type] ?? 'neutral'}>
                          {TYPE_LABEL[holiday.type] ?? holiday.type}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-status-red hover:bg-status-red-soft hover:text-status-red"
                            onClick={() => setDeleting(holiday)}
                          >
                            Remove
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Remove ${deleting.name}?` : ''}
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
              Remove holiday
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          {deleting && weekdayIndex(deleting.date) < 5
            ? `${formatDate(deleting.date)} becomes an ordinary working day again: everybody is expected to punch, and the month gains back a working day — which lowers the per-day pay rate for that month.`
            : `${deleting ? formatDate(deleting.date) : 'The day'} stops being marked as a holiday on everybody's calendar.`}
        </p>
      </Modal>

      <HolidayModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function HolidayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'PUBLIC' },
  })

  const date = watch('date')
  const type = watch('type')

  async function onSubmit(values: z.infer<typeof schema>) {
    setError(null)
    try {
      await apiPost('/holidays', { ...values, description: values.description || null })
      refreshCalendarDependents(queryClient)
      toast.success('Holiday added.')
      reset({ type: 'PUBLIC' })
      onClose()
    } catch (submitError) {
      const message = messageOf(submitError, 'The holiday was not added.')
      setError(message)
      toast.error(message)
    }
  }

  const consequence = date
    ? weekdayIndex(date) >= 5
      ? `${formatDate(date)} is already a non-working day, so nobody gains a day off and no pay changes.`
      : type === 'OPTIONAL'
        ? `${formatDate(date)} stays a working day. Anybody who takes it is on leave for the day, and the month keeps its working days.`
        : `The office closes on ${formatDate(date)}. That month loses a working day, so each remaining day is worth slightly more where pay is worked out from working days.`
    : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a holiday"
      description="Everybody sees it on their calendar and nobody is marked absent."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Add holiday
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <ErrorNote message={error} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" error={errors.date?.message} required>
            <Input type="date" autoFocus className="tabular" {...register('date')} />
          </Field>
          <Field label="Type" error={errors.type?.message}>
            <Select {...register('type')}>
              <option value="PUBLIC">Public holiday</option>
              <option value="COMPANY">Company holiday</option>
              <option value="OPTIONAL">Optional (restricted) holiday</option>
            </Select>
          </Field>
        </div>

        <Field label="Name" error={errors.name?.message} required>
          <Input placeholder="Republic Day" {...register('name')} />
        </Field>

        <Field label="Note" hint="Shown under the name on the holiday list." error={errors.description?.message}>
          <Input placeholder="Office closed." {...register('description')} />
        </Field>

        {consequence && (
          <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-[12px] text-ink-600">{consequence}</p>
        )}
      </form>
    </Modal>
  )
}
