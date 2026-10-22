import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LinkIcon, MailCheck } from 'lucide-react'
import { apiPost, messageOf } from '@/lib/api'
import { Button, ErrorNote, Field, Input, useToast } from '@/components/ui'
import { AuthLayout } from './AuthLayout'
import { PasswordRules } from './AcceptInvitePage'

const emailSchema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
})

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) })

  async function onSubmit(values: z.infer<typeof emailSchema>) {
    setFormError(null)
    try {
      await apiPost('/auth/forgot-password', values)
      setSent(true)
    } catch (error) {
      setFormError(messageOf(error))
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If that address has an account, a reset link is on its way."
      >
        <div className="card p-5">
          <MailCheck className="size-6 text-ink-300" aria-hidden />
          <p className="mt-3 text-[13px] leading-relaxed text-ink-600">
            We sent the link to{' '}
            <span className="tabular font-medium break-all text-ink-900">{getValues('email')}</span>
            . It expires in an hour, and opening it will sign you out everywhere else.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-500">
            Nothing after a few minutes? Check the spam folder, and make sure that is the address
            your administrator invited.
          </p>
        </div>
        <Link
          to="/login"
          className="mt-5 inline-block text-[13px] rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900"
        >
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link to set a new one."
      footer={
        <Link to="/login" className="rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}
        <Field label="Email address" error={errors.email?.message} required>
          <Input
            type="email"
            autoFocus
            autoComplete="email"
            placeholder="you@company.com"
            {...register('email')}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .regex(/[A-Za-z]/, 'Include at least one letter.')
      .regex(/\d/, 'Include at least one number.'),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Both passwords must match.',
  })

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) })

  const password = watch('password') ?? ''

  async function onSubmit(values: z.infer<typeof resetSchema>) {
    setFormError(null)
    try {
      await apiPost('/auth/reset-password', { token, new_password: values.password })
      // The reset screen disappears the instant this succeeds, so the only place
      // left to say it worked is the sign-in screen it lands on.
      toast.success('Password updated. Sign in with your new password.')
      navigate('/login', { replace: true })
    } catch (error) {
      setFormError(messageOf(error))
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link incomplete">
        <div className="card p-5">
          <LinkIcon className="size-6 text-ink-300" aria-hidden />
          <p className="mt-3 text-[13px] leading-relaxed text-ink-600">
            This link is missing its token. Open it from your email exactly as it was sent — some
            mail apps break long links across two lines. If it still will not open, ask for a new
            reset link.
          </p>
        </div>
        <Link
          to="/forgot-password"
          className="mt-5 inline-block text-[13px] rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900"
        >
          Send me a new link
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="You will be signed out everywhere else, on every device."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}
        <div>
          <Field label="New password" error={errors.password?.message} required>
            <Input
              type="password"
              autoFocus
              autoComplete="new-password"
              {...register('password')}
            />
          </Field>
          <PasswordRules password={password} />
        </div>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
