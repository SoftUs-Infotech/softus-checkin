import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { apiPatch, apiPost, messageOf } from '@/lib/api'
import { formatDate, humanise } from '@/lib/format'
import { useAuth } from '@/store/auth'
import {
  Button,
  Card,
  CardHeader,
  CardSkeleton,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  useToast,
} from '@/components/ui'
import { TwoFactorSetup } from '@/features/auth/TwoFactorSetup'
import { PasswordRules } from '@/features/auth/AcceptInvitePage'
import type { User } from '@/types'

const profileSchema = z.object({
  first_name: z.string().min(1, 'Enter your first name.').max(60),
  last_name: z.string().max(60).optional(),
  phone: z.string().max(20).optional(),
  designation: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
})

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .regex(/[A-Za-z]/, 'Include at least one letter.')
      .regex(/\d/, 'Include at least one number.'),
    confirm: z.string(),
  })
  .refine((values) => values.new_password === values.confirm, {
    path: ['confirm'],
    message: 'Both passwords must match.',
  })

export function ProfilePage() {
  const { user, setUser, signOut } = useAuth()
  const toast = useToast()
  // Two-factor authentication is an administrator feature; an employee never
  // sees the section at all rather than seeing one they cannot use.
  const isAdmin = user?.role === 'ADMIN'
  const [saved, setSaved] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      phone: user?.phone ?? '',
      designation: user?.designation ?? '',
      department: user?.department ?? '',
    },
  })

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
  })

  // The same live checklist the invitation and reset screens show, so the rules
  // are never something you only discover by being refused.
  const newPassword = passwordForm.watch('new_password') ?? ''

  const saveProfile = useMutation({
    mutationFn: (values: z.infer<typeof profileSchema>) => apiPatch<User>('/auth/me', values),
    onSuccess: (updated) => {
      setUser(updated)
      setSaved(true)
      setProfileError(null)
      toast.success('Your details were saved.')
      window.setTimeout(() => setSaved(false), 2500)
    },
    onError: (error) => setProfileError(messageOf(error, 'Your profile was not saved.')),
  })

  const changePassword = useMutation({
    mutationFn: (values: z.infer<typeof passwordSchema>) =>
      apiPost('/auth/change-password', {
        current_password: values.current_password,
        new_password: values.new_password,
      }),
    onSuccess: async () => {
      toast.success('Password changed. Signing you out of every device.')
      // Every session is revoked server-side, so sign out rather than pretend.
      await signOut()
      window.location.assign('/login')
    },
    onError: (error) => setPasswordError(messageOf(error, 'Your password was not changed.')),
  })

  return (
    <>
      <PageHeader
        title="Profile"
        description={
          isAdmin
            ? 'Your details, your password and how this account is protected.'
            : 'Your details and your password.'
        }
      />

      {!user ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardSkeleton lines={6} />
          </Card>
          <Card>
            <CardSkeleton lines={4} />
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your details"
              subtitle={user.email}
              action={
                <span className="text-[12px] text-ink-400">
                  Your administrator changes anything not shown here.
                </span>
              }
            />
            <form
              onSubmit={profileForm.handleSubmit((values) => saveProfile.mutate(values))}
              className="space-y-4 px-5 py-4"
              noValidate
            >
              {profileError && <ErrorNote message={profileError} />}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="First name"
                  error={profileForm.formState.errors.first_name?.message}
                  required
                >
                  <Input autoComplete="given-name" {...profileForm.register('first_name')} />
                </Field>
                <Field label="Last name" error={profileForm.formState.errors.last_name?.message}>
                  <Input autoComplete="family-name" {...profileForm.register('last_name')} />
                </Field>
              </div>

              <Field label="Phone" error={profileForm.formState.errors.phone?.message}>
                <Input type="tel" autoComplete="tel" {...profileForm.register('phone')} />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Job title"
                  error={profileForm.formState.errors.designation?.message}
                >
                  <Input {...profileForm.register('designation')} />
                </Field>
                <Field label="Department" error={profileForm.formState.errors.department?.message}>
                  <Input {...profileForm.register('department')} />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={saveProfile.isPending}>
                  Save changes
                </Button>
                {saved && (
                  <span
                    role="status"
                    className="text-[11px] font-semibold tracking-[0.14em] text-ink-500 uppercase"
                  >
                    Saved
                  </span>
                )}
              </div>
            </form>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Employment" subtitle="Set by your administrator." />
              <dl className="divide-y divide-rule">
                <Row term="Employee code" value={user.employee_code ?? '—'} />
                <Row term="Role" value={user.role === 'ADMIN' ? 'Administrator' : 'Employee'} />
                <Row term="Status" value={user.status ? humanise(user.status) : '—'} />
                <Row term="Joined" value={user.joining_date ? formatDate(user.joining_date) : '—'} />
              </dl>
            </Card>

            {isAdmin && <TwoFactorSetup />}

            <Card>
              <CardHeader
                title="Change password"
                subtitle="You will be signed out of every device, including this one."
              />
              <form
                onSubmit={passwordForm.handleSubmit((values) => changePassword.mutate(values))}
                className="space-y-4 px-5 py-4"
                noValidate
              >
                {passwordError && <ErrorNote message={passwordError} />}

                {/* Tells a password manager which saved login this new
                    password replaces; without it, it offers to save a new one. */}
                <input
                  type="email"
                  autoComplete="username"
                  value={user?.email ?? ''}
                  readOnly
                  hidden
                />

                <Field
                  label="Current password"
                  error={passwordForm.formState.errors.current_password?.message}
                  required
                >
                  <Input type="password" autoComplete="current-password" {...passwordForm.register('current_password')} />
                </Field>
                <div>
                  <Field
                    label="New password"
                    error={passwordForm.formState.errors.new_password?.message}
                    required
                  >
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...passwordForm.register('new_password')}
                    />
                  </Field>
                  <PasswordRules password={newPassword} />
                </div>
                <Field
                  label="Confirm new password"
                  error={passwordForm.formState.errors.confirm?.message}
                  required
                >
                  <Input type="password" autoComplete="new-password" {...passwordForm.register('confirm')} />
                </Field>

                <Button type="submit" loading={changePassword.isPending}>
                  Change password
                </Button>
              </form>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-[11px] font-semibold tracking-[0.1em] text-ink-400 uppercase">{term}</dt>
      <dd className="tabular text-right text-[13px] font-medium text-ink-900">{value}</dd>
    </div>
  )
}
