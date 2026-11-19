import { create } from 'zustand'
import { apiGet } from '@/lib/api'
import { compareVersions, desktop, releasePlatform, updateKind } from '@/lib/desktop'
import type { AppRelease, TodayState } from '@/types'

/*
  The desktop app has to be on the version the admin published before it may
  punch in. The check happens when "punch in" is pressed (the server refuses an
  outdated app too, so skipping it here changes nothing), and a newer version
  opens the update prompt instead of punching in.

  The app also offers a newer version when it opens and every half hour after
  (offerUpdate), so people who never punch in — admins — get it as well.
*/

interface UpdatePromptState {
  release: AppRelease | null
  /** Opened by a punch-in, which cannot go ahead without the update. */
  forPunch: boolean
  open: (release: AppRelease, forPunch: boolean) => void
  close: () => void
}

export const useUpdatePrompt = create<UpdatePromptState>((set) => ({
  release: null,
  forPunch: false,
  open: (release, forPunch) => set({ release, forPunch }),
  close: () => set({ release: null, forPunch: false }),
}))

export const UPDATE_REQUIRED = 'A new version of the app is ready. Update it to punch in.'

export class UpdateRequiredError extends Error {
  constructor() {
    super(UPDATE_REQUIRED)
    this.name = 'UpdateRequiredError'
  }
}

/** The newer published release this app should install, or null when it is up to date. */
export async function pendingUpdate(): Promise<AppRelease | null> {
  const platform = releasePlatform()
  if (!desktop || !platform) return null
  const release = await apiGet<AppRelease | null>('/app-releases/latest', {
    platform,
    arch: desktop.arch,
  })
  if (!release || compareVersions(release.version, desktop.version) <= 0) return null
  if (!release.files.some((file) => file.kind === updateKind())) return null
  return release
}

/** Before punching in from the app: a newer published version is installed first. */
export async function requireCurrentVersion(): Promise<void> {
  let release: AppRelease | null = null
  try {
    release = await pendingUpdate()
  } catch {
    // Could not ask; the server makes the same check on the punch itself.
    return
  }
  if (release) {
    useUpdatePrompt.getState().open(release, true)
    throw new UpdateRequiredError()
  }
}

/** How often an open app looks for a newer published version. */
export const UPDATE_CHECK_EVERY_MS = 30 * 60_000

/**
 * Offered when the app opens and every half hour while it is open — to
 * everybody, so admins who never punch in are kept up to date too. "Later" is
 * allowed here; at punch-in the update is required.
 *
 * Never in the middle of a working session: an update restarts the app, which
 * would end it. Somebody punched in is asked at their next punch-in instead.
 */
export async function offerUpdate(canPunch: boolean): Promise<void> {
  if (!desktop || useUpdatePrompt.getState().release) return
  if (canPunch) {
    const today = await apiGet<TodayState>('/attendance/today').catch(() => null)
    if (!today || today.can_punch_out) return
  }
  const release = await pendingUpdate().catch(() => null)
  if (release && !useUpdatePrompt.getState().release) useUpdatePrompt.getState().open(release, false)
}

/** The server said the app is outdated: show the prompt for what it has to install. */
export async function promptFromServer(): Promise<never> {
  const release = await pendingUpdate().catch(() => null)
  if (release) useUpdatePrompt.getState().open(release, true)
  throw new UpdateRequiredError()
}
