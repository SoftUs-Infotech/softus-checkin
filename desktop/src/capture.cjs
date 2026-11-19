'use strict'
/*
  Pictures of the screen, taken by the app itself — every display.

  Which way depends on the computer:
  - macOS, Windows and Linux on Xorg: Electron's desktop capture, silently.
  - Linux on Wayland, wlroots desktops (Sway, Hyprland…): grim, silently.
  - Linux on Wayland, GNOME / KDE / others: the ScreenCast portal — the
    desktop asks the employee to pick their screen once, then remembers.
  - Linux on Wayland without the screenshot components: Electron's own
    PipeWire capture, which asks once each time sharing starts (punch-in).

  `screens()` is the screenshot the admin sees: each display as a JPEG, with
  where it sits in the desktop layout so the screens can join them.

  `fingerprint()` is a tiny greyscale copy (96×54 per display) used only to tell
  whether the screen changed since a few seconds ago. It never leaves this computer.
*/
const { desktopCapturer, screen } = require('electron')

const linux = process.platform === 'linux'
const session = linux ? require('./linux/session.cjs') : null
const portal = linux ? require('./linux/portal.cjs') : null
const grim = linux ? require('./linux/grim.cjs') : null
const stream = linux ? require('./linux/stream.cjs') : null

const FINGERPRINT = { width: 96, height: 54 }
let active = null // the way chosen when sharing started

/*
  Asking macOS (or Windows) for the screens can hang rather than fail — seen on
  a Mac whose screen access stopped mid-day. A look that takes this long counts
  as "could not see the screen", so a hung request never holds up the next one
  or the screenshot schedule.
*/
const LOOK_TIMEOUT_MS = 10_000

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The screen did not answer in time.')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** desktop | grim | portal | stream */
async function method() {
  // Tests can force one way (SOFTUS_CAPTURE_METHOD=stream, …).
  const forced = process.env.SOFTUS_CAPTURE_METHOD
  if (forced && ['desktop', 'grim', 'portal', 'stream'].includes(forced)) return forced
  if (!linux || session.sessionType() === 'x11') return 'desktop'
  if (session.desktop() === 'wlroots' && grim.available()) return 'grim'
  if (portal.gstreamerReady() && (await portal.available())) return 'portal'
  return 'stream'
}

/** Start sharing for a punched-in session (only the Wayland ways need it). */
async function begin({ interactive }) {
  active = await method()
  if (active === 'portal') return { ...(await portal.start({ interactive })), method: active }
  if (active === 'stream') return { ...(await stream.start()), method: active }
  return { ok: true, method: active }
}

async function end() {
  if (active === 'portal') await portal.stop()
  if (active === 'stream') stream.stop()
  active = null
}

/* ---------------- Electron's desktop capture (macOS, Windows, Xorg) ---------------- */
function displayFor(source, displays, index) {
  return displays.find((display) => String(display.id) === source.display_id) || displays[index] || displays[0]
}

async function desktopScreens(maxWidth) {
  const displays = screen.getAllDisplays()
  const widest = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
  const tallest = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
  const scale = Math.min(1, maxWidth / widest)
  const sources = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(widest * scale), height: Math.round(tallest * scale) },
    }),
    LOOK_TIMEOUT_MS,
  )
  const out = []
  sources.forEach((source, index) => {
    const image = source.thumbnail
    if (!image || image.isEmpty()) return
    const display = displayFor(source, displays, index)
    const size = image.getSize()
    out.push({
      data: new Uint8Array(image.toJPEG(75)),
      width: size.width,
      height: size.height,
      x: display.bounds.x,
      y: display.bounds.y,
      boundsWidth: display.bounds.width,
      boundsHeight: display.bounds.height,
    })
  })
  return out
}

async function desktopImages() {
  const sources = await withTimeout(
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: FINGERPRINT }),
    LOOK_TIMEOUT_MS,
  )
  return sources.map((source) => source.thumbnail).filter((image) => image && !image.isEmpty())
}

/*
  Tests only: while the file named by SOFTUS_TEST_BLIND_FILE exists, the app
  sees no screen — the way a Mac does when its screen access stops. It can
  only ever end a session, never keep one going.
*/
function blind() {
  const file = process.env.SOFTUS_TEST_BLIND_FILE
  return Boolean(file) && require('node:fs').existsSync(file)
}

/* ---------------- one interface for all ---------------- */
async function screens(maxWidth) {
  if (blind()) return []
  const way = active || (await method())
  if (way === 'portal') return portal.screens(maxWidth)
  if (way === 'grim') return grim.screens(maxWidth)
  if (way === 'stream') return stream.screens(maxWidth)
  return desktopScreens(maxWidth)
}

/** Greyscale values of a tiny copy of every display, joined; null if nothing could be read. */
async function fingerprint() {
  if (blind()) return null
  const way = active || (await method())
  const images =
    way === 'portal'
      ? portal.images()
      : way === 'grim'
        ? grim.images()
        : way === 'stream'
          ? await stream.images()
          : await desktopImages()
  const parts = []
  for (const image of images) {
    if (!image || image.isEmpty()) continue
    const bitmap = image.resize(FINGERPRINT).toBitmap() // BGRA
    const grey = new Uint8Array(bitmap.length / 4)
    for (let i = 0; i < grey.length; i += 1) {
      grey[i] = (bitmap[i * 4] + bitmap[i * 4 + 1] + bitmap[i * 4 + 2]) / 3
    }
    parts.push(grey)
  }
  if (!parts.length) return null
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

/**
 * Whether two fingerprints differ enough to call it a change: more than 0.4% of
 * the tiny pixels moved by more than a small amount. A blinking cursor or a
 * clock ticking over does not count; scrolling, typing a line or switching
 * windows does.
 */
function changed(previous, next) {
  if (!previous || !next || previous.length !== next.length) return false
  let moved = 0
  for (let i = 0; i < next.length; i += 1) {
    if (Math.abs(next[i] - previous[i]) > 10) moved += 1
  }
  return moved / next.length > 0.004
}

module.exports = { method, begin, end, screens, fingerprint, changed }
