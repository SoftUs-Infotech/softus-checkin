import { create } from 'zustand'
import { API_BASE, apiPost, apiUpload, messageOf, readTokens } from '@/lib/api'
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
*/

export type CaptureStatus = 'idle' | 'starting' | 'active' | 'stopped' | 'denied' | 'unsupported'

interface CaptureState {
  status: CaptureStatus
  /** When the last screenshot reached the server, as epoch milliseconds. */
  lastShotAt: number | null
  error: string | null
  /** Another tab of the app holds the shared screen, so this one need not. */
  elsewhere: boolean
}

/** Captures are scaled down to this width: plenty to read a screen, a fraction of the bytes. */
const MAX_WIDTH = 1600
const JPEG_QUALITY = 0.7

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
}

export const useScreenCapture = create<CaptureState>(() => ({
  status: captureSupported() ? 'idle' : 'unsupported',
  lastShotAt: null,
  error: null,
  elsewhere: false,
}))

const set = useScreenCapture.setState

/** A failure worth showing to the employee in its own words. */
export class CaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureError'
  }
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null

export function captureRunning(): boolean {
  return Boolean(stream?.active)
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
  if (!captureSupported()) {
    set({ status: 'unsupported' })
    throw new CaptureError(
      'This browser cannot share a screen. Use Chrome, Edge or Firefox on your computer.',
    )
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
    const message = blockedBySystem
      ? 'Your computer is not letting this browser record the screen. On a Mac: System Settings → Privacy & Security → Screen Recording, turn your browser on, restart the browser, then punch in again.'
      : cancelled
        ? 'Screen sharing was cancelled. You are working from home, so your screen has to be shared to punch in.'
        : 'Your screen could not be shared. Check that the browser is allowed to record the screen, then try again.'
    set({ status: cancelled ? 'denied' : 'stopped', error: message })
    throw new CaptureError(message)
  }

  const [track] = media.getVideoTracks()
  // A single window or tab would show only what the employee chose to show.
  const surface = track?.getSettings().displaySurface
  if (!track || (surface && surface !== 'monitor')) {
    media.getTracks().forEach((each) => each.stop())
    const message = 'Share your entire screen, not a single window or browser tab.'
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

async function grab(): Promise<{ blob: Blob; width: number; height: number }> {
  const track = stream?.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') {
    throw new CaptureError('Screen capture is not running.')
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
    throw new CaptureError('The shared screen did not produce a picture.')
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
  if (!blob) throw new CaptureError('The screenshot could not be encoded.')
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
  windowStart = Date.now()
  scheduleNext()
  sendHeartbeat()
  heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_MS)
}

export function stopSchedule() {
  scheduling = false
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/** Sharing stopped while punched in: the server punches the employee out. */
export function reportStopped(): Promise<unknown> {
  return apiPost('/screenshots/stopped')
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

function scheduleNext() {
  const at = windowStart + Math.random() * windowMs
  timer = window.setTimeout(fire, Math.max(0, at - Date.now()))
}

async function fire() {
  timer = null
  windowStart += windowMs
  // After a sleeping laptop wakes up, take one screenshot and carry on from
  // now — not a burst for every window that passed while it slept.
  if (windowStart + windowMs < Date.now()) windowStart = Date.now()

  try {
    const stillWorking = shotGuard ? await shotGuard() : true
    if (stillWorking && captureRunning()) await captureNow()
  } catch (error) {
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
