import { desktop } from '@/lib/desktop'

/**
 * Browser geolocation, wrapped so the failure reasons are readable.
 *
 * Where a punch happened is recorded with it (never judged — any computer may
 * punch). A desktop has no GPS, so its browser reports an estimate.
 */
const DESKTOP_DENIED =
  'Location access is off. Allow Softus Checkin in System Settings → Privacy & Security → Location Services, then try again.'

export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser cannot report your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        const reasons: Record<number, string> = {
          1: desktop
            ? DESKTOP_DENIED
            : 'Location access was denied. Allow it for this site in your browser settings, then try again.',
          2: 'Your location could not be determined. Check that location services are on.',
          3: 'Finding your location took too long. Try again.',
        }
        reject(new Error(reasons[error.code] ?? 'Your location could not be read.'))
      },
      // Always a fresh reading, so the recorded place is where the punch was.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
