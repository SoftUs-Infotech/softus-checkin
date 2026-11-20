import { create } from 'zustand'
import { API_BASE, apiPost, apiUpload, messageOf, readTokens } from '@/lib/api'
import { flushLog, logEvent, watchSettings } from '@/lib/appLog'
import { problemNotice, useCaptureProblem, type CaptureProblemReason } from '@/lib/captureProblem'
import { desktop, permissionProblem, type ActivityMinute, type CaptureHealth } from '@/lib/desktop'
import { deviceProfileHeader } from '@/lib/device'

/*
  Screen capture for people working from home.

  A web page cannot look at a screen without asking: the browser shows its own
  picker, the employee chooses their screen, and the browser keeps a "you are
  sharing" indicator up for as long as it lasts. That is the deal this module
  works within — it never tries to hide.

  Once shared, the stream lives here, at module level, so moving between pages
  of the app does not end it. A reload or a closed tab does; the capture
  manager in the app shell notices and asks the employee to share again.

  Screenshots are taken at a random moment inside every window of N minutes
  (N is the organisation's setting), so the timing cannot be predicted. One is
  also taken the moment "punch in" is pressed: the server will not accept a
  punch-in from home without a screenshot from the last few minutes.

  The working session lasts exactly as long as the sharing. While punched in,
  the page checks in with the server every 30 seconds; stopping sharing, or
  closing or reloading the page, is reported at once and punches the employee
  out. When the page cannot report — a crash, a sleeping laptop — the server
  notices the silence and punches them out at the last check-in.

  In the desktop app none of the browser's sharing applies: the app captures
  every display itself once macOS has allowed it, counts activity (key presses,
  clicks, the screen changing — never what was typed), and this module sends
  that activity along with the 30-second check-in.
*/

export type CaptureStatus = 'idle' | 'starting' | 'active' | 'stopped' | 'denied' | 'unsupported'

interface CaptureState {
  status: CaptureStatus
  /** When the last screenshot reached the server, as epoch milliseconds. */
  lastShotAt: number | null
  error: string | null
  /** Another tab of the app holds the shared screen, so this one need not. */
  elsewhere: boolean
  /** When the desktop app last punched out because it lost the screen. */
  lostAt: number
}

/** Captures are scaled down to this width: plenty to read a screen, a fraction of the bytes. */
const MAX_WIDTH = 1600
const JPEG_QUALITY = 0.7

export function captureSupported(): boolean {
  if (desktop) return true
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
}

export const useScreenCapture = create<CaptureState>(() => ({
  status: captureSupported() ? 'idle' : 'unsupported',
  lastShotAt: null,
  error: null,
  elsewhere: false,
  lostAt: 0,
}))

const set = useScreenCapture.setState

/*
  What the employee is told when punching in fails. The app never explains
  screen capture (office policy does). The only time it names the screen is
  when the whole screen was not shared, and then only as what to do to punch
  in. Every other failure reads as an ordinary punch-in failure.
*/
export const PUNCH_IN_FAILED = 'Punch in failed. Please try again.'
const SHARE_ENTIRE_SCREEN = 'To punch in, please share your entire screen.'
const ALLOW_SCREEN_ON_MAC =
  'To punch in, allow your browser to share your entire screen. On a Mac: System Settings → Privacy & Security → Screen Recording, turn your browser on, then restart the browser.'
const USE_CHROME_OR_EDGE = 'This browser is not supported. Please use Chrome or Edge.'

/** A failure worth showing to the employee in its own words. */
export class CaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureError'
  }
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
/** The desktop app is capturing and tracking for this punched-in session. */
let desktopActive = false

export function captureRunning(): boolean {
  return desktop ? desktopActive : Boolean(stream?.active)
}

/* -------------------------------------------------------------------------- */
/* Starting and stopping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ask the employee to share their screen. Must be called from a click (or very
 * soon after one): browsers only show the picker in response to the person.
 */
export async function startCapture(): Promise<void> {
  if (captureRunning()) return
  if (desktop) return startDesktop()
  if (!captureSupported()) {
    set({ status: 'unsupported' })
    throw new CaptureError(USE_CHROME_OR_EDGE)
  }

  set({ status: 'starting', error: null })
  let media: MediaStream
  try {
    media = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor', frameRate: { max: 5 } },
      audio: false,
      // Chrome's hints for the picker: offer whole screens, not this tab.
      // Other browsers ignore what they do not know.
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch (error) {
    // Chrome says "Permission denied by system" when the operating system, not
    // the employee, refused — a Mac where the browser has not been allowed to
    // record the screen. Without that permission it cannot see other apps.
    const blockedBySystem =
      error instanceof DOMException && error.name === 'NotAllowedError' && /system/i.test(error.message)
    const cancelled =
      !blockedBySystem &&
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'AbortError')
    const message = blockedBySystem ? ALLOW_SCREEN_ON_MAC : SHARE_ENTIRE_SCREEN
    set({ status: cancelled ? 'denied' : 'stopped', error: message })
    throw new CaptureError(message)
  }

  const [track] = media.getVideoTracks()
  // Only the entire screen is accepted, and only when the browser confirms it:
  // a single window or tab would show only what the employee chose to show,
  // and a browser that does not say what was shared cannot prove it was whole.
  const surface = track?.getSettings().displaySurface
  if (!track || surface !== 'monitor') {
    media.getTracks().forEach((each) => each.stop())
    const message = surface ? SHARE_ENTIRE_SCREEN : USE_CHROME_OR_EDGE
    set({ status: 'stopped', error: message })
    throw new CaptureError(message)
  }

  track.addEventListener('ended', onTrackEnded)
  stream = media
  video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = media
  await video.play().catch(() => undefined)

  set({ status: 'active', error: null })
  announce('active')
}

/** The desktop app: no picker — the permissions, then capture and tracking. */
async function startDesktop(): Promise<void> {
  if (!desktop) return
  set({ status: 'starting', error: null })
  const problem = permissionProblem(await desktop.permissions())
  if (problem) {
    set({ status: 'denied', error: problem })
    throw new CaptureError(problem)
  }
  const started = await desktop.startTracking()
  if (!started.ok) {
    set({ status: 'stopped', error: PUNCH_IN_FAILED })
    throw new CaptureError(PUNCH_IN_FAILED)
  }
  desktopActive = true
  set({ status: 'active', error: null })
  announce('active')
}

/** The employee pressed the browser's own "Stop sharing", or the screen went away. */
function onTrackEnded() {
  teardown()
  set({ status: 'stopped' })
  announce('stopped')
}

function teardown() {
  stopSchedule()
  stream?.getTracks().forEach((track) => {
    track.removeEventListener('ended', onTrackEnded)
    track.stop()
  })
  stream = null
  if (video) {
    video.srcObject = null
    video = null
  }
}

/** End sharing on purpose — at punch-out, or when signing out. */
export function stopCapture() {
  if (desktop) {
    if (!desktopActive) return
    desktopActive = false
    stopSchedule()
    set({ status: 'idle' })
    announce('stopped')
    // The minute in progress is closed and sent, so a day's activity ends where the day did.
    void desktop
      .stopTracking()
      .then(flushActivity)
      .catch(() => undefined)
    return
  }
  if (!stream) return
  teardown()
  set({ status: 'idle' })
  announce('stopped')
}

/* -------------------------------------------------------------------------- */
/* Taking a screenshot                                                         */
/* -------------------------------------------------------------------------- */

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>
}

/** `ImageCapture` keeps working in a background tab; a <video> may not. */
function imageCaptureFor(track: MediaStreamTrack): ImageCaptureLike | null {
  const Ctor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike })
    .ImageCapture
  return Ctor ? new Ctor(track) : null
}

async function videoReady(element: HTMLVideoElement): Promise<void> {
  if (element.videoWidth > 0) return
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    element.addEventListener('loadeddata', done, { once: true })
    window.setTimeout(done, 3000)
  })
}

/** A screenshot the app could not take, for the administrator's app log. */
function shotFailed(error: string) {
  logEvent('SCREENSHOT_FAILED', { error })
}

/** Every display, side by side as they are arranged, in one picture. */
async function grabDesktop(): Promise<{ blob: Blob; width: number; height: number }> {
  if (!desktop || !desktopActive) throw new CaptureError(PUNCH_IN_FAILED)
  let screens: Awaited<ReturnType<typeof desktop.captureScreens>>
  try {
    screens = await desktop.captureScreens(MAX_WIDTH)
  } catch (error) {
    shotFailed(messageOf(error, 'the screen did not answer'))
    throw new CaptureError(PUNCH_IN_FAILED)
  }
  if (!screens.length) {
    shotFailed('no picture of the screen came back')
    throw new CaptureError(PUNCH_IN_FAILED)
  }

  const left = Math.min(...screens.map((s) => s.x))
  const top = Math.min(...screens.map((s) => s.y))
  const right = Math.max(...screens.map((s) => s.x + s.boundsWidth))
  const bottom = Math.max(...screens.map((s) => s.y + s.boundsHeight))
  const scale = Math.min(1, MAX_WIDTH / (right - left))
  const width = Math.max(1, Math.round((right - left) * scale))
  const height = Math.max(1, Math.round((bottom - top) * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new CaptureError(PUNCH_IN_FAILED)
  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  for (const screen of screens) {
    const bitmap = await createImageBitmap(new Blob([screen.data], { type: 'image/jpeg' }))
    context.drawImage(
      bitmap,
      Math.round((screen.x - left) * scale),
      Math.round((screen.y - top) * scale),
      Math.round(screen.boundsWidth * scale),
      Math.round(screen.boundsHeight * scale),
    )
    bitmap.close()
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  if (!blob) throw new CaptureError(PUNCH_IN_FAILED)
  return { blob, width, height }
}

async function grab(): Promise<{ blob: Blob; width: number; height: number }> {
  if (desktop) return grabDesktop()
  const track = stream?.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') {
    throw new CaptureError(PUNCH_IN_FAILED)
  }

  let source: CanvasImageSource | null = null
  let sourceWidth = 0
  let sourceHeight = 0
  let bitmap: ImageBitmap | null = null

  const imageCapture = imageCaptureFor(track)
  if (imageCapture) {
    try {
      bitmap = await imageCapture.grabFrame()
      source = bitmap
      sourceWidth = bitmap.width
      sourceHeight = bitmap.height
    } catch {
      bitmap = null
    }
  }
  if (!source && video) {
    await videoReady(video)
    source = video
    sourceWidth = video.videoWidth
    sourceHeight = video.videoHeight
  }
  if (!source || !sourceWidth || !sourceHeight) {
    throw new CaptureError(PUNCH_IN_FAILED)
  }

  const scale = Math.min(1, MAX_WIDTH / sourceWidth)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height)
  bitmap?.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  if (!blob) throw new CaptureError(PUNCH_IN_FAILED)
  return { blob, width, height }
}

/** Take a screenshot now and send it. */
export async function captureNow(): Promise<void> {
  const shot = await grab()
  await apiUpload('/screenshots', {
    file: new File([shot.blob], 'screen.jpg', { type: 'image/jpeg' }),
    width: shot.width,
    height: shot.height,
  })
  set({ lastShotAt: Date.now(), error: null })
}

/* -------------------------------------------------------------------------- */
/* The random schedule                                                         */
/* -------------------------------------------------------------------------- */

let timer: number | null = null
let heartbeatTimer: number | null = null
let scheduling = false
let windowMs = 10 * 60_000
let windowStart = 0
/** Asked before every scheduled screenshot: is this person still punched in? */
let shotGuard: (() => Promise<boolean>) | null = null

export function setShotGuard(guard: (() => Promise<boolean>) | null) {
  shotGuard = guard
}

/** How often the page tells the server the screen is still shared. */
const HEARTBEAT_MS = 30_000

function sendHeartbeat() {
  // A missed beat is not an error worth showing: the server allows for a few.
  if (captureRunning()) apiPost('/screenshots/heartbeat').catch(() => undefined)
  if (desktop) {
    void flushActivity()
    void flushLog()
  }
}

/* -------------------------------------------------------------------------- */
/* The desktop app watching that it can still see the screen                   */
/* -------------------------------------------------------------------------- */
/*
  Every 15 seconds while punched in. On macOS, Screen Recording or
  Accessibility turned off ends the session at once; anywhere, a screen the
  app has not been able to see for a minute while the person was at the
  computer (not locked, not away, not asleep) ends it too. Either way the
  session ends at the last moment the screen was seen, the window comes to the
  front, and the popup asks for the setting — nothing more.

  Ten minutes without any use of the keyboard or mouse (the screen locked
  that long counts) ends the session at the last use, with "Your PC was idle".
*/
const WATCH_EVERY_MS = 15_000
const UNSEEN_LIMIT_MS = 60_000
let watchTimer: number | null = null
let losing = false

async function watchDesktop(): Promise<void> {
  if (!desktop?.captureHealth || !desktopActive || losing) return
  const health = await desktop.captureHealth().catch(() => null)
  if (!health?.running || !desktopActive) return
  if (desktop.platform === 'darwin' && health.screen !== 'granted') {
    return captureLost('SETTING_OFF', health, 'screen')
  }
  if (desktop.platform === 'darwin' && health.input !== 'granted') {
    return captureLost('SETTING_OFF', health, 'input')
  }
  if (health.idleSince) return captureLost('IDLE', health)
  if (health.unseenMs >= UNSEEN_LIMIT_MS) return captureLost('SCREEN_NOT_VISIBLE', health)
}

async function captureLost(
  reason: CaptureProblemReason,
  health: CaptureHealth,
  setting?: 'screen' | 'input',
): Promise<void> {
  if (!desktop || losing) return
  losing = true
  try {
    // The log says what changed before it says what was done about it.
    if (reason === 'SETTING_OFF') await watchSettings().catch(() => undefined)
    if (reason === 'SCREEN_NOT_VISIBLE') {
      logEvent('SCREEN_NOT_VISIBLE', {
        seconds: Math.round(health.unseenMs / 1000),
        reported: health.screen === 'granted' ? 'on' : 'off',
      })
    }
    // Idle is not a lost screen: nothing to restart for on macOS.
    if (reason !== 'IDLE') void desktop.reportCaptureLost?.()
    const at = (reason === 'IDLE' ? health.idleSince : health.lastSeenAt) ?? new Date().toISOString()
    const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(at)) / 60_000))
    try {
      await reportStopped({ reason, at, setting })
    } catch {
      // The capture manager says so again, and the server notices the silence.
    }
    stopCapture()
    set({ lostAt: Date.now() })
    useCaptureProblem.getState().show({ reason, punchedOut: true, minutes })
    void desktop.attention?.({ title: 'Softus Checkin', body: problemNotice(desktop.platform, reason, minutes) })
  } finally {
    losing = false
  }
}

/* Minutes the app measured, waiting to reach the server. Kept through a lost
   connection (up to two days of them) and sent with the next check-in. */
let unsentActivity: ActivityMinute[] = []
let flushing = false
const MAX_UNSENT = 2880

async function flushActivity(): Promise<void> {
  if (!desktop || flushing) return
  flushing = true
  try {
    unsentActivity.push(...(await desktop.takeActivity()))
    while (unsentActivity.length) {
      const batch = unsentActivity.slice(0, 720)
      await apiPost('/activity', { minutes: batch })
      unsentActivity = unsentActivity.slice(batch.length)
    }
  } catch {
    unsentActivity = unsentActivity.slice(-MAX_UNSENT)
  } finally {
    flushing = false
  }
}

/**
 * While punched in: one screenshot at a random moment in every window of
 * `minutes`, and a check-in every 30 seconds. Calling it again with the same
 * interval leaves the running schedule alone.
 */
export function runSchedule(minutes: number) {
  const next = Math.max(1, minutes) * 60_000
  if (scheduling && next === windowMs) return
  stopSchedule()
  scheduling = true
  windowMs = next
  // Windows line up with the clock (10:00, 10:10, …), which is how the admin
  // page groups activity: one screenshot falls in every window.
  windowStart = Math.floor(Date.now() / windowMs) * windowMs
  scheduleNext()
  sendHeartbeat()
  heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_MS)
  if (desktop) watchTimer = window.setInterval(() => void watchDesktop(), WATCH_EVERY_MS)
}

export function stopSchedule() {
  scheduling = false
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
  heartbeatTimer = null
  if (watchTimer !== null) window.clearInterval(watchTimer)
  watchTimer = null
}

/** Why the screen went, as the server takes it. */
export interface StoppedReport {
  reason: 'SETTING_OFF' | 'SCREEN_NOT_VISIBLE' | 'IDLE' | 'APP_CLOSED' | 'SHARING_STOPPED'
  /** The last moment the screen was visible (IDLE: the last use); the session ends there. */
  at?: string
  setting?: 'screen' | 'input'
}

/** Sharing stopped while punched in: the server punches the employee out. */
export function reportStopped(report?: StoppedReport): Promise<unknown> {
  return apiPost('/screenshots/stopped', report)
}

/*
  The page is closing or reloading while punched in and sharing: sharing ends
  with it, so say so now. `keepalive` lets the request outlive the page, and
  unlike `sendBeacon` it can carry the sign-in token. If it does not get
  through, the server's own check punches them out a few minutes later.
*/
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!scheduling || !captureRunning()) return
    const token = readTokens()?.access_token
    if (!token) return
    fetch(`${API_BASE}/screenshots/stopped`, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Device-Profile': deviceProfileHeader(),
      },
      body: '{}',
    }).catch(() => undefined)
  })
}

/*
  The desktop app's window is closing while punched in: like a closed tab, that
  ends the working session. The app waits for this before it quits.
*/
if (desktop) {
  desktop.onClosing(async () => {
    if (!desktopActive) return
    await flushActivity()
    if (scheduling) await reportStopped({ reason: 'APP_CLOSED' }).catch(() => undefined)
  })
}

function scheduleNext() {
  const now = Date.now()
  const from = Math.max(now, windowStart)
  const at = from + Math.random() * Math.max(0, windowStart + windowMs - from)
  timer = window.setTimeout(fire, Math.max(0, at - now))
}

async function fire() {
  timer = null
  windowStart += windowMs
  // After a sleeping laptop wakes up, take one screenshot and carry on from
  // now — not a burst for every window that passed while it slept.
  if (windowStart + windowMs < Date.now()) windowStart = Math.floor(Date.now() / windowMs) * windowMs

  try {
    const stillWorking = shotGuard ? await shotGuard() : true
    if (stillWorking && captureRunning()) await captureNow()
  } catch (error) {
    // Not being able to take it is logged where it happened; this is sending.
    if (desktop && !(error instanceof CaptureError)) shotFailed(messageOf(error, 'it could not be sent'))
    set({ error: messageOf(error, 'A screenshot could not be sent.') })
  }
  if (scheduling && captureRunning()) scheduleNext()
}

/* -------------------------------------------------------------------------- */
/* Other tabs                                                                  */
/* -------------------------------------------------------------------------- */
/*
  Only the tab that holds the shared screen captures. Every other tab of the
  app hears its heartbeat, so it neither asks the employee to share again nor
  takes duplicate screenshots. Heartbeats from a background tab can be slowed
  to one a minute by the browser, hence the generous timeout.
*/
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('softus.screen-capture') : null
const TAB_HEARTBEAT_MS = 10_000
const ELSEWHERE_TIMEOUT_MS = 150_000
let heartbeat: number | null = null
let elsewhereTimer: number | null = null

type Message = { kind: 'active' | 'stopped' | 'ping' }

function announce(kind: 'active' | 'stopped') {
  if (!channel) return
  channel.postMessage({ kind } satisfies Message)
  if (heartbeat !== null) window.clearInterval(heartbeat)
  heartbeat =
    kind === 'active'
      ? window.setInterval(() => channel.postMessage({ kind: 'active' } satisfies Message), TAB_HEARTBEAT_MS)
      : null
}

if (channel) {
  channel.onmessage = (event: MessageEvent<Message>) => {
    const { kind } = event.data ?? {}
    if (kind === 'ping') {
      if (captureRunning()) channel.postMessage({ kind: 'active' } satisfies Message)
      return
    }
    if (elsewhereTimer !== null) window.clearTimeout(elsewhereTimer)
    if (kind === 'active') {
      set({ elsewhere: true })
      elsewhereTimer = window.setTimeout(() => set({ elsewhere: false }), ELSEWHERE_TIMEOUT_MS)
    } else if (kind === 'stopped') {
      set({ elsewhere: false })
    }
  }
  // A tab opened mid-day asks straight away rather than waiting for a heartbeat.
  channel.postMessage({ kind: 'ping' } satisfies Message)
  window.addEventListener('pagehide', () => {
    if (captureRunning()) channel.postMessage({ kind: 'stopped' } satisfies Message)
  })
}
