import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ClipboardList, CornerDownRight, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatDate, formatMinutes, humanise, relativeTime, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
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
  Textarea,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { Paginated, Task, TaskProgress, TaskStatus } from '@/types'

const PROGRESS: TaskProgress[] = ['TO_DO', 'IN_PROGRESS', 'DONE', 'BLOCKED']

/* The two axes of a task are constantly confused, so they are named in full
   wherever they appear: one is the employee's own word on the work, the other
   is a decision somebody else made about the record. */
const MINE_LABEL = 'My progress'
const THEIRS_LABEL = 'Administrator’s decision'

/**
 * Approval statuses borrow the status palette only to mean approved, refused
 * or waiting — the same meanings the calendar legend carries. `brand` is the
 * ink ramp, and it is the right answer for "waiting": no verdict has been
 * reached, so there is nothing yet to colour in.
 */
function approvalTone(status: TaskStatus | string): BadgeTone {
  switch (status) {
    case 'APPROVED':
      return 'green'
    case 'REJECTED':
      return 'red'
    case 'CHANGES_REQUESTED':
      return 'amber'
    default:
      return 'brand'
  }
}

/*
  Progress is a real state of the work, so it is drawn from the status palette
  rather than from grey: blue reads as under way, green as finished, red as
  stopped. `TO_DO` is the one that has genuinely not started, and it stays ink.

  This is deliberately not `progressChip` from `lib/format` — that one still
  tints "in progress" with the emphasis ramp, which is now achromatic and reads
  as "nothing is happening here".
*/
const PROGRESS_CHIP: Record<TaskProgress, string> = {
  TO_DO: 'bg-white text-ink-700 ring-1 ring-ink-300',
  IN_PROGRESS: 'bg-status-blue-soft text-status-blue',
  DONE: 'bg-status-green-soft text-status-green',
  BLOCKED: 'bg-status-red-soft text-status-red',
}

const schema = z.object({
  date: z.string().min(1, 'Choose the day.'),
  title: z.string().min(3, 'Give the task a short title.').max(200),
  description: z.string().max(5000).optional(),
  actual_minutes: z.coerce.number().int().min(0).max(1440).optional(),
  project: z.string().max(100).optional(),
})

// `z.coerce` means the form reads strings and the handler receives numbers.
type Input = z.input<typeof schema>
type Values = z.output<typeof schema>

export function TasksPage() {
  const [open, setOpen] = useState(false)
  const [commenting, setCommenting] = useState<Task | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tasks-mine'],
    queryFn: () => apiGet<Paginated<Task>>('/tasks/mine', { page_size: 50 }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks-mine'] })
      toast.success('Task removed.')
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The task was not removed.')),
  })

  const setProgress = useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: TaskProgress }) =>
      apiPatch(`/tasks/${id}/progress`, { progress }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks-mine'] })
      toast.success(`Progress set to ${humanise(variables.progress).toLowerCase()}.`)
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'Your progress was not saved.')),
  })

  return (
    <>
      <PageHeader
        title="Daily tasks"
        description="What you worked on, how far along you are, and what your administrator said about it."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Log a task
          </Button>
        }
      />

      {isError && (
        <ErrorNote
          className="mb-4"
          message={messageOf(error, 'Your tasks could not be loaded. Try again in a moment.')}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <CardSkeleton lines={3} />
            </Card>
          ))}
        </div>
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-8" />}
            title="No tasks logged yet"
            description="Record what you worked on today. Anything you leave unfinished carries forward to tomorrow on its own."
            action={<Button onClick={() => setOpen(true)}>Log a task</Button>}
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.items.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={task}
                onComment={() => setCommenting(task)}
                onRemove={() => remove.mutate(task.id)}
                onProgress={(progress) => setProgress.mutate({ id: task.id, progress })}
                busy={setProgress.isPending}
              />
            </li>
          ))}
        </ul>
      )}

      <TaskModal open={open} onClose={() => setOpen(false)} />
      {commenting && <TimelineModal task={commenting} onClose={() => setCommenting(null)} />}
    </>
  )
}

function TaskCard({
  task,
  onComment,
  onRemove,
  onProgress,
  busy,
}: {
  task: Task
  onComment: () => void
  onRemove: () => void
  onProgress: (progress: TaskProgress) => void
  busy: boolean
}) {
  const daysOpen = task.days_open ?? 0

  return (
    <Card className="overflow-hidden">
      {/*
        A carried task is not a new task, and reading it as one is how work
        quietly goes missing. The strip says where it came from and how long it
        has been open — in ink, not in a status colour, because being carried is
        a fact about the record and not a verdict on the person.
      */}
      {task.is_carried_forward && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-rule bg-ink-50 px-4 py-2 text-[12px] text-ink-500 sm:px-5">
          <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
          <span>
            Carried forward from{' '}
            <span className="tabular text-ink-700">{formatDate(task.carried_from_date)}</span>
          </span>
          {daysOpen > 0 && (
            <span className={cn(task.is_stale ? 'font-medium text-ink-900' : 'text-ink-500')}>
              · open <span className="tabular">{daysOpen}</span>{' '}
              {daysOpen === 1 ? 'day' : 'days'}
            </span>
          )}
        </p>
      )}

      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] leading-snug font-semibold text-ink-900">{task.title}</h3>
            <p className="tabular mt-1 text-[12px] text-ink-400">
              {formatDate(task.date)}
              {task.project ? ` · ${task.project}` : ''}
              {task.actual_minutes ? ` · ${formatMinutes(task.actual_minutes)}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onComment}
              aria-label={`Notes on ${task.title}`}
            >
              <MessageSquare className="size-3.5" aria-hidden />
              {/* Notes only: every task opens with a "created" entry, and counting
                  it put a 1 on the speech bubble of a task nobody had replied to. */}
              <span className="tabular">{task.timeline.filter((entry) => entry.note).length}</span>
            </Button>
            {task.status !== 'APPROVED' && (
              <Button variant="ghost" size="sm" aria-label={`Remove ${task.title}`} onClick={onRemove}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {task.description && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-600">{task.description}</p>
        )}

        {/*
          The two axes, side by side and labelled. Progress is the employee's to
          set on any day, whatever the administrator has decided; the decision
          is read-only here. Keeping them in one row, under one rule, is what
          stops the two being read as the same thing.
        */}
        <div className="mt-4 grid gap-3 border-t border-rule pt-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
              {MINE_LABEL}
            </p>
            <div
              role="group"
              aria-label={MINE_LABEL}
              className="mt-1.5 inline-flex flex-wrap gap-0.5 rounded-lg border border-rule bg-ink-50 p-0.5"
            >
              {PROGRESS.map((progress) => {
                const selected = task.progress === progress
                return (
                  <button
                    key={progress}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy || selected}
                    onClick={() => onProgress(progress)}
                    className={cn(
                      'rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-default',
                      selected
                        ? PROGRESS_CHIP[progress]
                        : 'text-ink-400 hover:bg-white hover:text-ink-800',
                    )}
                  >
                    {humanise(progress)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sm:text-right">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
              {THEIRS_LABEL}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge tone={approvalTone(task.status)}>{humanise(task.status)}</Badge>
              {task.reviewed_at && (
                <span className="tabular text-[11px] text-ink-400">
                  {relativeTime(task.reviewed_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {task.timeline.length > 1 && (
          <Timeline entries={task.timeline.slice(-2)} className="mt-3" />
        )}
      </div>
    </Card>
  )
}

function Timeline({
  entries,
  className,
}: {
  entries: Task['timeline']
  className?: string
}) {
  return (
    <ol className={cn('space-y-1.5 border-t border-rule pt-3', className)}>
      {entries.map((entry, index) => (
        <li key={index} className="flex items-start gap-2 text-[12px]">
          <span className="mt-[7px] h-px w-2 shrink-0 bg-ink-300" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="text-ink-700">
              <span className="font-medium">{entry.actor_name}</span> {humanise(entry.action).toLowerCase()}
            </span>
            {entry.note && <span className="mt-0.5 block text-ink-500">“{entry.note}”</span>}
          </span>
          <span className="tabular shrink-0 text-ink-300">{relativeTime(entry.at)}</span>
        </li>
      ))}
    </ol>
  )
}

function TimelineModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const comment = useMutation({
    mutationFn: () => apiPost(`/tasks/${task!.id}/comment`, { note }),
    onSuccess: () => {
      setNote('')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['tasks-mine'] })
      toast.success('Note added.')
      onClose()
    },
    onError: (mutationError) => setError(messageOf(mutationError, 'Your note was not added.')),
  })

  if (!task) return null

  return (
    <Modal open onClose={onClose} title={task.title} description={formatDate(task.date)}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-rule bg-ink-50 px-3 py-2 text-[12px]">
        <span className="text-ink-500">
          {MINE_LABEL}:{' '}
          <span className="font-medium text-ink-800">{humanise(task.progress)}</span>
        </span>
        <span className="text-ink-500">
          {THEIRS_LABEL}:{' '}
          <span className="font-medium text-ink-800">{humanise(task.status)}</span>
        </span>
      </div>

      {task.timeline.length ? (
        <Timeline entries={task.timeline} className="border-t-0 pt-0" />
      ) : (
        <p className="text-[13px] text-ink-400">
          Nothing has been said about this task yet. Add a note if there is something worth
          flagging.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {error && <ErrorNote message={error} />}
        <Textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note to this task…"
          aria-label="Note"
        />
        <Button
          size="sm"
          disabled={!note.trim()}
          loading={comment.isPending}
          onClick={() => comment.mutate()}
        >
          Add note
        </Button>
      </div>
    </Modal>
  )
}

function TaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayKey(), title: '', description: '' },
  })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await apiPost('/tasks', {
        ...values,
        actual_minutes: values.actual_minutes || null,
        project: values.project || null,
        description: values.description || null,
      })
      queryClient.invalidateQueries({ queryKey: ['tasks-mine'] })
      reset({ date: todayKey(), title: '', description: '' })
      toast.success('Task logged.')
      onClose()
    } catch (error) {
      setFormError(messageOf(error, 'Your task was not saved.'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a task"
      description="Describe what you worked on. Your administrator will review it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Save task
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Day" error={errors.date?.message} required>
            <Input type="date" max={todayKey()} {...register('date')} />
          </Field>
          <Field label="Time spent (minutes)" error={errors.actual_minutes?.message}>
            <Input type="number" min={0} max={1440} placeholder="300" {...register('actual_minutes')} />
          </Field>
        </div>

        <Field label="Title" error={errors.title?.message} required>
          <Input placeholder="Implemented the punch widget" {...register('title')} />
        </Field>

        <Field label="Project" error={errors.project?.message}>
          <Input placeholder="Attendance" {...register('project')} />
        </Field>

        <Field label="Details" error={errors.description?.message}>
          <Textarea rows={4} placeholder="What you did, and anything worth flagging." {...register('description')} />
        </Field>

        <p className="text-[12px] text-ink-400">
          You set your own progress after saving. Anything still open at the end of the day is
          carried forward to the next one automatically.
        </p>
      </form>
    </Modal>
  )
}
