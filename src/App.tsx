import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { setSessionLostHandler } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { AppShell } from '@/components/layout/AppShell'
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage'
import { LoginPage } from '@/features/auth/LoginPage'
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordPages'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { AttendancePage } from '@/features/attendance/AttendancePage'
import { EmployeeAttendancePage } from '@/features/admin/EmployeeAttendancePage'
import { CorrectionsPage } from '@/features/corrections/CorrectionsPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { LeavePage } from '@/features/leave/LeavePage'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { ApprovalsPage } from '@/features/admin/ApprovalsPage'
import { EmployeesPage } from '@/features/admin/EmployeesPage'
import { ShiftsPage } from '@/features/admin/ShiftsPage'
import { LeaveTypesPage } from '@/features/admin/LeaveTypesPage'
import { HolidaysPage } from '@/features/admin/HolidaysPage'
import { AnnouncementsPage } from '@/features/admin/AnnouncementsPage'
import { RegisterPage } from '@/features/admin/RegisterPage'
import { AuditPage } from '@/features/admin/AuditPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { OperationsPage } from '@/features/admin/OperationsPage'
import { TaskExplorerPage } from '@/features/admin/TaskExplorerPage'
import { WorkCalendarPage } from '@/features/admin/WorkCalendarPage'
import { SalaryPage } from '@/features/admin/SalaryPage'

function Booting() {
  return (
    <div className="grid min-h-screen place-items-center text-ink-300">
      <Loader2 className="size-6 animate-spin" aria-label="Loading" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status)
  if (status === 'loading') return <Booting />
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') return <Booting />
  if (status === 'anonymous') return <Navigate to="/login" replace />
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * The personal side of the app — punching, own attendance, own corrections.
 * An administrator who does not punch is sent to operations instead, because
 * those pages would be empty and misleading for them.
 */
function RequirePersonal({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') return <Booting />
  if (status === 'anonymous') return <Navigate to="/login" replace />
  if (user && user.can_punch === false) return <Navigate to="/admin" replace />
  return <>{children}</>
}

/**
 * Approvals and the team task view. A manager reaches these and nothing else of
 * the administration product; the API scopes what they see to their own reports.
 */
function RequireApprover({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') return <Booting />
  if (status === 'anonymous') return <Navigate to="/login" replace />
  if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') return <Navigate to="/" replace />
  return <>{children}</>
}

function AnonymousOnly({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status)
  if (status === 'loading') return <Booting />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const restore = useAuth((state) => state.restore)
  const navigate = useNavigate()

  useEffect(() => {
    void restore()
  }, [restore])

  // A refresh token that no longer works lands the employee on the sign-in
  // screen rather than on a page full of failed requests.
  useEffect(() => {
    setSessionLostHandler(() => {
      useAuth.setState({ user: null, status: 'anonymous' })
      navigate('/login', { replace: true })
    })
  }, [navigate])

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AnonymousOnly>
            <LoginPage />
          </AnonymousOnly>
        }
      />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/forgot-password"
        element={
          <AnonymousOnly>
            <ForgotPasswordPage />
          </AnonymousOnly>
        }
      />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <RequirePersonal>
              <DashboardPage />
            </RequirePersonal>
          }
        />
        <Route
          path="attendance"
          element={
            <RequirePersonal>
              <AttendancePage />
            </RequirePersonal>
          }
        />
        <Route
          path="corrections"
          element={
            <RequirePersonal>
              <CorrectionsPage />
            </RequirePersonal>
          }
        />
        <Route
          path="tasks"
          element={
            <RequirePersonal>
              <TasksPage />
            </RequirePersonal>
          }
        />
        <Route
          path="leave"
          element={
            <RequirePersonal>
              <LeavePage />
            </RequirePersonal>
          }
        />
        <Route path="profile" element={<ProfilePage />} />

        <Route
          path="admin"
          element={
            <RequireAdmin>
              <OperationsPage />
            </RequireAdmin>
          }
        />

        <Route
          path="admin/tasks"
          element={
            <RequireApprover>
              <TaskExplorerPage />
            </RequireApprover>
          }
        />
        <Route
          path="admin/work-calendar"
          element={
            <RequireAdmin>
              <WorkCalendarPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/salary"
          element={
            <RequireAdmin>
              <SalaryPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/register"
          element={
            <RequireAdmin>
              <RegisterPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/approvals"
          element={
            <RequireApprover>
              <ApprovalsPage />
            </RequireApprover>
          }
        />
        <Route
          path="admin/employees"
          element={
            <RequireAdmin>
              <EmployeesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/employees/:userId/attendance"
          element={
            <RequireAdmin>
              <EmployeeAttendancePage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/shifts"
          element={
            <RequireAdmin>
              <ShiftsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/leave-types"
          element={
            <RequireAdmin>
              <LeaveTypesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/holidays"
          element={
            <RequireAdmin>
              <HolidaysPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/announcements"
          element={
            <RequireAdmin>
              <AnnouncementsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/audit"
          element={
            <RequireAdmin>
              <AuditPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequireAdmin>
              <SettingsPage />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
