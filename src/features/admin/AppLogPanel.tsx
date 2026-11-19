import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react'
import { apiGet, messageOf } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { AppLogEntry } from '@/types'

/*
  One person's app log for the day — administrators only. What the desktop app
  reported (opened, closed, a setting turned off or on, the screen could not be
  seen, a popup shown) next to what the server did (punches, automatic
  punch-outs, updates) and long screen locks, in time order.
*/

const PROBLEM_KINDS = new Set(['AUTO_PUNCHED_OUT', 'SCREEN_NOT_VISIBLE', 'SCREENSHOT_FAILED'])

function isProblem(entry: AppLogEntry): boolean {
  if (PROBLEM_KINDS.has(entry.kind)) return true
  return entry.kind === 'SETTING_CHANGED' && /turned off|not allowed/.test(entry.message)
}

export function AppLogPanel({ userId, date }: { userId: string; date: string }) {
  const [open, setOpen] = useState(true)
  const log = useQuery({
    queryKey: ['activity', 'log', userId, date],
    queryFn: () => apiGet<AppLogEntry[]>('/activity/log', { user_id: userId, date }),
    refetchInterval: 60_000,
  })
  const entries = log.data ?? []
  const problems = entries.filter(isProblem).length

  return (
    <div className="border-b border-rule px-5 py-3" data-testid="app-log">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 text-left text-[13px] font-semibold text-ink-900"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <ScrollText className="size-3.5" aria-hidden />
        App log
        <span className="font-normal text-ink-400">
          · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {problems > 0 && <span className="text-status-red"> · {problems} to check</span>}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          {log.error ? (
            <p className="text-[12px] text-status-red">{messageOf(log.error)}</p>
          ) : log.isLoading ? (
            <p className="text-[12px] text-ink-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-[12px] text-ink-400">Nothing logged on this day.</p>
          ) : (
            <ol className="max-h-72 space-y-1 overflow-y-auto pr-2 text-[12px]">
              {entries.map((entry, index) => (
                <li key={`${entry.at}-${entry.kind}-${index}`} className="flex gap-3">
                  <span className="tabular w-24 shrink-0 text-ink-400">
                    {formatTime(entry.at)}
                    {entry.until ? `–${formatTime(entry.until)}` : ''}
                  </span>
                  <span
                    className={cn(
                      isProblem(entry) ? 'text-status-red' : 'text-ink-700',
                      entry.kind === 'SCREEN_LOCKED' && 'text-ink-500',
                    )}
                  >
                    {entry.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
