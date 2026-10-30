/**
 * Browser geolocation, wrapped so the failure reasons are readable.
 *
 * One definition for the punch and for the settings screen: the office point
 * an administrator captures has to be read the same way a punch is, or the two
 * can disagree by more than the radius. A desktop has no GPS, so its browser
 * reports an estimate — often the same point every time, ±100–300 m.
 */
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
          1: 'Location access was denied. Allow it for this site in your browser settings, then try again.',
          2: 'Your location could not be determined. Check that location services are on.',
          3: 'Finding your location took too long. Try again.',
        }
        reject(new Error(reasons[error.code] ?? 'Your location could not be read.'))
      },
      // Always a fresh reading: with the office geofence a refused punch is
      // retried, and a cached position would refuse the retry the same way.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
