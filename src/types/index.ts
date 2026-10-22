/** Shapes mirroring the backend schemas. */

export type UserRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED'

export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  phone?: string | null
  employee_code?: string | null
  designation?: string | null
  department?: string | null
  role: UserRole
  status: UserStatus
  shift_id?: string | null
  /** A shift is a planned window for a piece of work, not a permanent property
      of a person: "Riya is on the general shift for these two weeks". Both
      dates absent means the assignment runs until it is changed, which is how
      every account behaved before the window existed. */
  shift_from?: string | null
  shift_to?: string | null
  reporting_manager_id?: string | null
  joining_date?: string | null
  profile_completed: boolean
  /** An administrator oversees attendance rather than recording it. */
  can_punch: boolean
  wfh_enabled: boolean
  wfh_from?: string | null
  wfh_to?: string | null
  last_login_at?: string | null
  created_at?: string | null
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface AuthSession {
  tokens: TokenPair
  user: User
}

export interface Paginated<T> {
  items: T[]
  pagination: {
    page: number
    page_size: number
    total: number
    total_pages: number
    has_next: boolean
    has_previous: boolean
  }
}

export type AttendanceStatus =
  | 'PRESENT'
  | 'HALF_DAY'
  | 'SHORT_HOURS'
  | 'IN_PROGRESS'
  | 'NOT_STARTED'
  | 'MISSING_PUNCH_OUT'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEKEND'
  | 'UPCOMING'
  /** A day before the employee joined. Nothing was expected of it. */
  | 'BEFORE_JOINING'
  /** Before the organisation's go-live reset. Nothing on it counts. */
  | 'NOT_TRACKED'

export interface PunchEvent {
  at: string
  latitude?: number | null
  longitude?: number | null
  accuracy_metres?: number | null
  address?: string | null
  /** The town or city the coordinates fall in — what the register column shows. */
  city?: string | null
  device_class?: string | null
  platform?: string | null
  user_agent?: string | null
  ip?: string | null
  /** Flagged, never blocked: a bad GPS fix must not cost an attendance day. */
  outside_office?: boolean | null
  distance_metres?: number | null
  source: string
  note?: string | null
}

export interface AttendanceSession {
  punch_in: PunchEvent
  punch_out?: PunchEvent | null
  auto_closed: boolean
  duration_minutes: number
}

export interface AttendanceDay {
  date: string
  status: AttendanceStatus
  status_label: string
  color: string
  worked_minutes: number
  worked_display: string
  expected_minutes: number
  shortfall_minutes: number
  is_late: boolean
  is_open: boolean
  is_manually_adjusted: boolean
  first_punch_in?: string | null
  last_punch_out?: string | null
  sessions: AttendanceSession[]
  holiday_name?: string | null
  leave_type?: string | null
  leave_day_part?: string | null
  adjustment_note?: string | null
  user_id?: string | null
  employee_name?: string | null
  /** Carried on register rows so a search result can show what it matched on. */
  employee_email?: string | null
  employee_code?: string | null
  department?: string | null
  user_name?: string | null
  user_email?: string | null
  /** No shift assignment covered this date. The punches still count — a
      shift is a planned window, and a lapsed one is a signal, not a fault. */
  no_shift_assigned?: boolean
}

/**
 * What the register answered, alongside the rows. `employees` is the headcount
 * the filters left, which is how the screen tells "nobody matched the search"
 * apart from "nothing happened that day".
 */
export interface RegisterMeta {
  from_date: string
  to_date: string
  days: number
  employees: number
  total: number
  returned: number
  truncated: boolean
  filtered: boolean
}

export interface Shift {
  id: string
  name: string
  code: string
  start_time: string
  end_time: string
  required_minutes: number
  half_day_minutes: number
  grace_minutes: number
  break_minutes: number
  working_weekdays: number[]
  working_weekday_names: string[]
  crosses_midnight: boolean
  is_default: boolean
  is_active: boolean
  description?: string | null
  assigned_count?: number | null
}

export interface TodayState {
  server_time: string
  date: string
  day: AttendanceDay
  can_punch_in: boolean
  can_punch_out: boolean
  blocked_reason?: string | null
  shift?: Shift | null
  device_class: string
  geolocation_required: boolean
  elapsed_minutes: number
  /** No shift assignment covers today. Never blocks a punch — a shift is a
      planned window, and its lapsing is a signal to the administrator. */
  no_shift_assigned?: boolean
}

export interface MonthSummary {
  present_days: number
  half_days: number
  absent_days: number
  missing_punch_out_days: number
  leave_days: number
  holidays: number
  weekly_offs: number
  late_days: number
  worked_minutes: number
  worked_display: string
  expected_minutes: number
  working_days: number
}

export interface MonthCalendar {
  year: number
  month: number
  from_date: string
  to_date: string
  days: AttendanceDay[]
  summary: MonthSummary
  legend: Record<string, string>
  labels: Record<string, string>
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type CorrectionType =
  | 'MISSED_PUNCH_IN'
  | 'MISSED_PUNCH_OUT'
  | 'WRONG_TIME'
  | 'FULL_DAY'

export interface Correction {
  id: string
  user_id: string
  user_email?: string | null
  user_name?: string | null
  date: string
  type: CorrectionType
  requested_punch_in?: string | null
  requested_punch_out?: string | null
  reason: string
  status: ApprovalStatus
  approver_email?: string | null
  approver_role?: string | null
  decided_at?: string | null
  decision_note?: string | null
  created_at?: string | null
}

export type TaskStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'

export interface TimelineEntry {
  at: string
  actor_id?: string | null
  actor_name?: string | null
  actor_role?: string | null
  action: string
  note?: string | null
}

export type TaskProgress = 'TO_DO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED'

export interface TaskCalendarDay {
  date: string
  total: number
  done: number
  carried_in: number
}

export interface TaskWeekSummary {
  week: number
  from_date: string
  to_date: string
  completed: number
  in_progress: number
  carried_forward: number
}

/** Mirrors `TaskMonthSummary` in `backend/app/schemas/task.py`. */
export interface TaskMonthSummary {
  logged: number
  completed: number
  still_open: number
  stale: number
}

export interface TaskCalendar {
  user_id: string
  user_name?: string | null
  year: number
  month: number
  from_date: string
  to_date: string
  stale_after_days: number
  days: TaskCalendarDay[]
  weeks: TaskWeekSummary[]
  summary: TaskMonthSummary
}

export interface Task {
  id: string
  user_id: string
  user_email?: string | null
  user_name?: string | null
  date: string
  title: string
  description?: string | null
  planned_minutes?: number | null
  actual_minutes?: number | null
  project?: string | null
  status: TaskStatus
  /** The employee's word on the work — separate from the admin's approval. */
  progress: TaskProgress
  progress_updated_at?: string | null
  carried_from_date?: string | null
  completed_on?: string | null
  days_open?: number | null
  is_stale?: boolean
  is_carried_forward?: boolean
  reviewer_email?: string | null
  reviewer_role?: string | null
  reviewed_at?: string | null
  timeline: TimelineEntry[]
  created_at?: string | null
  updated_at?: string | null
}

export interface AccrualPolicy {
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  /** 0.5 is allowed — "half a day of sick leave a month". */
  amount_per_cycle: number
  credit_at: 'START' | 'END'
  lapse_at_year_end: boolean
}

export interface LeaveType {
  id: string
  name: string
  code: string
  annual_quota: number
  accrual: AccrualPolicy
  allow_negative_balance: boolean
  is_paid: boolean
  requires_approval: boolean
  allow_half_day: boolean
  carry_forward_max: number
  min_notice_days: number
  max_consecutive_days?: number | null
  applicable_after_days: number
  applicable_departments: string[]
  color: string
  sort_order: number
  description?: string | null
  is_active: boolean
}

export type DayPart = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF'

export interface LeaveBalance {
  leave_type_id: string
  leave_type_name: string
  leave_type_code: string
  color: string
  is_paid: boolean
  allow_half_day: boolean
  /** Whether the API accepts a request that takes this balance below zero. */
  allow_negative_balance: boolean
  year: number
  allocated: number
  carried_forward: number
  used: number
  pending: number
  available: number
}

export interface LeaveRequest {
  id: string
  user_id: string
  user_email?: string | null
  user_name?: string | null
  leave_type_id: string
  leave_type_name?: string | null
  leave_type_code?: string | null
  from_date: string
  to_date: string
  days: { date: string; day_part: DayPart }[]
  total_days: number
  reason: string
  contact_number?: string | null
  status: ApprovalStatus
  approver_email?: string | null
  decided_at?: string | null
  decision_note?: string | null
  created_at?: string | null
}

export interface Holiday {
  id: string
  date: string
  name: string
  type: 'PUBLIC' | 'COMPANY' | 'OPTIONAL'
  description?: string | null
  applicable_departments: string[]
  year: number
  is_active: boolean
  weekday?: string | null
}

export interface Announcement {
  id: string
  title: string
  body: string
  type: 'ANNOUNCEMENT' | 'EVENT'
  event_date?: string | null
  event_time?: string | null
  location?: string | null
  audience_departments: string[]
  pinned: boolean
  is_published: boolean
  published_at?: string | null
  author_name?: string | null
  created_at?: string | null
}

export interface Notification {
  id: string
  type: string
  title: string
  body?: string | null
  link?: string | null
  read_at?: string | null
  created_at?: string | null
}

export interface OrgSettings {
  org_name: string
  week_start: number
  correction_window_days: number
  auto_close_hour: number
  geolocation_required: boolean
  block_mobile_punch: boolean
  min_punch_gap_seconds: number
  allow_multiple_sessions: boolean
  tasks_required_daily: boolean
  leave_year_start_month: number

  enforce_office_network_for_punch: boolean
  enforce_office_network_for_corrections: boolean
  office_ip_ranges: string[]
  office_latitude?: number | null
  office_longitude?: number | null
  office_radius_metres: number

  late_arrivals_per_half_day: number
  retro_approval_months: number

  salary_day_basis: 'WORKING_DAYS' | 'CALENDAR_DAYS' | 'FIXED_26' | 'FIXED_30'
  salary_deduct_absent: boolean
  salary_deduct_unpaid_leave: boolean
  salary_deduct_half_day: boolean
  salary_deduct_missing_punch_out: boolean

  working_saturdays: number[]
  fifth_saturday_working?: boolean | null
  comp_off_expiry_days: number

  support_email?: string | null
  /** The go-live reset: attendance counts from this day. Null until pressed. */
  tracking_starts_on?: string | null
  timezone: string
  api_version: string
}

export interface AuditLog {
  id: string
  actor_id?: string | null
  actor_email?: string | null
  action: string
  entity: string
  entity_id?: string | null
  entity_label?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
  at: string
}

export interface DashboardSummary {
  announcements: Announcement[]
  upcoming_events: Announcement[]
  upcoming_holidays: Holiday[]
  leave_balances: LeaveBalance[]
  on_leave_today: {
    user_id: string
    user_name?: string | null
    leave_type_name?: string | null
    day_part: string
  }[]
  unread_notifications: number
  pending?: { corrections: number; leave: number; tasks: number }
}

export interface WorkCalendarDay {
  date: string
  weekday: string
  is_working: boolean
  source: string
  reason: string
  /** Only a fifth Saturday nobody has ruled on yet. */
  is_undecided: boolean
  swap_with_date?: string | null
  /** Set whenever a declared holiday falls here, even if the day was reopened. */
  holiday_name?: string | null
}

export interface WorkCalendarMonth {
  year: number
  month: number
  working_days: number
  days: WorkCalendarDay[]
}

/** Mirrors `CompOffOut`. `status` is resolved against today, so it can read
    EXPIRED for a credit stored as AVAILABLE. */
export interface CompOff {
  id: string
  user_id: string
  user_email?: string | null
  /** Present on the organisation ledger. */
  user_name?: string | null
  earned_on: string
  reason: string
  expires_on?: string | null
  status: 'AVAILABLE' | 'USED' | 'EXPIRED'
  used_on?: string | null
}

export interface Salary {
  id: string
  user_id: string
  monthly_ctc: number
  effective_from: string
  note?: string | null
  set_by_email?: string | null
}

export interface SalaryLine {
  kind: string
  label?: string
  days: number
  amount: number
  reason?: string | null
  source_month?: string | null
  source_date?: string | null
}

export interface SalaryProjection {
  user_id: string
  user_name?: string | null
  user_email?: string | null
  has_salary_on_record: boolean
  month: string
  monthly_ctc: number
  effective_from?: string | null
  day_basis: string
  day_rate: number
  counts: Record<string, number>
  deductions: SalaryLine[]
  adjustments: SalaryLine[]
  total_deduction: number
  total_adjustment: number
  projected_net: number
}

export interface OrgSalaryProjection {
  month: string
  employees: SalaryProjection[]
  total_projected_net: number
  missing_salary_count: number
}

/**
 * The bulk decision endpoints answer per record rather than per batch, so a
 * partial result can be reported honestly. The identifier field differs by
 * endpoint — `id` for corrections and leave, `task_id` for tasks — because each
 * mirrors the singular route it batches.
 */
export interface BulkResult {
  id?: string
  task_id?: string
  success: boolean
  error_code?: string | null
  message?: string | null
}

export interface BulkResponse {
  requested: number
  succeeded: number
  failed: number
  results: BulkResult[]
}

/**
 * The office-network policy as seen from one request. `your_ip` is the address
 * the API itself judges the caller by — not what a "what is my IP" site says,
 * which differs the moment a proxy sits in front.
 */
export interface NetworkView {
  your_ip: string | null
  /** What to put in the allowlist to cover this network — a /64 for IPv6. */
  suggested_range: string | null
  matches_allowlist: boolean
  office_ip_ranges: string[]
  enforce_office_network_for_punch: boolean
  enforce_office_network_for_corrections: boolean
}
