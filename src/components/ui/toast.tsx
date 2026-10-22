import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/*
  Confirmation that something happened.

  Every mutation in this product used to succeed in silence: a dialog closed and
  the reader was left to infer from the table whether the thing they clicked
  worked. A toast is the smallest honest answer — it names what happened, in the
  same words as the control that caused it ("Published", not "Success").

  Errors are shown here too but are never the *only* place an error appears: a
  form keeps its inline message, because a toast that has faded is no help to
  somebody still looking at the field.
*/

type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

//: Long enough to read a sentence, short enough not to sit over the table.
const DISMISS_AFTER_MS = 4000

const TONES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'border-status-green/25 bg-status-green-soft text-status-green',
  },
  error: {
    icon: TriangleAlert,
    className: 'border-status-red/25 bg-status-red-soft text-status-red',
  },
  info: { icon: Info, className: 'border-ink-200 bg-white text-ink-800' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  // A ref, not state: an id must never be reused after a fast double action,
  // and re-rendering to bump a counter would be a wasted render.
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      // Three is the most that can be read before the first one has gone.
      setToasts((current) => [...current.slice(-2), { id, tone, message }])
      timers.current.set(id, window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS))
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Polite, not assertive: a confirmation must not interrupt somebody
        // mid-sentence in a field.
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = TONES[toast.tone]
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-lg shadow-ink-950/5',
                className,
              )}
            >
              <Icon className="mt-px size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="-mr-1 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/** Throws outside the provider rather than no-opping — a silent toast is a bug
    that only shows up in production. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>.')
  return api
}
