import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, ShieldCheck, TriangleAlert } from 'lucide-react'
import { apiGet, apiPost, messageOf } from '@/lib/api'
import { formatDate } from '@/lib/format'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  Skeleton,
} from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * The Security card on the profile page: turn two-factor authentication on with
 * an authenticator app, keep the recovery codes, and turn it off again.
 *
 * The QR code is drawn here rather than fetched, because handing an `otpauth://`
 * URI — which contains the shared secret in full — to an image service would put
 * the second factor on somebody else's server.
 *
 * Everything anybody has to transcribe by hand — the shared secret, the recovery
 * codes — is monospaced and spaced into groups, and the recovery codes cannot be
 * walked past: the confirmation step stays locked until their owner says they
 * have been saved, because a lost recovery code is a lost account.
 */

interface TwoFactorStatus {
  enabled: boolean
  pending: boolean
  confirmed_at: string | null
  recovery_codes_remaining: number
}

interface TwoFactorSetupPayload {
  secret: string
  otpauth_uri: string
  recovery_codes: string[]
}

/** Base32 in fours: the only way a thirty-two character key gets typed correctly. */
const inGroups = (secret: string) => secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? secret

export function TwoFactorSetup() {
  const queryClient = useQueryClient()
  const [setup, setSetup] = useState<TwoFactorSetupPayload | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [codesSaved, setCodesSaved] = useState(false)

  const status = useQuery({
    queryKey: ['two-factor'],
    queryFn: () => apiGet<TwoFactorStatus>('/auth/2fa'),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['two-factor'] })
  }

  const begin = useMutation({
    mutationFn: () => apiPost<TwoFactorSetupPayload>('/auth/2fa/setup'),
    onSuccess: (data) => {
      setSetup(data)
      setError(null)
      setCode('')
      setCodesSaved(false)
      refresh()
    },
    onError: (cause) => setError(messageOf(cause, 'Two-factor setup could not be started.')),
  })

  const confirm = useMutation({
    mutationFn: () => apiPost<TwoFactorStatus>('/auth/2fa/confirm', { code: code.trim() }),
    onSuccess: () => {
      setSetup(null)
      setCode('')
      setCodesSaved(false)
      setError(null)
      refresh()
    },
    onError: (cause) => setError(messageOf(cause, 'That code was not accepted.')),
  })

  const disable = useMutation({
    mutationFn: () => apiPost<TwoFactorStatus>('/auth/2fa/disable', { password }),
    onSuccess: () => {
      setPassword('')
      setError(null)
      refresh()
    },
    onError: (cause) => setError(messageOf(cause, 'Two-factor authentication was not turned off.')),
  })

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Your browser would not let the page copy. Select the text and copy it by hand.')
    }
  }

  function downloadRecoveryCodes(codes: string[]) {
    const body = `Softus Checkin recovery codes\n\n${codes.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'softus-recovery-codes.txt'
    link.click()
    // Revoking straight after `click()` races the download: some browsers have
    // not started reading the blob yet and the file arrives empty. These codes
    // are shown exactly once, so an empty file means a lost account.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const enabled = status.data?.enabled ?? false
  const remaining = status.data?.recovery_codes_remaining ?? 0

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        subtitle="A code from your phone, on top of your password."
        action={
          status.isLoading ? (
            <Skeleton className="h-5 w-12 rounded-full" />
          ) : enabled ? (
            <Badge className="bg-ink-900 text-white">On</Badge>
          ) : (
            <Badge>Off</Badge>
          )
        }
      />

      <div className="space-y-4 px-5 py-4">
        {error && <ErrorNote message={error} />}

        {status.isLoading && (
          <div className="space-y-2.5" aria-busy="true" aria-label="Loading security settings">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="mt-4 h-10 w-56 rounded-lg" />
          </div>
        )}

        {status.isError && !status.isLoading && (
          <ErrorNote
            message={`${messageOf(status.error, 'Could not read your security settings.')} Reload the page to try again.`}
          />
        )}

        {!status.isLoading && enabled && !setup && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-600">
              Signing in asks for a six-digit code after your password.
              {status.data?.confirmed_at
                ? ` Turned on ${formatDate(status.data.confirmed_at)}.`
                : ''}{' '}
              You have <span className="tabular font-semibold text-ink-900">{remaining}</span>{' '}
              recovery {remaining === 1 ? 'code' : 'codes'} left.
            </p>

            {remaining <= 2 && (
              <p className="rounded-lg border border-rule bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
                <TriangleAlert className="mr-1.5 -mt-0.5 inline size-4 text-ink-400" aria-hidden />
                Few recovery codes left. Turning two-factor off and back on issues a fresh set.
              </p>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                disable.mutate()
              }}
              className="space-y-3 border-t border-rule pt-4"
              noValidate
            >
              <Field
                label="Turn it off"
                hint="Your password is required, so an unlocked laptop is not enough."
                required
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  placeholder="Your password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="danger"
                loading={disable.isPending}
                disabled={password.length === 0}
              >
                Turn off
              </Button>
            </form>
          </>
        )}

        {!status.isLoading && !enabled && !setup && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-600">
              An administrator account can approve leave, alter the record and suspend people. A
              stolen password should not be enough to do any of that.
            </p>
            <Button onClick={() => begin.mutate()} loading={begin.isPending}>
              <ShieldCheck className="size-4" aria-hidden />
              Set up two-factor authentication
            </Button>
          </>
        )}

        {setup && (
          <div className="space-y-6">
            <section>
              <StepHeading step={1} title="Scan this with your app" />
              <p className="mt-1 text-[13px] text-ink-600">
                Google Authenticator, 1Password, Authy — any of them.
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-5">
                <QrCode value={setup.otpauth_uri} />
                <div className="min-w-0 flex-1 space-y-3 sm:min-w-[15rem]">
                  <div>
                    <p className="text-[12px] text-ink-500">
                      Cannot scan? Type this key into the app instead.
                    </p>
                    <Copyable
                      text={inGroups(setup.secret)}
                      emphasis
                      label="Setup key"
                      copied={copied === 'secret'}
                      onCopy={() => copy('secret', setup.secret)}
                    />
                  </div>
                  <Copyable
                    text={setup.otpauth_uri}
                    label="Setup link"
                    copied={copied === 'uri'}
                    onCopy={() => copy('uri', setup.otpauth_uri)}
                  />
                </div>
              </div>
            </section>

            {/* The recovery codes. This is the one screen in the product whose
                content cannot be recovered by reloading, so it is given the
                weight of a document rather than a paragraph. */}
            <section className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
              <StepHeading step={2} title="Save your recovery codes now" />
              <p className="mt-1.5 flex items-start gap-2 text-[13px] leading-relaxed text-ink-700">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                <span>
                  <strong className="font-semibold text-ink-900">
                    These are shown once and never again.
                  </strong>{' '}
                  Each code signs you in a single time if your phone is lost. Without them, and
                  without your phone, only an administrator can get you back in.
                </span>
              </p>

              <ol className="tabular mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-ink-200 bg-white px-4 py-3 text-[13px] text-ink-900 sm:grid-cols-2">
                {setup.recovery_codes.map((recovery, index) => (
                  <li key={recovery} className="flex items-baseline gap-2.5">
                    <span className="w-4 shrink-0 text-right text-[11px] text-ink-300">
                      {index + 1}
                    </span>
                    <span className="tracking-[0.08em] select-all break-all">{recovery}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    downloadRecoveryCodes(setup.recovery_codes)
                    setCodesSaved(true)
                  }}
                >
                  <Download className="size-4" aria-hidden />
                  Download as a file
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copy('codes', setup.recovery_codes.join('\n'))}
                >
                  {copied === 'codes' ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  {copied === 'codes' ? 'Copied' : 'Copy all'}
                </Button>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-ink-200 pt-3 text-[13px] text-ink-700">
                <input
                  type="checkbox"
                  checked={codesSaved}
                  onChange={(event) => setCodesSaved(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-ink-900"
                />
                I have saved these {setup.recovery_codes.length} codes somewhere safe.
              </label>
            </section>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                confirm.mutate()
              }}
              className="space-y-3"
              noValidate
            >
              <StepHeading step={3} title="Enter the code your app is showing" />
              <Field label="Six-digit code" hint="Nothing is switched on until this matches." required>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  className="tabular h-12 max-w-[11rem] text-center text-[22px] tracking-[0.3em] indent-[0.3em]"
                />
              </Field>
              {!codesSaved && (
                <p className="text-[12px] text-ink-500">
                  Confirm you have saved the recovery codes above before turning this on.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={confirm.isPending}
                  disabled={code.length !== 6 || !codesSaved}
                >
                  Turn on
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSetup(null)
                    setCodesSaved(false)
                    setCode('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Card>
  )
}

function StepHeading({ step, title }: { step: number; title: string }) {
  return (
    <p className="font-display flex items-center gap-2 text-[13px] font-semibold text-ink-900">
      <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-[3px] bg-ink-900 text-[11px] font-semibold text-white">
        {step}
      </span>
      {title}
    </p>
  )
}

function Copyable({
  text,
  copied,
  onCopy,
  label,
  emphasis,
}: {
  text: string
  copied: boolean
  onCopy: () => void
  label: string
  /** The shared secret, which somebody is going to read out digit by digit. */
  emphasis?: boolean
}) {
  return (
    <div className="mt-1.5 flex items-start gap-2">
      <code
        className={cn(
          'tabular min-w-0 flex-1 rounded-md border border-rule bg-ink-50 px-2.5 py-1.5 break-all select-all text-ink-900',
          emphasis ? 'text-[13px] tracking-[0.06em]' : 'text-[12px] text-ink-600',
        )}
      >
        {text}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onCopy}
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** The matrix rendered as one SVG path — no canvas, no image, no network. */
function QrCode({ value, scale = 5 }: { value: string; scale?: number }) {
  const modules = useMemo(() => {
    try {
      return encodeQr(value)
    } catch {
      return null
    }
  }, [value])

  if (!modules) {
    return (
      <p className="text-[12px] text-ink-500">
        This link is too long to draw as a QR code — enter the key by hand.
      </p>
    )
  }

  const quiet = 4
  const size = modules.length + quiet * 2
  const path = modules
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')),
    )
    .join('')

  // Never wider than the column it sits in: at 360px the card is narrower than
  // the code's natural size, and a clipped QR code will not scan.
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size * scale}
      height={size * scale}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Two-factor setup QR code"
      className="h-auto w-[min(100%,13.5rem)] shrink-0 rounded-lg border border-rule bg-white p-1.5"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#111111" />
    </svg>
  )
}

// --------------------------------------------------------------------------- #
// A byte-mode QR encoder, error correction level M, versions 1 to 10.
//
// Small enough to keep here and to read: an `otpauth://` URI is around a hundred
// characters, which lands on version 6 or 7. Anything longer than version 10
// holds falls back to the key being typed in by hand.
// --------------------------------------------------------------------------- #

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let index = 0, value = 1; index < 255; index++) {
  EXP[index] = value
  LOG[value] = index
  value <<= 1
  if (value & 0x100) value ^= 0x11d
}
for (let index = 255; index < 512; index++) EXP[index] = EXP[index - 255]

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** ``[data codewords, EC codewords per block, short blocks, long blocks]`` per version. */
const SPECS: Array<[number, number, number, number] | null> = [
  null,
  [16, 10, 1, 0],
  [28, 16, 1, 0],
  [44, 26, 1, 0],
  [64, 18, 2, 0],
  [86, 24, 2, 0],
  [108, 16, 4, 0],
  [124, 18, 4, 0],
  [154, 22, 2, 2],
  [182, 22, 3, 2],
  [216, 26, 4, 1],
]

const ALIGNMENT: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function generatorPoly(degree: number): number[] {
  let poly = [1]
  for (let step = 0; step < degree; step++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i]
      next[i + 1] ^= gfMul(poly[i], EXP[step])
    }
    poly = next
  }
  return poly
}

function errorCorrection(block: number[], degree: number): number[] {
  const generator = generatorPoly(degree)
  const out = new Array<number>(degree).fill(0)
  for (const byte of block) {
    const factor = byte ^ out[0]
    out.shift()
    out.push(0)
    for (let i = 0; i < degree; i++) out[i] ^= gfMul(generator[i + 1], factor)
  }
  return out
}

function toCodewords(bytes: Uint8Array, version: number): number[] {
  const [dataCount] = SPECS[version]!
  const bits: number[] = []
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }

  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)

  const capacity = dataCount * 8
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }
  const padding = [0xec, 0x11]
  while (codewords.length < dataCount) codewords.push(padding[codewords.length % 2])
  return codewords
}

function interleave(codewords: number[], version: number): number[] {
  const [dataCount, ecCount, group1, group2] = SPECS[version]!
  const shortLength = Math.floor(dataCount / (group1 + group2))

  const blocks: number[][] = []
  let offset = 0
  for (let i = 0; i < group1 + group2; i++) {
    const length = i < group1 ? shortLength : shortLength + 1
    blocks.push(codewords.slice(offset, offset + length))
    offset += length
  }
  const ecBlocks = blocks.map((block) => errorCorrection(block, ecCount))

  const out: number[] = []
  const longest = Math.max(...blocks.map((block) => block.length))
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < ecCount; i++) for (const block of ecBlocks) out.push(block[i])
  return out
}

/** The function patterns. ``null`` marks a module data is still free to occupy. */
function skeleton(version: number): Array<Array<number | null>> {
  const size = version * 4 + 17
  const matrix: Array<Array<number | null>> = Array.from({ length: size }, () =>
    new Array<number | null>(size).fill(null),
  )
  const set = (x: number, y: number, value: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) matrix[y][x] = value
  }

  const finder = (ox: number, oy: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
        const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        set(ox + dx, oy + dy, inside && (ring || core) ? 1 : 0)
      }
    }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)

  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0
    matrix[6][i] = dark
    matrix[i][6] = dark
  }

  const centres = ALIGNMENT[version]
  const last = centres.length - 1
  for (let row = 0; row <= last; row++) {
    for (let column = 0; column <= last; column++) {
      // Every combination except the three that would sit on a finder pattern.
      const onFinder =
        (row === 0 && column === 0) ||
        (row === 0 && column === last) ||
        (row === last && column === 0)
      if (onFinder) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy))
          set(centres[column] + dx, centres[row] + dy, ring === 1 ? 0 : 1)
        }
      }
    }
  }

  // Reserved now, written once a mask has been chosen.
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = 0
    if (matrix[i][8] === null) matrix[i][8] = 0
  }
  for (let i = 0; i < 8; i++) {
    matrix[8][size - 1 - i] = 0
    matrix[size - 1 - i][8] = 0
  }
  matrix[size - 8][8] = 1 // the module that is always dark

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3)
      const b = (i % 3) + size - 11
      matrix[b][a] = 0
      matrix[a][b] = 0
    }
  }
  return matrix
}

/** The zigzag the data follows: two columns at a time, right to left, skipping column 6. */
function dataPositions(size: number): Array<[number, number]> {
  const positions: Array<[number, number]> = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      positions.push([right, y], [right - 1, y])
    }
    upward = !upward
  }
  return positions
}

function formatBits(mask: number): number {
  const data = mask // error correction level M is 0b00, so only the mask varies
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
  return ((data << 10) | remainder) ^ 0x5412
}

function versionBits(version: number): number {
  let remainder = version
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25)
  return (version << 12) | remainder
}

function writeFormat(matrix: number[][], mask: number) {
  const size = matrix.length
  const bits = formatBits(mask)
  const bit = (i: number) => (bits >> i) & 1

  for (let i = 0; i <= 5; i++) matrix[8][i] = bit(i)
  matrix[8][7] = bit(6)
  matrix[8][8] = bit(7)
  matrix[7][8] = bit(8)
  for (let i = 9; i <= 14; i++) matrix[14 - i][8] = bit(i)

  for (let i = 0; i <= 6; i++) matrix[size - 1 - i][8] = bit(i)
  for (let i = 7; i <= 14; i++) matrix[8][size - 15 + i] = bit(i)
  matrix[size - 8][8] = 1
}

function writeVersion(matrix: number[][], version: number) {
  if (version < 7) return
  const size = matrix.length
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const value = (bits >> i) & 1
    const a = Math.floor(i / 3)
    const b = (i % 3) + size - 11
    matrix[b][a] = value
    matrix[a][b] = value
  }
}

/** The four penalty rules from the standard; the lowest-scoring mask wins. */
function penalty(matrix: number[][]): number {
  const size = matrix.length
  let score = 0

  for (let line = 0; line < size; line++) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let i = 1; i < size; i++) {
        const previous = horizontal ? matrix[line][i - 1] : matrix[i - 1][line]
        const current = horizontal ? matrix[line][i] : matrix[i][line]
        if (current === previous) {
          run++
        } else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      if (run >= 5) score += run - 2
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = matrix[y][x]
      if (value === matrix[y][x + 1] && value === matrix[y + 1][x] && value === matrix[y + 1][x + 1])
        score += 3
    }
  }

  const finderLike = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const reversed = [...finderLike].reverse()
  const looksLikeFinder = (window: number[]) =>
    finderLike.every((value, i) => value === window[i]) ||
    reversed.every((value, i) => value === window[i])
  for (let line = 0; line < size; line++) {
    for (let start = 0; start + 11 <= size; start++) {
      const row: number[] = []
      const column: number[] = []
      for (let i = 0; i < 11; i++) {
        row.push(matrix[line][start + i])
        column.push(matrix[start + i][line])
      }
      if (looksLikeFinder(row)) score += 40
      if (looksLikeFinder(column)) score += 40
    }
  }

  let dark = 0
  for (const row of matrix) for (const value of row) dark += value
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
  return score
}

/** ``modules[y][x]`` — 1 is dark. Throws when the text needs more than version 10. */
function encodeQr(text: string): number[][] {
  const bytes = new TextEncoder().encode(text)
  const version = SPECS.findIndex(
    (spec, index) => spec !== null && bytes.length + (index < 10 ? 2 : 3) <= spec[0],
  )
  if (version < 1) throw new Error('Too much data for a version 10 QR code.')

  const base = skeleton(version)
  const reserved = base.map((row) => row.map((value) => value !== null))

  const bits: number[] = []
  for (const byte of interleave(toCodewords(bytes, version), version)) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  }
  let index = 0
  for (const [x, y] of dataPositions(base.length)) {
    if (base[y][x] !== null) continue
    // Past the last codeword are the version's remainder bits, which stay light.
    base[y][x] = index < bits.length ? bits[index] : 0
    index++
  }
  const placed = base as number[][]

  let best: { score: number; matrix: number[][] } | null = null
  for (let mask = 0; mask < 8; mask++) {
    const candidate = placed.map((row, y) =>
      row.map((value, x) => (!reserved[y][x] && MASKS[mask](x, y) ? value ^ 1 : value)),
    )
    writeFormat(candidate, mask)
    writeVersion(candidate, version)
    const score = penalty(candidate)
    if (best === null || score < best.score) best = { score, matrix: candidate }
  }
  return best!.matrix
}
