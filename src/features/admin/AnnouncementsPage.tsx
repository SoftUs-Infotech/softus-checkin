import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarClock, MapPin, Megaphone, Pin, Plus } from 'lucide-react'
import { apiDelete, apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate, relativeTime } from '@/lib/format'
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
  Segmented,
  Select,
  Textarea,
  Toolbar,
  useToast,
} from '@/components/ui'
import type { Announcement } from '@/types'

const schema = z
  .object({
    title: z.string().min(3, 'Give it a title.').max(200),
    body: z.string().min(1, 'Write the message.').max(5000),
    type: z.enum(['ANNOUNCEMENT', 'EVENT']),
    event_date: z.string().optional(),
    event_time: z.string().optional(),
    location: z.string().max(200).optional(),
    pinned: z.boolean(),
  })
  .refine((values) => values.type !== 'EVENT' || Boolean(values.event_date), {
    path: ['event_date'],
    message: 'An event needs a date.',
  })

type View = 'all' | 'notices' | 'events' | 'drafts'

const VIEWS: { value: View; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'notices', label: 'Notices' },
  { value: 'events', label: 'Events' },
  { value: 'drafts', label: 'Drafts' },
]

export function AnnouncementsPage() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('all')
  const [deleting, setDeleting] = useState<Announcement | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['announcements', 'admin'],
    queryFn: () =>
      apiGet<Announcement[]>('/announcements', { include_unpublished: true, limit: 100 }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/announcements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      setDeleting(null)
      toast.success('Announcement removed.')
    },
    onError: (mutationError) =>
      toast.error(messageOf(mutationError, 'The announcement was not removed.')),
  })

  // Filtered here rather than on the server: the whole list is already loaded,
  // and a filter that refetches feels slower than one that does not.
  const visible = useMemo(() => {
    const items = data ?? []
    if (view === 'notices') return items.filter((item) => item.type === 'ANNOUNCEMENT')
    if (view === 'events') return items.filter((item) => item.type === 'EVENT')
    if (view === 'drafts') return items.filter((item) => !item.is_published)
    return items
  }, [data, view])

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Notices and events. Publishing sends everyone a notification."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Post an announcement
          </Button>
        }
      />

      {!isLoading && Boolean(data?.length) && (
        <Toolbar>
          <Segmented
            className="max-w-full overflow-x-auto"
            value={view}
            onChange={setView}
            options={VIEWS}
          />
          <span className="tabular text-[12px] text-ink-400">
            {visible.length} of {data?.length}
          </span>
        </Toolbar>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Card>
            <CardSkeleton lines={3} />
          </Card>
          <Card>
            <CardSkeleton lines={3} />
          </Card>
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="size-8" />}
            title="Nothing posted yet"
            description="Post a notice or schedule an event for the team. Everybody sees it on their dashboard."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Post an announcement
              </Button>
            }
          />
        </Card>
      ) : !visible.length ? (
        <Card>
          <EmptyState
            title="Nothing here"
            description="There is nothing of this kind yet."
            action={
              <Button variant="secondary" onClick={() => setView('all')}>
                Show everything
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => (
            <li key={item.id}>
              <Card className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] text-ink-900">{item.title}</h3>
                      {item.pinned && (
                        <Badge tone="brand">
                          <Pin className="size-3" aria-hidden />
                          Pinned
                        </Badge>
                      )}
                      {item.type === 'EVENT' && (
                        <Badge>
                          <CalendarClock className="size-3" aria-hidden />
                          Event
                        </Badge>
                      )}
                      {!item.is_published && <Badge tone="brand">Draft</Badge>}
                    </div>

                    {item.type === 'EVENT' && (item.event_date || item.location) && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-600">
                        {item.event_date && (
                          <span className="tabular inline-flex items-center gap-1">
                            <CalendarClock className="size-3.5 text-ink-400" aria-hidden />
                            {formatDate(item.event_date)}
                            {item.event_time && ` · ${item.event_time}`}
                          </span>
                        )}
                        {item.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5 text-ink-400" aria-hidden />
                            {item.location}
                          </span>
                        )}
                      </p>
                    )}

                    <p className="mt-1.5 text-[13px] whitespace-pre-line text-ink-600">
                      {item.body}
                    </p>

                    <p className="mt-2 text-[11px] text-ink-400">
                      {item.author_name ?? 'Unknown'} ·{' '}
                      <span className="tabular">{relativeTime(item.created_at)}</span>
                      {!item.is_published && ' · not sent to anybody yet'}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-status-red hover:bg-status-red-soft hover:text-status-red"
                    onClick={() => setDeleting(item)}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Remove “${deleting.title}”?` : ''}
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
              Remove announcement
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          {deleting?.is_published
            ? 'It disappears from everybody’s dashboard. The notification already sent cannot be recalled.'
            : 'This draft was never sent, so nobody will notice it going.'}
        </p>
      </Modal>

      <AnnouncementModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function AnnouncementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    defaultValues: { type: 'ANNOUNCEMENT', pinned: false },
  })

  const type = watch('type')

  async function onSubmit(values: z.infer<typeof schema>) {
    setError(null)
    try {
      await apiPost('/announcements', {
        ...values,
        event_date: values.type === 'EVENT' ? values.event_date : null,
        event_time: values.event_time || null,
        location: values.location || null,
      })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      toast.success(type === 'EVENT' ? 'Event posted.' : 'Announcement posted.')
      reset({ type: 'ANNOUNCEMENT', pinned: false })
      onClose()
    } catch (submitError) {
      const message = messageOf(submitError, 'The announcement was not posted.')
      setError(message)
      toast.error(message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post an announcement"
      description="Everyone in the audience gets a notification."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            Post
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <ErrorNote message={error} />}

        <Field
          label="Type"
          hint={
            type === 'EVENT'
              ? 'An event also appears on the calendar with its date.'
              : 'A notice is text only — no date attached.'
          }
          error={errors.type?.message}
        >
          <Select {...register('type')}>
            <option value="ANNOUNCEMENT">Announcement</option>
            <option value="EVENT">Event</option>
          </Select>
        </Field>

        <Field label="Title" error={errors.title?.message} required>
          <Input placeholder="Office closed on Friday" {...register('title')} />
        </Field>

        <Field label="Message" error={errors.body?.message} required>
          <Textarea rows={4} placeholder="Maintenance work in the building." {...register('body')} />
        </Field>

        {type === 'EVENT' && (
          <div className="space-y-3 rounded-lg border border-ink-100 px-3 py-3">
            <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
              When and where
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date" error={errors.event_date?.message} required>
                <Input type="date" className="tabular" {...register('event_date')} />
              </Field>
              <Field label="Time" error={errors.event_time?.message}>
                <Input type="time" className="tabular" {...register('event_time')} />
              </Field>
            </div>
            <Field label="Where" error={errors.location?.message}>
              <Input placeholder="Main hall" {...register('location')} />
            </Field>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-ink-900"
            {...register('pinned')}
          />
          <span>
            <span className="block text-[13px] text-ink-800">Pin to the top of the dashboard</span>
            <span className="block text-[12px] text-ink-400">
              Pinned notices sit above everything else until you unpin them.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}
