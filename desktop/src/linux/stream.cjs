'use strict'
/*
  The fallback for Wayland when the one-time setup could not install the
  screenshot components: Electron's own screen capture. The desktop asks the
  employee to pick a screen once each time the app starts sharing (at
  punch-in); the stream then stays open and pictures are taken from it.
*/
const path = require('node:path')
const { BrowserWindow, desktopCapturer, nativeImage } = require('electron')

const PAGE = path.join(__dirname, 'stream.html')
let win = null

function pageUrl() {
  return `file://${PAGE}`
}

async function start() {
  if (win && !win.isDestroyed()) {
    if (await win.webContents.executeJavaScript('window.capture.live()')) return { ok: true }
    stop()
  }
  win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(PAGE)
  // On Wayland this is where the desktop's "share your screen" window appears.
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  if (!sources.length) {
    stop()
    return { ok: false }
  }
  const opened = await win.webContents
    .executeJavaScript(`window.capture.open(${JSON.stringify(sources[0].id)})`)
    .catch(() => false)
  if (!opened) {
    stop()
    return { ok: false }
  }
  return { ok: true }
}

function stop() {
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript('window.capture.close()').catch(() => undefined)
    win.destroy()
  }
  win = null
}

function running() {
  return Boolean(win && !win.isDestroyed())
}

async function frame(maxWidth) {
  if (!running()) return null
  const result = await win.webContents.executeJavaScript(`window.capture.frame(${Number(maxWidth) || 1600})`).catch(() => null)
  return result
}

async function screens(maxWidth) {
  const shot = await frame(maxWidth)
  if (!shot) return []
  return [
    {
      data: new Uint8Array(Buffer.from(shot.base64, 'base64')),
      width: shot.width,
      height: shot.height,
      x: 0,
      y: 0,
      boundsWidth: shot.width,
      boundsHeight: shot.height,
    },
  ]
}

async function images() {
  const shot = await frame(320)
  return shot ? [nativeImage.createFromBuffer(Buffer.from(shot.base64, 'base64'))] : []
}

module.exports = { start, stop, running, screens, images, pageUrl }
