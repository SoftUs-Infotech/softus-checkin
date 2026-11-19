import { ApiError, apiPost } from '@/lib/api'
import { useCaptureProblem } from '@/lib/captureProblem'
import { desktop } from '@/lib/desktop'
import { currentPosition } from '@/lib/location'
import {
  CaptureError,
  captureNow,
  PUNCH_IN_FAILED,
  startCapture,
  stopCapture,
} from '@/lib/screenCapture'
import { promptFromServer, requireCurrentVersion } from '@/lib/updates'
import type { AttendanceDay, TodayState } from '@/types'

/** Why the system ended a session: the employee's screen stopped being shared. */
export const SCREEN_SHARE_STOPPED = 'SCREEN_SHARE_STOPPED'

export const USE_DESKTOP_APP = 'To punch in, use the Softus Checkin desktop app.'

/**
 * A punch, the one way it is done everywhere — the punch card, and the prompt
 * that brings somebody working from home back after sharing stopped.
 */
export async function punch(
  action: 'punch-in' | 'punch-out',
  today: TodayState | undefined,
): Promise<AttendanceDay> {
  /*
    Working from home: the screen is shared before anything else, while the
    press still counts as the employee's own gesture — the browser only shows
    its picker in response to one, and a location prompt first could use that
    up. The screenshot taken straight after is what the server checks before
    it accepts the punch.

    A punch-in that fails for any reason ends the sharing, so the screen is only
    ever shared while the employee is actually punched in, and the next attempt
    asks for the entire screen again.
  */
  if (action === 'punch-in') {
    // Asked of the website when the organisation wants punches from the app.
    if (today?.desktop_app_required && !desktop) throw new Error(USE_DESKTOP_APP)
    // The app installs a newer published version before it punches in.
    if (desktop) await requireCurrentVersion()
  }

  const capturing = action === 'punch-in' && Boolean(today?.screen_capture_required)
  if (capturing) {
    try {
      await startCapture()
      await captureNow()
    } catch (error) {
      stopCapture()
      // The app could not see the screen: on macOS that takes a restart, and
      // the popup says which setting to allow. (A missing permission is shown
      // by the punch card's own checklist instead.)
      if (desktop && error instanceof CaptureError && error.message === PUNCH_IN_FAILED) {
        void desktop.reportCaptureLost?.()
        useCaptureProblem.getState().show({ reason: 'SCREEN_NOT_VISIBLE', punchedOut: false })
      }
      // CaptureError messages are already neutral; anything else (an upload
      // the server refused) would name screenshots, so it is replaced.
      throw error instanceof CaptureError ? error : new Error(PUNCH_IN_FAILED)
    }
  }

  try {
    let location: Record<string, number> | undefined
    // The server records the network address of every punch. The Linux app
    // cannot read a location at all; the Windows app gets one only when
    // Windows' location service answers, and punches without it otherwise.
    const canLocate = desktop?.platform !== 'linux'
    if (today?.geolocation_required !== false && canLocate) {
      try {
        const position = await currentPosition()
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_metres: position.coords.accuracy,
        }
      } catch (error) {
        if (desktop?.platform !== 'win32') throw error
      }
    }
    // Which punch of the day this is, within the minute: a double click repeats
    // the key and is answered as the same punch, while punching back in after
    // being punched out — even seconds later — is a new one.
    const ordinal = today?.day.sessions.length ?? 0
    return await apiPost<AttendanceDay>(`/attendance/${action}`, {
      location,
      request_key: `${action}-${ordinal}-${new Date().toISOString().slice(0, 16)}`,
    })
  } catch (error) {
    if (capturing) stopCapture()
    // The server's refusal for a missing screenshot names screen capture.
    if (error instanceof ApiError && error.code === 'SCREEN_CAPTURE_REQUIRED') {
      throw new Error(PUNCH_IN_FAILED)
    }
    if (error instanceof ApiError && error.code === 'APP_UPDATE_REQUIRED') {
      await promptFromServer()
    }
    throw error
  }
}
