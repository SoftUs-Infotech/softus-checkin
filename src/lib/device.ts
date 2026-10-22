/**
 * The device profile the backend needs to enforce desktop-only punching.
 *
 * The server does the deciding; this only reports. `pointerCoarse` is the
 * signal that matters most: a touch laptop still has a trackpad, so it reports
 * a fine pointer and is allowed through, while a phone or an iPad in desktop
 * mode cannot hide that it has neither mouse nor trackpad.
 */
export interface DeviceProfile {
  maxTouchPoints: number
  pointerCoarse: boolean
  screenWidth: number
  screenHeight: number
  platform: string
}

export function readDeviceProfile(): DeviceProfile {
  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(pointer: fine)').matches

  return {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    pointerCoarse: coarse,
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
    platform: navigator.platform ?? '',
  }
}

export function deviceProfileHeader(): string {
  return JSON.stringify(readDeviceProfile())
}

/**
 * A local guess, used only to explain the situation before the employee
 * presses anything. The server's answer is the one that counts.
 */
export function looksLikeAComputer(): boolean {
  const profile = readDeviceProfile()
  if (profile.pointerCoarse && profile.maxTouchPoints > 0) return false
  if (/android|iphone|ipod|ipad|mobile|tablet/i.test(navigator.userAgent)) return false
  if (/mac/i.test(navigator.userAgent) && profile.maxTouchPoints > 1) return false
  const shortestEdge = Math.min(profile.screenWidth, profile.screenHeight)
  return !(shortestEdge > 0 && shortestEdge < 900 && profile.maxTouchPoints > 0)
}
