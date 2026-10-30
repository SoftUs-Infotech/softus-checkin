import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ClipboardList, FileClock, Palmtree, RotateCcw, X } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { refreshApprovalDependents } from '@/lib/refresh'
import { approvalChip, formatDate, formatMinutes, formatTime, humanise, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Badge,
  Button,
  Card,
  CardSkeleton,
  Checkbox,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Textarea,
  useToast,
} from '@/components/ui'
import type { BulkResponse, Correction, LeaveRequest, Paginated, Task } from '@/types'

type Tab = 'corrections' | 'leave' | 'tasks'

const TABS: { key: Tab; label: string; icon: typeof FileClock }[] = [
  { key: 'corrections', label: 'Corrections', icon: FileClock },
  { key: 'leave', label: 'Leave', icon: Palmtree },
  { key: 'tasks', label: 'Tasks', icon: ClipboardList },
]

interface Decision {
  url: string
  title: string
  detail: string
  approve: boolean
  needsNote?: boolean
  /** Past tense of the button that opened this — "Approve" → "Approved". */
  done: string
}

/** A row as the selection sees it — an identity and something to call it by. */
interface BulkRow {
  id: string
  label: string
}

interface BulkOutcome {
  approve: boolean
  requested: number
  succeeded: number
  failures: { id: string; label: string; message: string }[]
}

export function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('corrections')
  const [decision, setDecision] = useState<Decision | null>(null)

  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<import('@/types').DashboardSummary>('/dashboard/summary'),
  })

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Everything waiting on a decision from you."
      />

      <div
        role="tablist"
        aria-label="Approval queues"
        className="mb-5 flex gap-1 rounded-xl border border-ink-100 bg-white p-1"
      >
        {TABS.map((entry) => {
          const count = summary.data?.pending?.[entry.key] ?? 0
          const selected = tab === entry.key
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(entry.key)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] transition-colors sm:gap-2 sm:px-3',
                selected
                  ? 'bg-brand-700 font-medium text-white'
                  : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
              )}
            >
              {/* Three tabs, a label and a count do not fit a phone with an icon too. */}
              <entry.icon className="hidden size-4 shrink-0 sm:block" aria-hidden />
              {entry.label}
              {count > 0 && (
                <span
                  className={cn(
                    'tabular rounded-full px-1.5 text-[10px] font-semibold',
                    selected ? 'bg-white/20 text-white' : 'bg-status-red text-white',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'corrections' && <CorrectionQueue onDecide={setDecision} />}
      {tab === 'leave' && <LeaveQueue onDecide={setDecision} />}
      {tab === 'tasks' && <TaskQueue onDecide={setDecision} />}

      {decision && <DecisionModal decision={decision} onClose={() => setDecision(null)} />}
    </>
  )
}

function DecisionModal({
  decision,
  onClose,
}: {
  decision: Decision | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: () => apiPost(decision!.url, { note: note || null }),
    onSuccess: () => {
      refreshApprovalDependents(queryClient)
      toast.success(decision!.done)
      setNote('')
      onClose()
    },
    // The inline note stays alongside the toast: a message that has faded is
    // no help to somebody still looking at the dialog.
    onError: (mutationError) => {
      setError(messageOf(mutationError))
      toast.error(messageOf(mutationError))
    },
  })

  if (!decision) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={decision.title}
      description={decision.detail}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision.approve ? 'success' : 'danger'}
            loading={submit.isPending}
            disabled={decision.needsNote && !note.trim()}
            onClick={() => submit.mutate()}
          >
            {decision.approve ? 'Approve' : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Note {decision.needsNote ? '(required)' : '(optional)'}
          </span>
          <Textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              decision.approve
                ? 'Confirmed with the team lead.'
                : 'Explain the decision so the employee knows what to do next.'
            }
          />
        </label>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Bulk selection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Selection over whatever rows are on screen right now.
 *
 * Ids are always filtered back through the visible rows before they are used:
 * a decided record leaves the queue on the next refetch, and a selection that
 * outlived its row would inflate the count and be posted again.
 */
function useBulkSelection(rows: BulkRow[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())

  const chosen = rows.filter((row) => selected.has(row.id))
  const ids = chosen.map((row) => row.id)
  const allSelected = rows.length > 0 && ids.length === rows.length

  return {
    ids,
    chosen,
    allSelected,
    /** Some, but not all. The select-all box has to say so rather than read
        as empty — otherwise it claims nothing is picked while a bulk bar sits
        above it counting seven records. */
    someSelected: ids.length > 0 && ids.length < rows.length,
    has: (id: string) => selected.has(id),
    toggle: (id: string) =>
      setSelected((previous) => {
        const next = new Set(previous)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    toggleAll: () =>
      setSelected(allSelected ? new Set<string>() : new Set(rows.map((row) => row.id))),
    clear: () => setSelected(new Set<string>()),
    /** Drop only what went through, so the failures stay picked and visible. */
    keepOnly: (survivors: string[]) => setSelected(new Set(survivors)),
  }
}

/**
 * Runs one decision across many records and turns the per-record answers into
 * something an administrator can read.
 */
function useBulkDecision({
  url,
  rows,
  noun,
  body,
  onDone,
}: {
  url: string
  rows: BulkRow[]
  /** What one record is called, for the confirmation and the toast. */
  noun: string
  body: (ids: string[], approve: boolean, note: string | null) => unknown
  onDone: (failedIds: string[]) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (input: { ids: string[]; approve: boolean; note: string }) =>
      apiPost<BulkResponse>(url, body(input.ids, input.approve, input.note.trim() || null)),
    onMutate: () => {
      setError(null)
      setOutcome(null)
    },
    onSuccess: (response, input) => {
      const failed = response.results.filter((result) => !result.success)
      setOutcome({
        approve: input.approve,
        requested: response.requested,
        succeeded: response.succeeded,
        failures: failed.map((result) => {
          const id = result.id ?? result.task_id ?? ''
          return {
            id,
            label: rows.find((row) => row.id === id)?.label ?? id,
            message: result.message ?? humanise(result.error_code ?? 'FAILED'),
          }
        }),
      })
      // The toast says the shape of the answer; the note below names every
      // refusal, because a batch is many decisions and not one.
      const verb = input.approve ? 'approved' : 'rejected'
      const plural = `${noun}${response.succeeded === 1 ? '' : 's'}`
      if (failed.length === 0) {
        toast.success(`${response.succeeded} ${plural} ${verb}.`)
      } else if (response.succeeded === 0) {
        toast.error(`None of the ${failed.length} could be ${verb} — see the reasons above.`)
      } else {
        toast.info(
          `${response.succeeded} ${plural} ${verb}, ${failed.length} could not be — see the reasons above.`,
        )
      }
      onDone(failed.map((result) => result.id ?? result.task_id ?? ''))
      refreshApprovalDependents(queryClient)
    },
    onError: (mutationError) => {
      setError(messageOf(mutationError))
      toast.error(messageOf(mutationError))
    },
  })

  return { outcome, error, noun, dismiss: () => setOutcome(null), mutation }
}

/**
 * The honest report. A batch is not one decision that worked or failed — it is
 * many, so the count is stated and every refusal is named with its reason.
 */
function BulkOutcomeNote({
  outcome,
  onDismiss,
}: {
  outcome: BulkOutcome
  onDismiss: () => void
}) {
  const verb = outcome.approve ? 'approved' : 'rejected'
  const failures = outcome.failures.length
  const clean = failures === 0

  return (
    <Card
      className={cn(
        'mb-3 px-5 py-4',
        clean ? 'border-status-green/30' : 'border-status-amber/40 bg-status-amber-soft/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink-900">
            <Badge tone={clean ? 'green' : failures === outcome.requested ? 'red' : 'amber'}>
              {clean ? 'Done' : failures === outcome.requested ? 'Nothing went through' : 'Partly done'}
            </Badge>
            <span className="tabular">
              {outcome.succeeded} of {outcome.requested}
            </span>
            {verb}
            {failures > 0 && <span className="tabular">· {failures} refused</span>}
          </p>
          {failures > 0 && (
            <ul className="mt-2 space-y-1">
              {outcome.failures.map((failure) => (
                <li key={failure.id} className="flex gap-2 text-[13px] text-ink-600">
                  <X className="mt-0.5 size-3.5 shrink-0 text-status-red" aria-hidden />
                  <span>
                    <span className="font-medium text-ink-900">{failure.label}</span> —{' '}
                    {failure.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {failures > 0 && (
            <p className="mt-2 text-[12px] text-ink-500">
              The refused records are still selected, so you can look at them one at a time.
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  )
}

/**
 * The bar sticks under the page header once anything is picked. A bulk decision
 * is irreversible in the reader's mind, so the count, the names and the button
 * that will act on them stay on screen together however far the list is
 * scrolled.
 */
function BulkBar({
  total,
  noun,
  selection,
  bulk,
}: {
  total: number
  noun: string
  selection: ReturnType<typeof useBulkSelection>
  bulk: ReturnType<typeof useBulkDecision>
}) {
  const [confirming, setConfirming] = useState<null | { approve: boolean }>(null)
  const count = selection.ids.length
  const armed = count > 0

  return (
    <>
      <Card
        className={cn(
          'sticky top-14 z-10 mb-3 px-5 py-3 transition-shadow',
          armed && 'border-brand-300 shadow-md shadow-ink-950/5 ring-1 ring-brand-200',
        )}
      >
        {bulk.error && <ErrorNote className="mb-3" message={bulk.error} />}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
            <Checkbox
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
            />
            Select all <span className="tabular">{total}</span>
          </label>

          <span
            className={cn(
              'tabular rounded-full px-2.5 py-0.5 text-[12px] font-medium',
              armed ? 'bg-brand-700 text-white' : 'bg-ink-50 text-ink-400',
            )}
            aria-live="polite"
          >
            {armed ? `${count} selected` : 'Nothing selected'}
          </span>

          {armed && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selection.clear}>
                Clear selection
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming({ approve: false })}
              >
                <X className="size-3.5" aria-hidden />
                Reject {count}
              </Button>
              <Button
                variant="success"
                size="sm"
                onClick={() => setConfirming({ approve: true })}
              >
                <Check className="size-3.5" aria-hidden />
                Approve {count}
              </Button>
            </div>
          )}
        </div>

        {armed && (
          <p className="mt-2 truncate border-t border-ink-100 pt-2 text-[12px] text-ink-500">
            {selection.chosen
              .slice(0, 3)
              .map((row) => row.label)
              .join(' · ')}
            {count > 3 && ` · and ${count - 3} more`}
          </p>
        )}
      </Card>

      {confirming && (
        <BulkConfirm
          approve={confirming.approve}
          noun={noun}
          rows={selection.chosen}
          pending={bulk.mutation.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={(note) =>
            bulk.mutation.mutate(
              { ids: selection.ids, approve: confirming.approve, note },
              { onSuccess: () => setConfirming(null) },
            )
          }
        />
      )}
    </>
  )
}

/**
 * Names every record before the decision is made. "Approve 12" is a number;
 * this is the twelve people it is about to happen to.
 */
function BulkConfirm({
  approve,
  noun,
  rows,
  pending,
  onClose,
  onConfirm,
}: {
  approve: boolean
  noun: string
  rows: BulkRow[]
  pending: boolean
  onClose: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const plural = `${noun}${rows.length === 1 ? '' : 's'}`

  return (
    <Modal
      open
      onClose={onClose}
      title={`${approve ? 'Approve' : 'Reject'} ${rows.length} ${plural}`}
      description={
        approve
          ? 'Each one is decided separately — anything the server refuses is listed afterwards with its reason.'
          : 'The same note is recorded against every record in this batch.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approve ? 'success' : 'danger'}
            loading={pending}
            disabled={!approve && !note.trim()}
            onClick={() => onConfirm(note)}
          >
            {approve ? `Approve ${rows.length}` : `Reject ${rows.length}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-700">
            About to be {approve ? 'approved' : 'rejected'}
          </p>
          <ul className="scrollbar-thin max-h-52 overflow-y-auto rounded-lg border border-ink-100">
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-b border-ink-50 px-3 py-2 text-[13px] text-ink-700 last:border-0"
              >
                {row.label}
              </li>
            ))}
          </ul>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Note for all {rows.length} {approve ? '(optional)' : '(required)'}
          </span>
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="The same note is recorded against every record in this batch."
          />
        </label>
      </div>
    </Modal>
  )
}

function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <Checkbox
      className="mt-1"
      checked={checked}
      onChange={onChange}
      aria-label={`Select ${label}`}
    />
  )
}

/** A picked row has to look picked from across the table, not just at the
    checkbox — the bar acts on all of them at once. */
function selectedCard(selected: boolean): string {
  return cn(
    'px-5 py-4 transition-colors',
    selected && 'border-brand-300 bg-brand-50/50 ring-1 ring-brand-200',
  )
}

function QueueShell({
  isLoading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  isLoading: boolean
  error?: unknown
  isEmpty: boolean
  emptyTitle: string
  emptyDescription?: string
  children: React.ReactNode
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardSkeleton lines={4} />
          </Card>
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <>
        <ErrorNote className="mb-3" message={messageOf(error)} />
        <Card>
          <EmptyState
            title="This queue could not be loaded"
            description="The message above is what the server said. Reload the page to try again."
          />
        </Card>
      </>
    )
  }
  if (isEmpty) {
    return (
      <Card>
        <EmptyState
          icon={<CheckCircle2 className="size-7 text-status-green" />}
          title={emptyTitle}
          description={
            emptyDescription ??
            'Nothing is waiting for a decision. New requests land here as they are submitted.'
          }
        />
      </Card>
    )
  }
  return <ul className="space-y-3">{children}</ul>
}

function CorrectionQueue({ onDecide }: { onDecide: (decision: Decision) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-corrections'],
    queryFn: () =>
      apiGet<Paginated<Correction>>('/corrections', { status: 'PENDING', page_size: 50 }),
  })

  const items = data?.items ?? []
  const rows: BulkRow[] = items.map((item) => ({
    id: item.id,
    label: `${item.user_name} · ${formatDate(item.date)}`,
  }))
  const selection = useBulkSelection(rows)
  const bulk = useBulkDecision({
    url: '/corrections/bulk-decision',
    rows,
    noun: 'correction',
    body: (ids, approve, note) => ({ ids, approve, note }),
    onDone: selection.keepOnly,
  })

  return (
    <>
      {bulk.outcome && <BulkOutcomeNote outcome={bulk.outcome} onDismiss={bulk.dismiss} />}
      {items.length > 0 && (
        <BulkBar total={items.length} noun="correction" selection={selection} bulk={bulk} />
      )}
      <QueueShell
        isLoading={isLoading}
        error={error}
        isEmpty={!items.length}
        emptyTitle="No corrections to review"
      >
        {items.map((item) => (
          <li key={item.id}>
            <Card className={selectedCard(selection.has(item.id))}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <RowCheckbox
                    checked={selection.has(item.id)}
                    onChange={() => selection.toggle(item.id)}
                    label={`${item.user_name}, ${formatDate(item.date)}`}
                  />
                  <div className="min-w-0">
                    <p className="text-[15px] text-ink-900">{item.user_name}</p>
                    <p className="tabular mt-0.5 text-[12px] text-ink-400">
                      {formatDate(item.date)} · {humanise(item.type)} · asked{' '}
                      {relativeTime(item.created_at)}
                    </p>
                    <p className="tabular mt-2 text-[13px] text-ink-700">
                      Requested {formatTime(item.requested_punch_in)} —{' '}
                      {formatTime(item.requested_punch_out)}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-600">“{item.reason}”</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/corrections/${item.id}/reject`,
                        title: 'Reject this correction',
                        detail: `${item.user_name} · ${formatDate(item.date)}`,
                        approve: false,
                        needsNote: true,
                        done: `Correction rejected for ${item.user_name}.`,
                      })
                    }
                  >
                    <X className="size-3.5" aria-hidden />
                    Reject
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/corrections/${item.id}/approve`,
                        title: 'Approve this correction',
                        detail: `${item.user_name}’s ${formatDate(item.date)} will be recalculated from the times they asked for.`,
                        approve: true,
                        done: `Correction approved for ${item.user_name}.`,
                      })
                    }
                  >
                    <Check className="size-3.5" aria-hidden />
                    Approve
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </QueueShell>
    </>
  )
}

function LeaveQueue({ onDecide }: { onDecide: (decision: Decision) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-leave'],
    queryFn: () => apiGet<Paginated<LeaveRequest>>('/leave', { status: 'PENDING', page_size: 50 }),
  })

  const items = data?.items ?? []
  const rows: BulkRow[] = items.map((item) => ({
    id: item.id,
    label: `${item.user_name} · ${item.leave_type_name}`,
  }))
  const selection = useBulkSelection(rows)
  const bulk = useBulkDecision({
    url: '/leave/bulk-decision',
    rows,
    noun: 'request',
    body: (ids, approve, note) => ({ ids, approve, note }),
    onDone: selection.keepOnly,
  })

  return (
    <>
      {bulk.outcome && <BulkOutcomeNote outcome={bulk.outcome} onDismiss={bulk.dismiss} />}
      {items.length > 0 && (
        <BulkBar total={items.length} noun="request" selection={selection} bulk={bulk} />
      )}
      <QueueShell
        isLoading={isLoading}
        error={error}
        isEmpty={!items.length}
        emptyTitle="No leave to review"
      >
        {items.map((item) => (
          <li key={item.id}>
            <Card className={selectedCard(selection.has(item.id))}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <RowCheckbox
                    checked={selection.has(item.id)}
                    onChange={() => selection.toggle(item.id)}
                    label={`${item.user_name}, ${item.leave_type_name}`}
                  />
                  <div className="min-w-0">
                    <p className="text-[15px] text-ink-900">{item.user_name}</p>
                    <p className="tabular mt-0.5 text-[12px] text-ink-400">
                      {item.leave_type_name} · {formatDate(item.from_date)}
                      {item.from_date !== item.to_date && ` — ${formatDate(item.to_date)}`} ·{' '}
                      {item.total_days} day{item.total_days === 1 ? '' : 's'}
                    </p>
                    <p className="mt-2 text-[13px] text-ink-600">“{item.reason}”</p>
                    {item.contact_number && (
                      <p className="tabular mt-1 text-[12px] text-ink-400">
                        Contact: {item.contact_number}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/leave/${item.id}/reject`,
                        title: 'Reject this leave request',
                        detail: `${item.user_name} · ${item.leave_type_name}`,
                        approve: false,
                        needsNote: true,
                        done: `Leave rejected for ${item.user_name}.`,
                      })
                    }
                  >
                    <X className="size-3.5" aria-hidden />
                    Reject
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/leave/${item.id}/approve`,
                        title: 'Approve this leave request',
                        detail: `${item.total_days} day(s) will be deducted from ${item.user_name}'s balance.`,
                        approve: true,
                        done: `Leave approved for ${item.user_name}.`,
                      })
                    }
                  >
                    <Check className="size-3.5" aria-hidden />
                    Approve
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </QueueShell>
    </>
  )
}

function TaskQueue({ onDecide }: { onDecide: (decision: Decision) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-tasks'],
    queryFn: () => apiGet<Paginated<Task>>('/tasks', { status: 'SUBMITTED', page_size: 50 }),
  })

  const items = data?.items ?? []
  const rows: BulkRow[] = items.map((item) => ({
    id: item.id,
    label: `${item.title} · ${item.user_name}`,
  }))
  const selection = useBulkSelection(rows)
  const bulk = useBulkDecision({
    url: '/tasks/bulk-decision',
    rows,
    noun: 'task',
    // Tasks carry three possible verdicts; the bar offers the two that a batch
    // makes sense for. "Ask for changes" stays a per-task conversation.
    body: (ids, approve, note) => ({
      task_ids: ids,
      decision: approve ? 'APPROVED' : 'REJECTED',
      note,
    }),
    onDone: selection.keepOnly,
  })

  return (
    <>
      {bulk.outcome && <BulkOutcomeNote outcome={bulk.outcome} onDismiss={bulk.dismiss} />}
      {items.length > 0 && (
        <BulkBar total={items.length} noun="task" selection={selection} bulk={bulk} />
      )}
      <QueueShell
        isLoading={isLoading}
        error={error}
        isEmpty={!items.length}
        emptyTitle="No tasks to review"
      >
        {items.map((item) => (
          <li key={item.id}>
            <Card className={selectedCard(selection.has(item.id))}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <RowCheckbox
                    checked={selection.has(item.id)}
                    onChange={() => selection.toggle(item.id)}
                    label={item.title}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] text-ink-900">{item.title}</p>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          approvalChip(item.status),
                        )}
                      >
                        {humanise(item.status)}
                      </span>
                    </div>
                    <p className="tabular mt-0.5 text-[12px] text-ink-400">
                      {item.user_name} · {formatDate(item.date)}
                      {item.actual_minutes ? ` · ${formatMinutes(item.actual_minutes)}` : ''}
                      {item.project ? ` · ${item.project}` : ''}
                    </p>
                    {item.description && (
                      <p className="mt-2 text-[13px] text-ink-600">{item.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/tasks/${item.id}/request-changes`,
                        title: 'Ask for changes',
                        detail: item.title,
                        approve: false,
                        needsNote: true,
                        done: `Changes requested on “${item.title}”.`,
                      })
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Ask for changes
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/tasks/${item.id}/reject`,
                        title: 'Reject this task',
                        detail: item.title,
                        approve: false,
                        needsNote: true,
                        done: `Task rejected — “${item.title}”.`,
                      })
                    }
                  >
                    <X className="size-3.5" aria-hidden />
                    Reject
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() =>
                      onDecide({
                        url: `/tasks/${item.id}/approve`,
                        title: 'Approve this task',
                        detail: item.title,
                        approve: true,
                        done: `Task approved — “${item.title}”.`,
                      })
                    }
                  >
                    <Check className="size-3.5" aria-hidden />
                    Approve
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </QueueShell>
    </>
  )
}
