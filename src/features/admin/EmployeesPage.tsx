import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarClock, CalendarDays, Copy, Search, UserPlus, Users } from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatDate, todayKey } from '@/lib/format'
import { refreshCalendarDependents } from '@/lib/refresh'
import { useAuth } from '@/store/auth'
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
  RowMenu,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  Toolbar,
  Tr,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { LeaveBalance, Paginated, Shift, User } from '@/types'

/* An account status is a real state of the person, so it may borrow the status
   palette: invited is unfinished, suspended is a stop. */
const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  SUSPENDED: 'red',
}

/* A manager is its own role now; calling them "Employee" in the register was a
   leftover from when there were only two. A role is not a status, so it never
   borrows the calendar colours — only ink emphasis, or nothing at all. */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'SUSPENDED', label: 'Suspended' },
]

/*
  A shift assignment is a planned window for a piece of work, not a permanent
  property of a person. Four things can be true of that window, and only one of
  them is worth an administrator's attention.
*/
type WindowState = 'open' | 'upcoming' | 'running' | 'lapsed'

function windowState(from: string | null | undefined, to: string | null | undefined): WindowState {
  if (!from && !to) return 'open'
  // ISO dates compare correctly as strings, and `todayKey` is already the
  // organisation's today rather than the browser's.
  const today = todayKey()
  if (from && today < from) return 'upcoming'
  if (to && today > to) return 'lapsed'
  return 'running'
}

/** The window, written the way somebody would say it out loud. */
function windowSentence(
  state: WindowState,
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (state === 'open') return 'Runs until you change it.'
  if (state === 'upcoming')
    return to
      ? `Planned for ${formatDate(from)} to ${formatDate(to)} — it has not started yet.`
      : `Starts on ${formatDate(from)} and runs until you change it.`
  if (state === 'lapsed')
    return `The window ran out on ${formatDate(to)}, so there is no active shift now.`
  return to
    ? `Running now, until ${formatDate(to)}.`
    : `Running since ${formatDate(from)}, until you change it.`
}

export function EmployeesPage() {
  const myId = useAuth((state) => state.user?.id)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [confirming, setConfirming] = useState<
    { employee: User; intent: 'suspend' | 'remove' } | null
  >(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, statusFilter],
    queryFn: () =>
      apiGet<Paginated<User>>('/users', {
        search: search || undefined,
        status: statusFilter || undefined,
        page_size: 100,
      }),
  })

  // Shown in the table so the shift somebody is on is visible without opening
  // them one at a time.
  const shifts = useQuery({
    queryKey: ['shifts', 'all'],
    // Inactive ones included: somebody assigned to a shift that was later
    // retired still has to show its name, not a dash.
    queryFn: () => apiGet<Shift[]>('/shifts', { include_inactive: true }),
  })

  const shiftLabel = (id?: string | null) => {
    if (!id) return 'Default'
    const shift = shifts.data?.find((entry) => entry.id === id)
    return shift ? shift.name : '—'
  }

  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'activate' }) =>
      apiPost(`/users/${id}/${action}`),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success(variables.action === 'suspend' ? 'Access suspended.' : 'Access reinstated.')
      setConfirming(null)
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The access change was not applied.')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Employee removed.')
      setConfirming(null)
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The employee was not removed.')),
  })

  const filtered = Boolean(search || statusFilter)

  // The point of a planned window is that somebody has to notice when it runs
  // out. Counting them here saves reading the column row by row.
  const lapsed = (data?.items ?? []).filter(
    (employee) =>
      employee.status !== 'SUSPENDED' &&
      windowState(employee.shift_from, employee.shift_to) === 'lapsed',
  )

  return (
    <>
      <PageHeader
        title="Employees"
        description="Invite people, put them on a shift for as long as the work runs, and manage access."
        action={
          <Button onClick={() => setInviting(true)}>
            <UserPlus className="size-4" />
            Invite an employee
          </Button>
        }
      />

      <Toolbar>
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-300" />
          <Input
            className="pl-9"
            type="search"
            aria-label="Search employees"
            placeholder="Search by name, email or employee code"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Segmented
          className="max-w-full overflow-x-auto"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
        />
      </Toolbar>

      {lapsed.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-ink-100 bg-white px-3.5 py-2.5 text-[12px] text-ink-600">
          <CalendarClock className="mt-px size-4 shrink-0 text-status-amber" aria-hidden />
          <span>
            <span className="font-medium text-ink-800">
              {lapsed.length === 1
                ? `${lapsed[0].full_name}’s shift window has run out.`
                : `${lapsed.length} people have a shift window that has run out.`}
            </span>{' '}
            They can still punch — but the window you planned has ended while the work
            evidently has not. Edit them to extend it, or leave the dates empty so the
            assignment runs until you change it.
          </span>
        </p>
      )}

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Users className="size-8" />}
            title={filtered ? 'Nobody matches those filters' : 'No employees yet'}
            description={
              filtered
                ? 'Try a different search, or look at everyone.'
                : 'Invite somebody and they will set their own password from the link.'
            }
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('')
                  }}
                >
                  Show everyone
                </Button>
              ) : (
                <Button onClick={() => setInviting(true)}>
                  <UserPlus className="size-4" />
                  Invite an employee
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Below a laptop width, one card per person: a seven-column table
                there scrolls the shift, the status and every action off-screen. */}
            <ul className="divide-y divide-rule md:grid md:grid-cols-2 md:divide-y-0 xl:hidden">
              {data.items.map((employee) => (
                <li
                  key={employee.id}
                  className="px-4 py-3.5 md:border-b md:border-rule md:odd:border-r"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block font-medium text-ink-900">{employee.full_name}</span>
                      <span className="block truncate text-[12px] text-ink-400">{employee.email}</span>
                    </div>
                    <Badge tone={STATUS_TONE[employee.status] ?? 'neutral'}>
                      {employee.status.toLowerCase()}
                    </Badge>
                  </div>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                    <div>
                      <dt className="text-[11px] tracking-wider text-ink-400 uppercase">Shift</dt>
                      <dd>
                        <ShiftCell name={shiftLabel(employee.shift_id)} employee={employee} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wider text-ink-400 uppercase">Role</dt>
                      <dd className="text-ink-700">
                        {ROLE_LABEL[employee.role] ?? employee.role}
                        {employee.employment_type === 'PART_TIME' && ' · Intern / part-time'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wider text-ink-400 uppercase">Department</dt>
                      <dd className="text-ink-700">{employee.department || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wider text-ink-400 uppercase">Joined</dt>
                      <dd className="tabular text-ink-700">
                        {employee.joining_date ? formatDate(employee.joining_date) : '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-end gap-1">
                    <EmployeeActions
                      employee={employee}
                      isSelf={employee.id === myId}
                      onEdit={() => setEditing(employee)}
                      onReinstate={() => setStatus.mutate({ id: employee.id, action: 'activate' })}
                      onConfirm={(intent) => setConfirming({ employee, intent })}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <Table className="hidden xl:block">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Shift</Th>
                  <Th>Department</Th>
                  <Th>Status</Th>
                  <Th className="hidden 2xl:table-cell">Joined</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((employee) => (
                  <Tr key={employee.id}>
                    <Td>
                      <span className="block font-medium text-ink-900">{employee.full_name}</span>
                      <span className="block text-[12px] text-ink-400">{employee.email}</span>
                    </Td>
                    <Td>
                      {employee.role === 'EMPLOYEE' ? (
                        <span className="text-ink-500">Employee</span>
                      ) : (
                        <Badge tone="brand">{ROLE_LABEL[employee.role] ?? employee.role}</Badge>
                      )}
                      {employee.employment_type === 'PART_TIME' && (
                        <span className="block text-[11px] text-ink-400">Intern / part-time</span>
                      )}
                    </Td>
                    <Td>
                      <ShiftCell name={shiftLabel(employee.shift_id)} employee={employee} />
                    </Td>
                    <Td>{employee.department || '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[employee.status] ?? 'neutral'}>
                        {employee.status.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td className="tabular hidden whitespace-nowrap 2xl:table-cell">
                      {employee.joining_date ? formatDate(employee.joining_date) : '—'}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <EmployeeActions
                          employee={employee}
                          isSelf={employee.id === myId}
                          onEdit={() => setEditing(employee)}
                          onReinstate={() => setStatus.mutate({ id: employee.id, action: 'activate' })}
                          onConfirm={(intent) => setConfirming({ employee, intent })}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirming)}
        title={
          confirming?.intent === 'remove'
            ? `Remove ${confirming.employee.full_name}?`
            : `Suspend ${confirming?.employee.full_name ?? ''}?`
        }
        description={
          confirming?.intent === 'remove'
            ? `${
                confirming.employee.role === 'ADMIN'
                  ? 'They lose administrator access immediately'
                  : 'They lose access immediately'
              } and disappear from the register. An invitation they have not accepted stops working. Attendance already recorded is kept for the audit trail.`
            : 'They stay in the register but cannot sign in or punch until you reinstate them.'
        }
        confirmLabel={
          confirming?.intent === 'remove'
            ? confirming.employee.role === 'ADMIN'
              ? 'Remove administrator'
              : 'Remove employee'
            : 'Suspend access'
        }
        loading={setStatus.isPending || remove.isPending}
        onConfirm={() => {
          if (!confirming) return
          if (confirming.intent === 'remove') remove.mutate(confirming.employee.id)
          else setStatus.mutate({ id: confirming.employee.id, action: 'suspend' })
        }}
        onClose={() => setConfirming(null)}
      />

      <InviteModal open={inviting} onClose={() => setInviting(false)} />
      <EditModal employee={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/**
    Routine actions stay on the row; the ones that change somebody's access sit
    behind the menu, so a slip of the pointer on a busy table cannot suspend
    anyone, and the row fits a laptop screen without scrolling sideways.
*/
function EmployeeActions({
  employee,
  isSelf,
  onEdit,
  onReinstate,
  onConfirm,
}: {
  employee: User
  /** Your own row: the API refuses to suspend or remove you, so don't offer it. */
  isSelf: boolean
  onEdit: () => void
  onReinstate: () => void
  onConfirm: (intent: 'suspend' | 'remove') => void
}) {
  return (
    <>
      {/* The word only where there is room for it: on a laptop the label
          alone pushed the row past the edge of the table. */}
      <Link to={`/admin/employees/${employee.id}/attendance`} title="Attendance">
        <Button variant="ghost" size="sm" tabIndex={-1}>
          <CalendarDays className="size-4" aria-hidden />
          <span className="xl:max-2xl:sr-only">Attendance</span>
        </Button>
      </Link>
      <Button variant="secondary" size="sm" onClick={onEdit}>
        Edit
      </Button>
      {isSelf ? (
        // Keeps the column aligned with the rows that do have a menu.
        <span className="inline-block size-8" title="This is you" aria-hidden />
      ) : (
        <RowMenu
          label={`More actions for ${employee.full_name}`}
          items={[
            employee.status === 'SUSPENDED'
              ? { label: 'Reinstate access', onSelect: onReinstate }
              : { label: 'Suspend access', onSelect: () => onConfirm('suspend'), danger: true },
            {
              label: employee.role === 'ADMIN' ? 'Remove administrator' : 'Remove employee',
              onSelect: () => onConfirm('remove'),
              danger: true,
            },
          ]}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

/**
    The Shift column.

    The shift's name alone stopped being the whole answer once an assignment
    could be a window: what an administrator scans this column for is the
    person whose window ran out while the work did not. That one case is the
    only thing here drawn in colour — it is a real state of how the register
    measures the person, and every other row stays ink so it stands out.
*/
function ShiftCell({ name, employee }: { name: string; employee: User }) {
  const from = employee.shift_from
  const to = employee.shift_to
  const state = windowState(from, to)

  return (
    <div className="min-w-0">
      <span className={state === 'lapsed' ? 'block text-ink-400 line-through' : 'block text-ink-800'}>
        {name}
      </span>

      {state === 'lapsed' ? (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="amber">No active shift</Badge>
          <span className="tabular text-[11px] whitespace-nowrap text-ink-400">
            ended {formatDate(to)}
          </span>
        </span>
      ) : state === 'upcoming' ? (
        <span className="tabular block text-[11px] whitespace-nowrap text-ink-400">
          from {formatDate(from)}
          {to && ` to ${formatDate(to)}`}
        </span>
      ) : state === 'running' ? (
        <span className="tabular block text-[11px] whitespace-nowrap text-ink-400">
          {to ? `until ${formatDate(to)}` : `since ${formatDate(from)}`}
        </span>
      ) : (
        /* No window at all — the ordinary case, and the ordinary case says
           nothing rather than repeating "until changed" down every row. */
        null
      )}
    </div>
  )
}

/** A titled group inside a long dialog. A form of fifteen fields is unreadable
    as one list; four short lists with headings is the same form, answered. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <fieldset className="border-t border-ink-100 pt-4 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{title}</p>
      {description && <p className="mt-0.5 text-[12px] text-ink-400">{description}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </fieldset>
  )
}

/**
    The shift assignment: one decision, three fields.

    A shift used to be a permanent property of a person, and the selector alone
    said so. It is now a planned window for a piece of work — "Riya is on the
    general shift for these two weeks" — so the dates are not a separate
    question and are not laid out as one. The sentence underneath reads the
    three fields back together, because that is the only place the decision is
    visible as a whole.
*/
function ShiftAssignment({
  shifts,
  shiftField,
  fromField,
  toField,
  shiftId,
  from,
  to,
  toError,
}: {
  shifts?: Shift[]
  shiftField: UseFormRegisterReturn
  fromField: UseFormRegisterReturn
  toField: UseFormRegisterReturn
  shiftId?: string
  from?: string
  to?: string
  toError?: string
}) {
  const chosen = shiftId ? shifts?.find((shift) => shift.id === shiftId) : undefined
  const state = windowState(from, to)

  return (
    <FormSection
      title="Which shift, and for how long"
      description="A shift is a planned window for a piece of work, not the opening hours of the office. Which days the office is actually open — Saturdays, holidays and one-off closures — comes from the work calendar."
    >
      <div className="space-y-3 rounded-lg border border-ink-100 px-3 py-3">
        <Field label="Shift" hint="Decides what counts as a full day while the window is running.">
          <Select {...shiftField}>
            <option value="">Organisation default</option>
            {shifts?.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.name} · {shift.start_time}–{shift.end_time}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="On this shift from">
            <Input type="date" className="tabular" {...fromField} />
          </Field>
          <Field label="Until" error={toError}>
            <Input type="date" className="tabular" {...toField} />
          </Field>
        </div>

        <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
          <span className="font-medium text-ink-800">
            {chosen ? chosen.name : 'The organisation’s default shift'}.
          </span>{' '}
          {windowSentence(state, from, to)}
          {state === 'open'
            ? ' Give it dates when the assignment is for one piece of work with an end in sight.'
            : ' After it, they have no active shift — they can still punch, and you get told here that the window ran out before the work did.'}
        </p>
      </div>
    </FormSection>
  )
}

/** Nothing irreversible happens on a single click. The dialog says what will
    happen in the same words as the button that opened it. */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-600">{description}</p>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */
const inviteSchema = z
  .object({
    email: z.string().min(1, 'Enter an email address.').email('Enter a valid email address.'),
    first_name: z.string().max(60).optional(),
    last_name: z.string().max(60).optional(),
    role: z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']),
    employment_type: z.enum(['FULL_TIME', 'PART_TIME']),
    designation: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    employee_code: z.string().max(40).optional(),
    shift_id: z.string().optional(),
    shift_from: z.string().optional(),
    shift_to: z.string().optional(),
    joining_date: z.string().optional(),
  })
  .refine((values) => !values.shift_from || !values.shift_to || values.shift_from <= values.shift_to, {
    path: ['shift_to'],
    message: 'The window has to end after it starts.',
  })

const ROLE_EXPLAINER: Record<string, string> = {
  EMPLOYEE: 'Records their own attendance and applies for their own leave.',
  MANAGER: 'Everything an employee can do, plus approving for their own reports.',
  ADMIN: 'Sees and changes everything, including salary rules and this register.',
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [delivered, setDelivered] = useState(true)
  const [copied, setCopied] = useState(false)

  // The first piece of work somebody is put on is usually known before they
  // arrive, so the shift and its window belong on the invitation rather than
  // in an edit somebody has to remember afterwards.
  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => apiGet<Shift[]>('/shifts'),
    enabled: open,
  })

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'EMPLOYEE', employment_type: 'FULL_TIME' },
  })

  const role = watch('role')
  const shiftId = watch('shift_id')
  const shiftFrom = watch('shift_from')
  const shiftTo = watch('shift_to')

  async function onSubmit(values: z.infer<typeof inviteSchema>) {
    setError(null)
    try {
      const created = await apiPost<{ invite_url: string; email_delivered: boolean }>(
        '/auth/invite',
        {
          ...values,
          joining_date: values.joining_date || null,
          shift_id: values.shift_id || null,
          // An empty date is not "no answer", it is "runs until changed".
          shift_from: values.shift_from || null,
          shift_to: values.shift_to || null,
          employee_code: values.employee_code || null,
          designation: values.designation || null,
          department: values.department || null,
        },
      )
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setInviteUrl(created.invite_url)
      setDelivered(created.email_delivered)
      if (created.email_delivered) toast.success('Invitation sent.')
      else toast.info('Invitation created — the email did not go out.')
      reset({ role: 'EMPLOYEE', employment_type: 'FULL_TIME' })
    } catch (submitError) {
      const message = messageOf(submitError, 'The invitation was not sent.')
      setError(message)
      toast.error(message)
    }
  }

  function close() {
    setInviteUrl(null)
    setCopied(false)
    setError(null)
    onClose()
  }

  if (inviteUrl) {
    return (
      <Modal
        open={open}
        onClose={close}
        title={delivered ? 'Invitation sent' : 'Invitation created'}
        description={
          delivered
            ? 'The employee has been emailed a setup link.'
            : 'The email could not be sent, so nobody has the link yet.'
        }
        footer={<Button onClick={close}>Done</Button>}
      >
        <p className="text-[13px] text-ink-600">
          {delivered
            ? 'If it does not arrive, share this link directly. It works once and expires.'
            : 'Share this link with them directly. It works once and expires.'}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input readOnly value={inviteUrl} aria-label="Invitation link" className="tabular text-[12px]" />
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(inviteUrl)
              setCopied(true)
              toast.success('Link copied.')
            }}
          >
            <Copy className="size-4" />
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite an employee"
      description="They will set their own password and complete their profile."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Send invitation
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {error && <ErrorNote message={error} />}

        <FormSection title="Who they are" description="Only the email address is required to send the invitation.">
          <Field label="Email address" error={errors.email?.message} required>
            <Input
              type="email"
              autoFocus
              autoComplete="off"
              placeholder="new.hire@company.com"
              {...register('email')}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" error={errors.first_name?.message}>
              <Input {...register('first_name')} />
            </Field>
            <Field label="Last name" error={errors.last_name?.message}>
              <Input {...register('last_name')} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="What they may do">
          <Field label="Role" hint={ROLE_EXPLAINER[role] ?? undefined} error={errors.role?.message}>
            <Select {...register('role')}>
              <option value="EMPLOYEE">Employee</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
        </FormSection>

        <FormSection title="Where they sit">
          <EmploymentTypeField register={register('employment_type')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job title" error={errors.designation?.message}>
              <Input placeholder="Accounts executive" {...register('designation')} />
            </Field>
            <Field label="Department" error={errors.department?.message}>
              <Input placeholder="Finance" {...register('department')} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee code" error={errors.employee_code?.message}>
              <Input className="tabular" placeholder="EMP-0142" {...register('employee_code')} />
            </Field>
            <Field label="Joining date" error={errors.joining_date?.message}>
              <Input type="date" className="tabular" {...register('joining_date')} />
            </Field>
          </div>
        </FormSection>

        <ShiftAssignment
          shifts={shifts.data}
          shiftField={register('shift_id')}
          fromField={register('shift_from')}
          toField={register('shift_to')}
          shiftId={shiftId}
          from={shiftFrom}
          to={shiftTo}
          toError={errors.shift_to?.message}
        />
      </form>
    </Modal>
  )
}

/** Full-time or intern/part-time — which decides how the person is paid. */
function EmploymentTypeField({ register }: { register: UseFormRegisterReturn }) {
  return (
    <Field
      label="Employment type"
      hint="Interns and part-timers are paid their fixed monthly amount in proportion to the hours they work, shown on the Salary page."
    >
      <Select {...register}>
        <option value="FULL_TIME">Full-time</option>
        <option value="PART_TIME">Intern / part-time</option>
      </Select>
    </Field>
  )
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */
const editSchema = z
  .object({
    first_name: z.string().max(60).optional(),
    last_name: z.string().max(60).optional(),
    employment_type: z.enum(['FULL_TIME', 'PART_TIME']),
    designation: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    employee_code: z.string().max(40).optional(),
    shift_id: z.string().optional(),
    shift_from: z.string().optional(),
    shift_to: z.string().optional(),
    reporting_manager_id: z.string().optional(),
    joining_date: z.string().optional(),
    can_punch: z.boolean(),
  })
  .refine((values) => !values.shift_from || !values.shift_to || values.shift_from <= values.shift_to, {
    path: ['shift_to'],
    message: 'The window has to end after it starts.',
  })

function EditModal({ employee, onClose }: { employee: User | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => apiGet<Shift[]>('/shifts'),
    enabled: Boolean(employee),
  })

  const colleagues = useQuery({
    // Its own key: sharing the roster's prefix meant this 100-row lookup could
    // be served the roster's payload, and vice versa, whenever the roster
    // happened to be unfiltered.
    queryKey: ['employees', 'colleagues'],
    queryFn: () => apiGet<Paginated<User>>('/users', { page_size: 100 }),
    enabled: Boolean(employee),
  })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: {
      first_name: employee?.first_name ?? '',
      last_name: employee?.last_name ?? '',
      employment_type: employee?.employment_type ?? 'FULL_TIME',
      designation: employee?.designation ?? '',
      department: employee?.department ?? '',
      employee_code: employee?.employee_code ?? '',
      shift_id: employee?.shift_id ?? '',
      shift_from: employee?.shift_from ?? '',
      shift_to: employee?.shift_to ?? '',
      reporting_manager_id: employee?.reporting_manager_id ?? '',
      joining_date: employee?.joining_date ?? '',
      can_punch: employee?.can_punch ?? true,
    },
  })

  const shiftId = watch('shift_id')
  const shiftFrom = watch('shift_from')
  const shiftTo = watch('shift_to')

  if (!employee) return null

  async function onSubmit(values: z.infer<typeof editSchema>) {
    setError(null)
    try {
      /*
        An emptied field is an instruction, not an absence. Filtering blanks out
        meant a job title or a department could be filled in but never taken
        out again — the PATCH simply omitted the field and the old value stayed.
        Blanks are now sent as null, which the API reads as "clear this".
      */
      const payload = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, value === '' ? null : value]),
      )
      await apiPatch(`/users/${employee!.id}`, payload)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      // A changed shift or shift window moves their calendar, the register and
      // the lapsed-window signal on the operations feed.
      refreshCalendarDependents(queryClient)
      toast.success('Changes saved.')
      onClose()
    } catch (submitError) {
      const message = messageOf(submitError, 'The changes were not saved.')
      setError(message)
      toast.error(message)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={employee.full_name}
      description={`${employee.email} · ${ROLE_LABEL[employee.role] ?? employee.role}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Save changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {error && <ErrorNote message={error} />}

        <FormSection title="Who they are">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" error={errors.first_name?.message}>
              <Input {...register('first_name')} />
            </Field>
            <Field label="Last name" error={errors.last_name?.message}>
              <Input {...register('last_name')} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Where they sit">
          <EmploymentTypeField register={register('employment_type')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job title" error={errors.designation?.message}>
              <Input {...register('designation')} />
            </Field>
            <Field label="Department" error={errors.department?.message}>
              <Input {...register('department')} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee code" error={errors.employee_code?.message}>
              <Input className="tabular" {...register('employee_code')} />
            </Field>
            <Field label="Joining date" error={errors.joining_date?.message}>
              <Input type="date" className="tabular" {...register('joining_date')} />
            </Field>
          </div>
          <Field
            label="Reporting manager"
            hint="Recorded now, used when the manager role is enabled."
          >
            <Select {...register('reporting_manager_id')}>
              <option value="">Nobody</option>
              {colleagues.data?.items
                .filter((person) => person.id !== employee.id)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        </FormSection>

        <ShiftAssignment
          shifts={shifts.data}
          shiftField={register('shift_id')}
          fromField={register('shift_from')}
          toField={register('shift_to')}
          shiftId={shiftId}
          from={shiftFrom}
          to={shiftTo}
          toError={errors.shift_to?.message}
        />


        <FormSection title="Exceptions" description="Each of these is recorded in the audit trail.">
          <div className="space-y-3 rounded-lg border border-ink-100 px-3 py-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-ink-900"
                {...register('can_punch')}
              />
              <span>
                <span className="block text-[13px] text-ink-800">May punch in and out</span>
                <span className="block text-[12px] text-ink-400">
                  Off for administrators by default — they review attendance rather than record it.
                </span>
              </span>
            </label>
          </div>
        </FormSection>
      </form>

      <div className="mt-5">
        <LeaveBalances userId={employee.id} />
      </div>
    </Modal>
  )
}

/**
    Each leave balance, settable by hand.

    Outside the form above on purpose: a balance is saved the moment it is set,
    with its own entry in the audit trail, rather than riding along with a
    change of job title. The administrator types what is left to take; the API
    works out the figures behind it, and monthly credits keep adding on top.
*/
function LeaveBalances({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const balances = useQuery({
    queryKey: ['leave-balances', userId],
    queryFn: () => apiGet<LeaveBalance[]>(`/leave/balances/${userId}`),
  })

  const save = useMutation({
    mutationFn: ({ typeId, available }: { typeId: string; available: number }) =>
      apiPatch(`/leave/balances/${userId}/${typeId}`, {
        available,
        note: `Set to ${available} day(s) by an administrator`,
      }),
    onSuccess: (_, { typeId }) => {
      setDrafts(({ [typeId]: _done, ...rest }) => rest)
      queryClient.invalidateQueries({ queryKey: ['leave-balances', userId] })
      toast.success('Leave balance saved.')
    },
    onError: (saveError) => toast.error(messageOf(saveError, 'The balance was not saved.')),
  })

  return (
    <FormSection
      title="Leave balances"
      description="Days left to take this year. Half days are allowed; credits keep adding on the 1st."
    >
      {balances.isLoading ? (
        <p className="text-[13px] text-ink-400">Loading…</p>
      ) : (
        <ul className="divide-y divide-ink-50">
          {(balances.data ?? []).map((balance) => {
            const draft = drafts[balance.leave_type_id]
            const value = draft ?? String(balance.available)
            const parsed = Number(value)
            const valid = value !== '' && parsed >= 0 && parsed <= 365 && (parsed * 2) % 1 === 0
            return (
              <li key={balance.leave_type_id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink-800">{balance.leave_type_name}</span>
                  <span className="block text-[12px] text-ink-400">
                    {balance.used} taken{balance.pending ? ` · ${balance.pending} waiting` : ''}
                  </span>
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label={`${balance.leave_type_name} days left`}
                  className="w-20"
                  value={value}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [balance.leave_type_id]: event.target.value,
                    }))
                  }
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={draft === undefined || !valid}
                  loading={save.isPending && save.variables?.typeId === balance.leave_type_id}
                  onClick={() => save.mutate({ typeId: balance.leave_type_id, available: parsed })}
                >
                  Set
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </FormSection>
  )
}
