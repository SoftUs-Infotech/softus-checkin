'use strict'
/*
  Runs the one-time Linux setup (desktop/linux/setup.sh) as the administrator.

  From the app, pkexec shows the desktop's own password window. IT can run it
  without the app's screens:  ./softus-checkin.AppImage --setup

  The files are first copied to a private temporary folder: the AppImage is
  mounted with FUSE, which root is not allowed to read from.
*/
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app } = require('electron')

function resource(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, '..', '..', ...parts)
}

function helperBinary() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const name = `softus-checkin-helper-${arch}`
  return app.isPackaged ? resource('helper', name) : resource('build', 'helper', name)
}

/** @returns {Promise<{ok: boolean, cancelled?: boolean, output: string}>} */
function run({ onOutput } = {}) {
  return new Promise((resolve) => {
    let dir
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softus-setup-'))
      fs.chmodSync(dir, 0o700)
      fs.copyFileSync(resource('linux', 'setup.sh'), path.join(dir, 'setup.sh'))
      fs.copyFileSync(resource('linux', 'softus-checkin-helper.service'), path.join(dir, 'softus-checkin-helper.service'))
      fs.copyFileSync(helperBinary(), path.join(dir, 'softus-checkin-helper'))
      fs.chmodSync(path.join(dir, 'softus-checkin-helper'), 0o755)
    } catch (error) {
      resolve({ ok: false, output: `The setup files could not be prepared: ${error.message}` })
      return
    }
    const args = [
      '/bin/sh',
      path.join(dir, 'setup.sh'),
      'install',
      path.join(dir, 'softus-checkin-helper'),
      path.join(dir, 'softus-checkin-helper.service'),
    ]
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
    const child = spawn(asRoot ? args[0] : 'pkexec', asRoot ? args.slice(1) : args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk) => {
      output += chunk
      if (onOutput) onOutput(String(chunk))
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      fs.rmSync(dir, { recursive: true, force: true })
      resolve({ ok: false, output: `Could not ask for the administrator password (${error.message}).` })
    })
    child.on('close', (code) => {
      fs.rmSync(dir, { recursive: true, force: true })
      // Kept for whoever has to find out why a setup failed.
      try {
        fs.writeFileSync(
          path.join(app.getPath('userData'), 'setup.log'),
          `${new Date().toISOString()} exit ${code}\n${output}\n`,
        )
      } catch {
        // Not worth failing over.
      }
      // pkexec: 126 = the password window was closed, 127 = not authorised.
      resolve({ ok: code === 0, cancelled: code === 126 || code === 127, output: output.trim() })
    })
  })
}

module.exports = { run, helperBinary }
