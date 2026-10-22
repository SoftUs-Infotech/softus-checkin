import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { apiPost, messageOf } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { Button, ErrorNote, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AuthSession } from '@/types'
import { AuthLayout } from './AuthLayout'

const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

type Values = z.infer<typeof schema>

/** An administrator with two-factor authentication gets this instead of tokens. */
interface Challenge {
  two_factor_required: true
  challenge_token: string
  expires_in: number
}

const isChallenge = (result: AuthSession | Challenge): result is Challenge =>
  'two_factor_required' in result

export function LoginPage() {
  const navigate = useNavigate()
  const adopt = useAuth((state) => state.adopt)
  const [formError, setFormError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const result = await apiPost<AuthSession | Challenge>('/auth/login', values)
      if (isChallenge(result)) {
        setChallenge(result)
        return
      }
      adopt(result)
      navigate('/', { replace: true })
    } catch (error) {
      setFormError(messageOf(error, 'Could not sign you in.'))
    }
  }

  if (challenge) {
    return (
      <SecondStep
        challenge={challenge}
        onDone={(session) => {
          adopt(session)
          navigate('/', { replace: true })
        }}
        onStartOver={() => {
          setChallenge(null)
          setFormError(null)
        }}
      />
    )
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the email address your administrator invited."
      footer={
        <Link to="/forgot-password" className="rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900">
          Forgot your password?
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorNote message={formError} />}

        <Field label="Email address" error={errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            {...register('email')}
          />
        </Field>

        <Field label="Password" error={errors.password?.message} required>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

/**
 * The password was right; the sign-in is not finished until a code arrives. The
 * challenge is single-use and short-lived, so anything that goes wrong here
 * sends the administrator back to the password screen rather than retrying.
 *
 * This screen is deliberately styled as a continuation and not as a problem:
 * the first thing on it confirms the password was accepted, because a plain
 * code box appearing after a submit otherwise reads as a rejection.
 */
function SecondStep({
  challenge,
  onDone,
  onStartOver,
}: {
  challenge: Challenge
  onDone: (session: AuthSession) => void
  onStartOver: () => void
}) {
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await apiPost<AuthSession>('/auth/2fa/verify', {
        challenge_token: challenge.challenge_token,
        code: code.trim(),
      })
      onDone(session)
    } catch (cause) {
      setError(messageOf(cause, 'That code was not accepted.'))
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setUseRecovery((previous) => !previous)
    setCode('')
    setError(null)
  }

  const ready = useRecovery ? code.trim().length > 0 : code.length === 6

  return (
    <AuthLayout
      title="One more step"
      subtitle={
        useRecovery
          ? 'Enter one of the recovery codes you saved when you set this up.'
          : 'Enter the six-digit code your authenticator app is showing.'
      }
      footer={
        <button
          type="button"
          onClick={onStartOver}
          className="rounded font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 transition-colors hover:decoration-ink-900"
        >
          Start again
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="flex items-center gap-2 rounded-lg border border-rule bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
          <ShieldCheck className="size-4 shrink-0 text-ink-400" aria-hidden />
          Password accepted. Your account asks for a second factor.
        </p>

        {error && <ErrorNote message={error} />}

        {useRecovery ? (
          <Field
            label="Recovery code"
            hint="Each recovery code works once and is then used up."
            required
          >
            <Input
              autoFocus
              autoComplete="one-time-code"
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={32}
              placeholder="ABCDE-FGHJK"
              className="tabular tracking-[0.12em]"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        ) : (
          <CodeField value={code} onChange={setCode} />
        )}

        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!ready}>
          Sign in
        </Button>

        <button
          type="button"
          onClick={switchMode}
          className="flex w-full items-center justify-center gap-1.5 rounded py-1 text-[13px] text-ink-500 hover:text-ink-900 hover:underline"
        >
          <KeyRound className="size-3.5" aria-hidden />
          {useRecovery ? 'Use my authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </form>
    </AuthLayout>
  )
}

/**
 * A six-digit code field that looks like six digits: one real input, so paste
 * and the browser's own one-time-code autofill both still work, but sized and
 * spaced so each digit can be checked against the phone at a glance.
 */
function CodeField({
  value,
  onChange,
  label = 'Six-digit code',
  hint = 'The code changes every thirty seconds.',
  id = 'otp-code',
}: {
  value: string
  onChange: (next: string) => void
  label?: string
  hint?: string
  id?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-ink-700">
        {label}
        <span className="text-status-red">*</span>
      </label>
      <input
        id={id}
        autoFocus
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="••••••"
        aria-describedby={`${id}-hint`}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={cn(
          'tabular w-full rounded-lg border border-ink-200 bg-white text-center',
          'h-14 text-[26px] leading-none font-medium text-ink-900',
          'tracking-[0.32em] indent-[0.32em]',
          'placeholder:text-ink-300 transition-colors focus:border-ink-800',
        )}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span id={`${id}-hint`} className="text-[12px] text-ink-400">
          {hint}
        </span>
        <span className="tabular text-[12px] text-ink-300">{value.length}/6</span>
      </div>
    </div>
  )
}
