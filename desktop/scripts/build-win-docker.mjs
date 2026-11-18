// Builds the Windows installer on Linux or a Mac, inside electron-builder's
// own Docker image (Windows builds need Wine, which the image has). On a
// Windows computer, run `npm run dist:win` instead.
//
// The screens must be built first (`npm run dist:win:docker` does both).
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE = 'electronuserland/builder:22-wine-10.26'
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// Electron and the Windows build tools are downloaded once and kept on this computer.
const caches = {
  ELECTRON_CACHE: join(homedir(), '.cache', 'electron'),
  ELECTRON_BUILDER_CACHE: join(homedir(), '.cache', 'electron-builder'),
}
// Wine's own folder: it has to belong to the user the build runs as (not /tmp).
const wineHome = join(homedir(), '.cache', 'softus-checkin-wine')
for (const dir of [...Object.values(caches), wineHome]) mkdirSync(dir, { recursive: true })

const args = [
  'run',
  '--rm',
  '--platform',
  'linux/amd64',
  // Files come out owned by whoever runs this, not by root.
  ...(process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []),
  '-v',
  `${wineHome}:/wine-home`,
  '-e',
  'HOME=/wine-home',
  '-e',
  'WINEDEBUG=-all',
  '-v',
  `${desktopDir}:/project`,
  '-w',
  '/project',
]
for (const [name, dir] of Object.entries(caches)) {
  args.push('-v', `${dir}:/cache/${name}`, '-e', `${name}=/cache/${name}`)
}
args.push(IMAGE, 'npx', 'electron-builder', '--win')

console.log(`Building the Windows installer in ${IMAGE}`)
const result = spawnSync('docker', args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
