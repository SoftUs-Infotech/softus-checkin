import { useQuery } from '@tanstack/react-query'
import { MonitorDown } from 'lucide-react'
import { apiGet, resolveApiUrl } from '@/lib/api'
import type { AppRelease, ReleaseFile } from '@/types'

const ARCH_LABEL: Record<string, string> = {
  arm64: 'Apple silicon',
  x64: 'Intel',
  universal: 'any Mac',
}

/*
  On the website, for somebody who has to punch in from the desktop app: what
  to install, with the published installers to download.
*/
export function DesktopAppDownload() {
  const releases = useQuery({
    queryKey: ['app-releases', 'downloads'],
    queryFn: async () => {
      const [mac, linux] = await Promise.all([
        apiGet<AppRelease | null>('/app-releases/latest', { platform: 'mac' }),
        apiGet<AppRelease | null>('/app-releases/latest', { platform: 'linux' }),
      ])
      return { mac, linux }
    },
    staleTime: 5 * 60_000,
  })

  const links: { label: string; file: ReleaseFile }[] = []
  for (const file of releases.data?.mac?.files ?? []) {
    if (file.kind === 'dmg') links.push({ label: `Mac (${ARCH_LABEL[file.arch] ?? file.arch})`, file })
  }
  for (const file of releases.data?.linux?.files ?? []) {
    if (file.kind === 'appimage') links.push({ label: 'Linux', file })
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-rule bg-ink-50/70 px-3 py-2 text-[12px] text-ink-600">
      <MonitorDown className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block font-semibold">Punch in from the Softus Checkin app</span>
        <span className="mt-0.5 block">
          Install the app on this computer and sign in with the same email.
          {!releases.isLoading && links.length === 0 && ' Ask your administrator for the installer.'}
        </span>
        {links.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {links.map(({ label, file }) => (
              <a
                key={file.filename}
                href={resolveApiUrl(file.url)}
                className="font-medium text-ink-900 underline underline-offset-2"
              >
                Download for {label}
              </a>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}
