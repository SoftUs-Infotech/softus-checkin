import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  StatTile,
  Table,
  TableSkeleton,
  Td,
  Th,
  Tr,
  useToast,
} from '@/components/ui'
import type { OrgSalaryProjection, Salary, SalaryHours, SalaryProjection } from '@/types'

/*
  Pay, projected from attendance.

  Deliberately the only screen in the application that shows money, and it is
  behind the admin guard on both sides — there is no employee endpoint to call,
  so nothing here can leak by guessing a URL.
*/

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, direction: -1 | 1): string {
  const [year, index] = month.split('-').map(Number)
  return monthKey(new Date(year, index - 1 + direction, 1))
}

/*
  The API sends the day buckets under their field names, and printing those
  verbatim gave the reader rows like "missing punch out days". A count worth
  showing gets a sentence-shaped label; a count of zero is not worth a tile at
  all, so the grid shows only what actually happened this month.

  `working_days` is deliberately absent: it is stated on its own above the grid,
  because it is the denominator rather than one bucket among many.
*/
const COUNT_LABELS: [string, string][] = [
  ['present_days', 'Present'],
  ['half_days', 'Half days'],
  ['absent_days', 'Absent'],
  ['paid_leave_days', 'Paid leave'],
  ['unpaid_leave_days', 'Unpaid leave'],
  ['missing_punch_out_days', 'Never punched out'],
  ['holiday_days', 'Holidays'],
  ['late_days', 'Late arrivals'],
  ['pending_days', 'Still to come'],
  ['before_joining_days', 'Before joining'],
  ['untracked_days', 'Before go-live (paid)'],
]

/** `48333.33` → `48,333` — a projection does not need paise. */
/** `5400` minutes → `90 h`, `5430` → `90.5 h`. */
function hoursOf(minutes: number): string {
  return `${Math.round((minutes / 60) * 100) / 100} h`
}

/** What one hour of an hourly-paid month is worth. */
function hourRate(row: SalaryProjection): number {
  const expected = row.hours?.expected_minutes ?? 0
  return expected > 0 ? row.monthly_ctc / (expected / 60) : 0
}

function money(amount: number): string {
  return Math.round(amount).toLocaleString()
}

export function SalaryPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [detail, setDetail] = useState<SalaryProjection | null>(null)
  const [editing, setEditing] = useState<SalaryProjection | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['salary-projection', month],
    queryFn: () => apiGet<OrgSalaryProjection>('/salary/projection', { month }),
  })

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  return (
    <>
      <PageHeader
        title="Salary"
        description="Projected from this month's attendance. Employees never see any of it."
        action={
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular px-2 text-[13px] text-ink-700">{monthLabel}</span>
            <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Projected total"
          value={data ? money(data.total_projected_net) : '—'}
          hint="Every employee, after deductions"
        />
        <StatTile label="Employees" value={data?.employees.length ?? '—'} />
        <StatTile
          label="Working days"
          value={data?.employees[0]?.counts.working_days ?? '—'}
          hint="The denominator of every day rate"
        />
        <StatTile
          label="No salary on record"
          value={data?.missing_salary_count ?? '—'}
          tone={(data?.missing_salary_count ?? 0) > 0 ? 'amber' : 'neutral'}
          hint={
            (data?.missing_salary_count ?? 0) > 0
              ? 'These rows project as zero'
              : 'Everybody has a figure'
          }
        />
      </div>

      <p className="mb-4 flex items-center gap-2 text-[12px] text-ink-400">
        <Lock className="size-3.5 shrink-0" />
        Administrators only. There is no employee-facing route to any of these figures.
      </p>

      <Card>
        {isLoading || !data ? (
          <TableSkeleton rows={6} columns={7} />
        ) : !data.employees.length ? (
          <EmptyState title="Nobody to pay" description="Add employees to see a projection." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th numeric>Monthly</Th>
                <Th numeric>Day rate</Th>
                <Th numeric>Deductions</Th>
                <Th numeric>Adjustments</Th>
                <Th numeric>Projected</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((row) => (
                <Tr key={row.user_id}>
                  <Td className="font-medium whitespace-nowrap text-ink-900">
                    {row.user_name || row.user_email}
                    {!row.has_salary_on_record && (
                      <span className="block text-[11px] font-normal text-status-amber">
                        no salary set
                      </span>
                    )}
                    {row.pay_basis === 'HOURS' && row.hours && (
                      <span className="tabular block text-[11px] font-normal text-ink-400">
                        Intern / part-time · {hoursOf(row.hours.credited_minutes)} of{' '}
                        {hoursOf(row.hours.expected_minutes)}
                      </span>
                    )}
                  </Td>
                  <Td numeric>{money(row.monthly_ctc)}</Td>
                  <Td numeric className="text-ink-500">
                    {row.pay_basis === 'HOURS' ? `${money(hourRate(row))} / h` : money(row.day_rate)}
                  </Td>
                  <Td
                    numeric
                    className={cn(row.total_deduction > 0 ? 'text-status-red' : 'text-ink-300')}
                  >
                    {row.total_deduction > 0 ? `−${money(row.total_deduction)}` : '—'}
                  </Td>
                  <Td
                    numeric
                    className={cn(row.total_adjustment !== 0 ? 'text-status-green' : 'text-ink-300')}
                  >
                    {row.total_adjustment !== 0
                      ? `${row.total_adjustment > 0 ? '+' : '−'}${money(Math.abs(row.total_adjustment))}`
                      : '—'}
                  </Td>
                  <Td numeric className="font-semibold text-ink-900">
                    {money(row.projected_net)}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
                      Breakdown
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                      Set pay
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <BreakdownModal row={detail} onClose={() => setDetail(null)} />
      {/* Mounted per opening, so one employee's typed figures never carry over to the next. */}
      {editing && (
        <SetSalaryModal row={editing} month={month} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function BreakdownModal({ row, onClose }: { row: SalaryProjection | null; onClose: () => void }) {
  if (!row) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={row.user_name || row.user_email || 'Employee'}
      description={
        row.pay_basis === 'HOURS'
          ? `${row.month} · intern / part-time, paid by hours`
          : `${row.month} · ${row.day_basis.toLowerCase().replace(/_/g, ' ')}`
      }
    >
      <div className="space-y-4">
        {/* The working-day count is the number every other figure here is
            divided by, so it is stated on its own rather than buried in a grid
            of eleven equal-looking tiles. */}
        {row.pay_basis === 'HOURS' && row.hours ? (
          <HoursPanel hours={row.hours} monthly={row.monthly_ctc} />
        ) : (
          <div className="flex items-baseline justify-between rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
            <span className="text-[13px] text-ink-700">
              {row.counts.working_days} working days this month
            </span>
            <span className="tabular text-[13px] font-semibold text-ink-900">
              {money(row.day_rate)} a day
            </span>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COUNT_LABELS.filter(([key]) => (row.counts[key] ?? 0) > 0).map(([key, label]) => (
            <div key={key} className="rounded-lg bg-ink-50 px-3 py-2">
              <dt className="text-[11px] tracking-wide text-ink-400 uppercase">{label}</dt>
              <dd className="tabular mt-0.5 text-[14px] font-medium text-ink-900">
                {row.counts[key]}
              </dd>
            </div>
          ))}
        </dl>

        <Section title="Deductions" empty="Nothing deducted.">
          {row.deductions.map((line, index) => (
            <Line
              key={index}
              label={line.label || line.kind}
              days={line.days}
              hours={line.hours}
              amount={-line.amount}
            />
          ))}
        </Section>

        <Section title="Adjustments" empty="No corrections carried into this month.">
          {row.adjustments.map((line, index) => (
            <Line
              key={index}
              label={
                line.reason ||
                `${line.kind}${line.source_date ? ` · ${formatDate(line.source_date)}` : ''}`
              }
              days={line.days}
              amount={line.amount}
            />
          ))}
        </Section>

        <p className="flex items-center justify-between border-t border-ink-100 pt-3 text-[15px] font-semibold text-ink-900">
          Projected
          <span className="tabular">{money(row.projected_net)}</span>
        </p>
      </div>
    </Modal>
  )
}

function Section({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
        {title}
      </p>
      {items.filter(Boolean).length ? (
        <ul className="divide-y divide-ink-50 rounded-lg border border-ink-100">{children}</ul>
      ) : (
        <p className="text-[13px] text-ink-400">{empty}</p>
      )}
    </div>
  )
}

/*
  An intern's month in hours: what the month asked for, what counts towards it,
  and the share of the fixed amount that earns. Every source of credited hours
  is listed, so "why is it 75%" is answered on the same screen.
*/
function HoursPanel({ hours, monthly }: { hours: SalaryHours; monthly: number }) {
  const parts: [string, number][] = [
    ['Punched', hours.worked_minutes],
    ['Paid leave', hours.paid_leave_minutes],
    ['Short days counted as full', hours.full_day_minutes],
    ['Days still to come (assumed worked)', hours.pending_minutes],
    ['Before go-live (paid in full)', hours.untracked_minutes],
  ]
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-700">
          Paid by hours · {hoursOf(hours.credited_minutes)} of {hoursOf(hours.expected_minutes)}
        </span>
        <span className="tabular text-[13px] font-semibold text-ink-900">
          {Math.round(hours.share * 1000) / 10}% of {money(monthly)}
        </span>
      </div>
      <ul className="space-y-0.5 text-[12px] text-ink-500">
        {parts
          .filter(([, minutes]) => minutes > 0)
          .map(([label, minutes]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="tabular">{hoursOf(minutes)}</span>
            </li>
          ))}
      </ul>
      <p className="text-[11px] text-ink-400">
        Hours are pooled over the month and the payout never exceeds the fixed amount.
      </p>
    </div>
  )
}

function Line({
  label,
  days,
  hours,
  amount,
}: {
  label: string
  days: number
  hours?: number | null
  amount: number
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-ink-700">{label}</span>
      <span className="tabular text-[12px] text-ink-400">
        {hours != null ? `${hours} h` : `${days} d`}
      </span>
      <span className={cn('tabular', amount < 0 ? 'text-status-red' : 'text-status-green')}>
        {amount < 0 ? '−' : '+'}
        {money(Math.abs(amount))}
      </span>
    </li>
  )
}

function SetSalaryModal({
  row,
  month,
  onClose,
}: {
  row: SalaryProjection | null
  month: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState(`${month}-01`)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const history = useQuery({
    queryKey: ['salary-history', row?.user_id],
    queryFn: () => apiGet<Salary[]>(`/salary/employees/${row!.user_id}`),
    enabled: !!row,
  })

  const save = useMutation({
    mutationFn: () =>
      apiPost(`/salary/employees/${row!.user_id}`, {
        monthly_ctc: Number(amount),
        effective_from: from,
        note: note || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-projection'] })
      queryClient.invalidateQueries({ queryKey: ['salary-history'] })
      toast.success('Pay saved. The previous figure is kept in the history.')
      onClose()
    },
    onError: (mutationError) => setError(messageOf(mutationError, 'The salary was not saved.')),
  })

  if (!row) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay for ${row.user_name || row.user_email}`}
      description="A raise adds a record; it never overwrites what came before."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!amount} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly amount">
            <Input
              type="number"
              min="0"
              className="tabular"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Effective from">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
        </div>

        <Field label="Note" hint="Why it changed — appears in the audit trail.">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
            History
          </p>
          {history.data?.length ? (
            <ul className="divide-y divide-ink-50 rounded-lg border border-ink-100">
              {history.data.map((record) => (
                <li key={record.id} className="flex items-center justify-between px-3 py-2">
                  <span className="tabular text-[13px] text-ink-700">
                    {formatDate(record.effective_from)}
                  </span>
                  <span className="tabular text-[13px] font-medium text-ink-900">
                    {money(record.monthly_ctc)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-400">Nothing on record yet.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
