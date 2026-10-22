import { Loader2, LogIn, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/format'

/*
  The day, drawn as a dial.

  A timesheet is a clock face before it is a spreadsheet, so the shift is a
  circle: the ring fills as the day is worked, the faint marks outside it are
  the hours of the shift, and the heavier one is the half-day threshold. The
  punch control sits in the middle because that is the only thing you press.

  Everything around this dial is now ink on paper, which changes what the dial
  has to be. It used to shout to be heard over a coloured interface; in a quiet
  one a heavy ring is the loudest object on the page for no reason. So the
  track is thinner (6 rather than 13) and the whole dial a little smaller —
  enough that the arc still reads as a filled measure from across a desk, and
  the arc's colour is the only chromatic thing on the card.

  The arc takes the day's own status colour, exactly as the calendar would mark
  it: blue while the day is in progress, amber once past the half day, green
  when a full day is done. Nothing here invents a hue of its own.

  Three things make "how much of my day is done" readable at a glance rather
  than by arithmetic:

  * the hour marks light up as they are passed, so the ring can be counted, not
    just estimated;
  * a head dot rides the end of the arc, so the current position is a point and
    not a fading edge;
  * work past the required minutes goes onto a second, thinner inner lap, so a
    long day is visibly a long day instead of a ring that silently stops.

  Motion is limited to the arc easing to its new length and a slow breath on the
  halo while a session is open. Both are neutralised by the global
  prefers-reduced-motion rule.
*/

const SIZE = 200
const CENTRE = SIZE / 2
const RADIUS = 84
/* The ruling weight of the dial. A rule on paper is thin; so is this. */
const RING = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const OVERTIME_RADIUS = RADIUS - 9
const OVERTIME_CIRCUMFERENCE = 2 * Math.PI * OVERTIME_RADIUS

/** Polar to cartesian, with 12 o'clock as zero — how a dial is read. */
function point(fraction: number, radius: number) {
  const angle = (fraction * 360 - 90) * (Math.PI / 180)
  return {
    x: CENTRE + radius * Math.cos(angle),
    y: CENTRE + radius * Math.sin(angle),
  }
}

function Tick({
  fraction,
  className,
  inner,
  outer,
  width = 1.25,
}: {
  fraction: number
  className: string
  inner: number
  outer: number
  width?: number
}) {
  const from = point(fraction, inner)
  const to = point(fraction, outer)
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      strokeWidth={width}
      strokeLinecap="butt"
      className={className}
    />
  )
}

export function PunchDial({
  workedMinutes,
  requiredMinutes,
  halfDayMinutes,
  mode,
  disabled,
  loading,
  onPunch,
}: {
  workedMinutes: number
  requiredMinutes: number
  halfDayMinutes: number
  mode: 'in' | 'out'
  disabled: boolean
  loading: boolean
  onPunch: () => void
}) {
  const required = Math.max(1, requiredMinutes)
  const progress = Math.max(0, Math.min(1, workedMinutes / required))
  const complete = workedMinutes >= requiredMinutes
  const pastHalf = workedMinutes >= halfDayMinutes
  const started = workedMinutes > 0
  const working = mode === 'out'

  // Minutes beyond the full day ride a second, thinner lap inside the ring.
  const overtime = Math.max(0, Math.min(1, (workedMinutes - required) / required))

  /* The calendar's own colours, for the state today is in: green PRESENT,
     amber HALF_DAY, blue IN_PROGRESS. */
  const arcStroke = complete
    ? 'stroke-status-green'
    : pastHalf
      ? 'stroke-status-amber'
      : 'stroke-status-blue'
  const arcFill = complete
    ? 'fill-status-green'
    : pastHalf
      ? 'fill-status-amber'
      : 'fill-status-blue'

  // One faint mark per hour of the shift: the ledger ruler, curved.
  const hours = Math.max(1, Math.round(required / 60))
  const hourTicks = Array.from({ length: hours }, (_, index) => (index + 1) / hours)
  const halfFraction = Math.min(1, halfDayMinutes / required)
  const head = point(progress, RADIUS)

  const label = started
    ? `${formatMinutes(workedMinutes)} worked of ${formatMinutes(requiredMinutes)}${
        complete ? ' — full day complete' : ''
      }`
    : `Not started. A full day is ${formatMinutes(requiredMinutes)}.`

  return (
    <div className="relative aspect-square w-full max-w-[176px] shrink-0">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" role="img" aria-label={label}>
        {/* The empty day: a ruled track, in ink. */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          fill="none"
          strokeWidth={RING}
          className="stroke-ink-100"
        />

        {/* A breath on the ring while a session is open, so a dashboard left on
            a second monitor still reads as running. */}
        {working && (
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            fill="none"
            strokeWidth={RING + 10}
            className={cn('animate-pulse opacity-15', arcStroke)}
            aria-hidden
          />
        )}

        {/* The day so far. */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          fill="none"
          strokeWidth={RING}
          // A round cap at zero would draw a dot on an untouched day.
          strokeLinecap={progress > 0.004 ? 'round' : 'butt'}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
          className={cn(arcStroke, 'transition-[stroke-dashoffset,stroke] duration-700 ease-out')}
        />

        {/* Anything past a full day, on an inner lap. */}
        {overtime > 0 && (
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={OVERTIME_RADIUS}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={OVERTIME_CIRCUMFERENCE}
            strokeDashoffset={OVERTIME_CIRCUMFERENCE * (1 - overtime)}
            transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
            className={cn(
              arcStroke,
              'opacity-45 transition-[stroke-dashoffset] duration-700 ease-out',
            )}
          />
        )}

        {/* Where the day has got to, as a point. */}
        {started && !complete && (
          <circle
            cx={head.x}
            cy={head.y}
            r={2.5}
            className={cn(arcFill, 'transition-all duration-700 ease-out')}
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}

        {/* The hours of the shift. A passed hour is darker, so the ring can be
            counted rather than eyeballed. */}
        {hourTicks.map((fraction) => (
          <Tick
            key={fraction}
            fraction={fraction}
            inner={RADIUS + 7}
            outer={RADIUS + 11}
            className={cn(
              'transition-colors duration-500',
              fraction <= progress + 0.001 ? 'stroke-ink-500' : 'stroke-ink-200',
            )}
          />
        ))}

        {/* The half-day threshold. Once crossed it is a notch cut out of the
            arc; before that it is a mark laid across the empty track. */}
        <Tick
          fraction={halfFraction}
          inner={RADIUS - RING / 2 - 1.5}
          outer={RADIUS + RING / 2 + 1.5}
          width={2}
          className={cn(
            'transition-colors duration-500',
            pastHalf ? 'stroke-white' : 'stroke-ink-300',
          )}
        />
      </svg>

      {/*
        The only thing you press. It is ink, not colour: on this page the arc
        around it is the record, and the record is what gets the hue.
      */}
      <button
        type="button"
        onClick={onPunch}
        disabled={disabled || loading}
        aria-label={
          working
            ? `Punch out. ${formatMinutes(workedMinutes)} worked so far.`
            : `Punch in. ${formatMinutes(workedMinutes)} worked today.`
        }
        className={cn(
          'absolute inset-0 m-auto flex size-[58%] flex-col items-center justify-center gap-1',
          'rounded-full text-white transition',
          'bg-ink-900 hover:bg-ink-800 active:scale-[0.97]',
          'disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400',
          'disabled:hover:bg-ink-100 disabled:active:scale-100',
        )}
      >
        {loading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : working ? (
          <LogOut className="size-5" aria-hidden />
        ) : (
          <LogIn className="size-5" aria-hidden />
        )}
        <span
          aria-hidden
          className="text-[11px] leading-none font-semibold tracking-[0.08em] uppercase"
        >
          {working ? 'Punch out' : 'Punch in'}
        </span>
      </button>
    </div>
  )
}
