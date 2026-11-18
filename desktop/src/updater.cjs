'use strict'
/*
  Installing a version the admin published.

  The app downloads the file, checks its size and SHA-256 against what the
  server recorded at upload (so a damaged or swapped download is never
  installed), then hands over to a small script that waits for this app to
  quit, puts the new version in place of the old one, and starts it.

  The app is not signed with an Apple Developer ID, so macOS's own updater
  cannot be used; this does the same job by hand:

  - macOS: the .zip holds the new "Softus Checkin.app"; it replaces the one
    this app runs from (usually /Applications).
  - Linux: the .AppImage replaces the one this app runs from ($APPIMAGE).

  Where the app cannot write over itself (installed by another user, run from
  the disk image, a .deb), the download is opened for the person to finish.
*/
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { app, net, shell } = require('electron')

const SAFE_NAME = /[^A-Za-z0-9._-]/g

function allowedUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return true
    // Plain http only to this computer — the local test setup.
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  } catch {
    return false
  }
}

async function download(file, target, onProgress) {
  const response = await net.fetch(file.url)
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`)
  const total = Number(response.headers.get('content-length')) || file.size || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(target)
  let received = 0
  let lastReport = 0
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      received += buffer.length
      hash.update(buffer)
      if (!out.write(buffer)) await new Promise((resolve) => out.once('drain', resolve))
      if (Date.now() - lastReport > 150) {
        lastReport = Date.now()
        onProgress({ stage: 'downloading', received, total })
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve))
  }
  onProgress({ stage: 'verifying', received, total })
  return { received, sha256: hash.digest('hex') }
}

/** A detached shell script: wait for this app to quit, swap in the new version, start it. */
function handOver(lines) {
  const script = path.join(app.getPath('temp'), `softus-checkin-update-${Date.now()}.sh`)
  fs.writeFileSync(
    script,
    [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      ...lines,
      `rm -f "${script}"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  // The new version sets these up for itself; the old AppImage's would point at its own mount.
  const env = { ...process.env }
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[name]
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore', env })
  child.unref()
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function writable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function installMac(downloaded) {
  // …/Softus Checkin.app/Contents/MacOS/Softus Checkin → …/Softus Checkin.app
  const current = path.resolve(process.execPath, '..', '..', '..')
  const extractTo = path.join(path.dirname(downloaded), `extracted-${Date.now()}`)
  fs.mkdirSync(extractTo, { recursive: true })
  const unzip = spawnSync('/usr/bin/ditto', ['-x', '-k', downloaded, extractTo])
  if (unzip.status !== 0) throw new Error('The update could not be unpacked.')
  const bundle = fs.readdirSync(extractTo).find((name) => name.endsWith('.app'))
  if (!bundle) throw new Error('The update does not contain the app.')
  const fresh = path.join(extractTo, bundle)

  const inPlace = current.endsWith('.app') && !current.startsWith('/Volumes/') && writable(path.dirname(current))
  if (!inPlace) {
    // Running from the disk image, or somewhere this user cannot write.
    shell.showItemInFolder(fresh)
    return { ok: true, manual: true }
  }
  handOver([
    `rm -rf ${quote(current)}`,
    `/usr/bin/ditto ${quote(fresh)} ${quote(current)}`,
    // Downloaded by the app itself, so not quarantined — but make sure.
    `/usr/bin/xattr -dr com.apple.quarantine ${quote(current)} 2>/dev/null`,
    `rm -rf ${quote(extractTo)} ${quote(downloaded)}`,
    `/usr/bin/open ${quote(current)}`,
  ])
  return { ok: true, restart: true }
}

async function installLinux(downloaded) {
  fs.chmodSync(downloaded, 0o755)
  const current = process.env.APPIMAGE
  if (!current || !writable(path.dirname(current))) {
    // Not running as an AppImage this user can replace: leave the new one in Downloads.
    const target = path.join(app.getPath('downloads'), path.basename(downloaded))
    fs.copyFileSync(downloaded, target)
    fs.chmodSync(target, 0o755)
    shell.showItemInFolder(target)
    return { ok: true, manual: true }
  }
  handOver([
    // A rename swaps the file even while the old one is still mounted.
    `mv -f ${quote(downloaded)} ${quote(current)}`,
    `chmod 755 ${quote(current)}`,
    `nohup ${quote(current)} >/dev/null 2>&1 &`,
  ])
  return { ok: true, restart: true }
}

/**
 * @param {{url: string, sha256: string, size: number, filename: string, version: string}} file
 * @param {(progress: {stage: string, received: number, total: number}) => void} onProgress
 */
async function install(file, onProgress) {
  if (!file || !allowedUrl(file.url) || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
    return { ok: false, error: 'This update cannot be installed.' }
  }
  const dir = path.join(app.getPath('temp'), 'softus-checkin-updates')
  fs.mkdirSync(dir, { recursive: true })
  const downloaded = path.join(dir, (file.filename || `update-${file.version}`).replace(SAFE_NAME, '-'))
  try {
    const result = await download(file, downloaded, onProgress)
    if ((file.size && result.received !== file.size) || result.sha256 !== file.sha256) {
      fs.rmSync(downloaded, { force: true })
      return { ok: false, error: 'The download was damaged. Try again.' }
    }
    onProgress({ stage: 'installing', received: result.received, total: result.received })
    const outcome =
      process.platform === 'darwin'
        ? await installMac(downloaded)
        : process.platform === 'linux'
          ? await installLinux(downloaded)
          : { ok: false, error: 'Updating is not supported on this system yet.' }
    if (outcome.restart) setTimeout(() => app.exit(0), 300)
    return { ok: outcome.ok, manual: Boolean(outcome.manual), error: outcome.error }
  } catch (error) {
    fs.rmSync(downloaded, { force: true })
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

module.exports = { install }
