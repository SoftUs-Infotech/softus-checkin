'use strict'
/*
  Screenshots on Wayland desktops with a ScreenCast portal (GNOME, KDE and most
  others): the desktop's own "share your screen" window, asked ONCE.

  The first time, the employee picks their screen(s) in the desktop's window
  and the portal hands back a restore token, saved in the app's profile. Every
  later start passes that token and the desktop starts sharing without asking
  (persist_mode 2: until the person revokes it). Each start returns a new token,
  which replaces the old one.

  While punched in, one GStreamer pipeline per shared screen writes the latest
  picture to a private temporary folder every few seconds; screenshots and the
  screen-change check read the newest one. GStreamer's PipeWire plugin is
  installed by the one-time setup.
*/
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const dbus = require('dbus-next')
const { app, nativeImage } = require('electron')

const { Variant } = dbus
const FRAME_EVERY_SECONDS = 3

let bus = null
let matchAdded = false
let sessionHandle = null
let pipelines = [] // { process, dir, x, y, width, height }
let starting = null
let counter = 0

const tokenFile = () => path.join(app.getPath('userData'), 'screencast-token')

function hasToken() {
  try {
    return fs.readFileSync(tokenFile(), 'utf8').trim().length > 0
  } catch {
    return false
  }
}

/*
  The system's own GStreamer, never one from Anaconda, Homebrew or similar:
  those come first on many developers' PATH and do not have the distribution's
  PipeWire plugin, which is the one the setup installs.
*/
const SYSTEM_DIRS = ['/usr/bin', '/bin', '/usr/local/bin', '/run/current-system/sw/bin']

function systemTool(name) {
  for (const dir of SYSTEM_DIRS) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Not here.
    }
  }
  return name
}

/** The environment for GStreamer, without anything pointing it at another installation. */
function gstEnvironment() {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('GST_PLUGIN') || name.startsWith('GST_REGISTRY')) delete env[name]
  }
  return env
}

let gstChecked = null
/** GStreamer with the PipeWire source and a JPEG encoder. */
function gstreamerReady() {
  if (gstChecked !== null) return gstChecked
  const inspect = systemTool('gst-inspect-1.0')
  const has = (element) =>
    spawnSync(inspect, [element], { stdio: 'ignore', env: gstEnvironment() }).status === 0
  gstChecked = has('pipewiresrc') && has('jpegenc') && has('videorate') && has('videoconvert')
  return gstChecked
}

function forgetChecks() {
  gstChecked = null
}

async function sessionBus() {
  bus = bus || dbus.sessionBus()
  if (!matchAdded) {
    await bus.call(
      new dbus.Message({
        destination: 'org.freedesktop.DBus',
        path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus',
        member: 'AddMatch',
        signature: 's',
        body: ["type='signal',interface='org.freedesktop.portal.Request',member='Response'"],
      }),
    )
    matchAdded = true
  }
  return bus
}

/** Whether this desktop offers a ScreenCast portal new enough to remember the choice. */
async function available() {
  try {
    const b = await sessionBus()
    const portal = await b.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
    const props = portal.getInterface('org.freedesktop.DBus.Properties')
    const version = await props.Get('org.freedesktop.portal.ScreenCast', 'version')
    return Number(version.value) >= 4
  } catch {
    return false
  }
}

async function request(call, timeoutMs) {
  const b = await sessionBus()
  const token = `softus${process.pid}_${counter++}`
  const requestPath = `/org/freedesktop/portal/desktop/request/${b.name.slice(1).replace(/\./g, '_')}/${token}`
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      b.removeListener('message', onMessage)
      reject(new Error('The screen-sharing window was not answered.'))
    }, timeoutMs)
    function onMessage(message) {
      if (message.type === dbus.MessageType.SIGNAL && message.path === requestPath && message.member === 'Response') {
        clearTimeout(timer)
        b.removeListener('message', onMessage)
        resolve({ code: message.body[0], results: message.body[1] })
      }
    }
    b.on('message', onMessage)
  })
  await call(token)
  return response
}

/**
 * Start sharing. `interactive` allows the desktop's window to appear (only when
 * the employee pressed something); without it, only a saved choice is used.
 */
async function start({ interactive }) {
  if (pipelines.length) return { ok: true }
  if (starting) return starting
  starting = (async () => {
    const saved = hasToken() ? fs.readFileSync(tokenFile(), 'utf8').trim() : ''
    if (!saved && !interactive) return { ok: false, needsChoice: true }
    if (!gstreamerReady()) return { ok: false, setupNeeded: true }

    const b = await sessionBus()
    const portal = await b.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
    const cast = portal.getInterface('org.freedesktop.portal.ScreenCast')

    const created = await request(
      (token) =>
        cast.CreateSession({
          handle_token: new Variant('s', token),
          session_handle_token: new Variant('s', `session${token}`),
        }),
      15000,
    )
    if (created.code !== 0) return { ok: false }
    sessionHandle = created.results.session_handle.value

    const options = {
      types: new Variant('u', 1), // whole screens, never single windows
      multiple: new Variant('b', true), // every screen the person has
      persist_mode: new Variant('u', 2),
    }
    if (saved) options.restore_token = new Variant('s', saved)
    const selected = await request(
      (token) => cast.SelectSources(sessionHandle, { ...options, handle_token: new Variant('s', token) }),
      15000,
    )
    if (selected.code !== 0) {
      await stop()
      return { ok: false }
    }
    // With a saved choice this answers at once; otherwise the window waits for the person.
    const started = await request(
      (token) => cast.Start(sessionHandle, '', { handle_token: new Variant('s', token) }),
      saved ? 30000 : 180000,
    )
    if (started.code !== 0) {
      await stop()
      if (saved && !interactive) fs.rmSync(tokenFile(), { force: true })
      return { ok: false, cancelled: started.code === 1 }
    }
    if (started.results.restore_token) {
      fs.writeFileSync(tokenFile(), started.results.restore_token.value, { mode: 0o600 })
    }
    const streams = started.results.streams ? started.results.streams.value : []
    if (!streams.length) {
      await stop()
      return { ok: false }
    }

    for (const [nodeId, properties] of streams) {
      const position = properties.position ? properties.position.value : [0, 0]
      const size = properties.size ? properties.size.value : [0, 0]
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softus-screen-'))
      fs.chmodSync(dir, 0o700)
      const child = spawn(
        systemTool('gst-launch-1.0'),
        [
          '-q',
          'pipewiresrc',
          `path=${nodeId}`,
          'do-timestamp=true',
          'keepalive-time=1000',
          'always-copy=true',
          '!',
          'videorate',
          '!',
          `video/x-raw,framerate=1/${FRAME_EVERY_SECONDS}`,
          '!',
          'videoconvert',
          '!',
          'jpegenc',
          'quality=80',
          '!',
          'multifilesink',
          `location=${path.join(dir, 'frame-%06d.jpg')}`,
          'max-files=3',
        ],
        { stdio: 'ignore', env: gstEnvironment() },
      )
      pipelines.push({ process: child, dir, x: position[0], y: position[1], width: size[0], height: size[1] })
    }

    // Ready when every screen has produced a picture.
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (pipelines.every((p) => latestFrame(p))) return { ok: true }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await stop()
    return { ok: false }
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

async function stop() {
  for (const p of pipelines) {
    try {
      p.process.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    fs.rmSync(p.dir, { recursive: true, force: true })
  }
  pipelines = []
  if (sessionHandle && bus) {
    try {
      const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', sessionHandle)
      await object.getInterface('org.freedesktop.portal.Session').Close()
    } catch {
      // The session ends with the connection anyway.
    }
  }
  sessionHandle = null
}

/** The newest complete picture of one screen, or null. */
function latestFrame(pipeline) {
  let files
  try {
    files = fs.readdirSync(pipeline.dir).filter((name) => name.endsWith('.jpg')).sort()
  } catch {
    return null
  }
  for (let i = files.length - 1; i >= 0; i -= 1) {
    try {
      const data = fs.readFileSync(path.join(pipeline.dir, files[i]))
      // A JPEG is complete when it ends with the end-of-image marker.
      if (data.length > 4 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) return data
    } catch {
      // Removed while reading; try the one before.
    }
  }
  return null
}

function running() {
  return pipelines.length > 0 && pipelines.every((p) => p.process.exitCode === null)
}

async function screens(maxWidth) {
  const out = []
  for (const pipeline of pipelines) {
    const data = latestFrame(pipeline)
    if (!data) continue
    let image = nativeImage.createFromBuffer(data)
    let size = image.getSize()
    if (size.width > maxWidth) {
      image = image.resize({ width: maxWidth, quality: 'good' })
      size = image.getSize()
    }
    out.push({
      data: new Uint8Array(image.toJPEG(75)),
      width: size.width,
      height: size.height,
      x: pipeline.x,
      y: pipeline.y,
      boundsWidth: pipeline.width || size.width,
      boundsHeight: pipeline.height || size.height,
    })
  }
  return out
}

/** The newest pictures, as images, for the screen-change check. */
function images() {
  return pipelines.map(latestFrame).filter(Boolean).map((data) => nativeImage.createFromBuffer(data))
}

module.exports = { available, gstreamerReady, forgetChecks, hasToken, start, stop, running, screens, images, systemTool }
