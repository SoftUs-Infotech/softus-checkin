import type { QueryClient } from '@tanstack/react-query'

/*
  Everything downstream of "which days is the office open".

  A holiday, a Saturday-pattern change, a one-off closure and a shift edit all
  answer the same question, and the same screens read the answer: the work
  calendar grid, every employee's month, today's punch card, the exception feed
  and the salary projection — whose per-day rate is the month's pay divided by
  exactly this count.

  Listing them in one place is the point. Every page that changed a day used to
  invalidate its own two or three keys, so a holiday added from the holidays page
  left the calendar and the salary table showing the old numbers until somebody
  reloaded, which is how "nothing here is properly wired" starts.
*/
/*
  Everything a decision on a request changes.

  Approving a correction or a leave request rewrites the day it names, which
  moves the register, the employee's month, the exception feed and the salary
  projection priced off it. The approval screens used to call
  `invalidateQueries()` with no key at all — correct, but it throws away every
  cached query in the application on each individual approval, so working
  through a queue of twenty refetches the whole product twenty times.
*/
export function refreshApprovalDependents(queryClient: QueryClient): void {
  for (const key of [
    'admin-corrections',
    'corrections-mine',
    'admin-leave',
    'leave-mine',
    'leave-balances',
    'admin-tasks',
    'tasks-mine',
    'task-day',
    'task-calendar',
    'attendance-calendar',
    'attendance-today',
    'register',
    'dashboard-summary',
    'notifications',
    'salary-projection',
    'comp-offs',
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] })
  }
}

export function refreshCalendarDependents(queryClient: QueryClient): void {
  for (const key of [
    'work-calendar',
    'holidays',
    'comp-offs',
    'attendance-calendar',
    'attendance-today',
    'register',
    'dashboard-summary',
    'salary-projection',
    'settings',
    'shifts',
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] })
  }
}
