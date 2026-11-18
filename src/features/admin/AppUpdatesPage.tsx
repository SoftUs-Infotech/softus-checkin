import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, MonitorDown, Rocket, Trash2, Undo2, Upload } from 'lucide-react'
import { apiDelete, apiGet, apiPost, http, messageOf, resolveApiUrl, type ApiEnvelope } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
  type BadgeTone,
} from '@/components/ui'
import type { AppRelease, ReleaseFile } from '@/types'

const PLATFORM_LABEL = { mac: 'Mac', linux: 'Linux', windows: 'Windows' } as const
const PLATFORMS = ['mac', 'linux', 'windows'] as const
type Platform = (typeof PLATFORMS)[number]
/** The file each platform's app updates itself from. */
const UPDATE_FILE: Record<Platform, string> = { mac: '.zip', linux: '.AppImage', windows: '.exe' }

/** The platform a build file is for, from its extension; null when it cannot tell. */
function platformOf(name: string): Platform | null {
  if (/\.AppImage$/i.test(name)) return 'linux'
  if (/\.exe$/i.test(name)) return 'windows'
  if (/\.(zip|dmg)$/i.test(name)) return 'mac'
  return null
}
const ARCH_LABEL: Record<string, string> = {
  arm64: 'Apple silicon (arm64)',
  x64: 'Intel / PC (x64)',
  universal: 'Universal',
}
const KIND_LABEL: Record<ReleaseFile['kind'], string> = {
  zip: 'Update (.zip)',
  dmg: 'Installer (.dmg)',
  appimage: 'App (.AppImage)',
  exe: 'Installer (.exe)',
}
const STATUS_TONE: Record<AppRelease['status'], BadgeTone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'green',
  WITHDRAWN: 'amber',
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(bytes >= 10 * 1_048_576 ? 0 : 1)} MB`
}

type Intent = { kind: 'publish' | 'withdraw' | 'delete'; release: AppRelease }

/*
  Desktop app versions. Upload a version's build files (the first upload makes
  a draft), then publish it: from the next punch-in, every app on that platform
  that is older asks its employee to update before punching in.
*/
export function AppUpdatesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [intent, setIntent] = useState<Intent | null>(null)

  const releases = useQuery({
    queryKey: ['app-releases', 'all'],
    queryFn: () => apiGet<AppRelease[]>('/app-releases'),
  })

  const act = useMutation({
    mutationFn: ({ kind, release }: Intent) =>
      kind === 'delete'
        ? apiDelete<null>(`/app-releases/${release.id}`)
        : apiPost<AppRelease>(`/app-releases/${release.id}/${kind}`),
    onSuccess: (_result, { kind, release }) => {
      queryClient.invalidateQueries({ queryKey: ['app-releases'] })
      toast.success(
        kind === 'publish'
          ? `Version ${release.version} published.`
          : kind === 'withdraw'
            ? `Version ${release.version} withdrawn.`
            : `Version ${release.version} deleted.`,
      )
      setIntent(null)
    },
  })

  const list = releases.data ?? []
  const current = (platform: Platform) =>
    list.find((release) => release.platform === platform && release.current)

  return (
    <div className="space-y-6">
      <PageHeader
        title="App updates"
        description="The desktop app that work-from-home staff punch in from. Upload a new version, then publish it: older apps update before their next punch-in."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const release = current(platform)
          return (
            <Card key={platform} className="px-4 py-3">
              <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                {PLATFORM_LABEL[platform]} — published
              </p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-ink-900">
                {release ? `v${release.version}` : '—'}
              </p>
              <p className="text-[12px] text-ink-400">
                {release?.published_at ? `Since ${formatDateTime(release.published_at)}` : 'Nothing published yet'}
              </p>
            </Card>
          )
        })}
      </div>

      <UploadCard onUploaded={() => queryClient.invalidateQueries({ queryKey: ['app-releases'] })} />

      <Card>
        <CardHeader title="Versions" subtitle="Drafts, published and withdrawn, newest first." />
        {releases.isLoading ? (
          <div className="p-4">
            <CardSkeleton />
          </div>
        ) : releases.error ? (
          <div className="p-4">
            <ErrorNote message={messageOf(releases.error, 'The versions could not be loaded.')} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<MonitorDown className="size-6" />}
            title="No versions yet"
            description="Build the app, then upload its files above."
          />
        ) : (
          <ul className="divide-y divide-rule">
            {list.map((release) => (
              <li key={release.id} className="px-4 py-3" data-release={`${release.platform}-${release.version}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular font-semibold text-ink-900">v{release.version}</span>
                    <Badge>{PLATFORM_LABEL[release.platform]}</Badge>
                    <Badge tone={STATUS_TONE[release.status]}>
                      {release.current ? 'Current' : release.status.toLowerCase()}
                    </Badge>
                    {!release.updatable && release.status === 'DRAFT' && (
                      <span className="text-[12px] text-status-amber">
                        Needs the {UPDATE_FILE[release.platform]} before publishing
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {release.status === 'DRAFT' && (
                      <Button size="sm" disabled={!release.updatable} onClick={() => setIntent({ kind: 'publish', release })}>
                        <Rocket className="size-3.5" />
                        Publish
                      </Button>
                    )}
                    {release.status === 'PUBLISHED' && (
                      <Button size="sm" variant="secondary" onClick={() => setIntent({ kind: 'withdraw', release })}>
                        <Undo2 className="size-3.5" />
                        Withdraw
                      </Button>
                    )}
                    {release.status !== 'PUBLISHED' && (
                      <Button size="sm" variant="ghost" onClick={() => setIntent({ kind: 'delete', release })}>
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {release.notes && <p className="mt-1 text-[13px] whitespace-pre-line text-ink-600">{release.notes}</p>}
                <ul className="mt-2 space-y-1">
                  {release.files.map((file) => (
                    <li key={`${file.kind}-${file.arch}`} className="flex flex-wrap items-center gap-x-3 text-[12px] text-ink-500">
                      <span className="text-ink-700">{KIND_LABEL[file.kind]}</span>
                      <span>{ARCH_LABEL[file.arch] ?? file.arch}</span>
                      <span className="tabular">{megabytes(file.size_bytes)}</span>
                      <a
                        href={resolveApiUrl(file.url)}
                        className="inline-flex items-center gap-1 font-medium text-ink-900 underline underline-offset-2"
                      >
                        <Download className="size-3" />
                        {file.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {intent && (
        <Modal
          open
          onClose={() => !act.isPending && setIntent(null)}
          title={
            intent.kind === 'publish'
              ? `Publish version ${intent.release.version}?`
              : intent.kind === 'withdraw'
                ? `Withdraw version ${intent.release.version}?`
                : `Delete version ${intent.release.version}?`
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setIntent(null)} disabled={act.isPending}>
                Cancel
              </Button>
              <Button
                variant={intent.kind === 'delete' ? 'danger' : 'primary'}
                loading={act.isPending}
                onClick={() => act.mutate(intent)}
              >
                {intent.kind === 'publish' ? 'Publish' : intent.kind === 'withdraw' ? 'Withdraw' : 'Delete'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-[13px] text-ink-600">
            <p>
              {intent.kind === 'publish'
                ? `Every ${PLATFORM_LABEL[intent.release.platform]} app on an older version will have to update before its next punch-in.`
                : intent.kind === 'withdraw'
                  ? 'It stops being offered. The version published before it becomes the one apps have to be on.'
                  : 'Its files are removed from storage. This cannot be undone.'}
            </p>
            {act.error && <ErrorNote message={messageOf(act.error)} />}
          </div>
        </Modal>
      )}
    </div>
  )
}

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState<Platform>('mac')
  const [arch, setArch] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)

  /** Fill the version and platform in from the first file's name, when they are empty. */
  function pick(list: FileList | null) {
    const picked = Array.from(list ?? [])
    setFiles(picked)
    const name = picked[0]?.name ?? ''
    // softus-checkin-1.0.1-linux-x86_64.AppImage → 1.0.1; a pre-release keeps its tag (1.1.0-beta.2).
    const found = name.match(/\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.?\d+)?)?/i)
    if (found && !version) setVersion(found[0])
    const fromName = platformOf(name)
    if (fromName) setPlatform(fromName)
  }

  const upload = useMutation({
    mutationFn: async () => {
      for (const [index, file] of files.entries()) {
        const form = new FormData()
        form.append('version', version.trim())
        // Each file goes to its own platform, so one upload can hold every build of a version.
        form.append('platform', platformOf(file.name) ?? platform)
        if (arch) form.append('arch', arch)
        if (notes.trim()) form.append('notes', notes.trim())
        form.append('file', file)
        await http.post<ApiEnvelope<AppRelease>>('/app-releases/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // A build is 100–200 MB: the usual 20-second limit would cut it off.
          timeout: 0,
          onUploadProgress: (event) => {
            const percent = event.total ? Math.round((100 * event.loaded) / event.total) : 0
            setProgress(`${file.name} — ${percent}% (${index + 1} of ${files.length})`)
          },
        })
      }
    },
    onSuccess: () => {
      toast.success(files.length === 1 ? 'File uploaded.' : `${files.length} files uploaded.`)
      setFiles([])
      setProgress(null)
      if (fileInput.current) fileInput.current.value = ''
      onUploaded()
    },
    onError: () => setProgress(null),
  })

  return (
    <Card>
      <CardHeader
        title="Upload a version"
        subtitle="Mac: the .zip (the app updates from it) and the .dmg (first install), for each processor. Linux: the .AppImage. Windows: the .exe installer."
      />
      <form
        className="grid gap-4 px-4 pb-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          upload.mutate()
        }}
      >
        <Field label="Build files" className="md:col-span-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".zip,.dmg,.AppImage,.exe"
            onChange={(event) => pick(event.target.files)}
            className="block w-full text-[13px] text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-ink-800"
            aria-label="Build files"
          />
        </Field>
        <Field label="Version" hint="As in the file names, e.g. 1.0.1">
          <Input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.1" aria-label="Version" />
        </Field>
        <Field label="Platform">
          <Select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)} aria-label="Platform">
            <option value="mac">Mac</option>
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
          </Select>
        </Field>
        <Field label="Processor" hint="Read from the file name when left on automatic.">
          <Select value={arch} onChange={(event) => setArch(event.target.value)} aria-label="Processor">
            <option value="">Automatic</option>
            <option value="arm64">Apple silicon (arm64)</option>
            <option value="x64">Intel / PC (x64)</option>
            <option value="universal">Universal</option>
          </Select>
        </Field>
        <Field label="What changed (optional)" hint="Shown to employees in the update prompt.">
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} aria-label="What changed" />
        </Field>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" loading={upload.isPending} disabled={!files.length || !version.trim()}>
            <Upload className="size-4" />
            Upload {files.length > 1 ? `${files.length} files` : 'file'}
          </Button>
          {progress && <span className="tabular text-[12px] text-ink-500">{progress}</span>}
        </div>
        {upload.error && (
          <div className="md:col-span-2">
            <ErrorNote message={messageOf(upload.error, 'The upload failed.')} />
          </div>
        )}
      </form>
    </Card>
  )
}
