import { apiPost } from '@/lib/api'
import { currentPosition } from '@/lib/location'
import { captureNow, startCapture } from '@/lib/screenCapture'
import type { AttendanceDay, TodayState } from '@/types'

/** Why the system ended a session: the employee's screen stopped being shared. */
export const SCREEN_SHARE_STOPPED = 'SCREEN_SHARE_STOPPED'

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
  */
  if (action === 'punch-in' && today?.screen_capture_required) {
    await startCapture()
    await captureNow()
  }

  let location: Record<string, number> | undefined
  if (today?.geolocation_required !== false) {
    const position = await currentPosition()
    location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_metres: position.coords.accuracy,
    }
  }
  // Which punch of the day this is, within the minute: a double click repeats
  // the key and is answered as the same punch, while punching back in after
  // being punched out — even seconds later — is a new one.
  const ordinal = today?.day.sessions.length ?? 0
  return apiPost<AttendanceDay>(`/attendance/${action}`, {
    location,
    request_key: `${action}-${ordinal}-${new Date().toISOString().slice(0, 16)}`,
  })
}
