import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { clock, type TimeScale } from './timeScale'

/*
  The pieces of a day timeline, shared by the day bar (Employees) and the
  activity bars (Work from home): a scale from the hour before the first
  moment to the hour after the last, on the organisation's clock; hour lines
  and labels; and a legend.
*/

/** Hairlines at every hour, behind the marks. */
export function HourLines({ scale, className }: { scale: TimeScale; className?: string }) {
  return (
    <>
      {scale.hours.map((hour) => (
        <span
          key={hour}
          aria-hidden
          className={cn('absolute w-px bg-ink-100', className)}
          style={{ left: `${scale.at(hour)}%` }}
        />
      ))}
    </>
  )
}

/** The hour labels; on a narrow screen with many hours, every other one. */
export function HourLabels({ scale }: { scale: TimeScale }) {
  const crowded = scale.hours.length > 7
  return (
    <div className="tabular relative h-4 text-[10px] text-ink-400" aria-hidden>
      {scale.hours.map((hour, index) => {
        const first = index === 0
        const last = index === scale.hours.length - 1
        return (
          <span
            key={hour}
            className={cn(
              'absolute top-0',
              crowded && index % 2 === 1 && !last && 'hidden sm:block',
            )}
            style={{
              left: `${scale.at(hour)}%`,
              transform: first ? undefined : last ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {clock(hour)}
          </span>
        )
      })}
    </div>
  )
}

export interface LegendItem {
  swatch: ReactNode
  label: string
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500"
      aria-label="Legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** A small square of colour for the legend. */
export function Swatch({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)} />
  )
}
