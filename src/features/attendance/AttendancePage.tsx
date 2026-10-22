import { Link } from 'react-router-dom'
import { Button, PageHeader } from '@/components/ui'
import { MonthlyAttendance } from '@/features/attendance/MonthlyAttendance'

/*
  The register behind the calendar. The calendar answers "which days", the table
  answers "in what order, and by how much" — and both are scoped to one month,
  because that is the unit anybody actually reads a register in.
*/
export function AttendancePage() {
  return (
    <>
      <PageHeader
        title="My attendance"
        description="Every day you have punched this month, and how each one was counted."
        action={
          <Link to="/corrections">
            <Button variant="secondary" size="sm">
              Request a correction
            </Button>
          </Link>
        }
      />

      <MonthlyAttendance />
    </>
  )
}
