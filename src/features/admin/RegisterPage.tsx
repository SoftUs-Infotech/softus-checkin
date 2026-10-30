import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { http, apiGet, apiPut, messageOf, type ApiEnvelope } from '@/lib/api'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  MapPin,
  Monitor,
  Search,
  Smartphone,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  STATUS_ORDER,
  formatDate,
  formatMinutes,
  formatTime,
  humanise,
  orgWallClockToIso,
  todayKey,
} from '@/lib/format'
import { cn } from '@/lib/cn'
import { refreshApprovalDependents } from '@/lib/refresh'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Textarea,
  Th,
  Toolbar,
  Tr,
  Field,
  useToast,
} from '@/components/ui'
import type { AttendanceDay, RegisterMeta } from '@/types'

type SortColumn = 'employee' | 'worked_minutes' | 'first_punch_in'
type SortDirection = 'asc' | 'desc'

/**
 * A shift is a planned window for a piece of work. When it lapses the person
 * can still punch, and the server flags the day so the administrator knows the
 * window they planned ran out while the work did not. It is a planning signal,
 * not a fault, so it is never drawn in a status colour.
 */
type RegisterRow = AttendanceDay & { no_shift_assigned?: boolean }

/*
  The muster mark.

  A register carries one letter per person per day, and the letter is the whole
  record: P is present, A is absent, the column of them is the month. The word
  is kept alongside for anybody who cannot see the colour or the shape of it.
*/
const MARKS: Record<string, { mark: string; word: string }> = {
  PRESENT: { mark: 'P', word: 'Present' },
  HALF_DAY: { mark: '½', word: 'Half day' },
  SHORT_HOURS: { mark: 'S', word: 'Short hours' },
  IN_PROGRESS: { mark: '/', word: 'Still working' },
  MISSING_PUNCH_OUT: { mark: '!', word: 'Never punched out' },
  ABSENT: { mark: 'A', word: 'Absent' },
  ON_LEAVE: { mark: 'L', word: 'On leave' },
  HOLIDAY: { mark: 'H', word: 'Holiday' },
  WEEKEND: { mark: '—', word: 'Weekly off' },
  NOT_STARTED: { mark: '·', word: 'Not started' },
  UPCOMING: { mark: '·', word: 'Upcoming' },
  BEFORE_JOINING: { mark: '', word: 'Before joining' },
  NOT_TRACKED: { mark: '', word: 'Not tracked' },
}

/* The mark is written in the legend's ink and nothing else in this page is. */
const MARK_INK: Record<string, string> = {
  green: 'text-status-green',
  amber: 'text-status-amber',
  red: 'text-status-red',
  violet: 'text-status-violet',
  yellow: 'text-status-yellow',
  blue: 'text-status-blue',
  grey: 'text-status-grey',
}

/** The statuses that put somebody on the premises — what a column foot counts. */
const ATTENDED = new Set([
  'PRESENT',
  'HALF_DAY',
  'SHORT_HOURS',
  'IN_PROGRESS',
  'MISSING_PUNCH_OUT',
])

function markOf(row: AttendanceDay): { mark: string; word: string } {
  return MARKS[row.status] ?? { mark: row.status.charAt(0), word: row.status_label }
}

/** `2026-03-09` → `09` and `M`, for the head of a day column. */
function dayHead(iso: string): { number: string; weekday: string } {
  const date = new Date(`${iso}T12:00:00Z`)
  return {
    number: iso.slice(8, 10),
    weekday: date.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'narrow' }),
  }
}

function isWeekendish(row: RegisterRow | undefined): boolean {
  return row?.status === 'WEEKEND' || row?.status === 'HOLIDAY'
}

interface Filters {
  mode: 'day' | 'range'
  day: string
  fromDate: string
  toDate: string
  search: string
  department: string
  status: string
  exceptionsOnly: boolean
}

function emptyFilters(): Filters {
  return {
    mode: 'day',
    day: todayKey(),
    fromDate: todayKey(),
    toDate: todayKey(),
    search: '',
    department: '',
    status: '',
    exceptionsOnly: false,
  }
}

/**
 * A search box that fires on every keystroke would ask the server for a register
 * per letter. The value the query uses lags the value the field shows.
 */
function useDebounced(value: string, delay = 350): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function RegisterPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [sort, setSort] = useState<SortColumn | ''>('')
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [adjusting, setAdjusting] = useState<AttendanceDay | null>(null)
  // Several days of one person per row is the shape the paper register had, and
  // it is still the densest way to read a fortnight. The list stays available
  // because it is the only view that shows where a punch came from.
  const [rangeView, setRangeView] = useState<'grid' | 'rows'>('grid')

  const search = useDebounced(filters.search)
  const ranged = filters.mode === 'range'

  function update(changes: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...changes }))
  }

  const params = {
    day: ranged ? undefined : filters.day,
    from_date: ranged ? filters.fromDate : undefined,
    to_date: ranged ? filters.toDate : undefined,
    search: search.trim() || undefined,
    department: filters.department || undefined,
    status: filters.status || undefined,
    exceptions_only: filters.exceptionsOnly || undefined,
    sort: sort || undefined,
    direction: sort ? direction : undefined,
  }

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['register', params],
    // Read through the envelope rather than the usual helper: the register's
    // meta is what tells an empty screen which kind of empty it is.
    queryFn: async () => {
      const response = await http.get<ApiEnvelope<AttendanceDay[]>>('/attendance/register', {
        params,
      })
      return {
        rows: response.data.data,
        meta: (response.data.meta ?? null) as RegisterMeta | null,
      }
    },
  })

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => apiGet<string[]>('/users/departments'),
  })

  const rows: RegisterRow[] = data?.rows ?? []
  const meta = data?.meta ?? null

  const active = useMemo(() => activeFilters(filters, search), [filters, search])
  const filtered = active.length > 0

  const counts = rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.status] = (accumulator[row.status] ?? 0) + 1
    return accumulator
  }, {})

  // Purely a reshaping of the rows already in hand — one row per employee, one
  // column per day, in the order the server sent them.
  const muster = useMemo(() => buildMuster(rows), [rows])
  const grid = ranged && rangeView === 'grid'

  function toggleSort(column: SortColumn) {
    if (sort !== column) {
      setSort(column)
      setDirection('asc')
      return
    }
    setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
  }

  function clearEverything() {
    setFilters(emptyFilters())
    setSort('')
    setDirection('asc')
  }

  const columnCount = ranged ? 9 : 8

  return (
    <>
      <PageHeader
        title="Daily register"
        description="Where everyone stands on a given day — or across a stretch of them."
      />

      {/* One bar, one order: what you are looking for, then who, then when.
          The search box sits first here as it does on every other list. */}
      <Toolbar className="mb-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-300"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Search by name, email or employee code"
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            aria-label="Search the register"
          />
        </div>

        <Select
          className="w-44"
          value={filters.department}
          onChange={(event) => update({ department: event.target.value })}
          aria-label="Department"
        >
          <option value="">All departments</option>
          {departments.data?.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </Select>

        <Select
          className="w-44"
          value={filters.status}
          onChange={(event) => update({ status: event.target.value })}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {humanise(status)}
            </option>
          ))}
        </Select>

        {/* Deliberately not a status colour: "needs attention" is a question
            about the day, not one of the calendar's verdicts on it. */}
        <button
          type="button"
          onClick={() => update({ exceptionsOnly: !filters.exceptionsOnly })}
          aria-pressed={filters.exceptionsOnly}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            filters.exceptionsOnly
              ? 'border-ink-900 bg-ink-900 text-white'
              : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
          )}
        >
          <TriangleAlert className="size-4" aria-hidden />
          Exceptions only
        </button>
      </Toolbar>

      <Toolbar className="mb-4">
        <Segmented
          value={filters.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { value: 'day', label: 'One day' },
            { value: 'range', label: 'Range' },
          ]}
        />
        {ranged ? (
          <>
            <Input
              type="date"
              className="w-40"
              value={filters.fromDate}
              max={filters.toDate}
              onChange={(event) => update({ fromDate: event.target.value })}
              aria-label="From"
            />
            <span className="text-[13px] text-ink-400">to</span>
            <Input
              type="date"
              className="w-40"
              value={filters.toDate}
              max={todayKey()}
              onChange={(event) => update({ toDate: event.target.value })}
              aria-label="To"
            />
            <Segmented
              value={rangeView}
              onChange={setRangeView}
              options={[
                { value: 'grid', label: 'Muster grid' },
                { value: 'rows', label: 'One row per day' },
              ]}
            />
          </>
        ) : (
          <Input
            type="date"
            className="w-44"
            value={filters.day}
            max={todayKey()}
            onChange={(event) => update({ day: event.target.value })}
            aria-label="Day"
          />
        )}

        {filtered && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-400">Filtered by</span>
            {active.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[12px] font-medium text-ink-800"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove ${chip.label}`}
                  onClick={() => update(chip.clear)}
                  className="rounded-full p-0.5 hover:bg-ink-200"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={clearEverything}>
              Clear all
            </Button>
          </div>
        )}
      </Toolbar>

      {/* The tally at the foot of a register page, moved to the top because it
          is also the way into each slice of it. Mark, word, figure. */}
      {!filtered && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-stretch divide-x divide-rule overflow-hidden rounded-lg border border-rule bg-white">
          {Object.entries(counts).map(([status, count]) => {
            const example = rows.find((row) => row.status === status)
            const legend = MARKS[status] ?? {
              mark: status.charAt(0),
              word: example?.status_label ?? humanise(status),
            }
            return (
              <button
                key={status}
                type="button"
                onClick={() => update({ status })}
                title={`Show only ${legend.word.toLowerCase()}`}
                className="flex items-baseline gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-ink-50"
              >
                <span
                  aria-hidden
                  className={cn(
                    'mark text-[13px]',
                    MARK_INK[example?.color ?? 'grey'] ?? MARK_INK.grey,
                  )}
                >
                  {legend.mark}
                </span>
                <span className="text-ink-500">{example?.status_label ?? legend.word}</span>
                <span className="tabular font-semibold text-ink-900">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {error && <ErrorNote className="mb-4" message={messageOf(error)} />}

      {meta?.truncated && (
        <p className="tabular mb-3 text-[12px] text-ink-400">
          Showing the first {meta.returned} of {meta.total} rows. Narrow the range or the
          filters to see the rest.
        </p>
      )}

      {/* The note above already carries the server's wording; an empty card
          underneath it would read as a second, emptier answer. */}
      {!error && (
        <Card>
          {isLoading ? (
            <TableSkeleton rows={8} columns={columnCount} />
          ) : !rows.length ? (
            <RegisterEmpty
              filters={filters}
              search={search}
              active={active}
              meta={meta}
              onClear={clearEverything}
            />
          ) : (
            <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
              {grid ? (
                <MusterGrid
                  muster={muster}
                  sort={sort}
                  direction={direction}
                  onSort={toggleSort}
                  onAdjust={setAdjusting}
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-10 px-0 text-center">
                        <abbr title="Muster mark" className="no-underline">
                          Mk
                        </abbr>
                      </Th>
                      <SortHeader
                        column="employee"
                        label="Employee"
                        sort={sort}
                        direction={direction}
                        onSort={toggleSort}
                      />
                      {ranged && <Th>Date</Th>}
                      <Th>Status</Th>
                      <SortHeader
                        column="first_punch_in"
                        label="In"
                        sort={sort}
                        direction={direction}
                        onSort={toggleSort}
                        numeric
                        ruled
                      />
                      <Th numeric>Out</Th>
                      <Th>Punched from</Th>
                      <SortHeader
                        column="worked_minutes"
                        label="Worked"
                        sort={sort}
                        direction={direction}
                        onSort={toggleSort}
                        numeric
                        ruled
                      />
                      <Th className="text-right">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Tr key={`${row.user_id}-${row.date}`} className="group">
                        <Td className="w-10 border-r border-rule px-0">
                          <MarkCell row={row} />
                        </Td>
                        <Td>
                          <p className="font-medium text-ink-900">{row.employee_name}</p>
                          <p className="text-[12px] text-ink-400">
                            {row.department || row.employee_email}
                          </p>
                        </Td>
                        {ranged && (
                          <Td className="tabular whitespace-nowrap">{formatDate(row.date)}</Td>
                        )}
                        <Td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-ink-800">{row.status_label}</span>
                            {row.is_late && (
                              <span className="text-[11px] font-medium text-status-amber">
                                late
                              </span>
                            )}
                            {row.no_shift_assigned && <NoShiftTag />}
                          </span>
                        </Td>
                        <Td numeric className="border-l border-rule">
                          {formatTime(row.first_punch_in)}
                        </Td>
                        <Td numeric>{formatTime(row.last_punch_out)}</Td>
                        <Td>
                          <PunchedFrom day={row} />
                        </Td>
                        <Td numeric className="border-l border-rule font-medium text-ink-900">
                          {formatMinutes(row.worked_minutes)}
                        </Td>
                        <Td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAdjusting(row)}
                            aria-label={`Adjust ${row.employee_name} on ${formatDate(row.date)}`}
                          >
                            Adjust
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}

              {/* A register carries its legend at the foot of the page, where
                  it is next to the marks it explains. */}
              <RegisterLegend rows={rows} />
            </div>
          )}
        </Card>
      )}

      <AdjustModal day={adjusting} onClose={() => setAdjusting(null)} />
    </>
  )
}

interface FilterChip {
  key: string
  label: string
  clear: Partial<Filters>
}

function activeFilters(filters: Filters, search: string): FilterChip[] {
  const chips: FilterChip[] = []
  if (search.trim()) {
    chips.push({ key: 'search', label: `“${search.trim()}”`, clear: { search: '' } })
  }
  if (filters.department) {
    chips.push({
      key: 'department',
      label: filters.department,
      clear: { department: '' },
    })
  }
  if (filters.status) {
    chips.push({ key: 'status', label: humanise(filters.status), clear: { status: '' } })
  }
  if (filters.exceptionsOnly) {
    chips.push({
      key: 'exceptions',
      label: 'Exceptions only',
      clear: { exceptionsOnly: false },
    })
  }
  return chips
}

/**
 * Nothing found has two quite different meanings, and the screen has to say
 * which one it is: filters that excluded every row are the administrator's own
 * doing and are one click away from being undone, whereas a day with nothing on
 * it is a fact about the organisation.
 */
function RegisterEmpty({
  filters,
  search,
  active,
  meta,
  onClear,
}: {
  filters: Filters
  search: string
  active: FilterChip[]
  meta: RegisterMeta | null
  onClear: () => void
}) {
  const when =
    filters.mode === 'range'
      ? `${formatDate(filters.fromDate)} – ${formatDate(filters.toDate)}`
      : formatDate(filters.day)

  if (active.length) {
    // Nobody left after the search and department is a different miss from
    // "these people had no such day" — it is the roster, not the attendance.
    const nobodyMatched = meta?.employees === 0
    const who = [
      search.trim() ? `“${search.trim()}”` : null,
      filters.department ? `in ${filters.department}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <EmptyState
        icon={<Search className="size-7" />}
        title={nobodyMatched ? 'Nobody matches those filters' : 'Filters are hiding every row'}
        description={
          nobodyMatched
            ? `No employee matches ${who}.`
            : `${when} has no rows for ${active.map((chip) => chip.label).join(' · ')}. Clearing the filters brings the day back.`
        }
        action={
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    )
  }

  if (meta && meta.employees === 0) {
    return (
      <EmptyState title="No employees yet" description="Invite people to see them here." />
    )
  }

  return (
    <EmptyState title={`Nothing recorded for ${when}`} description="No attendance was logged." />
  )
}

/**
 * A column header that says it can be sorted before it is clicked, and says
 * which way it is sorted after. A header that only shows its arrow once it is
 * active looks, until then, exactly like a header that does nothing.
 */
function SortHeader({
  column,
  label,
  sort,
  direction,
  onSort,
  numeric,
  ruled,
}: {
  column: SortColumn
  label: string
  sort: SortColumn | ''
  direction: SortDirection
  onSort: (column: SortColumn) => void
  numeric?: boolean
  /** Carries the column rule that separates the figures from the words. */
  ruled?: boolean
}) {
  const active = sort === column
  const Icon = !active ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown
  const state = !active ? 'not sorted' : direction === 'asc' ? 'ascending' : 'descending'

  return (
    <Th
      numeric={numeric}
      aria-sort={!active ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}
      className={cn(active && 'bg-ink-50', ruled && 'border-l border-l-rule')}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={`Sort by ${label}`}
        aria-label={`Sort by ${label}, currently ${state}`}
        className={cn(
          'group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors',
          active ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700',
        )}
      >
        {label}
        <Icon
          aria-hidden
          className={cn(
            'size-3 transition-colors',
            active ? 'text-ink-900' : 'text-ink-300 group-hover:text-ink-500',
          )}
        />
      </button>
    </Th>
  )
}

/**
 * The mark itself: one letter, in the legend's ink, with the word it stands for
 * available on hover and to a screen reader. The letter is the record; the
 * colour is a second reading of the same fact, never the only one.
 */
function MarkCell({ row, className }: { row: RegisterRow; className?: string }) {
  const legend = markOf(row)
  return (
    <span
      title={legend.word}
      className={cn(
        'mark mx-auto size-7 text-[13px]',
        MARK_INK[row.color] ?? MARK_INK.grey,
        className,
      )}
    >
      <span aria-hidden>{legend.mark}</span>
      <span className="sr-only">{legend.word}</span>
    </span>
  )
}

/** A planning signal, so it is ink: the shift window ran out, the work did not. */
function NoShiftTag() {
  return (
    <span
      title="The planned shift window has lapsed — no shift is assigned for this day"
      className="inline-flex items-center gap-1 rounded border border-rule bg-ink-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-500"
    >
      <span aria-hidden>◦</span>
      shift lapsed
    </span>
  )
}

/** The key at the foot of the page, listing only the marks actually used. */
function RegisterLegend({ rows }: { rows: RegisterRow[] }) {
  const seen = new Map<string, RegisterRow>()
  for (const row of rows) if (!seen.has(row.status)) seen.set(row.status, row)

  const late = rows.some((row) => row.is_late)
  const noShift = rows.some((row) => row.no_shift_assigned)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule px-4 py-2.5 text-[11px] text-ink-400">
      <span className="text-[10px] font-semibold tracking-wider text-ink-500 uppercase">
        Legend
      </span>
      {[...seen.entries()].map(([status, row]) => {
        const legend = markOf(row)
        return (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn('mark text-[12px]', MARK_INK[row.color] ?? MARK_INK.grey)}
            >
              {legend.mark}
            </span>
            {row.status_label || legend.word}
          </span>
        )
      })}
      {late && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3.5 bg-status-amber" />
          late arrival
        </span>
      )}
      {noShift && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-1 rounded-full bg-ink-300" />
          shift window lapsed
        </span>
      )}
    </div>
  )
}

interface MusterEmployee {
  id: string
  userId: string | null
  name: string
  sub: string
  byDate: Map<string, RegisterRow>
}

interface Muster {
  dates: string[]
  employees: MusterEmployee[]
}

/**
 * The rows the server already sent, folded into the shape the paper register
 * had: one line per person, one column per day. No extra request is made — a
 * range response already carries every person-day in it.
 */
function buildMuster(rows: RegisterRow[]): Muster {
  const dates = [...new Set(rows.map((row) => row.date))].sort()
  const employees: MusterEmployee[] = []
  const index = new Map<string, MusterEmployee>()

  for (const row of rows) {
    const id = row.user_id ?? row.employee_email ?? row.employee_name ?? 'unknown'
    let employee = index.get(id)
    if (!employee) {
      employee = {
        id,
        // Only a real id opens a month; a row keyed by email is a person the
        // register knows of but cannot look up.
        userId: row.user_id ?? null,
        name: row.employee_name || row.user_name || row.employee_email || '—',
        sub: row.department || row.employee_email || '',
        byDate: new Map(),
      }
      index.set(id, employee)
      employees.push(employee)
    }
    employee.byDate.set(row.date, row)
  }

  return { dates, employees }
}

/**
 * The muster roll. Every cell is a real button, because the thing an
 * administrator wants after finding an exception in the grid is to correct it.
 * The foot of each column carries the day's attendance, which is what the
 * totals line on a paper register was for.
 */
function MusterGrid({
  muster,
  sort,
  direction,
  onSort,
  onAdjust,
}: {
  muster: Muster
  sort: SortColumn | ''
  direction: SortDirection
  onSort: (column: SortColumn) => void
  onAdjust: (row: RegisterRow) => void
}) {
  const { dates, employees } = muster
  const activeSort = sort === 'employee'
  const SortIcon = !activeSort ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown

  const presentByDate = new Map<string, number>()
  let totalPresent = 0
  let totalWorked = 0
  for (const employee of employees) {
    for (const date of dates) {
      const row = employee.byDate.get(date)
      if (!row) continue
      totalWorked += row.worked_minutes ?? 0
      if (ATTENDED.has(row.status)) {
        presentByDate.set(date, (presentByDate.get(date) ?? 0) + 1)
        totalPresent += 1
      }
    }
  }

  const headCell =
    'sticky top-0 z-10 border-b border-ink-300 bg-white py-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase'
  const footCell = 'tabular border-t border-ink-300 py-2 text-[12px] font-semibold text-ink-900'

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <caption className="sr-only">
          Muster roll: one row per employee, one column per day.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              aria-sort={!activeSort ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}
              className={cn(headCell, 'left-0 z-20 min-w-[12rem] px-4 text-left')}
            >
              <button
                type="button"
                onClick={() => onSort('employee')}
                title="Sort by Employee"
                aria-label={`Sort by Employee, currently ${
                  !activeSort ? 'not sorted' : direction === 'asc' ? 'ascending' : 'descending'
                }`}
                className={cn(
                  'group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors',
                  activeSort ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700',
                )}
              >
                Employee
                <SortIcon aria-hidden className="size-3" />
              </button>
            </th>
            {dates.map((date) => {
              const head = dayHead(date)
              return (
                <th key={date} scope="col" className={cn(headCell, 'w-9 border-l border-l-rule px-0 text-center')}>
                  <span className="tabular block text-[12px] text-ink-800">{head.number}</span>
                  <span className="block text-[10px] font-normal text-ink-400">
                    {head.weekday}
                  </span>
                  <span className="sr-only">{formatDate(date)}</span>
                </th>
              )
            })}
            <th scope="col" className={cn(headCell, 'border-l border-l-ink-300 px-3 text-right')}>
              Days
            </th>
            <th scope="col" className={cn(headCell, 'px-3 text-right')}>
              Worked
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const days = dates.map((date) => employee.byDate.get(date))
            const present = days.filter((row) => row && ATTENDED.has(row.status)).length
            const worked = days.reduce((sum, row) => sum + (row?.worked_minutes ?? 0), 0)

            return (
              <tr key={employee.id} className="group transition-colors hover:bg-ink-50/70">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-rule bg-white px-4 py-1.5 text-left font-normal group-hover:bg-ink-50"
                >
                  {/* The row already reads across a date range; the name is the
                      way into that person's month, which is the other question
                      an administrator asks of this grid. */}
                  {employee.userId ? (
                    <Link
                      to={`/admin/employees/${employee.userId}/attendance`}
                      className="block truncate font-medium text-ink-900 underline-offset-2 hover:underline"
                    >
                      {employee.name}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink-900">{employee.name}</span>
                  )}
                  {employee.sub && (
                    <span className="block truncate text-[11px] text-ink-400">{employee.sub}</span>
                  )}
                </th>
                {dates.map((date, position) => {
                  const row = days[position]
                  return (
                    <td
                      key={date}
                      className={cn(
                        'w-9 border-b border-l border-rule p-0 text-center',
                        isWeekendish(row) && 'bg-ink-50/70',
                      )}
                    >
                      {row ? (
                        <button
                          type="button"
                          onClick={() => onAdjust(row)}
                          title={`${employee.name} · ${formatDate(date)} — ${markOf(row).word}`}
                          className="relative flex h-9 w-full items-center justify-center transition-colors hover:bg-ink-100"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'mark text-[13px]',
                              MARK_INK[row.color] ?? MARK_INK.grey,
                            )}
                          >
                            {markOf(row).mark}
                          </span>
                          <span className="sr-only">
                            {`${employee.name}, ${formatDate(date)}: ${markOf(row).word}`}
                            {row.is_late ? ', late' : ''}
                            {row.no_shift_assigned ? ', shift window lapsed' : ''}. Adjust
                          </span>
                          {row.is_late && (
                            <span
                              aria-hidden
                              className="absolute bottom-1 h-0.5 w-3.5 bg-status-amber"
                            />
                          )}
                          {row.no_shift_assigned && (
                            <span
                              aria-hidden
                              className="absolute top-1 right-1 size-1 rounded-full bg-ink-300"
                            />
                          )}
                        </button>
                      ) : (
                        <span aria-hidden className="block h-9 leading-9 text-ink-200">
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
                <td className="tabular border-b border-l border-l-ink-200 px-3 py-1.5 text-right text-ink-900">
                  {present}
                </td>
                <td className="tabular border-b px-3 py-1.5 text-right text-ink-900">
                  {formatMinutes(worked)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th
              scope="row"
              className={cn(
                footCell,
                'sticky left-0 z-10 bg-white px-4 text-left text-[10px] tracking-wider text-ink-500 uppercase',
              )}
            >
              Present
            </th>
            {dates.map((date) => (
              <td key={date} className={cn(footCell, 'w-9 border-l border-l-rule px-0 text-center')}>
                {presentByDate.get(date) ?? 0}
              </td>
            ))}
            <td className={cn(footCell, 'border-l border-l-ink-300 px-3 text-right')}>
              {totalPresent}
            </td>
            <td className={cn(footCell, 'px-3 text-right')}>{formatMinutes(totalWorked)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * Where the first punch of the day came from — the device, and whether it was
 * anywhere near the office. Both are recorded on every punch; this is the only
 * place an administrator sees them without opening a day.
 */
function PunchedFrom({ day }: { day: AttendanceDay }) {
  const punch = day.sessions?.[0]?.punch_in
  if (!punch) return <span className="text-ink-300">—</span>

  // Times an administrator typed, or a correction applied, came from no device;
  // calling them "Unknown" read like a punch somebody should investigate.
  const entered = { ADMIN: 'Set by an administrator', CORRECTION: 'From a correction' }[
    punch.source as 'ADMIN' | 'CORRECTION'
  ]
  if (entered) return <span className="text-[12px] text-ink-500">{entered}</span>

  const mobile = punch.device_class === 'MOBILE' || punch.device_class === 'TABLET'

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap',
          mobile ? 'bg-status-amber-soft text-status-amber' : 'bg-ink-50 text-ink-600',
        )}
        title={punch.user_agent ?? undefined}
      >
        {mobile ? (
          <Smartphone className="size-3" aria-hidden />
        ) : (
          <Monitor className="size-3" aria-hidden />
        )}
        {punch.platform || (punch.device_class ? humanise(punch.device_class) : 'Unknown')}
      </span>
      {/* Where, in the only terms a person reads at a glance. The address and
          the IP are still recorded — they hang off this as the tooltip, for the
          one time in a year somebody has to prove where a punch came from. */}
      {(punch.city || punch.address) && (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap text-ink-500"
          title={[punch.address, punch.ip].filter(Boolean).join(' · ')}
        >
          <MapPin className="size-3 shrink-0" aria-hidden />
          {punch.city ?? punch.address}
        </span>
      )}
    </span>
  )
}

function AdjustModal({ day, onClose }: { day: AttendanceDay | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [punchIn, setPunchIn] = useState('09:30')
  const [punchOut, setPunchOut] = useState('18:30')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    // The row carries its own date, which is what a range view is adjusting.
    mutationFn: () =>
      apiPut(`/attendance/employee/${day!.user_id}/${day!.date}`, {
        sessions: [
          {
            punch_in: orgWallClockToIso(day!.date, punchIn),
            punch_out: orgWallClockToIso(day!.date, punchOut),
          },
        ],
        note,
      }),
    onSuccess: () => {
      // An adjusted day moves the same screens an approved correction does.
      refreshApprovalDependents(queryClient)
      toast.success(`Attendance saved for ${day?.employee_name ?? 'this employee'}.`)
      setNote('')
      onClose()
    },
    // The inline note stays: a toast that has faded is no help to somebody
    // still looking at the dialog.
    onError: (mutationError) => {
      setError(messageOf(mutationError))
      toast.error('Attendance could not be saved.')
    },
  })

  if (!day) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust ${day.employee_name}`}
      description={`${formatDate(day.date)} — this replaces the day's punches. The change is recorded in the audit trail.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={note.trim().length < 3} onClick={() => save.mutate()}>
            Save attendance
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="tabular grid grid-cols-2 gap-3 rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2 text-[13px] text-ink-600">
          <span>
            Recorded in <span className="text-ink-900">{formatTime(day.first_punch_in)}</span>
          </span>
          <span>
            Recorded out <span className="text-ink-900">{formatTime(day.last_punch_out)}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Punch in" required>
            <Input type="time" value={punchIn} onChange={(event) => setPunchIn(event.target.value)} />
          </Field>
          <Field label="Punch out" required>
            <Input type="time" value={punchOut} onChange={(event) => setPunchOut(event.target.value)} />
          </Field>
        </div>

        <Field label="Why" hint="Required — this is what the audit trail will show." required>
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Employee was at the client site; confirmed with the team lead."
          />
        </Field>
      </div>
    </Modal>
  )
}
