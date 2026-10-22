import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { Button, EmptyState, PageHeader } from '@/components/ui'
import { MonthlyAttendance } from '@/features/attendance/MonthlyAttendance'
import type { User } from '@/types'

/*
  One employee's register, for an administrator.

  The daily register answers "where is everybody today". This answers the other
  question — "how has this person's month gone" — which used to be reachable
  only by reading a muster grid sideways. It opens on the current month and
  steps back through as many as the record holds.
*/
export function EmployeeAttendancePage() {
  const { userId = '' } = useParams()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => apiGet<User>(`/users/${userId}`),
    enabled: Boolean(userId),
  })

  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ') || data?.email

  if (isError) {
    return (
      <EmptyState
        title="That employee could not be loaded"
        description="They may have been removed. Go back to the list and try again."
        action={
          <Link to="/admin/employees">
            <Button variant="secondary" size="sm">
              Back to employees
            </Button>
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        title={isLoading ? 'Attendance' : `${name}`}
        description={
          isLoading
            ? 'Loading this employee’s record.'
            : [data?.designation, data?.department].filter(Boolean).join(' · ') ||
              'Attendance month by month.'
        }
        action={
          <Link to="/admin/employees">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="size-4" />
              All employees
            </Button>
          </Link>
        }
      />

      {userId && (
        <MonthlyAttendance userId={userId} who={`${data?.first_name ?? 'They'} has`} />
      )}
    </>
  )
}
