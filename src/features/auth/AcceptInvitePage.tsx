import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, MailWarning } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { Button, ErrorNote, Field, Input, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AuthSession } from '@/types'
import { AuthLayout } from './AuthLayout'

interface InvitePreview {
  email: string
  first_name: string
  last_name: string
  role: string
  expires_at: string
}

// Mirrors the server's password policy so the employee is told before they submit.
const schema = z
  .object({
    first_name: z.string().min(1, 'Enter your first name.').max(60),
    last_name: z.string().max(60).optional(),
    phone: z.string().max(20).optional(),
    designation: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(128)
      .regex(/[A-Za-z]/, 'Include at least one letter.')
      .regex(/\d/, 'Include at least one number.'),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Both passwords must match.',
  })

type Values = z.infer<typeof schema>

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const adopt = useAuth((state) => state.adopt)
  const [formError, setFormError] = useState<string | null>(null)
  // Once accepted the token is spent. Signing in re-renders this page before
  // the navigation lands, and the preview would ask for it again and get a 409.
  const [accepted, setAccepted] = useState(false)

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => apiGet<InvitePreview>(`/auth/invite/${token}`),
    enabled: Boolean(token) && !accepted,
    retry: false,
  })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      first_name: preview.data?.first_name ?? '',
      last_name: preview.data?.last_name ?? '',
      phone: '',
      designation: '',
      department: '',
      password: '',
      confirm: '',
    },
  })

  const password = watch('password') ?? ''

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const session = await apiPost<AuthSession>('/auth/accept-invite', {
        token,
        password: values.password,
        first_name: values.first_name,
        last_name: values.last_name || '',
        phone: values.phone || null,
        designation: values.designation || null,
        department: values.department || null,
      })
      setAccepted(true)
      adopt(session)
      navigate('/', { replace: true })
    } catch (error) {
      setFormError(messageOf(error, 'Could not complete your account setup.'))
    }
  }

  if (!token) {
    return (
      <InviteProblem
        title="Invitation link incomplete"
        detail="This link is missing its token. Open the link from your invitation email exactly as it was sent — some mail apps cut long links in half."
      />
    )
  }

  if (preview.isLoading) {
    return (
      <AuthLayout
        title="Checking your invitation"
        subtitle="One moment while we look up who invited you."
      >
        <div className="space-y-5" aria-busy="true" aria-label="Checking your invitation">
          <div className="grid grid-cols-2 gap-3">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <FieldSkeleton />
          <FieldSkeleton />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </AuthLayout>
    )
  }

  if (preview.isError) {
    return (
      <InviteProblem
        title="This invitation can no longer be used"
        detail="Invitations expire, and each one can only be used once. If you have already set up your account, sign in instead — otherwise ask your administrator to send a fresh invitation and use the most recent email."
        message={messageOf(preview.error)}
      />
    )
  }

  return (
    <AuthLayout
      title="Set up your account"
      subtitle="Choose a password and tell your colleagues who you are. You can change any of this later."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {preview.data && (
          <p className="rounded-lg border border-rule bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
            Invited as{' '}
            <span className="tabular font-medium break-all text-ink-900">{preview.data.email}</span>
          </p>
        )}

        {formError && <ErrorNote message={formError} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.first_name?.message} required>
            <Input autoFocus {...register('first_name')} />
          </Field>
          <Field label="Last name" error={errors.last_name?.message}>
            <Input {...register('last_name')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Job title" error={errors.designation?.message}>
            <Input placeholder="Engineer" {...register('designation')} />
          </Field>
          <Field label="Department" error={errors.department?.message}>
            <Input placeholder="Engineering" {...register('department')} />
          </Field>
        </div>

        <Field label="Phone" error={errors.phone?.message}>
          <Input type="tel" {...register('phone')} />
        </Field>

        <div>
          <Field label="Password" error={errors.password?.message} required>
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <PasswordRules password={password} />
        </div>

        <Field label="Confirm password" error={errors.confirm?.message} required>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create my account
        </Button>
      </form>
    </AuthLayout>
  )
}

function FieldSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  )
}

/**
 * A link that has expired is not the employee's mistake, so it is not dressed
 * as a failure: the sentence that matters is what to do next, and the server's
 * own wording is kept underneath rather than shouted at the top.
 */
function InviteProblem({
  title,
  detail,
  message,
}: {
  title: string
  detail: string
  message?: string
}) {
  return (
    <AuthLayout title={title}>
      <div className="card p-5">
        <MailWarning className="size-6 text-ink-300" aria-hidden />
        <p className="mt-3 text-[13px] leading-relaxed text-ink-600">{detail}</p>
        {message && (
          <p className="mt-3 border-t border-rule pt-3 text-[12px] text-ink-400">
            The server said: {message}
          </p>
        )}
      </div>
      <Link
        to="/login"
        className="mt-5 inline-block text-[13px] rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900"
      >
        Go to sign in
      </Link>
    </AuthLayout>
  )
}

/**
 * The rules, visible from the moment the field exists rather than after a
 * rejected submit. Each line ticks itself off as it is satisfied, so nobody has
 * to guess what "at least one number" was going to mean.
 */
export function PasswordRules({ password }: { password: string }) {
  const rules = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'A letter', met: /[A-Za-z]/.test(password) },
    { label: 'A number', met: /\d/.test(password) },
  ]

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Password requirements">
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={cn(
            'flex items-center gap-1.5 text-[12px] transition-colors',
            rule.met ? 'text-ink-700' : 'text-ink-400',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
              rule.met ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white',
            )}
          >
            {rule.met && <Check className="size-2.5" strokeWidth={3} />}
          </span>
          {rule.label}
          <span className="sr-only">{rule.met ? ' — met' : ' — not yet met'}</span>
        </li>
      ))}
    </ul>
  )
}
