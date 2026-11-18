import { compareVersions, OS_NAME } from '@/lib/desktop'
import { formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui'
import type { PublishedVersions, User } from '@/types'

const RELEASE_PLATFORM: Record<string, keyof PublishedVersions> = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'windows',
}

/**
 * Which app somebody uses: the desktop app's version and system, flagged when
 * it is older than the published version — or the website.
 */
export function AppCell({ employee, published }: { employee: User; published?: PublishedVersions }) {
  const app = employee.desktop_app
  if (app?.version) {
    const platform = RELEASE_PLATFORM[app.os ?? '']
    const current = platform ? published?.[platform] : null
    const outdated = Boolean(current && compareVersions(app.version, current) < 0)
    // macOS reports a number ("14.5.0"); Linux its distribution ("Ubuntu 22.04.5 LTS");
    // Windows its name and build ("Windows 11 (10.0.22631)").
    const system =
      (app.os === 'linux' || app.os === 'win32') && app.os_version
        ? app.os_version
        : [OS_NAME[app.os ?? ''] ?? app.os, app.os_version].filter(Boolean).join(' ')
    return (
      <span className="block" title={app.last_seen_at ? `Last used ${formatDateTime(app.last_seen_at)}` : undefined}>
        <span className="tabular flex items-center gap-1.5 text-ink-700">
          v{app.version}
          {outdated && <Badge tone="amber">Update due</Badge>}
        </span>
        <span className="block text-[11px] text-ink-400">{system || 'Desktop app'}</span>
      </span>
    )
  }
  if (employee.web_last_seen_at) {
    return (
      <span className="text-ink-500" title={`Last used ${formatDateTime(employee.web_last_seen_at)}`}>
        Website
      </span>
    )
  }
  return <span className="text-ink-300">—</span>
}
