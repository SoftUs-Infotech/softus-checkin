import { create } from 'zustand'

/*
  The popup of the desktop app when it punched somebody out. Two kinds:

  - It lost the screen (a setting turned off, or the screen could not be
    seen), or a punch-in failed because it cannot see the screen: "Please
    allow this setting". It names only the setting to allow — never why.
  - Nobody used the keyboard or mouse for ten minutes: "Your PC was idle for
    10 minutes, so you have been punched out. Please punch in again."
*/

export type CaptureProblemReason = 'SETTING_OFF' | 'SCREEN_NOT_VISIBLE' | 'IDLE'

interface CaptureProblemState {
  open: boolean
  reason: CaptureProblemReason
  /** The app punched them out (rather than a punch-in failing). */
  punchedOut: boolean
  /** IDLE: how long nobody used the computer. */
  minutes: number
  /** When it was last closed, so the "you were punched out" prompt is not shown on top. */
  closedAt: number
  show: (problem: { reason: CaptureProblemReason; punchedOut: boolean; minutes?: number }) => void
  close: () => void
}

export const useCaptureProblem = create<CaptureProblemState>((set) => ({
  open: false,
  reason: 'SETTING_OFF',
  punchedOut: false,
  minutes: 0,
  closedAt: 0,
  show: ({ reason, punchedOut, minutes = 0 }) => set({ open: true, reason, punchedOut, minutes }),
  close: () => set({ open: false, closedAt: Date.now() }),
}))

/** "10 minutes", "1 minute". */
export function minutesText(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** The popup's title on this computer. */
export function problemTitle(platform: string | undefined, reason: CaptureProblemReason): string {
  if (reason === 'IDLE') return 'You have been punched out'
  return platform === 'win32' ? 'Please punch in again' : 'Please allow this setting'
}

/** The system notification's text, for when the app is not in front. */
export function problemNotice(platform: string | undefined, reason: CaptureProblemReason, minutes = 0): string {
  if (reason === 'IDLE') return `You have been punched out. Your PC was idle for ${minutesText(minutes)}.`
  return platform === 'win32' ? 'Please punch in again.' : 'Please allow this setting to punch in.'
}
