import { create } from 'zustand'
import { apiGet } from '@/lib/api'
import { compareVersions, desktop, releasePlatform, updateKind } from '@/lib/desktop'
import type { AppRelease } from '@/types'

/*
  The desktop app has to be on the version the admin published before it may
  punch in. The check happens when "punch in" is pressed (the server refuses an
  outdated app too, so skipping it here changes nothing), and a newer version
  opens the update prompt instead of punching in.
*/

interface UpdatePromptState {
  release: AppRelease | null
  open: (release: AppRelease) => void
  close: () => void
}

export const useUpdatePrompt = create<UpdatePromptState>((set) => ({
  release: null,
  open: (release) => set({ release }),
  close: () => set({ release: null }),
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
    useUpdatePrompt.getState().open(release)
    throw new UpdateRequiredError()
  }
}

/** The server said the app is outdated: show the prompt for what it has to install. */
export async function promptFromServer(): Promise<never> {
  const release = await pendingUpdate().catch(() => null)
  if (release) useUpdatePrompt.getState().open(release)
  throw new UpdateRequiredError()
}
