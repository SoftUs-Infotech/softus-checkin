import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Palmtree, Plus } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate, humanise, todayKey } from '@/lib/format'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
  Table,
  TableSkeleton,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { LeaveBalance, LeaveRequest, Paginated } from '@/types'

/**
 * Approval statuses borrow the status palette only to mean approved, refused
 * or waiting — the meanings the calendar legend already carries. `brand` is the
 * ink ramp: a pending request has no verdict yet, so there is nothing to
 * colour in.
 */
function approvalTone(status: string): BadgeTone {
  switch (status) {
    case 'APPROVED':
      return 'green'
    case 'REJECTED':
      return 'red'
    case 'CANCELLED':
      return 'neutral'
    case 'CHANGES_REQUESTED':
      return 'amber'
    default:
      return 'brand'
  }
}

const schema = z
  .object({
    leave_type_id: z.string().min(1, 'Choose a leave type.'),
    from_date: z.string().min(1, 'Choose the first day.'),
    to_date: z.string().min(1, 'Choose the last day.'),
    day_part: z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']),
    reason: z.string().min(5, 'Say why you need the time off.').max(1000),
    contact_number: z.string().max(20).optional(),
  })
  .refine((values) => values.to_date >= values.from_date, {
    path: ['to_date'],
    message: 'The last day cannot be before the first.',
  })
  .refine((values) => values.day_part === 'FULL' || values.from_date === values.to_date, {
    path: ['day_part'],
    message: 'A half day applies to a single date.',
  })

type Values = z.infer<typeof schema>

export function LeavePage() {
  const [applyingFor, setApplyingFor] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const balances = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => apiGet<LeaveBalance[]>('/leave/balances'),
  })

  const requests = useQuery({
    queryKey: ['leave-mine'],
    queryFn: () => apiGet<Paginated<LeaveRequest>>('/leave/mine', { page_size: 50 }),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/leave/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-mine'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success('Leave request withdrawn.')
    },
    onError: (error) => toast.error(messageOf(error, 'The request was not withdrawn.')),
  })

  function openApply(leaveTypeId?: string) {
    setApplyingFor(leaveTypeId ?? null)
    setOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Leave"
        description="What you have left, and what you have asked for."
        action={
          <Button onClick={() => openApply()}>
            <Plus className="size-4" />
            Apply for leave
          </Button>
        }
      />

      {balances.isError && (
        <ErrorNote
          className="mb-4"
          message={messageOf(balances.error, 'Your balances could not be loaded.')}
        />
      )}

      {/* Balances read as one set of figures: same label, same digit size, same
          baseline, so the eye compares them instead of reading four cards. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {balances.isLoading
          ? [0, 1, 2, 3].map((index) => (
              <Card key={index} className="space-y-2 px-4 py-3">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-3 w-full" />
              </Card>
            ))
          : balances.data?.map((balance) => (
              <StatTile
                key={balance.leave_type_id}
                label={`${balance.leave_type_name}${balance.is_paid ? '' : ' (unpaid)'}`}
                value={balance.available}
                // The dot is the leave type's own colour, set by an
                // administrator and used on the calendar. It is data, not one of
                // our tokens, so it is the one colour on the page we did not
                // choose — and it is what ties a tile to its marks in the month.
                swatch={balance.color}
                hint={
                  <span className="tabular">
                    {balance.used} used · {balance.pending} pending · {balance.allocated}{' '}
                    allocated
                  </span>
                }
                onClick={() => openApply(balance.leave_type_id)}
              />
            ))}
      </div>
      {!balances.isLoading && !balances.isError && !balances.data?.length && (
        <Card className="mb-6">
          <EmptyState
            title="No leave types allocated yet"
            description="Your administrator has not set up a leave balance for you. Ask them before you plan time off."
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Your requests"
          subtitle="A pending request already holds the days aside; withdrawing one gives them back."
        />
        {requests.isError && (
          <div className="px-5 pt-4">
            <ErrorNote message={messageOf(requests.error, 'Your requests could not be loaded.')} />
          </div>
        )}
        {requests.isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : !requests.data?.items.length ? (
          <EmptyState
            icon={<Palmtree className="size-8" />}
            title="No leave requested"
            description="Apply when you need time off; the days are held aside as soon as you do, before anybody approves it."
            action={<Button onClick={() => openApply()}>Apply for leave</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th numeric>Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {requests.data.items.map((request) => (
                <Tr key={request.id}>
                  <Td className="whitespace-nowrap font-medium text-ink-900">
                    {request.leave_type_name}
                  </Td>
                  <Td className="tabular whitespace-nowrap">
                    {formatDate(request.from_date)}
                    {request.from_date !== request.to_date && ` — ${formatDate(request.to_date)}`}
                  </Td>
                  <Td numeric className="font-medium text-ink-900">
                    {request.total_days}
                  </Td>
                  <Td className="max-w-[16rem] truncate">{request.reason}</Td>
                  <Td>
                    <Badge tone={approvalTone(request.status)}>{humanise(request.status)}</Badge>
                    {request.decision_note && (
                      <p className="mt-1 max-w-[14rem] text-[12px] text-ink-400">
                        {request.decision_note}
                      </p>
                    )}
                  </Td>
                  <Td className="text-right">
                    {['PENDING', 'APPROVED'].includes(request.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={cancel.isPending && cancel.variables === request.id}
                        onClick={() => cancel.mutate(request.id)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Mounted only while open, so the form's defaults are built from the
          balances that have actually arrived — and from the tile just clicked. */}
      {open && (
        <ApplyModal
          onClose={() => setOpen(false)}
          balances={balances.data ?? []}
          initialTypeId={applyingFor}
        />
      )}
    </>
  )
}

/** Whole days in the range, weekends excluded — the same rule the server
    applies, minus the holiday calendar it alone knows about. */
function weekdaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  let days = 0
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay()
    if (weekday !== 0 && weekday !== 6) days += 1
  }
  return days
}

function ApplyModal({
  onClose,
  balances,
  initialTypeId,
}: {
  onClose: () => void
  balances: LeaveBalance[]
  initialTypeId: string | null
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      leave_type_id: initialTypeId ?? balances[0]?.leave_type_id ?? '',
      from_date: todayKey(),
      to_date: todayKey(),
      day_part: 'FULL',
      reason: '',
    },
  })

  const [typeId, fromDate, toDate, dayPart] = watch([
    'leave_type_id',
    'from_date',
    'to_date',
    'day_part',
  ])
  const balance = balances.find((item) => item.leave_type_id === typeId)
  const cost = dayPart === 'FULL' ? weekdaysBetween(fromDate, toDate) : 0.5
  const remaining = balance ? balance.available - cost : null
  const overdrawn = remaining !== null && remaining < 0
  // Mirrors the API's rule: a paid type with no advance allowed is refused
  // outright, so the button should not offer what the server will turn down.
  const refused = overdrawn && !!balance?.is_paid && !balance.allow_negative_balance

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await apiPost('/leave', { ...values, contact_number: values.contact_number || null })
      queryClient.invalidateQueries({ queryKey: ['leave-mine'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      reset()
      toast.success('Leave requested.')
      onClose()
    } catch (error) {
      setFormError(messageOf(error, 'Your leave request was not submitted.'))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply for leave"
      description="Weekends and holidays inside the range are not counted."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting} disabled={refused}>
            Send request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}

        <Field label="Leave type" error={errors.leave_type_id?.message} required>
          <Select {...register('leave_type_id')}>
            {balances.map((item) => (
              <option key={item.leave_type_id} value={item.leave_type_id}>
                {item.leave_type_name} — {item.available} available
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First day" error={errors.from_date?.message} required>
            <Input type="date" {...register('from_date')} />
          </Field>
          <Field label="Last day" error={errors.to_date?.message} required>
            <Input type="date" {...register('to_date')} />
          </Field>
        </div>

        <Field label="Duration" error={errors.day_part?.message}>
          <Select {...register('day_part')}>
            <option value="FULL">Full day</option>
            <option value="FIRST_HALF">First half of the day</option>
            <option value="SECOND_HALF">Second half of the day</option>
          </Select>
        </Field>

        {/*
          What this will cost, and from which balance, before the request is
          sent. Stated as an estimate because the holiday calendar lives on the
          server — an over-confident figure that later disagrees is worse than
          an honest approximate one.
        */}
        {balance && cost > 0 && (
          <div
            aria-live="polite"
            className="rounded-lg border border-rule bg-ink-50 px-3.5 py-3 text-[13px]"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: balance.color }}
              />
              What this costs
            </p>

            {/* The sum, set out the way a balance is struck on paper: the
                figures in a column that lines up, the words beside them. */}
            <dl className="mt-2 border-y border-rule py-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">{balance.leave_type_name} available now</dt>
                <dd className="tabular font-medium text-ink-900">{balance.available}</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">This request</dt>
                <dd className="tabular font-medium text-ink-900">−{cost}</dd>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-ink-300 pt-1.5">
                <dt className="font-medium text-ink-700">Left if this is approved</dt>
                {/* No status colour on a shortfall: red in this product means
                    absent, and an over-drawn balance is neither absent nor
                    refused. The minus sign and the sentence under it say it. */}
                <dd className="tabular text-[15px] font-semibold text-ink-900">{remaining}</dd>
              </div>
            </dl>

            {overdrawn && !refused && (
              <p className="mt-2 font-medium text-ink-900">
                That takes your balance below zero. {balance.leave_type_name} allows an advance, so
                the request can still go to your administrator.
              </p>
            )}
            {refused && (
              <p className="mt-2 font-medium text-status-red">
                That is more than you have left, so it cannot be sent. Shorten the range, or choose
                a different leave type.
              </p>
            )}
            {!balance.is_paid && <p className="mt-2 text-ink-500">This leave type is unpaid.</p>}
            <p className="mt-2 text-[12px] text-ink-400">
              Weekends are already excluded. Public holidays inside the range are not counted
              either, so the final figure may be lower.
            </p>
          </div>
        )}

        <Field label="Reason" error={errors.reason?.message} required>
          <Textarea rows={3} placeholder="Family function out of town." {...register('reason')} />
        </Field>

        <Field
          label="Contact number while away"
          hint="Optional. Only used if something urgent comes up."
          error={errors.contact_number?.message}
        >
          <Input type="tel" {...register('contact_number')} />
        </Field>
      </form>
    </Modal>
  )
}
