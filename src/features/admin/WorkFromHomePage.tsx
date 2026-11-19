import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, House, Images, Trash2 } from 'lucide-react'
import { apiGet, apiPost, messageOf, resolveApiUrl } from '@/lib/api'
import { formatDate, formatTime, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  PageHeader,
  StatTile,
  useToast,
} from '@/components/ui'
import { windowFor } from '@/lib/activity'
import { ActivitySummary, ShotActivity } from './ActivityPanel'
import { AppLogPanel } from './AppLogPanel'
import type {
  ActivityDay,
  Screenshot,
  ScreenshotDay,
  ScreenshotDeleteResult,
  ScreenshotPerson,
  ScreenshotSummary,
} from '@/types'

/** `1536000` → `1.5 MB`. Storage is what this page exists to keep in check. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** What a delete will do, said before it is done. */
type DeleteIntent =
  | { kind: 'ids'; ids: string[]; label: string }
  | { kind: 'day'; userId: string; date: string; label: string }
  | { kind: 'everything'; label: string }

/*
  Everybody working from home, and what their screen showed while they were
  punched in. Screenshots exist to be looked at and then deleted: the page
  leads with what is stored and how much space it takes, and every view has a
  way to clear what it shows.
*/
export function WorkFromHomePage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState(todayKey())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [viewing, setViewing] = useState<number | null>(null)
  const [confirming, setConfirming] = useState<DeleteIntent | null>(null)

  const summary = useQuery({
    queryKey: ['screenshots', 'summary', date],
    queryFn: () => apiGet<ScreenshotSummary>('/screenshots/summary', { date }),
  })

  const people = useMemo(() => summary.data?.people ?? [], [summary.data])
  const selected = people.find((person) => person.id === selectedId) ?? null

  // Open on somebody rather than an empty panel: the first person working from home.
  useEffect(() => {
    if (!selected && people.length) setSelectedId(people[0].id)
  }, [selected, people])

  // A selection belongs to what was on screen when it was made.
  useEffect(() => {
    setPicked(new Set())
    setViewing(null)
  }, [selectedId, date])

  const shots = useQuery({
    queryKey: ['screenshots', 'list', selectedId, date],
    queryFn: () => apiGet<Screenshot[]>('/screenshots', { user_id: selectedId, date }),
    enabled: Boolean(selectedId),
    // Links expire; a gallery left open should not end up full of broken images.
    refetchInterval: 10 * 60_000,
  })

  const days = useQuery({
    queryKey: ['screenshots', 'days', selectedId],
    queryFn: () => apiGet<ScreenshotDay[]>('/screenshots/days', { user_id: selectedId }),
    enabled: Boolean(selectedId),
  })

  const activity = useQuery({
    queryKey: ['activity', 'day', selectedId, date],
    queryFn: () => apiGet<ActivityDay>('/activity/day', { user_id: selectedId, date }),
    enabled: Boolean(selectedId),
    refetchInterval: 60_000,
  })

  const remove = useMutation({
    mutationFn: (intent: DeleteIntent) =>
      apiPost<ScreenshotDeleteResult>(
        '/screenshots/delete',
        intent.kind === 'ids'
          ? { ids: intent.ids }
          : intent.kind === 'day'
            ? { user_id: intent.userId, date: intent.date }
            : { everything: true },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['screenshots'] })
      setPicked(new Set())
      setViewing(null)
      setConfirming(null)
      if (result.failed) {
        toast.error(
          `${plural(result.deleted, 'screenshot')} deleted; ${result.failed} could not be removed from storage and were kept.`,
        )
      } else {
        toast.success(
          `${plural(result.deleted, 'screenshot')} deleted, ${formatBytes(result.freed_bytes)} freed.`,
        )
      }
    },
    onError: (error) => toast.error(messageOf(error, 'The screenshots were not deleted.')),
  })

  const list = shots.data ?? []
  const pickedBytes = list
    .filter((shot) => picked.has(shot.id))
    .reduce((sum, shot) => sum + shot.size_bytes, 0)
  const dayBytes = list.reduce((sum, shot) => sum + shot.size_bytes, 0)
  const totals = summary.data?.totals

  function togglePick(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="Work from home"
        description="Who works from home, and what their screen showed while they were punched in. Review the screenshots, then delete them so they stop taking space."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="Day"
              className="tabular w-auto"
              value={date}
              max={todayKey()}
              onChange={(event) => setDate(event.target.value || todayKey())}
            />
            <Button
              variant="danger"
              disabled={!totals?.count}
              onClick={() =>
                setConfirming({
                  kind: 'everything',
                  label: `every stored screenshot — ${plural(totals?.count ?? 0, 'screenshot')}, ${formatBytes(totals?.size_bytes ?? 0)} — for everybody, on every day`,
                })
              }
            >
              <Trash2 className="size-4" />
              Delete all screenshots
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Working from home"
          value={<span className="tabular">{totals?.people_wfh ?? '—'}</span>}
          hint={
            summary.data
              ? `A screenshot every ${summary.data.interval_minutes} minutes, at a random moment.`
              : undefined
          }
        />
        <StatTile
          label={`Screenshots on ${date === todayKey() ? 'today' : formatDate(date)}`}
          value={<span className="tabular">{totals?.on_day ?? '—'}</span>}
        />
        <StatTile
          label="Stored in total"
          value={<span className="tabular">{totals ? formatBytes(totals.size_bytes) : '—'}</span>}
          hint={totals ? <span className="tabular">{plural(totals.count, 'screenshot')}</span> : undefined}
        />
      </div>

      {summary.error && <ErrorNote className="mb-5" message={messageOf(summary.error)} />}

      {summary.isLoading ? (
        <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
          <Card>
            <CardSkeleton lines={5} />
          </Card>
          <Card>
            <CardSkeleton lines={8} />
          </Card>
        </div>
      ) : people.length === 0 ? (
        <Card>
          <EmptyState
            icon={<House className="size-6" />}
            title="Nobody works from home yet"
            description="Open an employee and set their mode of work to Work from home. Their screenshots will appear here once they punch in."
            action={
              <Link to="/admin/employees">
                <Button variant="secondary">Go to Employees</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[340px_1fr]">
          <Card>
            <CardHeader title="People" subtitle="Working from home, and anyone with screenshots still stored." />
            <ul className="divide-y divide-rule">
              {people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  active={person.id === selectedId}
                  onSelect={() => setSelectedId(person.id)}
                />
              ))}
            </ul>
          </Card>

          {selected && (
            <Card>
              <CardHeader
                title={`${selected.full_name} · ${formatDate(date)}`}
                subtitle={
                  shots.data
                    ? list.length
                      ? `${plural(list.length, 'screenshot')}, ${formatBytes(dayBytes)}`
                      : 'No screenshots on this day.'
                    : undefined
                }
                action={
                  <div className="flex flex-wrap gap-2">
                    {picked.size > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setConfirming({
                            kind: 'ids',
                            ids: [...picked],
                            label: `${plural(picked.size, 'selected screenshot')} of ${selected.full_name} (${formatBytes(pickedBytes)})`,
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                        Delete selected ({picked.size})
                      </Button>
                    )}
                    {list.length > 0 && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPicked(
                              picked.size === list.length
                                ? new Set()
                                : new Set(list.map((shot) => shot.id)),
                            )
                          }
                        >
                          {picked.size === list.length ? 'Clear selection' : 'Select all'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setConfirming({
                              kind: 'day',
                              userId: selected.id,
                              date,
                              label: `all ${plural(list.length, 'screenshot')} of ${selected.full_name} on ${formatDate(date)} (${formatBytes(dayBytes)})`,
                            })
                          }
                        >
                          Delete this day
                        </Button>
                      </>
                    )}
                  </div>
                }
              />

              {(days.data?.length ?? 0) > 0 && (
                <div className="scrollbar-thin flex gap-1.5 overflow-x-auto border-b border-rule px-5 py-3">
                  {days.data!.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setDate(day.date)}
                      className={cn(
                        'tabular shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                        day.date === date
                          ? 'border-ink-900 bg-ink-900 text-white'
                          : 'border-ink-200 text-ink-600 hover:border-ink-400',
                      )}
                      title={`${plural(day.count, 'screenshot')}, ${formatBytes(day.size_bytes)}`}
                    >
                      {formatDate(day.date)} · {day.count}
                    </button>
                  ))}
                </div>
              )}

              <ActivitySummary day={activity.data} />
              {selectedId && <AppLogPanel userId={selectedId} date={date} />}

              <div className="px-5 py-4">
                {shots.error && <ErrorNote className="mb-3" message={messageOf(shots.error)} />}
                {shots.isLoading ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                    {Array.from({ length: 8 }, (_, index) => (
                      <div key={index} className="aspect-video animate-pulse rounded-lg bg-ink-50" />
                    ))}
                  </div>
                ) : list.length === 0 ? (
                  <EmptyState
                    icon={<Images className="size-6" />}
                    title="Nothing on this day"
                    description={
                      selected.work_mode === 'WFH'
                        ? 'Screenshots are taken only while they are punched in with their screen shared.'
                        : 'They work from the office now; only older screenshots remain.'
                    }
                  />
                ) : (
                  <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                    {list.map((shot, index) => (
                      <li key={shot.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => setViewing(index)}
                          className={cn(
                            'block w-full overflow-hidden rounded-lg border bg-ink-50 transition-colors',
                            picked.has(shot.id) ? 'border-ink-900 ring-1 ring-ink-900' : 'border-rule hover:border-ink-300',
                          )}
                        >
                          <img
                            src={resolveApiUrl(shot.url)}
                            alt={`Screen at ${formatTime(shot.captured_at)}`}
                            loading="lazy"
                            className="aspect-video w-full object-cover object-top"
                          />
                        </button>
                        <label
                          className={cn(
                            'absolute top-2 left-2 grid size-6 cursor-pointer place-items-center rounded-md bg-white/90 shadow-sm transition-opacity',
                            picked.has(shot.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-ink-900"
                            checked={picked.has(shot.id)}
                            onChange={() => togglePick(shot.id)}
                            aria-label={`Select the screenshot at ${formatTime(shot.captured_at)}`}
                          />
                        </label>
                        <p className="tabular mt-1 flex justify-between text-[12px] text-ink-500">
                          <span>{formatTime(shot.captured_at)}</span>
                          <span className="text-ink-400">{formatBytes(shot.size_bytes)}</span>
                        </p>
                        <ShotActivity window={windowFor(activity.data, shot)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {viewing !== null && list[viewing] && selected && (
        <Viewer
          shots={list}
          index={viewing}
          name={selected.full_name}
          onMove={setViewing}
          onClose={() => setViewing(null)}
          onDelete={(shot) =>
            setConfirming({
              kind: 'ids',
              ids: [shot.id],
              label: `the screenshot of ${selected.full_name} at ${formatTime(shot.captured_at)}`,
            })
          }
        />
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Delete screenshots?"
        description="Deleted screenshots are removed from storage and cannot be recovered."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => confirming && remove.mutate(confirming)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          This deletes {confirming?.label}. The deletion is recorded in the audit trail.
        </p>
      </Modal>
    </div>
  )
}

function PersonRow({
  person,
  active,
  onSelect,
}: {
  person: ScreenshotPerson
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-3 px-5 py-3 text-left transition-colors',
          active ? 'bg-ink-50' : 'hover:bg-ink-50/60',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium text-ink-900">{person.full_name}</span>
            {person.removed ? (
              <Badge>Removed</Badge>
            ) : person.work_mode !== 'WFH' ? (
              <Badge>Back in office</Badge>
            ) : null}
          </span>
          <span className="block truncate text-[12px] text-ink-400">
            {[person.employee_code, person.designation, person.department].filter(Boolean).join(' · ') ||
              person.email}
          </span>
          <span className="mt-1 block text-[12px] text-ink-500">
            {person.last_captured_at
              ? `Last screenshot ${formatDate(person.last_captured_at)}, ${formatTime(person.last_captured_at)}`
              : 'No screenshots yet'}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-[15px] font-semibold text-ink-900">{person.on_day}</span>
          <span className="tabular block text-[11px] text-ink-400">{formatBytes(person.total_bytes)}</span>
        </span>
      </button>
    </li>
  )
}

/** One screenshot at full width, with the ones either side a key press away. */
function Viewer({
  shots,
  index,
  name,
  onMove,
  onClose,
  onDelete,
}: {
  shots: Screenshot[]
  index: number
  name: string
  onMove: (index: number) => void
  onClose: () => void
  onDelete: (shot: Screenshot) => void
}) {
  const shot = shots[index]
  const hasPrevious = index > 0
  const hasNext = index < shots.length - 1

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' && hasPrevious) onMove(index - 1)
      if (event.key === 'ArrowRight' && hasNext) onMove(index + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [index, hasPrevious, hasNext, onMove])

  const src = resolveApiUrl(shot.url)

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${name} · ${formatTime(shot.captured_at)}`}
      description={`${index + 1} of ${shots.length} on ${formatDate(shot.date)}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!hasPrevious} onClick={() => onMove(index - 1)}>
              <ChevronLeft className="size-4" />
              Earlier
            </Button>
            <Button variant="secondary" size="sm" disabled={!hasNext} onClick={() => onMove(index + 1)}>
              Later
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <a href={src} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">
                Open full size
              </Button>
            </a>
            <Button variant="danger" size="sm" onClick={() => onDelete(shot)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      }
    >
      <img src={src} alt={`${name}'s screen at ${formatTime(shot.captured_at)}`} className="w-full rounded-lg border border-rule" />
    </Modal>
  )
}
