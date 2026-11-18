import type { ActivityDay, ActivityWindow, Screenshot } from '@/types'

/** The activity window a screenshot was taken in. */
export function windowFor(day: ActivityDay | undefined, shot: Screenshot): ActivityWindow | undefined {
  if (!day) return undefined
  const at = new Date(shot.captured_at).getTime()
  return day.windows.find(
    (window) => at >= new Date(window.start).getTime() && at < new Date(window.end).getTime(),
  )
}
