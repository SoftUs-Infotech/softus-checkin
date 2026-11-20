import { Activity } from 'lucide-react'
import { formatMinutes, formatTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui'
import { HourLabels, HourLines, Legend, Swatch } from './Timeline'
import { spanStyle, timeScale } from './timeScale'
import type { ActivityDay, ActivityFlag, ActivityWindow } from '@/types'

/*
  What the desktop app measured for one person's day: active time against the
  time it was tracking, the count of key presses and clicks, and the windows
  worth a second look. Only counts exist — never what was typed.
*/

const FLAG_LABEL: Record<ActivityFlag, string> = {
  idle: 'Idle',
  locked: 'Screen locked',
  mouse_only: 'Mouse only, screen unchanged',
  screen_only: 'Screen changing, no input',
  virtual_input: 'Input from software',
}

const FLAG_HINT: Record<ActivityFlag, string> = {
  idle: 'Almost no keyboard or mouse use in this window.',
  locked: 'The screen was locked for most of this window.',
  mouse_only:
    'The pointer kept moving, but there was not one key press, click or scroll, and the screen never changed — what a mouse jiggler looks like.',
  screen_only: 'The screen kept changing with nobody using the keyboard or mouse — a video left playing, for example.',
  virtual_input:
    'Much of the keyboard or mouse input came from a program rather than a real keyboard or mouse — remote-control software, or a "mouse jiggler".',
}

const LEVEL_BAR: Record<ActivityWindow['level'], string> = {
  high: 'bg-status-green',
  medium: 'bg-status-amber',
  low: 'bg-status-red',
}

function count(value: number): string {
  return value.toLocaleString()
}

export function ActivitySummary({ day }: { day: ActivityDay | undefined }) {
  if (!day || day.totals.tracked_minutes === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-rule px-5 py-3 text-[12px] text-ink-400">
        <Activity className="size-3.5" aria-hidden />
        No activity recorded on this day. Activity comes from the desktop app.
      </div>
    )
  }
  const { totals } = day
  const flagged = day.windows.filter((window) => window.flags.length > 0)
  return (
    <div className="border-b border-rule px-5 py-3" data-testid="activity-summary">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-ink-600">
        <span className="flex items-center gap-1.5 font-semibold text-ink-900">
          <Activity className="size-3.5" aria-hidden />
          Active {formatMinutes(Math.round(totals.active_seconds / 60))} of{' '}
          {formatMinutes(totals.tracked_minutes)} ({day.active_percent}%)
        </span>
        <span className="tabular">{count(totals.keys)} key presses</span>
        <span className="tabular">{count(totals.clicks)} clicks</span>
        {totals.locked_seconds > 0 && (
          <span className="tabular">locked {formatMinutes(Math.round(totals.locked_seconds / 60))}</span>
        )}
        <span className={cn('tabular', flagged.length ? 'text-status-red' : 'text-ink-400')}>
          {flagged.length ? `${flagged.length} window${flagged.length === 1 ? '' : 's'} to check` : 'Nothing flagged'}
        </span>
      </div>
      <ActivityTimeline windows={day.windows} />
    </div>
  )
}

/*
  One bar per window on the day's timeline: where it sits is when, its height
  how much of it was active, its colour the level, and a red ring a window to
  check. Hover a bar for its figures; the screenshots below carry the same.
*/
function ActivityTimeline({ windows }: { windows: ActivityWindow[] }) {
  if (!windows.length) return null
  const start = new Date(windows[0].start).getTime()
  const end = new Date(windows[windows.length - 1].end).getTime()
  const scale = timeScale(start, end)
  const flagged = windows.some((window) => window.flags.length > 0)
  return (
    <figure className="mt-3" data-testid="activity-timeline" aria-label="Activity through the day">
      <div className="relative h-10">
        <HourLines scale={scale} className="inset-y-0" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-ink-200" />
        {windows.map((window) => (
          <span
            key={window.start}
            title={`${formatTime(window.start)}–${formatTime(window.end)}: active ${window.active_percent}%, ${count(window.keys)} keys, ${count(window.clicks)} clicks${window.flags.length ? ` — ${window.flags.map((flag) => FLAG_LABEL[flag]).join(', ')}` : ''}`}
            className={cn(
              'absolute bottom-0 rounded-t-[3px]',
              LEVEL_BAR[window.level],
              window.flags.length > 0 && 'ring-1 ring-status-red ring-offset-1',
            )}
            style={{
              ...spanStyle(scale, new Date(window.start).getTime(), new Date(window.end).getTime()),
              height: `${Math.max(8, window.active_percent)}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-1">
        <HourLabels scale={scale} />
      </div>
      <Legend
        items={[
          { swatch: <Swatch className="bg-status-green" />, label: 'High activity (50%+)' },
          { swatch: <Swatch className="bg-status-amber" />, label: 'Medium (20–49%)' },
          { swatch: <Swatch className="bg-status-red" />, label: 'Low (under 20%)' },
          ...(flagged
            ? [
                {
                  swatch: <Swatch className="bg-white ring-1 ring-status-red ring-offset-1" />,
                  label: 'To check — hover the bar for why',
                },
              ]
            : []),
        ]}
      />
      <p className="mt-1 text-[11px] text-ink-400">Bar height: how much of the window was active.</p>
    </figure>
  )
}

/** Under one screenshot: the activity of the window it was taken in. */
export function ShotActivity({ window }: { window: ActivityWindow | undefined }) {
  if (!window) return null
  return (
    <div className="mt-0.5 text-[11px] text-ink-500" data-testid="shot-activity">
      <span className="tabular">
        Active {window.active_percent}% · {count(window.keys)} keys · {count(window.clicks)} clicks
      </span>
      {window.flags.length > 0 && (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {window.flags.map((flag) => (
            <span key={flag} title={FLAG_HINT[flag]}>
              <Badge tone="red">{FLAG_LABEL[flag]}</Badge>
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
