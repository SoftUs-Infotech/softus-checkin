import type { CSSProperties } from 'react'
import { formatTime, orgTimeZoneName } from '@/lib/format'

/* The scale of a day timeline (see Timeline.tsx), on the organisation's clock. */

const HOUR = 3_600_000

function minutesPastHour(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: orgTimeZoneName(),
    minute: '2-digit',
  }).formatToParts(new Date(ms))
  return Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
}

/** The hour on the organisation's clock at or before `ms`. */
function hourBefore(ms: number): number {
  const minute = ms - (ms % 60_000)
  return minute - minutesPastHour(minute) * 60_000
}

export interface TimeScale {
  from: number
  to: number
  /** Where `ms` falls, as a percentage of the width. */
  at: (ms: number) => number
  /** Every hour from `from` to `to`. */
  hours: number[]
}

export function timeScale(start: number, end: number): TimeScale {
  const from = hourBefore(start)
  const last = hourBefore(end)
  const to = Math.max(last === end ? end : last + HOUR, from + HOUR)
  const hours: number[] = []
  for (let hour = from; hour <= to; hour += HOUR) hours.push(hour)
  return { from, to, hours, at: (ms) => ((ms - from) / (to - from)) * 100 }
}

/** A span from `start` to `end`, with a 1px gap either side so neighbours stay apart. */
export function spanStyle(scale: TimeScale, start: number, end: number): CSSProperties {
  const left = scale.at(start)
  const width = Math.max(0, scale.at(end) - left)
  return { left: `calc(${left}% + 1px)`, width: `max(2px, calc(${width}% - 2px))` }
}

export function clock(ms: number): string {
  return formatTime(new Date(ms).toISOString())
}
