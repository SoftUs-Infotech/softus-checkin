// Builds the Linux activity helper (desktop/helper, Go) for x64 and ARM into
// desktop/build/helper, where the Linux build packs it. Needs Go 1.18+.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(desktopDir, 'build', 'helper')
mkdirSync(out, { recursive: true })
for (const arch of ['amd64', 'arm64']) {
  console.log(`Building the activity helper for linux/${arch}`)
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags', '-s -w', '-o', join(out, `softus-checkin-helper-${arch}`), '.'],
    { cwd: join(desktopDir, 'helper'), stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: arch } },
  )
}
