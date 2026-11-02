import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Palmtree } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { approvalChip, formatDate, formatDayMonth, humanise, toDateKey, todayKey } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Table,
  TableSkeleton,
  Td,
  Th,
  Tr,
} from '@/components/ui'
import type { LeaveRequest } from '@/types'
import { LeaveTypesPage } from './LeaveTypesPage'

type Tab = 'calendar' | 'upcoming' | 'summary' | 'types'

const TABS: { value: Tab; label: string }[] = [
  { value: 'calendar', label: 'Who is away' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'summary', label: 'Taken this year' },
  { value: 'types', label: 'Leave types' },
]

interface SummaryRow {
  user_id: string
  user_name: string
  paid_taken: number
  unpaid_taken: number
  pending: number
  types: {
    leave_type_id: string
    leave_type_name: string
    is_paid: boolean
    taken: number
    pending: number
    available: number | null
  }[]
}

function addDays(key: string, days: number): string {
  const day = new Date(`${key}T00:00:00`)
  day.setDate(day.getDate() + days)
  return toDateKey(day)
}

function partLabel(part: string): string {
  return part === 'FULL' ? '' : ` · ${humanise(part)}`
}

/**
    Leave, managed: who is away on a day or across a month, what is coming up
    and whether it is approved, what each person has taken this year — paid
    against unpaid, which the salary deducts — and the types themselves.
    Weekly offs, off-Saturdays and holidays are never part of a leave, so a
    day listed here is always a day the person was expected in.
*/
export function LeavesPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((item) => item.value === params.get('tab')) ? params.get('tab') : 'calendar') as Tab

  return (
    <>
      <PageHeader
        title="Leaves"
        description="Who is away, what is coming up, what each person has taken, and the leave types."
      />
      <Segmented
        className="mb-4 max-w-full overflow-x-auto"
        value={tab}
        onChange={(next) => setParams(next === 'calendar' ? {} : { tab: next }, { replace: true })}
        options={TABS}
      />
      {tab === 'calendar' && <WhoIsAway />}
      {tab === 'upcoming' && <Upcoming />}
      {tab === 'summary' && <TakenThisYear />}
      {tab === 'types' && <LeaveTypesPage embedded />}
    </>
  )
}

function useLeaveBetween(from: string, to: string) {
  return useQuery({
    queryKey: ['leave-calendar', from, to],
    queryFn: () => apiGet<LeaveRequest[]>('/leave/calendar', { from_date: from, to_date: to }),
  })
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', approvalChip(status))}>
      {status === 'PENDING' ? 'Waiting' : humanise(status)}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Who is away — a month, and one day of it                                   */
/* -------------------------------------------------------------------------- */

function WhoIsAway() {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7))
  const [selected, setSelected] = useState(todayKey())

  const first = `${month}-01`
  const last = addDays(addDays(first, 31).slice(0, 7) + '-01', -1)
  const { data, isLoading } = useLeaveBetween(first, last)

  const byDay = useMemo(() => {
    const map = new Map<string, { request: LeaveRequest; part: string }[]>()
    for (const request of data ?? []) {
      for (const day of request.days) {
        const list = map.get(day.date) ?? []
        list.push({ request, part: day.day_part })
        map.set(day.date, list)
      }
    }
    return map
  }, [data])

  const leading = (new Date(`${first}T00:00:00`).getDay() + 6) % 7 // Monday first
  const length = Number(last.slice(8, 10))
  const away = byDay.get(selected) ?? []

  function shift(by: number) {
    const [year, mon] = month.split('-').map(Number)
    const next = new Date(year, mon - 1 + by, 1)
    const key = toDateKey(next).slice(0, 7)
    setMonth(key)
    setSelected(key === todayKey().slice(0, 7) ? todayKey() : `${key}-01`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <p className="text-[14px] text-ink-900">
            {new Date(`${first}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>
          <Button variant="ghost" size="sm" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-400">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div className={cn('mt-1 grid grid-cols-7 gap-1', isLoading && 'opacity-50')}>
          {Array.from({ length: leading }).map((_, index) => (
            <span key={`pad-${index}`} />
          ))}
          {Array.from({ length }).map((_, index) => {
            const key = `${month}-${String(index + 1).padStart(2, '0')}`
            const people = byDay.get(key) ?? []
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={cn(
                  'flex min-h-16 flex-col items-start rounded-lg border p-1.5 text-left transition-colors',
                  key === selected ? 'border-ink-900' : 'border-ink-100 hover:bg-ink-50',
                )}
              >
                <span className={cn('tabular text-[12px]', key === todayKey() ? 'font-semibold text-ink-900' : 'text-ink-500')}>
                  {index + 1}
                </span>
                {people.slice(0, 2).map(({ request }) => (
                  <span
                    key={request.id}
                    className={cn(
                      'mt-0.5 w-full truncate rounded px-1 text-[10px]',
                      request.status === 'PENDING' ? 'bg-ink-100 text-ink-700' : 'bg-status-green-soft text-status-green',
                    )}
                  >
                    {request.user_name?.split(' ')[0]}
                  </span>
                ))}
                {people.length > 2 && <span className="mt-0.5 text-[10px] text-ink-400">+{people.length - 2} more</span>}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-[12px] text-ink-400">
          Green is approved, grey is waiting for a decision. Weekly offs and holidays never count as leave.
        </p>
      </Card>

      <Card className="p-4">
        <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
          Away on {formatDate(selected)}
        </p>
        {away.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-400">Nobody is on leave.</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink-50">
            {away.map(({ request, part }) => (
              <li key={request.id} className="flex items-start justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink-900">{request.user_name}</span>
                  <span className="block text-[12px] text-ink-400">
                    {request.leave_type_name}
                    {partLabel(part)}
                  </span>
                </span>
                <StatusChip status={request.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Upcoming                                                                    */
/* -------------------------------------------------------------------------- */

function Upcoming() {
  const today = todayKey()
  const { data, isLoading } = useLeaveBetween(today, addDays(today, 90))
  const waiting = (data ?? []).filter((request) => request.status === 'PENDING').length

  return (
    <Card>
      {waiting > 0 && (
        <p className="border-b border-ink-100 px-4 py-2.5 text-[13px] text-ink-700">
          {waiting} request(s) waiting for a decision —{' '}
          <Link to="/admin/approvals" className="text-brand-700 hover:underline">
            decide in Approvals
          </Link>
        </p>
      )}
      {isLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : !data?.length ? (
        <EmptyState icon={<Palmtree className="size-5" />} title="No leave in the next three months" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Type</Th>
              <Th>Dates</Th>
              <Th className="text-right">Days</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((request) => (
              <Tr key={request.id}>
                <Td className="text-ink-900">{request.user_name}</Td>
                <Td>{request.leave_type_name}</Td>
                <Td className="tabular whitespace-nowrap">
                  {request.from_date === request.to_date
                    ? formatDayMonth(request.from_date)
                    : `${formatDayMonth(request.from_date)} – ${formatDayMonth(request.to_date)}`}
                </Td>
                <Td className="tabular text-right">{request.total_days}</Td>
                <Td>
                  <StatusChip status={request.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Taken this year                                                             */
/* -------------------------------------------------------------------------- */

function TakenThisYear() {
  const { data, isLoading } = useQuery({
    queryKey: ['leave-summary'],
    queryFn: () => apiGet<SummaryRow[]>('/leave/summary'),
  })

  return (
    <Card>
      <p className="border-b border-ink-100 px-4 py-2.5 text-[12px] text-ink-400">
        Approved leave this year. Paid leave comes out of the balance; unpaid leave is deducted from
        salary. Set a balance by hand under Employees → Edit.
      </p>
      {isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : !data?.length ? (
        <EmptyState icon={<Palmtree className="size-5" />} title="No employees yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th className="text-right">Paid taken</Th>
              <Th className="text-right">Unpaid (salary deducted)</Th>
              <Th className="text-right">Waiting</Th>
              <Th>Left to take</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <Tr key={row.user_id}>
                <Td className="text-ink-900">{row.user_name}</Td>
                <Td className="tabular text-right">{row.paid_taken}</Td>
                <Td className={cn('tabular text-right', row.unpaid_taken > 0 && 'text-status-red')}>
                  {row.unpaid_taken}
                </Td>
                <Td className="tabular text-right">{row.pending}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {row.types
                      .filter((type) => type.is_paid && type.available !== null)
                      .map((type) => (
                        <span
                          key={type.leave_type_id}
                          title={`${type.leave_type_name}: ${type.taken} taken`}
                          className={cn(
                            'tabular rounded-full px-2 py-0.5 text-[11px]',
                            (type.available ?? 0) < 0 ? 'bg-status-red-soft text-status-red' : 'bg-ink-50 text-ink-700',
                          )}
                        >
                          {type.leave_type_name} {type.available}
                        </span>
                      ))}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}
