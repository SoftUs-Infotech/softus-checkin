import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Palmtree, Plus } from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
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
  Th,
  Tr,
  useToast,
} from '@/components/ui'
import type { LeaveType } from '@/types'

const ACCRUAL_CADENCE: Record<string, string> = {
  MONTHLY: 'a month',
  QUARTERLY: 'a quarter',
  YEARLY: 'a year',
}

/** How many times a year each cadence credits. Used to read an accrual policy
    back as a yearly total, which is the number people actually argue about. */
const CYCLES_PER_YEAR: Record<string, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
}

const schema = z
  .object({
    name: z.string().min(2, 'Name the leave type.').max(60),
    code: z.string().min(2, 'Give a short code.').max(20),
    annual_quota: z.coerce.number().min(0).max(365),
    frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
    amount_per_cycle: z.coerce.number().min(0).max(365),
    credit_at: z.enum(['START', 'END']),
    lapse_at_year_end: z.boolean(),
    allow_negative_balance: z.boolean(),
    carry_forward_max: z.coerce.number().min(0).max(365),
    min_notice_days: z.coerce.number().int().min(0).max(365),
    applicable_after_days: z.coerce.number().int().min(0).max(730),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour.'),
    is_paid: z.boolean(),
    allow_half_day: z.boolean(),
    visible_to_employees: z.boolean(),
  })
  .refine((values) => values.carry_forward_max <= values.annual_quota, {
    path: ['carry_forward_max'],
    message: 'Carry-forward cannot exceed the annual quota.',
  })

// `z.coerce` means the form reads strings and the handler receives numbers.
type Input = z.input<typeof schema>
type Values = z.output<typeof schema>

/** `1` → `1 day`, `0.5` → `half a day`. Written the way a policy is spoken. */
function days(value: number): string {
  if (value === 0.5) return 'half a day'
  return `${round(value)} ${value === 1 ? 'day' : 'days'}`
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function LeaveTypesPage() {
  const [editing, setEditing] = useState<LeaveType | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<LeaveType | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['leave-types', 'all'],
    queryFn: () => apiGet<LeaveType[]>('/leave-types', { include_inactive: true }),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ deleted: boolean; message: string }>(`/leave-types/${id}`),
    onSuccess: (result) => {
      setNotice(result.message)
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['leave-types'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success(result.message)
    },
    onError: (error) => {
      const message = messageOf(error)
      setNotice(message)
      toast.error(message)
    },
  })

  return (
    <>
      <PageHeader
        title="Leave types"
        description="Add a new kind of leave, or change the rules of an existing one."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add a leave type
          </Button>
        }
      />

      {notice && (
        <p className="mb-4 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-[13px] text-ink-700">{notice}</p>
      )}

      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : !data?.length ? (
          <EmptyState
            icon={<Palmtree className="size-8" />}
            title="No leave types yet"
            description="Employees cannot apply for leave until at least one exists."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Add a leave type
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th numeric>Days a year</Th>
                <Th>How it accrues</Th>
                <Th numeric>Carry forward</Th>
                <Th>Rules</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((type) => (
                <Tr key={type.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      {/* The dot is the leave type's own colour, chosen by the
                          administrator — it is a label, not a status. */}
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: type.color }}
                        aria-hidden
                      />
                      <span>
                        <span className="block font-medium text-ink-900">{type.name}</span>
                        <span className="tabular block text-[11px] text-ink-400">{type.code}</span>
                      </span>
                    </span>
                  </Td>
                  <Td numeric>{round(type.annual_quota)}</Td>
                  <Td className="text-[12px] text-ink-600">
                    {days(type.accrual.amount_per_cycle)} {ACCRUAL_CADENCE[type.accrual.frequency]}
                    <span className="block text-ink-400">
                      credited at the {type.accrual.credit_at === 'START' ? 'start' : 'end'} of each
                      cycle
                    </span>
                  </Td>
                  <Td numeric>{type.carry_forward_max ? round(type.carry_forward_max) : '—'}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={type.is_paid ? 'brand' : 'neutral'}>
                        {type.is_paid ? 'Paid' : 'Unpaid'}
                      </Badge>
                      <Badge>{type.allow_half_day ? 'Half days' : 'Full days only'}</Badge>
                      {type.min_notice_days > 0 && (
                        <Badge>{type.min_notice_days}d notice</Badge>
                      )}
                      {!type.visible_to_employees && <Badge tone="amber">Hidden from employees</Badge>}
                      {!type.is_active && <Badge>Retired</Badge>}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(type)}>
                        Edit
                      </Button>
                      <span className="mx-1 h-5 w-px bg-ink-100" aria-hidden />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-status-red hover:bg-status-red-soft hover:text-status-red"
                        onClick={() => setDeleting(type)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

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
              Delete leave type
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          Nobody will be able to apply for {deleting?.name ?? 'this leave'} again. If leave of this
          kind has already been taken, the type is retired rather than deleted so the history still
          reads correctly.
        </p>
      </Modal>

      <LeaveTypeModal
        open={creating || Boolean(editing)}
        leaveType={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </>
  )
}

function LeaveTypeModal({
  open,
  leaveType,
  onClose,
}: {
  open: boolean
  leaveType: LeaveType | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    values: {
      name: leaveType?.name ?? '',
      code: leaveType?.code ?? '',
      annual_quota: leaveType?.annual_quota ?? 12,
      frequency: leaveType?.accrual?.frequency ?? 'YEARLY',
      amount_per_cycle: leaveType?.accrual?.amount_per_cycle ?? 12,
      credit_at: leaveType?.accrual?.credit_at ?? 'START',
      lapse_at_year_end: leaveType?.accrual?.lapse_at_year_end ?? true,
      allow_negative_balance: leaveType?.allow_negative_balance ?? false,
      carry_forward_max: leaveType?.carry_forward_max ?? 0,
      min_notice_days: leaveType?.min_notice_days ?? 0,
      applicable_after_days: leaveType?.applicable_after_days ?? 0,
      color: leaveType?.color ?? '#2563eb',
      is_paid: leaveType?.is_paid ?? true,
      allow_half_day: leaveType?.allow_half_day ?? true,
      visible_to_employees: leaveType?.visible_to_employees ?? true,
    },
  })

  const frequency = String(watch('frequency'))
  const perCycle = Number(watch('amount_per_cycle'))
  const quota = Number(watch('annual_quota'))
  const creditAt = String(watch('credit_at'))
  const carryForward = Number(watch('carry_forward_max'))
  const lapses = Boolean(watch('lapse_at_year_end'))
  const name = String(watch('name') || 'This leave')

  const cycles = CYCLES_PER_YEAR[frequency] ?? 1
  const accruedPerYear = Number.isFinite(perCycle) ? perCycle * cycles : null
  // The whole reason this panel exists: an accrual rule is three fields that
  // only mean something multiplied together, and the number they multiply to is
  // the one people were guessing at.
  const quotaMismatch =
    accruedPerYear != null &&
    Number.isFinite(quota) &&
    Math.abs(accruedPerYear - quota) > 0.001

  async function onSubmit(values: Values) {
    setError(null)
    try {
      const { code, frequency, amount_per_cycle, credit_at, lapse_at_year_end, ...fields } = values
      const rest = {
        ...fields,
        accrual: { frequency, amount_per_cycle, credit_at, lapse_at_year_end },
      }
      if (leaveType) await apiPatch(`/leave-types/${leaveType.id}`, rest)
      else await apiPost('/leave-types', { ...rest, code })
      queryClient.invalidateQueries({ queryKey: ['leave-types'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success(leaveType ? 'Changes saved.' : 'Leave type added.')
      onClose()
    } catch (submitError) {
      const message = messageOf(submitError, 'The leave type was not saved.')
      setError(message)
      toast.error(message)
    }
  }

  if (!open) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={leaveType ? `Edit ${leaveType.name}` : 'Add a leave type'}
      description="The accrual rules decide what everybody's balance says on any given day."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {leaveType ? 'Save changes' : 'Add leave type'}
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
              <Input placeholder="Casual leave" {...register('name')} />
            </Field>
            <Field
              label="Code"
              hint={leaveType ? 'A code cannot change once leave refers to it.' : undefined}
              error={errors.code?.message}
              required
            >
              <Input
                className="tabular"
                placeholder="CL"
                disabled={Boolean(leaveType)}
                {...register('code')}
              />
            </Field>
          </div>
          <Field
            label="Colour"
            hint="How this leave is marked wherever leave is listed."
            error={errors.color?.message}
          >
            <Input type="color" className="h-10 w-20 p-1" {...register('color')} />
          </Field>
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>How days are earned</SectionLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Credited" error={errors.frequency?.message}>
              <Select {...register('frequency')}>
                <option value="YEARLY">Once a year</option>
                <option value="QUARTERLY">Every quarter</option>
                <option value="MONTHLY">Every month</option>
              </Select>
            </Field>
            <Field
              label="Days credited each time"
              hint="0.5 is allowed — half a day a month is a real policy."
              error={errors.amount_per_cycle?.message}
            >
              <Input
                type="number"
                step="0.5"
                min="0"
                className="tabular"
                {...register('amount_per_cycle')}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Credited at the" error={errors.credit_at?.message}>
              <Select {...register('credit_at')}>
                <option value="START">Start of the cycle</option>
                <option value="END">End of the cycle</option>
              </Select>
            </Field>
            <Field
              label="Days a year (the cap)"
              hint="The most anybody may hold in one year."
              error={errors.annual_quota?.message}
              required
            >
              <Input
                type="number"
                step="0.5"
                min="0"
                className="tabular"
                {...register('annual_quota')}
              />
            </Field>
          </div>

          {/* The rule, read back in the words a person would use. */}
          {accruedPerYear != null && (
            <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                What this adds up to
              </p>
              <p className="mt-1 text-[13px] text-ink-700">
                {name} credits <span className="tabular font-medium">{days(perCycle)}</span>{' '}
                {ACCRUAL_CADENCE[frequency]}, at the {creditAt === 'START' ? 'start' : 'end'} of each
                cycle — <span className="tabular font-medium">{days(accruedPerYear)}</span> over a
                full year.
              </p>
              {quotaMismatch && (
                <p className="mt-1 text-[12px] text-status-amber">
                  The yearly cap is {days(quota)}, so{' '}
                  {accruedPerYear > quota
                    ? `${days(accruedPerYear - quota)} of what is credited cannot be held.`
                    : `nobody will reach the cap by accruing alone.`}
                </p>
              )}
              <p className="mt-1 text-[12px] text-ink-500">
                {lapses
                  ? carryForward > 0
                    ? `At the end of the year up to ${days(carryForward)} carries over; the rest lapses.`
                    : 'Anything unused lapses at the end of the year.'
                  : 'Unused days stay on the balance into the next year.'}
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>What happens at the year end</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Carry forward (max days)"
              hint="0 means nothing carries over."
              error={errors.carry_forward_max?.message}
            >
              <Input
                type="number"
                step="0.5"
                min="0"
                className="tabular"
                {...register('carry_forward_max')}
              />
            </Field>
            <Field
              label="Available after (days)"
              hint="Time an employee must have served first."
              error={errors.applicable_after_days?.message}
            >
              <Input type="number" min="0" className="tabular" {...register('applicable_after_days')} />
            </Field>
          </div>
          <Field
            label="Notice required (days)"
            hint="Applying with less notice than this needs an exception."
            error={errors.min_notice_days?.message}
          >
            <Input type="number" min="0" className="tabular" {...register('min_notice_days')} />
          </Field>
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>Who can see it</SectionLabel>
          <div className="rounded-lg border border-ink-100 px-3 py-3">
            <Check
              label="Employees can see and apply for it"
              hint="Turn off to keep this type to administrators: it disappears from employees' leave page and balances, and they cannot apply for it. It still accrues, so turning it back on shows the right balance."
              {...register('visible_to_employees')}
            />
          </div>
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <SectionLabel>How it may be taken</SectionLabel>
          <div className="space-y-3 rounded-lg border border-ink-100 px-3 py-3">
            <Check
              label="Paid leave"
              hint="Unpaid leave deducts from pay under the salary rules in Settings."
              {...register('is_paid')}
            />
            <Check label="Can be taken as a half day" {...register('allow_half_day')} />
            <Check
              label="Unused days lapse at the end of the year"
              hint="Anything above the carry-forward limit is cleared."
              {...register('lapse_at_year_end')}
            />
            <Check
              label="May go overdrawn"
              hint="Lets an employee borrow against leave they have not accrued yet."
              {...register('allow_negative_balance')}
            />
          </div>
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

const Check = function Check({
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
