import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { apiGet, messageOf } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { punch, SCREEN_SHARE_STOPPED } from '@/lib/punch'
import {
  captureRunning,
  reportStopped,
  runSchedule,
  setShotGuard,
  stopCapture,
  stopSchedule,
  useScreenCapture,
} from '@/lib/screenCapture'
import { useAuth } from '@/store/auth'
import { Button, ErrorNote, Modal, useToast } from '@/components/ui'
import type { TodayState } from '@/types'

const fetchToday = () => apiGet<TodayState>('/attendance/today')

/** Which "you were punched out" prompt was waved away, so it does not come back. */
const DISMISSED_KEY = 'softus.share-prompt-dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(value: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, value)
  } catch {
    // Private windows can refuse storage; the prompt simply may return.
  }
}

/** How long a freshly loaded page waits for another tab to say it holds the shared screen. */
const OTHER_TAB_GRACE_MS = 4000

/*
  Lives in the app shell, so it keeps working whichever page the employee is
  on. For somebody working from home, the working session lasts exactly as
  long as the screen is shared:

  - while punched in and sharing, screenshots run on their random schedule;
  - stop sharing while punched in — the browser's own Stop button, a reload, a
    closed tab — and they are punched out (when the page cannot say so itself,
    the server notices the silence and does it);
  - punched out that way, a prompt asks them to share again and punch back in;
  - punching out on purpose ends the sharing, so nobody is left with a "you are
    sharing your screen" bar over their evening.
*/
export function ScreenCaptureManager() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const workMode = useAuth((state) => state.user?.work_mode)
  const { status, elsewhere, error } = useScreenCapture()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)

  /* The account's mode of work can change mid-session; capture having been
     started by the punch card is reason enough to watch, too. */
  const { data: today } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: fetchToday,
    enabled: workMode === 'WFH' || status === 'active',
    refetchInterval: 120_000,
  })

  const required = Boolean(today?.screen_capture_required)
  const working = Boolean(today?.can_punch_out)
  const intervalMinutes = today?.screen_capture_interval_minutes ?? 10

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['attendance-today'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-calendar'] })
  }, [queryClient])

  // Asked before every scheduled screenshot, so a punch-out made in another
  // tab is respected at once rather than at the next refetch.
  useEffect(() => {
    setShotGuard(async () => {
      const fresh = await queryClient.fetchQuery({
        queryKey: ['attendance-today'],
        queryFn: fetchToday,
        staleTime: 0,
      })
      return Boolean(fresh.can_punch_out && fresh.screen_capture_required)
    })
    return () => setShotGuard(null)
  }, [queryClient])

  useEffect(() => {
    if (required && working && status === 'active') runSchedule(intervalMinutes)
    else stopSchedule()
  }, [required, working, status, intervalMinutes])

  const wasWorking = useRef(false)
  useEffect(() => {
    if (!today) return
    // Only on the change from working to not: the punch card starts sharing a
    // moment *before* the punch-in lands, and must not be undone in between.
    if ((wasWorking.current && !working) || (!required && captureRunning())) stopCapture()
    wasWorking.current = working
  }, [today, working, required])

  // Signing out unmounts the shell; sharing must not outlive the session.
  useEffect(() => () => stopCapture(), [])

  /* ---- sharing stopped while punched in: punch out ---------------------- */
  const lost = required && working && status !== 'active' && status !== 'starting' && !elsewhere
  const reporting = useRef(false)
  useEffect(() => {
    if (!lost) return
    // "Stop sharing" pressed in this tab: at once. A page that has just loaded
    // waits a moment first, for another tab holding the shared screen to speak up.
    const timer = window.setTimeout(
      async () => {
        if (reporting.current) return
        reporting.current = true
        try {
          await reportStopped()
        } catch {
          // The server's own check punches them out within a few minutes.
        } finally {
          reporting.current = false
          refresh()
        }
      },
      status === 'stopped' ? 0 : OTHER_TAB_GRACE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [lost, status, refresh])

  /* ---- punched out that way: ask them back -------------------------------- */
  const lastSession = today?.day.sessions.at(-1)
  const stoppedAt =
    !working && lastSession?.closed_reason === SCREEN_SHARE_STOPPED
      ? (lastSession.punch_out?.at ?? null)
      : null
  const prompting =
    required && stoppedAt !== null && stoppedAt !== dismissed && Boolean(today?.can_punch_in)

  const resume = useMutation({
    mutationFn: () => punch('punch-in', today),
    onSuccess: () => {
      refresh()
      toast.success('Punched in')
    },
  })

  function dismiss() {
    if (stoppedAt) {
      writeDismissed(stoppedAt)
      setDismissed(stoppedAt)
    }
    resume.reset()
  }

  // Sharing is on but a screenshot failed to send. The employee should know
  // before the administrator notices the gap.
  const sendFailure =
    required && working && status === 'active' && error ? (
      <div
        role="status"
        className="mb-5 rounded-lg border border-rule bg-ink-50/70 px-4 py-3 text-[13px] text-ink-600"
      >
        <span className="font-semibold text-ink-900">Screenshots are not reaching the server. </span>
        {error} Sharing is still on, and the next screenshot will try again.
      </div>
    ) : null

  return (
    <>
      {sendFailure}
      {/* Deliberately says only *that* they were punched out, never why: the
          reason is for the administrator, who sees it on the employee's day. */}
      <Modal
        open={prompting}
        onClose={dismiss}
        title="You have been punched out"
        description={stoppedAt ? `At ${formatTime(stoppedAt)}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={dismiss} disabled={resume.isPending}>
              Not now
            </Button>
            <Button onClick={() => resume.mutate()} loading={resume.isPending}>
              <LogIn className="size-4" />
              Punch in
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-ink-600">
          <p>Please punch in again to continue.</p>
          {resume.error && (
            <ErrorNote message={messageOf(resume.error, 'You were not punched in.')} />
          )}
        </div>
      </Modal>
    </>
  )
}
