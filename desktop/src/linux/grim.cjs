'use strict'
/*
  Screenshots on wlroots-based Wayland desktops (Sway, Hyprland, river, labwc,
  COSMIC…) with grim, which captures every output through the compositor's
  screen-copy protocol — no window, nothing to choose. Installed by the
  one-time setup.
*/
const { spawnSync } = require('node:child_process')
const { nativeImage } = require('electron')
const { systemTool } = require('./portal.cjs')

let checked = null
function available() {
  if (checked !== null) return checked
  checked = spawnSync(systemTool('grim'), ['-h'], { stdio: 'ignore' }).status === 0
  return checked
}

function forgetChecks() {
  checked = null
}

function capture(args) {
  const run = spawnSync(systemTool('grim'), [...args, '-'], { maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0 || !run.stdout || !run.stdout.length) return null
  return nativeImage.createFromBuffer(run.stdout)
}

/** Every output, as the compositor lays them out, in one picture. */
function screens(maxWidth) {
  let image = capture(['-t', 'png'])
  if (!image || image.isEmpty()) return []
  let size = image.getSize()
  if (size.width > maxWidth) {
    image = image.resize({ width: maxWidth, quality: 'good' })
    size = image.getSize()
  }
  return [
    {
      data: new Uint8Array(image.toJPEG(75)),
      width: size.width,
      height: size.height,
      x: 0,
      y: 0,
      boundsWidth: size.width,
      boundsHeight: size.height,
    },
  ]
}

/** A small copy for the screen-change check. */
function images() {
  const image = capture(['-t', 'png', '-s', '0.1'])
  return image && !image.isEmpty() ? [image] : []
}

module.exports = { available, forgetChecks, screens, images }
