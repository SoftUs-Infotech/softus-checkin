import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { resolveApiUrl } from '@/lib/api'
import { desktop, updateKind, type UpdateProgress } from '@/lib/desktop'
import { offerUpdate, UPDATE_CHECK_EVERY_MS, useUpdatePrompt } from '@/lib/updates'
import { useAuth } from '@/store/auth'
import { Button, ErrorNote, Modal } from '@/components/ui'

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(0)} MB`
}

/*
  Shown when "punch in" finds a newer published version, and when the app opens
  (or every half hour while it is open) and one is waiting. The app downloads
  it, checks it is exactly the file the admin published, replaces itself and
  restarts — on the new version.
*/
export function UpdatePrompt() {
  const { release, forPunch, close } = useUpdatePrompt()
  const canPunch = useAuth((state) => state.hasPersonalSpace())
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)

  useEffect(() => desktop?.onUpdateProgress(setProgress), [])
  useEffect(() => {
    if (!desktop) return
    // A moment after the screens are up, then every half hour.
    const first = window.setTimeout(() => void offerUpdate(canPunch), 3000)
    const every = window.setInterval(() => void offerUpdate(canPunch), UPDATE_CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
    }
  }, [canPunch])
  useEffect(() => {
    // A different release opened the prompt: start clean.
    setProgress(null)
    setBusy(false)
    setError(null)
    setManual(false)
  }, [release?.id])

  if (!desktop || !release) return null
  const bridge = desktop
  const file = release.files.find(
    (candidate) =>
      candidate.kind === updateKind() &&
      (candidate.arch === bridge.arch || candidate.arch === 'universal'),
  )

  async function install() {
    if (!file || !release) return
    setBusy(true)
    setError(null)
    const result = await bridge.installUpdate({
      url: resolveApiUrl(file.url),
      sha256: file.sha256,
      size: file.size_bytes,
      filename: file.filename,
      version: release.version,
    })
    if (!result.ok) {
      setError(result.error ?? 'The update could not be installed. Try again.')
      setBusy(false)
      return
    }
    if (result.manual) {
      setManual(true)
      setBusy(false)
    }
    // Otherwise the app restarts on the new version by itself.
  }

  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((100 * progress.received) / progress.total)) : 0
  const stageLabel =
    progress?.stage === 'verifying'
      ? 'Checking the download…'
      : progress?.stage === 'installing'
        ? 'Installing — the app will restart…'
        : `Downloading… ${percent}%`

  return (
    <Modal
      open
      onClose={busy ? () => undefined : close}
      title="Update available"
      description={`Version ${release.version} is ready. You have ${bridge.version}.`}
      footer={
        manual ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Later
            </Button>
            <Button onClick={install} loading={busy} disabled={!file}>
              <Download className="size-4" />
              Update now
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-[13px] text-ink-600">
        <p>{forPunch ? 'Update the app to punch in.' : 'Update now: the app restarts by itself in a few seconds.'}</p>
        {release.notes && (
          <p className="rounded-lg border border-rule bg-ink-50/70 px-3 py-2 whitespace-pre-line">
            {release.notes}
          </p>
        )}
        {file && !manual && !busy && (
          <p className="text-[12px] text-ink-400">Download size: {megabytes(file.size_bytes)}</p>
        )}
        {busy && (
          <div>
            <p className="text-[12px] text-ink-500">{stageLabel}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-ink-900 transition-[width]"
                style={{ width: `${progress?.stage === 'downloading' ? percent : 100}%` }}
              />
            </div>
          </div>
        )}
        {manual && (
          <p>
            {bridge.platform === 'darwin'
              ? 'The new version has been downloaded and opened. Drag Softus Checkin into Applications, replace the old one, then open it again.'
              : 'The new version has been saved in your Downloads folder. Open it from there.'}
          </p>
        )}
        {!file && <ErrorNote message="This version is not available for this computer yet. Ask your administrator." />}
        {error && <ErrorNote message={error} />}
      </div>
    </Modal>
  )
}
