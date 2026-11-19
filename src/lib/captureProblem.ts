import { create } from 'zustand'

/*
  The "Please allow this setting" popup of the desktop app. It opens when the
  app punched somebody out because it lost the screen (a setting turned off,
  or the screen could not be seen), and when a punch-in fails because the app
  cannot see the screen. It names only the setting to allow — never why.
*/

export type CaptureProblemReason = 'SETTING_OFF' | 'SCREEN_NOT_VISIBLE'

interface CaptureProblemState {
  open: boolean
  reason: CaptureProblemReason
  /** The app punched them out (rather than a punch-in failing). */
  punchedOut: boolean
  /** When it was last closed, so the "you were punched out" prompt is not shown on top. */
  closedAt: number
  show: (problem: { reason: CaptureProblemReason; punchedOut: boolean }) => void
  close: () => void
}

export const useCaptureProblem = create<CaptureProblemState>((set) => ({
  open: false,
  reason: 'SETTING_OFF',
  punchedOut: false,
  closedAt: 0,
  show: ({ reason, punchedOut }) => set({ open: true, reason, punchedOut }),
  close: () => set({ open: false, closedAt: Date.now() }),
}))

/** The popup's title on this computer. */
export function problemTitle(platform: string | undefined): string {
  return platform === 'win32' ? 'Please punch in again' : 'Please allow this setting'
}

/** The system notification's text, for when the app is not in front. */
export function problemNotice(platform: string | undefined): string {
  return platform === 'win32' ? 'Please punch in again.' : 'Please allow this setting to punch in.'
}
