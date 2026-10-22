import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'
import { Loader2, MoreHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export { ToastProvider, useToast } from './toast'

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

/*
  Ink, not a brand colour. See the palette note in `index.css`: the only
  chromatic pixels in this product belong to the status palette, so an absence
  in the register is the only red thing on screen. `danger` and `success` are
  the exceptions and they earn it — they *are* a verdict.
*/
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950',
  secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 hover:border-ink-300',
  ghost: 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
  danger: 'bg-status-red text-white hover:brightness-95',
  success: 'bg-status-green text-white hover:brightness-95',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */
const FIELD_BASE =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-ink-300 transition-colors focus:border-ink-800 ' +
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, 'h-10', className)} {...props} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD_BASE, 'min-h-24 resize-y', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(FIELD_BASE, 'h-10 pr-8', className)} {...props}>
        {children}
      </select>
    )
  },
)

/*
  A checkbox with a real indeterminate state.

  "Some but not all of these are selected" cannot be expressed through the
  `checked` attribute — it is a DOM property that has to be set imperatively,
  which is why hand-rolled select-all boxes always end up lying about what is
  selected. Setting it here means every caller gets it right.
*/
export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }
>(function Checkbox({ className, indeterminate, ...props }, forwarded) {
  const own = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const node = own.current
    if (node) node.indeterminate = Boolean(indeterminate) && !props.checked
  }, [indeterminate, props.checked])

  return (
    <input
      type="checkbox"
      ref={(node) => {
        own.current = node
        if (typeof forwarded === 'function') forwarded(node)
        else if (forwarded) forwarded.current = node
      }}
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded border-ink-300 accent-ink-900',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
})

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  below,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
  /** Anything that belongs to the field but sits under its hint — a live
      password checklist, a running cost, a preview of what will be saved. */
  below?: ReactNode
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-status-red">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-status-red">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-400">{hint}</span>
      ) : null}
      {below && <div className="mt-2">{below}</div>}
    </label>
  )
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */
export function Card({ className, children }: { className?: string; children?: ReactNode }) {
  return <section className={cn('card', className)}>{children}</section>
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] leading-tight text-ink-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

/*
  The status palette is the calendar legend, so a badge may only borrow it to
  mean the thing the legend means. `neutral` and `brand` carry no status.
*/
const BADGE_TONES = {
  neutral: 'bg-ink-50 text-ink-500',
  brand: 'bg-ink-100 text-ink-800',
  /** A struck mark. For the one state in a pair that is definitely *on* —
      `neutral` and `brand` are close enough that they never read as opposites. */
  stamp: 'bg-ink-900 text-white',
  green: 'bg-status-green-soft text-status-green',
  amber: 'bg-status-amber-soft text-status-amber',
  red: 'bg-status-red-soft text-status-red',
  blue: 'bg-status-blue-soft text-status-blue',
  violet: 'bg-status-violet-soft text-status-violet',
  yellow: 'bg-status-yellow-soft text-status-yellow',
} as const

export type BadgeTone = keyof typeof BADGE_TONES

export function Badge({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode
  className?: string
  tone?: BadgeTone
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Loading placeholders                                                        */
/* -------------------------------------------------------------------------- */
/*
  A skeleton in the shape of the thing that is coming, rather than a spinner in
  the middle of an empty page. The layout does not jump when the data lands,
  which is the whole point — a spinner tells you to wait, a skeleton tells you
  what you are waiting for.
*/
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('skeleton block rounded-md', className)} aria-hidden />
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="px-4 py-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-ink-50 py-3 last:border-0">
          {Array.from({ length: columns }).map((_, column) => (
            <Skeleton
              key={column}
              className={cn('h-3.5', column === 0 ? 'w-[22%]' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5 px-5 py-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  )
}

export function CalendarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto grid max-w-[28rem] grid-cols-7 gap-1.5', className)} aria-busy="true">
      {/* The weekday header is part of the grid it stands in for. Without these
          the real calendar is a row taller than its own placeholder, and the
          page jumps at exactly the moment the reader starts looking at it. */}
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton key={`weekday-${index}`} className="mx-auto mb-1 h-2.5 w-3" />
      ))}
      {Array.from({ length: 35 }).map((_, index) => (
        <Skeleton key={index} className="aspect-square w-full" />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page furniture                                                              */
/* -------------------------------------------------------------------------- */
/*
  Every list page grew its own filter bar, so no two lined up. One wrapper means
  the search box sits in the same place on every screen — which is the only
  reason a filter bar is ever quick to use.
*/
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2.5', className)}>{children}</div>
  )
}

/** A number worth reading at a glance, with the word that makes it mean
    something. `tone` is for counts that are themselves a status. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
  active,
  swatch,
}: {
  label: string
  value: ReactNode
  /** A node, not a string: a hint carrying figures needs `.tabular` on them. */
  hint?: ReactNode
  tone?: BadgeTone
  onClick?: () => void
  active?: boolean
  /** A colour the server owns — a leave type's colour on the calendar, say.
      Passed as a CSS colour because it is data, not one of our tokens. */
  swatch?: string
}) {
  const Element = onClick ? 'button' : 'div'
  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      // A tile used as a filter is a toggle, and a toggle that only signals
      // itself with a ring is invisible to a screen reader.
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={cn(
        'card px-4 py-3 text-left transition-colors',
        onClick && 'hover:border-ink-300',
        active && 'border-ink-900 ring-1 ring-ink-900',
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
        {swatch && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: swatch }}
          />
        )}
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 text-2xl leading-none font-semibold',
          tone === 'neutral' ? 'text-ink-900' : BADGE_TONES[tone].split(' ')[1],
        )}
      >
        {value}
      </p>
      {hint && <div className="mt-1 text-[12px] text-ink-400">{hint}</div>}
    </Element>
  )
}

/** Two or three mutually exclusive views of the same data. Not tabs — tabs
    imply separate pages; this switches what one page is showing. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex rounded-lg border border-ink-200 bg-white p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[6px] px-3 py-1.5 text-[13px] transition-colors',
            option.value === value
              ? 'bg-ink-900 font-medium text-white'
              : 'text-ink-500 hover:text-ink-900',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */
export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
  tone,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  /** For a narrow card — a dashboard rail section — where the full height
      would push everything below it off the screen. */
  compact?: boolean
  /** The icon's colour. "Nothing needs you today" is good news and should not
      be drawn in the same grey as "nothing loaded". */
  tone?: BadgeTone
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 text-center',
        compact ? 'py-7' : 'py-14',
      )}
    >
      {icon && (
        <div className={cn('mb-1', tone ? BADGE_TONES[tone].split(' ')[1] : 'text-ink-300')}>
          {icon}
        </div>
      )}
      <p className="font-display text-[15px] text-ink-800">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-ink-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-10 text-ink-300', className)}>
      <Loader2 className="size-5 animate-spin" aria-label="Loading" />
    </div>
  )
}

export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-lg border border-status-red/25 bg-status-red-soft px-3 py-2 text-[13px] text-status-red',
        className,
      )}
    >
      {message}
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <ModalShell open={open} onClose={onClose} title={title} wide={wide}>
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-base text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-400">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <footer className="flex justify-end gap-2 border-t border-rule px-5 py-3">
          {footer}
        </footer>
      )}
    </ModalShell>
  )
}

/*
  The parts of a dialog that are behaviour rather than layout: Escape closes it,
  a click on the backdrop closes it, the page behind stops scrolling, and focus
  moves into the dialog so a keyboard user is not left tabbing through the page
  underneath. None of that was here before, and a dialog you can only leave by
  finding the small × is a dialog people feel trapped by.
*/
function ModalShell({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    // The panel itself, not the first control: focusing a text field would
    // pop the keyboard open on a phone before anybody has read the question.
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        // mousedown on the backdrop only: mouseup landing here after a drag
        // that started inside the dialog is a text selection, not a dismissal.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'modal-panel max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */
export function Table({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    // `relative` makes the scroller the containing block of anything absolutely
    // placed inside a cell — a visually hidden label, say. Without it those
    // escape the scroll box and widen the whole page past the screen edge.
    <div {...props} className={cn('scrollbar-thin relative overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  )
}

/** A row that reacts to the pointer. Rows are read one at a time; without this
    the eye loses its place halfway across a wide register. */
export function Tr({
  children,
  className,
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'transition-colors hover:bg-ink-50/70',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function Th({
  children,
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  /** Figures read right-aligned, so the digits line up under each other. */
  numeric?: boolean
}) {
  return (
    <th
      // Spread, so a sortable column can carry `aria-sort` — a screen reader
      // has no other way to learn which column the table is ordered by.
      {...props}
      className={cn(
        // Sticky, so scrolling a long register does not lose the column names.
        'sticky top-0 z-10 border-b border-ink-300 bg-white px-4 py-2.5 text-[11px] font-semibold tracking-wider text-ink-500 uppercase',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  numeric,
}: {
  children?: ReactNode
  className?: string
  numeric?: boolean
}) {
  return (
    <td
      className={cn(
        'border-b border-rule px-4 py-3 align-middle text-ink-700',
        numeric && 'tabular text-right',
        className,
      )}
    >
      {children}
    </td>
  )
}

/* -------------------------------------------------------------------------- */
/* Row menu                                                                    */
/* -------------------------------------------------------------------------- */
export interface RowMenuItem {
  label: string
  onSelect: () => void
  /** Irreversible or access-changing: drawn in the verdict red. */
  danger?: boolean
}

/*
  The rarely-used actions on a table row, behind one "more" button.

  The panel is `position: fixed` and placed from the trigger's rectangle
  because a table scrolls sideways inside an `overflow-x-auto` box, and an
  absolutely placed menu would be cut off by that box at the last row. Any
  scroll or resize closes it rather than leaving it floating over the wrong row.
*/
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top?: number; bottom?: number; right: number } | null>(
    null,
  )

  const close = () => setPlace(null)

  useEffect(() => {
    if (!place) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close()
        trigger.current?.focus()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const options = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
        const at = options.indexOf(document.activeElement as HTMLButtonElement)
        const step = event.key === 'ArrowDown' ? 1 : -1
        options[(at + step + options.length) % options.length]?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [place])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(place)}
        onClick={() => {
          if (place) return close()
          const box = trigger.current!.getBoundingClientRect()
          const right = window.innerWidth - box.right
          // The last rows of a long table sit at the foot of the screen; open
          // upwards there rather than off the bottom edge.
          const height = items.length * 36 + 8
          setPlace(
            box.bottom + 4 + height > window.innerHeight
              ? { bottom: window.innerHeight - box.top + 4, right }
              : { top: box.bottom + 4, right },
          )
        }}
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {place && (
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          style={{ top: place.top, bottom: place.bottom, right: place.right }}
          className="fixed z-40 min-w-40 rounded-lg border border-ink-100 bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                item.onSelect()
              }}
              className={cn(
                'block w-full rounded-md px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors',
                item.danger
                  ? 'text-status-red hover:bg-status-red-soft focus:bg-status-red-soft'
                  : 'text-ink-700 hover:bg-ink-50 focus:bg-ink-50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  )
}
