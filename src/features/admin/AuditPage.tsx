import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDate, formatTime, humanise, relativeTime } from '@/lib/format'
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  Toolbar,
  Tr,
} from '@/components/ui'
import type { AuditLog, Paginated } from '@/types'

const ENTITIES = [
  'USER',
  'SHIFT',
  'HOLIDAY',
  'LEAVE_TYPE',
  'LEAVE_REQUEST',
  'LEAVE_BALANCE',
  'ATTENDANCE',
  'CORRECTION',
  'TASK',
  'SETTINGS',
]

/** How many changed fields a row shows before it has to be opened. Four is
    about as much as reads at a glance in a table cell. */
const PREVIEW_FIELDS = 4

export function AuditPage() {
  const [entity, setEntity] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['audit', entity],
    queryFn: () =>
      apiGet<Paginated<AuditLog>>('/audit-logs', {
        entity: entity || undefined,
        page_size: 100,
      }),
  })

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every administrative change, with who made it and what it changed. Nothing here can be edited or deleted."
      />

      <Toolbar>
        <label className="flex items-center gap-2 text-[13px] text-ink-500">
          Show
          <Select
            className="w-52"
            aria-label="Filter by what was changed"
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
          >
            <option value="">Everything</option>
            {ENTITIES.map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </Select>
        </label>
        {!isLoading && data?.items.length ? (
          <span className="tabular text-[12px] text-ink-400">
            {data.items.length} most recent {data.items.length === 1 ? 'entry' : 'entries'}
          </span>
        ) : null}
      </Toolbar>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} columns={5} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<ScrollText className="size-8" />}
            title={entity ? `Nothing recorded for ${humanise(entity).toLowerCase()}` : 'Nothing recorded yet'}
            description={
              entity
                ? 'Try looking at everything instead — the change may be filed under another kind of record.'
                : 'Administrative changes will appear here as they happen: who, what, when, and what the value was before.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>What</Th>
                <Th>Changes</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => {
                const open = expanded === entry.id
                return (
                  <Tr key={entry.id} className="align-top">
                    <Td className="whitespace-nowrap">
                      <span className="tabular block text-ink-800">{formatTime(entry.at)}</span>
                      <span className="tabular block text-[11px] text-ink-400">
                        {formatDate(entry.at)}
                      </span>
                    </Td>
                    <Td>
                      <span className="block text-ink-800">{entry.actor_email ?? 'system'}</span>
                      <span className="block text-[11px] text-ink-400">
                        {relativeTime(entry.at)}
                        {entry.ip && <span className="tabular"> · {entry.ip}</span>}
                      </span>
                    </Td>
                    <Td>
                      <Badge>{humanise(entry.action)}</Badge>
                    </Td>
                    <Td>
                      <span className="block text-ink-900">{humanise(entry.entity)}</span>
                      {entry.entity_label && (
                        <span className="block text-[12px] text-ink-400">{entry.entity_label}</span>
                      )}
                    </Td>
                    <Td>
                      <ChangeList
                        before={entry.before}
                        after={entry.after}
                        expanded={open}
                        onToggle={() => setExpanded(open ? null : entry.id)}
                      />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}

/** `null` → `not set`, `true` → `yes`, an object → its JSON. A log entry that
    prints `[object Object]` is a log entry nobody can act on. */
function readable(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length ? value.map(readable).join(', ') : 'empty'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ChangeList({
  before,
  after,
  expanded,
  onToggle,
}: {
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  expanded?: boolean
  onToggle: () => void
}) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  if (!keys.length) return <span className="text-ink-300">—</span>

  const shown = expanded ? keys : keys.slice(0, PREVIEW_FIELDS)

  return (
    <>
      <ul className="space-y-1">
        {shown.map((key) => {
          const had = before?.[key] !== undefined
          const has = after?.[key] !== undefined
          return (
            <li key={key} className="text-[12px] leading-snug">
              <span className="block text-ink-400">{humanise(key)}</span>
              <span className="tabular flex flex-wrap items-baseline gap-1">
                {had && (
                  <span className="text-ink-400 line-through">{readable(before?.[key])}</span>
                )}
                {had && has && (
                  <span className="text-ink-300" aria-label="became">
                    →
                  </span>
                )}
                {has && <span className="text-ink-800">{readable(after?.[key])}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {keys.length > PREVIEW_FIELDS && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={Boolean(expanded)}
          className="mt-1 rounded text-[12px] font-medium text-ink-800 underline decoration-ink-200 underline-offset-2 hover:decoration-ink-800"
        >
          {expanded ? 'Show less' : `and ${keys.length - PREVIEW_FIELDS} more`}
        </button>
      )}
    </>
  )
}
