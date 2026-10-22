import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileClock, Plus, Wifi } from 'lucide-react'
import { ApiError, apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate, formatTime, humanise, orgWallClockToIso, todayKey } from '@/lib/format'
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
  Table,
  TableSkeleton,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { Correction, OrgSettings, Paginated } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  MISSED_PUNCH_IN: 'Forgot to punch in',
  MISSED_PUNCH_OUT: 'Forgot to punch out',
  WRONG_TIME: 'Wrong times recorded',
  FULL_DAY: 'Whole day missing',
}

/**
 * Approval statuses borrow the status palette only to mean approved, refused
 * or waiting — the meanings the calendar legend already carries. `brand` is the
 * ink ramp: a request nobody has decided on has no verdict to colour.
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
    date: z.string().min(1, 'Choose the day to correct.'),
    type: z.enum(['MISSED_PUNCH_IN', 'MISSED_PUNCH_OUT', 'WRONG_TIME', 'FULL_DAY']),
    punch_in: z.string().optional(),
    punch_out: z.string().optional(),
    reason: z.string().min(5, 'Explain what happened, in a sentence or two.').max(1000),
  })
  .superRefine((values, ctx) => {
    const needsIn = values.type !== 'MISSED_PUNCH_OUT'
    const needsOut = values.type !== 'MISSED_PUNCH_IN'
    if (needsIn && !values.punch_in) {
      ctx.addIssue({ code: 'custom', path: ['punch_in'], message: 'Give the punch-in time.' })
    }
    if (needsOut && !values.punch_out) {
      ctx.addIssue({ code: 'custom', path: ['punch_out'], message: 'Give the punch-out time.' })
    }
  })

type Values = z.infer<typeof schema>

export function CorrectionsPage() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['corrections-mine'],
    queryFn: () => apiGet<Paginated<Correction>>('/corrections/mine', { page_size: 50 }),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/corrections/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections-mine'] })
      toast.success('Correction request withdrawn.')
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The request was not withdrawn.')),
  })

  return (
    <>
      <PageHeader
        title="Corrections"
        description="Ask for a day to be fixed when a punch was missed or a time came out wrong."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Request a correction
          </Button>
        }
      />

      {/* Said once, up front: nothing changes on its own, and a person decides.
          Forgetting to punch is ordinary, so the tone here is procedural. */}
      <div className="mb-5 max-w-2xl border-l-2 border-ink-900 pl-3.5">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
          How a correction is handled
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          Your day stays exactly as it is until an administrator approves the request. They see the
          times you are asking for and the reason you gave, then either apply them to the day or
          come back to you. Nothing is deducted while a request is waiting.
        </p>
      </div>

      {isError && (
        <ErrorNote
          className="mb-4"
          message={messageOf(error, 'Your requests could not be loaded. Try again in a moment.')}
        />
      )}

      <Card>
        {isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<FileClock className="size-8" />}
            title="No corrections requested"
            description="If you forget to punch, or a time came out wrong, ask for the day to be corrected and your administrator will review it."
            action={<Button onClick={() => setOpen(true)}>Request a correction</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>What happened</Th>
                <Th>Times you asked for</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="tabular whitespace-nowrap font-medium text-ink-900">
                    {formatDate(item.date)}
                  </Td>
                  <Td>
                    <p className="font-medium text-ink-900">{TYPE_LABELS[item.type] ?? humanise(item.type)}</p>
                    <p className="mt-0.5 line-clamp-1 max-w-[18rem] text-[12px] text-ink-400">
                      {item.reason}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="tabular text-ink-900">
                      {formatTime(item.requested_punch_in)}
                    </span>
                    <span className="mx-1.5 text-ink-300" aria-hidden>
                      →
                    </span>
                    <span className="tabular text-ink-900">
                      {formatTime(item.requested_punch_out)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={approvalTone(item.status)}>{humanise(item.status)}</Badge>
                    {item.status === 'PENDING' ? (
                      <p className="mt-1 text-[12px] text-ink-400">Waiting on your administrator.</p>
                    ) : (
                      item.decision_note && (
                        <p className="mt-1 max-w-[14rem] text-[12px] text-ink-400">
                          {item.decision_note}
                        </p>
                      )
                    )}
                  </Td>
                  <Td className="text-right">
                    {item.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancel.mutate(item.id)}
                        loading={cancel.isPending && cancel.variables === item.id}
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

      <RequestModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function RequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  // Filing can be pinned to the office network by policy. A refusal on those
  // grounds is not the reader's mistake, so it is shown as a state with a way
  // out rather than as a validation error against the form.
  const [blocked, setBlocked] = useState<string | null>(null)
  // Days before the go-live reset are not tracked, so there is nothing on
  // them to correct; the picker should not offer them.
  const { data: orgSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<OrgSettings>('/settings'),
    enabled: open,
  })

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayKey(), type: 'FULL_DAY', reason: '' },
  })

  const type = watch('type')
  const needsIn = type !== 'MISSED_PUNCH_OUT'
  const needsOut = type !== 'MISSED_PUNCH_IN'

  async function onSubmit(values: Values) {
    setFormError(null)
    setBlocked(null)
    try {
      await apiPost('/corrections', {
        date: values.date,
        type: values.type,
        requested_punch_in:
          needsIn && values.punch_in ? orgWallClockToIso(values.date, values.punch_in) : null,
        requested_punch_out:
          needsOut && values.punch_out
            ? orgWallClockToIso(values.date, values.punch_out)
            : null,
        reason: values.reason,
      })
      queryClient.invalidateQueries({ queryKey: ['corrections-mine'] })
      reset({ date: todayKey(), type: 'FULL_DAY', reason: '' })
      toast.success('Correction requested.')
      onClose()
    } catch (error) {
      // Match the server's own code, not the status. Any other 403 on this
      // route — a suspended account, say — would otherwise be explained to the
      // employee as a network problem and send them to the office for nothing.
      if (error instanceof ApiError && error.code === 'OFFICE_NETWORK_REQUIRED') {
        setBlocked(error.message)
      } else {
        setFormError(messageOf(error, 'Your request was not submitted.'))
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a correction"
      description="Your administrator reviews this before the day changes."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Send request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}

        {/* Not an error against the form — a rule of the place, stated in ink
            with the way out underneath it. */}
        {blocked && (
          <div
            role="alert"
            className="rounded-lg border border-ink-300 border-l-2 border-l-ink-900 bg-ink-50 px-3.5 py-3 text-[13px]"
          >
            <p className="font-display flex items-center gap-2 font-semibold text-ink-900">
              <Wifi className="size-4 shrink-0" aria-hidden />
              This has to be filed from the office network
            </p>
            <p className="mt-1 text-ink-600">{blocked}</p>
            <p className="mt-1.5 text-ink-500">
              Nothing you typed has been lost. Send it again once you are on the office network, or
              ask your administrator to adjust the day for you.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Day" error={errors.date?.message} required>
            <Input
              type="date"
              min={orgSettings?.tracking_starts_on ?? undefined}
              max={todayKey()}
              {...register('date')}
            />
          </Field>
          <Field label="What happened" error={errors.type?.message} required>
            <Select {...register('type')}>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {needsIn && (
            <Field label="Punch-in time" error={errors.punch_in?.message} required>
              <Input type="time" {...register('punch_in')} />
            </Field>
          )}
          {needsOut && (
            <Field label="Punch-out time" error={errors.punch_out?.message} required>
              <Input type="time" {...register('punch_out')} />
            </Field>
          )}
        </div>

        <Field
          label="Reason"
          hint="A sentence is enough. It is read by whoever decides, and kept with the day."
          error={errors.reason?.message}
          required
        >
          <Textarea
            rows={3}
            placeholder="I was at the client site all morning and had no access to a computer."
            {...register('reason')}
          />
        </Field>

        <p className="text-[12px] text-ink-400">
          After you send this, the request sits as pending until an administrator approves or
          declines it. You can withdraw it yourself at any point before then.
        </p>
      </form>
    </Modal>
  )
}
