import { ApiError, apiPost } from '@/lib/api'
import { desktop } from '@/lib/desktop'
import { useAuth } from '@/store/auth'

/*
  The app log: what happened with the desktop app on a work-from-home
  employee's computer — opened, closed, a setting turned off or on, the screen
  could not be seen, a screenshot failed, a popup shown. The server adds the
  punches and automatic punch-outs. Only administrators read it (the Work from
  home page); nothing here is ever shown to the employee.

  Lines wait in a small queue and go with the next check-in when the
  connection is down.
*/

export type AppLogKind =
  | 'APP_OPENED'
  | 'APP_CLOSED'
  | 'SETTING_CHANGED'
  | 'SCREEN_NOT_VISIBLE'
  | 'SCREENSHOT_FAILED'
  | 'POPUP_SHOWN'

type Details = Record<string, string | number | boolean>

interface LogLine {
  at: string
  kind: AppLogKind
  details?: Details
}

const MAX_WAITING = 200
const BATCH = 50

let waiting: LogLine[] = []
let flushing = false

function worksFromHome(): boolean {
  return useAuth.getState().user?.work_mode === 'WFH'
}

export function logEvent(kind: AppLogKind, details?: Details): void {
  if (!desktop || !worksFromHome()) return
  waiting.push({ at: new Date().toISOString(), kind, ...(details ? { details } : {}) })
  if (waiting.length > MAX_WAITING) waiting = waiting.slice(-MAX_WAITING)
  void flushLog()
}

/** Send what is waiting. Lines the server refuses outright are dropped; the rest wait. */
export async function flushLog(): Promise<void> {
  if (flushing || !waiting.length) return
  flushing = true
  try {
    while (waiting.length) {
      const batch = waiting.slice(0, BATCH)
      try {
        await apiPost('/activity/events', { events: batch })
      } catch (error) {
        const refused =
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 408, 429].includes(error.status)
        if (!refused) return
      }
      waiting = waiting.slice(batch.length)
    }
  } finally {
    flushing = false
  }
}

let opened = false

/** Once per start of the app, as soon as somebody working from home is signed in. */
export function logAppOpened(): void {
  if (opened || !desktop || !worksFromHome()) return
  opened = true
  logEvent('APP_OPENED')
}

let settings: Record<'screen' | 'input', string> | null = null

/** macOS: the first reading of each setting, then every change. */
export async function watchSettings(): Promise<void> {
  if (!desktop || desktop.platform !== 'darwin' || !worksFromHome()) return
  const now = await desktop.permissions().catch(() => null)
  if (!now) return
  const next = {
    screen: now.screen === 'granted' ? 'granted' : 'denied',
    input: now.input === 'granted' ? 'granted' : 'denied',
  }
  for (const setting of ['screen', 'input'] as const) {
    const before = settings?.[setting]
    if (before === undefined) logEvent('SETTING_CHANGED', { setting, state: next[setting], first: true })
    else if (before !== next[setting]) logEvent('SETTING_CHANGED', { setting, state: next[setting], first: false })
  }
  settings = next
}

if (desktop) {
  desktop.onClosing(async () => {
    logEvent('APP_CLOSED')
    await flushLog()
  })
}
