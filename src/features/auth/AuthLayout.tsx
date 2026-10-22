import { useEffect, useState, type ReactNode } from 'react'

/**
 * The signed-out frame. The left panel states what the product does in the
 * product's own terms — including the desktop-only rule, which is the first
 * surprise a new employee would otherwise hit.
 *
 * The one deliberate risk on this screen is the day ruler at the foot of the
 * panel: a live 24-hour scale with a marker sitting on the actual current
 * minute. An attendance product's whole subject is where you are in the working
 * day, so the sign-in screen shows you that before it asks you for anything —
 * and because it is genuinely live it can never read as decoration. Everything
 * else on the screen is kept deliberately quiet around it.
 *
 * Under the ink-and-paper palette the ruler is drawn entirely in ink: the part
 * of the day already spent is inked in, the part still to come is left faint,
 * and now is the single solid mark on the scale. No status colour appears here,
 * because nothing on this screen is a record of anybody's attendance yet.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink-950 px-12 py-12 text-white lg:flex">
        <Wordmark tone="dark" />

        <div className="max-w-md">
          <h2 className="font-display text-[2.6rem] leading-[1.05] font-semibold text-balance text-white">
            Your working day,
            <br />
            counted honestly.
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-300">
            Punch in when you start, punch out when you finish. The month adds itself up as you go,
            and anything that needs a human decision goes to your administrator.
          </p>

          {/*
            Three columns divided by real rules rather than gaps — the head of a
            register page, where every column is named before anything is
            written under it.
          */}
          <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-ink-700/70 ring-1 ring-ink-700/70">
            {[
              { term: 'Punch from', detail: 'A computer' },
              { term: 'Location', detail: 'Recorded' },
              { term: 'Corrections', detail: 'Approved' },
            ].map((item) => (
              <div key={item.term} className="bg-ink-950 px-4 py-3">
                <dt className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                  {item.term}
                </dt>
                <dd className="mt-1 text-[13px] font-medium text-white">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <DayRuler tone="dark" />
          <p className="mt-6 border-t border-ink-800 pt-4 text-[12px] text-ink-400">
            Punching in and out is only available on a laptop or desktop computer.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          {/* The panel is desktop-only, so the ruler comes with the wordmark on a
              phone: the idea is the product's, not the large screen's. */}
          <div className="mb-8 lg:hidden">
            <Wordmark tone="light" />
            <div className="mt-6 border-y border-rule py-4">
              <DayRuler tone="light" />
            </div>
          </div>

          <h1 className="font-display text-2xl text-balance text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{subtitle}</p>}

          <div className="mt-6">{children}</div>
          {footer && (
            <div className="mt-6 border-t border-rule pt-4 text-[13px] text-ink-500">{footer}</div>
          )}
        </div>
      </main>
    </div>
  )
}

function Wordmark({ tone }: { tone: 'dark' | 'light' }) {
  const dark = tone === 'dark'
  return (
    <div>
      <p
        className={
          dark
            ? 'font-display text-xl font-bold tracking-tight text-white'
            : 'font-display text-lg font-bold tracking-tight text-ink-900'
        }
      >
        Softus
      </p>
      <p
        className={
          dark
            ? 'tabular mt-1 text-[10px] tracking-[0.24em] text-ink-300 uppercase'
            : 'tabular mt-0.5 text-[10px] tracking-[0.24em] text-ink-400 uppercase'
        }
      >
        Checkin
      </p>
    </div>
  )
}

const HOUR_LABELS = [0, 6, 12, 18]

/** Ink weights for the two grounds the ruler is drawn on. Nothing chromatic:
    the status palette belongs to the register, and this is not one yet. */
const RULER_TONES = {
  dark: {
    eyebrow: 'text-ink-400',
    clock: 'text-white',
    track: 'bg-white/10',
    spent: 'bg-white/45',
    tick: 'bg-white/20',
    tickMajor: 'bg-white/45',
    mark: 'bg-white',
    label: 'text-ink-400',
  },
  light: {
    eyebrow: 'text-ink-400',
    clock: 'text-ink-900',
    track: 'bg-ink-100',
    spent: 'bg-ink-500',
    tick: 'bg-ink-200',
    tickMajor: 'bg-ink-400',
    mark: 'bg-ink-900',
    label: 'text-ink-400',
  },
} as const

/**
 * The signature element: the day as a ruler, with now on it. The minute hand
 * moves, so this is a clock rather than an illustration of one — and the scale
 * inks itself in as the day is spent, which is the shape of the whole product
 * in one line.
 */
function DayRuler({ tone }: { tone: 'dark' | 'light' }) {
  const [now, setNow] = useState(() => new Date())
  const ink = RULER_TONES[tone]

  useEffect(() => {
    // Every twenty seconds: the marker never sits visibly behind the clock, and
    // nothing here is expensive enough to care about.
    const timer = window.setInterval(() => setNow(new Date()), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  const minutes = now.getHours() * 60 + now.getMinutes()
  const progress = (minutes / 1440) * 100
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const day = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="max-w-md">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-[10px] font-semibold tracking-[0.2em] uppercase ${ink.eyebrow}`}>
          Right now
        </p>
        <p className={`tabular text-[13px] font-semibold ${ink.clock}`}>
          <span className="sr-only">The time is </span>
          {clock}
        </p>
      </div>

      <div className="relative mt-3 h-9" aria-hidden>
        {/* The baseline: the rule the day is written on. What is behind us is
            inked; what is ahead is still blank paper. */}
        <div className={`absolute inset-x-0 top-5 h-px ${ink.track}`} />
        <div
          className={`absolute top-5 left-0 h-px ${ink.spent}`}
          style={{ width: `${progress}%` }}
        />

        {/* Twenty-four hour ticks, each hour of a day that has to be accounted for. */}
        <div className="absolute inset-x-0 top-0 flex h-5 items-end justify-between">
          {Array.from({ length: 25 }).map((_, hour) => (
            <span
              key={hour}
              className={`w-px ${hour % 6 === 0 ? ink.tickMajor : ink.tick}`}
              style={{ height: hour % 6 === 0 ? '100%' : '40%' }}
            />
          ))}
        </div>

        {/* Now. One solid stem with a stamped square cap — a register mark, not
            a bullet — and the only fully opaque thing on the scale. */}
        <div className={`absolute top-0 h-6 w-[1.5px] ${ink.mark}`} style={{ left: `${progress}%` }}>
          <span className={`absolute -top-[3px] -left-[1.75px] size-[5px] ${ink.mark}`} />
        </div>

        <div className="absolute inset-x-0 top-6 flex justify-between">
          {[...HOUR_LABELS, 24].map((hour) => (
            <span key={hour} className={`tabular text-[9px] tracking-[0.1em] ${ink.label}`}>
              {String(hour).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      <p className={`mt-4 text-[11px] tracking-[0.02em] ${ink.label}`}>{day}</p>
    </div>
  )
}
