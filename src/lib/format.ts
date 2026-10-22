import type { AttendanceStatus } from '@/types'

/*
  Every time in this product is the organisation's time.

  These helpers used to hand the browser's own timezone to `toLocale*`, which
  meant a laptop set to another zone rendered every punch, every calendar cell
  and — through `todayKey` — the very date a punch belongs to, shifted by hours.
  An attendance product cannot let the reader's machine decide what day it is.

  The zone is fixed here to match `ORG_TIMEZONE` on the server. `/settings`
  reports it read-only, and `useOrgTimezone` keeps this in step with it, so a
  deployment in another country changes one setting rather than this file.
*/
export const DEFAULT_ORG_TIMEZONE = 'Asia/Kolkata'

let orgTimeZone = DEFAULT_ORG_TIMEZONE

/** Called once the settings response arrives. */
export function setOrgTimeZone(zone: string | null | undefined): void {
  if (!zone) return
  try {
    // Reject a zone this browser cannot resolve rather than throwing on every
    // subsequent format call.
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    orgTimeZone = zone
  } catch {
    orgTimeZone = DEFAULT_ORG_TIMEZONE
  }
}

export function orgTimeZoneName(): string {
  return orgTimeZone
}

/** `545` → `9h 05m`. Zero-padded so a column of durations lines up. */
export function formatMinutes(minutes: number | null | undefined): string {
  const value = Math.max(0, Math.round(minutes ?? 0))
  const hours = Math.floor(value / 60)
  const rest = value % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

/*
  An instant from the API, parsed without letting the browser guess the zone.

  A timestamp that carries no offset — `2026-09-02T04:45:45.308000`, which is
  what a naive UTC datetime serialises to — is read by `new Date()` as *local*
  time. The reader's machine then silently claims a punch made at 10:15 IST
  happened at 04:45. The server is the authority on the instant, and everything
  it stores is UTC, so an offset-less string is treated as UTC here.

  Kept even though the API now sends offsets: the same strings live in records
  written before that, and a fallback that costs one regex is worth more than a
  wrong time on somebody's timesheet.
*/
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/

export function parseInstant(iso: string): Date {
  return new Date(HAS_OFFSET.test(iso) ? iso : `${iso}Z`)
}

/*
  The reverse trip: a wall-clock time somebody typed, turned into an instant.

  When an administrator types 10:15 against a day, they mean 10:15 in the
  office's zone. `new Date('2026-09-02T10:15')` means 10:15 wherever the laptop
  happens to be, so a correction filed from a machine set to UTC landed five and
  a half hours out — and silently, because the form redisplayed what was typed.

  The zone's offset varies by date (and, elsewhere in the world, by DST), so it
  is measured at the instant rather than assumed: read the guess back in the
  target zone, see how far it drifted, correct. Twice, because a guess that
  straddles a DST boundary lands in a different offset than it started in.
*/
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((all, part) => {
      all[part.type] = part.value
      return all
    }, {})

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return asIfUtc - instant.getTime()
}

/** `('2026-09-02', '10:15')` → the ISO instant of 10:15 in the office's zone. */
export function orgWallClockToIso(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const naive = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0)

  let instant = naive - zoneOffsetMs(new Date(naive), orgTimeZone)
  instant = naive - zoneOffsetMs(new Date(instant), orgTimeZone)
  return new Date(instant).toISOString()
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return parseInstant(iso).toLocaleTimeString(undefined, {
    timeZone: orgTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  // A bare `YYYY-MM-DD` is already a calendar day in the organisation's zone,
  // so it is pinned to midday UTC rather than parsed as local midnight — which
  // in a zone behind UTC would roll it back to the previous day.
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : parseInstant(iso)
  return date.toLocaleDateString(undefined, {
    timeZone: iso.length === 10 ? 'UTC' : orgTimeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  return `${formatDate(iso)} · ${formatTime(iso)}`
}

export function formatDayMonth(iso?: string | null): string {
  if (!iso) return '—'
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : parseInstant(iso)
  return date.toLocaleDateString(undefined, {
    timeZone: iso.length === 10 ? 'UTC' : orgTimeZone,
    day: '2-digit',
    month: 'short',
  })
}

/** `2026-03-09` for an input[type=date] and for API date keys.
 *
 *  Read in the organisation's zone, not the browser's: at 00:30 IST a laptop
 *  still set to UTC would call it yesterday and file the correction against
 *  the wrong day.
 */
export function toDateKey(date: Date): string {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the key the API expects.
  return date.toLocaleDateString('en-CA', { timeZone: orgTimeZone })
}

export function todayKey(): string {
  return toDateKey(new Date())
}

/** The parts of "now" in the organisation's zone, for a clock or a heading. */
export function orgNowParts(now: Date = new Date()): { time: string; date: string } {
  return {
    time: now.toLocaleTimeString('en-GB', {
      timeZone: orgTimeZone,
      hour: '2-digit',
      minute: '2-digit',
    }),
    date: now.toLocaleDateString(undefined, {
      timeZone: orgTimeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
  }
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const seconds = Math.round((Date.now() - parseInstant(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

/**
 * Status colour classes. The server sends a colour name with each day; this is
 * the single place that turns it into styling, so the calendar, the day drawer
 * and the register can never disagree.
 */
/* `ink` is the bare text colour, with no fill behind it — what a mark written
   on a ruled page actually is. The other three carry a background. */
const STATUS_STYLES: Record<string, { dot: string; chip: string; bar: string; ink: string }> = {
  green: {
    dot: 'bg-status-green',
    chip: 'bg-status-green-soft text-status-green',
    bar: 'bg-status-green',
    ink: 'text-status-green',
  },
  amber: {
    dot: 'bg-status-amber',
    chip: 'bg-status-amber-soft text-status-amber',
    bar: 'bg-status-amber',
    ink: 'text-status-amber',
  },
  red: {
    dot: 'bg-status-red',
    chip: 'bg-status-red-soft text-status-red',
    bar: 'bg-status-red',
    ink: 'text-status-red',
  },
  violet: {
    dot: 'bg-status-violet',
    chip: 'bg-status-violet-soft text-status-violet',
    bar: 'bg-status-violet',
    ink: 'text-status-violet',
  },
  yellow: {
    dot: 'bg-status-yellow',
    chip: 'bg-status-yellow-soft text-status-yellow',
    bar: 'bg-status-yellow',
    ink: 'text-status-yellow',
  },
  blue: {
    dot: 'bg-status-blue',
    chip: 'bg-status-blue-soft text-status-blue',
    bar: 'bg-status-blue',
    ink: 'text-status-blue',
  },
  grey: {
    dot: 'bg-status-grey',
    chip: 'bg-status-grey-soft text-status-grey',
    bar: 'bg-status-grey',
    ink: 'text-status-grey',
  },
}

export function statusStyle(color: string) {
  return STATUS_STYLES[color] ?? STATUS_STYLES.grey
}

export const STATUS_ORDER: AttendanceStatus[] = [
  'PRESENT',
  'HALF_DAY',
  'SHORT_HOURS',
  'IN_PROGRESS',
  'MISSING_PUNCH_OUT',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'NOT_STARTED',
  'UPCOMING',
  'BEFORE_JOINING',
  'NOT_TRACKED',
]

export function approvalChip(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-status-green-soft text-status-green'
    case 'REJECTED':
      return 'bg-status-red-soft text-status-red'
    case 'CANCELLED':
      return 'bg-status-grey-soft text-status-grey'
    case 'CHANGES_REQUESTED':
      return 'bg-status-amber-soft text-status-amber'
    default:
      // Waiting on a decision. Ink rather than colour is correct — there is no
      // verdict yet to colour — but it has to be a legible ink, not the ramp's
      // near-white first step.
      return 'bg-ink-100 text-ink-800'
  }
}

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

/**
 * Progress colours. Deliberately not the attendance palette: a task being done
 * has nothing to do with a day being green, and reusing the colour would imply
 * it does.
 */
export function progressChip(progress: string): string {
  switch (progress) {
    case 'DONE':
      return 'bg-status-green-soft text-status-green'
    case 'IN_PROGRESS':
      // Progress is a real state of the work, so it takes the status palette.
      // `brand` is the achromatic emphasis ramp now, and a grey chip reads as
      // "nothing is happening" — the opposite of what this means.
      return 'bg-status-blue-soft text-status-blue'
    case 'BLOCKED':
      return 'bg-status-red-soft text-status-red'
    default:
      return 'bg-ink-50 text-ink-500'
  }
}
