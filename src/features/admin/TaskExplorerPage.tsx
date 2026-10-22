import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import {
  approvalChip,
  formatDate,
  formatDateTime,
  humanise,
  progressChip,
} from '@/lib/format'
import { cn } from '@/lib/cn'
import { refreshApprovalDependents } from '@/lib/refresh'
import {
  Badge,
  Button,
  CalendarSkeleton,
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Select,
  StatTile,
  useToast,
} from '@/components/ui'
import type { Paginated, Task, TaskCalendar, User } from '@/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/*
  One employee, one month, at a glance.

  The grid answers "did they log anything, and did it get finished"; the week
  rows answer "what is rolling into next week". Everything else — the actual
  work — is one click into the day.
*/

export function TaskExplorerPage() {
  const today = new Date()
  const [userId, setUserId] = useState('')
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 })
  const [day, setDay] = useState<string | null>(null)

  /*
    100 is the API's ceiling on `page_size`. Asking for 200 failed validation,
    so this list never arrived, `subject` stayed empty, the calendar query below
    stayed disabled — and the page sat on an empty dropdown and a skeleton
    forever, with the only evidence a 422 in the network tab.
  */
  const { data: people, isLoading: peopleLoading, error: peopleError } = useQuery({
    queryKey: ['employees', 'for-tasks'],
    queryFn: () => apiGet<Paginated<User>>('/users', { page_size: 100, status: 'ACTIVE' }),
  })

  const subject = userId || people?.items[0]?.id || ''

  const { data, isLoading } = useQuery({
    queryKey: ['task-calendar', subject, cursor.year, cursor.month],
    queryFn: () =>
      apiGet<TaskCalendar>('/tasks/calendar', {
        user_id: subject,
        year: cursor.year,
        month: cursor.month,
      }),
    enabled: !!subject,
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
        title="Tasks by employee"
        description="What each person logged, what they finished, and what is carrying over."
        action={
          <Select
            className="w-56"
            aria-label="Whose tasks to show"
            value={subject}
            disabled={peopleLoading || !people?.items.length}
            onChange={(event) => setUserId(event.target.value)}
          >
            {peopleLoading && <option>Loading…</option>}
            {!peopleLoading && !people?.items.length && <option>Nobody to show</option>}
            {people?.items.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || person.email}
              </option>
            ))}
          </Select>
        }
      />

      {peopleError && (
        <ErrorNote
          className="mb-4"
          message={messageOf(peopleError, 'The list of employees could not be loaded.')}
        />
      )}

      {!peopleLoading && !peopleError && !people?.items.length && (
        <Card>
          <EmptyState
            title="Nobody to show"
            description="There are no active employees, so there are no tasks to look at yet."
          />
        </Card>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Logged" value={data?.summary.logged ?? '—'} hint="Tasks raised this month" />
        <StatTile label="Finished" value={data?.summary.completed ?? '—'} tone="green" />
        <StatTile label="Still open" value={data?.summary.still_open ?? '—'} tone="amber" />
        <StatTile
          label="Stale"
          value={data?.summary.stale ?? '—'}
          tone={(data?.summary.stale ?? 0) > 0 ? 'red' : 'neutral'}
          hint={data ? `Open more than ${data.stale_after_days} days` : undefined}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
            <div>
              <h2 className="text-[14px] text-ink-900">{monthLabel}</h2>
              <p className="mt-0.5 text-[11px] text-ink-400">
                Open a day to see the work and approve it
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" onClick={() => step(-1)} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCursor({ year: today.getFullYear(), month: today.getMonth() + 1 })
                }
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
                {data.days.map((entry) => {
                  const complete = entry.total > 0 && entry.done === entry.total
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      onClick={() => setDay(entry.date)}
                      title={
                        `${entry.date} · ${entry.done}/${entry.total} finished` +
                        (entry.carried_in ? ` · ${entry.carried_in} carried in` : '')
                      }
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center rounded-md text-center transition hover:brightness-95',
                        entry.total === 0
                          ? 'bg-ink-50 text-ink-300'
                          : complete
                            ? 'bg-status-green-soft text-status-green'
                            : 'bg-status-blue-soft text-status-blue',
                      )}
                    >
                      <span className="tabular text-[12px] leading-none font-semibold">
                        {Number(entry.date.slice(8, 10))}
                      </span>
                      {entry.total > 0 && (
                        <span className="tabular mt-0.5 text-[9px] leading-none opacity-80">
                          {entry.done}/{entry.total}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="By week" subtitle="Finished, still moving, carried over" />
          {data?.weeks.length ? (
            <ul className="divide-y divide-ink-50">
              {data.weeks.map((week) => (
                <li key={week.from_date} className="px-5 py-3">
                  <p className="tabular text-[12px] text-ink-400">
                    Week {week.week} · {formatDate(week.from_date)} — {formatDate(week.to_date)}
                  </p>
                  <p className="mt-1 flex gap-3 text-[12px]">
                    <span className="text-status-green">{week.completed} done</span>
                    <span className="text-status-blue">{week.in_progress} moving</span>
                    <span className="text-ink-500">{week.carried_forward} carried</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-ink-400">Nothing logged this month.</p>
          )}
        </Card>
      </div>

      <DayTasks userId={subject} date={day} onClose={() => setDay(null)} />
    </>
  )
}

function DayTasks({
  userId,
  date,
  onClose,
}: {
  userId: string
  date: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['task-day', userId, date],
    queryFn: () => apiGet<Task[]>('/tasks/day', { user_id: userId, date }),
    enabled: !!date,
  })

  const approveAll = useMutation({
    mutationFn: (ids: string[]) =>
      apiPost('/tasks/bulk-decision', {
        task_ids: ids,
        status: 'APPROVED',
        note: 'Reviewed together',
      }),
    onSuccess: (_result, ids) => {
      refreshApprovalDependents(queryClient)
      toast.success(`Approved ${ids.length} task${ids.length === 1 ? '' : 's'}.`)
    },
    onError: (mutationError) => {
      const message = messageOf(mutationError, 'Nothing was approved.')
      setError(message)
      toast.error(message)
    },
  })

  if (!date) return null

  const pending = (data ?? []).filter((task) => task.status === 'SUBMITTED')

  return (
    <Modal open onClose={onClose} title={formatDate(date)} description="Everything logged for this day">
      {isLoading ? (
        <CardSkeleton lines={4} />
      ) : !data?.length ? (
        <EmptyState title="Nothing logged" description="No work was recorded on this day." />
      ) : (
        <div className="space-y-3">
          {error && <ErrorNote message={error} />}

          {pending.length > 1 && (
            <Button size="sm" loading={approveAll.isPending} onClick={() => approveAll.mutate(pending.map((task) => task.id))}>
              <CheckCheck className="size-4" />
              Approve all {pending.length}
            </Button>
          )}

          <ul className="space-y-2">
            {data.map((task) => (
              <li key={task.id} className="rounded-lg border border-ink-100 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-[13px] font-medium text-ink-900">{task.title}</span>
                  {/* Two different things, and they get confused constantly:
                      the employee's own word on the work, then the
                      administrator's decision about it. Labelled as such. */}
                  <span
                    title="What the employee says about the work"
                    className={cn('rounded-full px-2 py-0.5 text-[11px]', progressChip(task.progress))}
                  >
                    {humanise(task.progress)}
                  </span>
                  <span
                    title="Your decision on it"
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ring-current/20',
                      approvalChip(task.status),
                    )}
                  >
                    {humanise(task.status)}
                  </span>
                </div>
                {task.description && (
                  <p className="mt-1 text-[12px] text-ink-600">{task.description}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
                  <span className="tabular">Submitted {formatDateTime(task.created_at)}</span>
                  {task.is_carried_forward && (
                    <Badge tone="amber">
                      carried from {formatDate(task.carried_from_date)}
                    </Badge>
                  )}
                  {task.is_stale && <Badge tone="red">stale</Badge>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
