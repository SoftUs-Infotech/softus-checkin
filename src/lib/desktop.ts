/*
  The desktop app (Electron) runs these same screens and hands them a small,
  fixed set of native abilities through `window.softusDesktop` — set by the
  app's preload script, absent in a browser. Everything the screens do
  differently in the app goes through `desktop` below, so the website and the
  app stay one codebase.
*/

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface DesktopPermissions {
  /** Screen Recording on macOS. Always granted on Linux (X11). */
  screen: PermissionState
  /** Accessibility on macOS: counting key presses and clicks. Always granted on Linux (X11). */
  input: PermissionState
  /** Linux under Wayland cannot be tracked at all; the person has to sign in with Xorg. */
  session: 'ok' | 'wayland'
  /** macOS applies a new Screen Recording permission only after the app restarts. */
  restartNeeded: boolean
  /**
   * Linux: the one-time setup (administrator password) that installs the
   * activity helper. `needed` blocks punching in (Wayland); `advised` does not.
   */
  setup?: 'ok' | 'needed' | 'advised'
  linux?: { sessionType: 'x11' | 'wayland'; desktop: string; method: string }
}

export interface DesktopScreen {
  /** JPEG bytes of one display. */
  data: Uint8Array<ArrayBuffer>
  width: number
  height: number
  /** Where the display sits in the desktop layout, in points. */
  x: number
  y: number
  boundsWidth: number
  boundsHeight: number
}

/** One minute of activity, exactly as the API takes it. */
export interface ActivityMinute {
  minute: string
  active_seconds: number
  keys: number
  clicks: number
  scrolls: number
  mouse_distance: number
  screen_samples: number
  screen_changes: number
  locked_seconds: number
  virtual_seconds?: number
}

export interface UpdateProgress {
  stage: 'downloading' | 'verifying' | 'installing'
  received: number
  total: number
}

export interface UpdateFile {
  url: string
  sha256: string
  size: number
  filename: string
  version: string
}

/** Whether the app can still see the screen while punched in. */
export interface CaptureHealth {
  running: boolean
  /** How long the screen has gone unseen while the person was there to be seen. */
  unseenMs: number
  /** The last moment it was seen. */
  lastSeenAt: string | null
  /** Set once nobody has used the keyboard or mouse for `idleLimitMs`: the last use. */
  idleSince?: string | null
  idleLimitMs?: number
  /** The permissions as the operating system reports them now (macOS). */
  screen: PermissionState
  input: PermissionState
}

export interface DesktopBridge {
  version: string
  platform: 'darwin' | 'linux' | 'win32'
  arch: string
  osVersion: string
  permissions(): Promise<DesktopPermissions>
  requestPermission(kind: 'screen' | 'input'): Promise<DesktopPermissions>
  openPermissionSettings(kind: 'screen' | 'input'): Promise<void>
  relaunch(): Promise<void>
  captureScreens(maxWidth: number): Promise<DesktopScreen[]>
  startTracking(): Promise<{ ok: boolean; error?: string }>
  stopTracking(): Promise<void>
  takeActivity(): Promise<ActivityMinute[]>
  captureHealth?(): Promise<CaptureHealth>
  /** The screen was lost: on macOS the app must restart to see it again. */
  reportCaptureLost?(): Promise<void>
  /** Bring the window to the front and show a system notification. */
  attention?(message: { title: string; body: string }): Promise<void>
  installUpdate(file: UpdateFile): Promise<{ ok: boolean; manual?: boolean; error?: string }>
  /** Linux: the one-time setup, behind the desktop's administrator password window. */
  runSetup?(): Promise<{ ok: boolean; cancelled?: boolean; output: string }>
  onSetupOutput?(listener: (text: string) => void): () => void
  onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void
  /** The window is closing: finish what has to be said to the server first. */
  onClosing(listener: () => Promise<void> | void): void
}

declare global {
  interface Window {
    softusDesktop?: DesktopBridge
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.softusDesktop ? window.softusDesktop : null

export const isDesktop = desktop !== null

/** The platform name releases are published under. */
export function releasePlatform(): 'mac' | 'linux' | 'windows' | null {
  if (!desktop) return null
  if (desktop.platform === 'darwin') return 'mac'
  if (desktop.platform === 'linux') return 'linux'
  if (desktop.platform === 'win32') return 'windows'
  return null
}

/** The file kind this platform updates itself from. */
export function updateKind(): 'zip' | 'appimage' | 'exe' | null {
  const kinds = { mac: 'zip', linux: 'appimage', windows: 'exe' } as const
  const platform = releasePlatform()
  return platform ? kinds[platform] : null
}

/** `1.0.10` > `1.0.9`; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre = ''] = value.split('-', 2)
    const parts = core.split('.').map((part) => Number.parseInt(part, 10) || 0)
    return { parts, pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre < right.pre ? -1 : 1
}

export const OS_NAME: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }

/** The name of the screen setting in this Mac's System Settings (macOS 15 renamed it). */
export function screenSettingName(): string {
  const major = Number.parseInt(desktop?.osVersion ?? '', 10) || 0
  return major >= 15 ? 'Screen & System Audio Recording' : 'Screen Recording'
}

/** What stands between this computer and punching in, in the employee's terms — or null. */
export function permissionProblem(permissions: DesktopPermissions): string | null {
  if (permissions.setup === 'needed') {
    return 'To punch in, set up this computer first. It needs an administrator password once.'
  }
  if (permissions.session === 'wayland') {
    return 'To punch in, sign out, choose “Ubuntu on Xorg” with the gear button on the sign-in screen, sign in again and reopen the app.'
  }
  if (desktop?.platform === 'linux' && permissions.screen !== 'granted') {
    return 'To punch in, choose your screen once.'
  }
  if (permissions.screen !== 'granted' || permissions.input !== 'granted') {
    return `To punch in, allow Softus Checkin under ${screenSettingName()} and Accessibility in System Settings → Privacy & Security.`
  }
  if (permissions.restartNeeded) {
    return 'To punch in, restart the app.'
  }
  return null
}
