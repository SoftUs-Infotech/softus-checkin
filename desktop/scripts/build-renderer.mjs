// Builds the website's screens into desktop/renderer, for the app to serve.
//
// The API address is built in, like on Vercel. It defaults to production;
// set VITE_API_BASE to point a test build elsewhere, e.g.
//   VITE_API_BASE=http://127.0.0.1:8011/api/v1 npm run renderer
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const webDir = join(desktopDir, '..')
const apiBase = process.env.VITE_API_BASE || 'https://140.245.28.23/api/v1'

console.log(`Building the screens for the desktop app (API: ${apiBase})`)
execFileSync(
  'npx',
  ['vite', 'build', '--mode', 'desktop', '--outDir', join(desktopDir, 'renderer'), '--emptyOutDir'],
  { cwd: webDir, stdio: 'inherit', env: { ...process.env, VITE_API_BASE: apiBase } },
)
