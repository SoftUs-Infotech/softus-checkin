'use strict'
/*
  Softus Checkin desktop app — the main process.

  The window shows the same screens as the website, built into the app and
  served from app://softus/. The screens talk to the API exactly as the website
  does; what only the app can do (capture every display without a picker, count
  activity, check macOS permissions, install an update) is reached through the
  small bridge in preload.cjs.
*/
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, Menu, net, Notification, protocol, session, shell } = require('electron')
const capture = require('./capture.cjs')
const permissions = require('./permissions.cjs')
const tracker = require('./tracker.cjs')
const updater = require('./updater.cjs')
const setup = process.platform === 'linux' ? require('./linux/setup.cjs') : null
const stream = process.platform === 'linux' ? require('./linux/stream.cjs') : null

const SCHEME = 'app'
const ORIGIN = `${SCHEME}://softus`
const RENDERER = path.join(__dirname, '..', 'renderer')

// A separate profile (sign-in, settings) when asked for — used by the tests.
if (process.env.SOFTUS_USER_DATA) app.setPath('userData', process.env.SOFTUS_USER_DATA)

/*
  Linux on Wayland: run as an X11 window (through XWayland). GNOME draws title
  bars only for X11 windows, Electron draws none of its own on Wayland (and its
  own window buttons crash there), so a native Wayland window would have no
  close or minimise buttons and could not be moved. Nothing else depends on
  it: the activity helper and the screen sharing work outside Electron.

  The choice has to be made when the process starts, so the app starts itself
  again once, at once, with it.
*/
if (
  process.platform === 'linux' &&
  process.env.WAYLAND_DISPLAY &&
  !process.argv.some((arg) => arg.startsWith('--ozone-platform')) &&
  !process.argv.includes('--setup')
) {
  // Started directly rather than with app.relaunch(): Electron's relauncher
  // runs from inside the AppImage, which is unmounted as soon as this exits.
  const env = { ...process.env }
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[name]
  require('node:child_process')
    .spawn(process.env.APPIMAGE || process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], {
      detached: true,
      stdio: 'ignore',
      env,
    })
    .unref()
  app.exit(0)
  return
}

/*
  Windows: punches read the location from Windows' own location service
  (Electron otherwise asks a Google web service it has no key for). When
  Windows gives none, the punch goes ahead without it and the server records
  the network address.
*/
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation')
  // The taskbar groups and pins the app under the installer's shortcuts.
  app.setAppUserModelId('com.softusinfotech.checkin')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

let win = null

function osVersion() {
  if (process.platform === 'darwin') return process.getSystemVersion()
  if (process.platform === 'win32') {
    // 10.0.22631: Windows 11 reports itself as 10.0, from build 22000 on.
    const build = Number(os.release().split('.')[2]) || 0
    return `Windows ${build >= 22000 ? '11' : '10'} (${os.release()})`
  }
  if (process.platform === 'linux') {
    try {
      const release = fs.readFileSync('/etc/os-release', 'utf8')
      const pretty = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m)
      if (pretty) return pretty[1]
    } catch {
      // Fall through to the kernel version.
    }
  }
  return os.release()
}

/** app://softus/<path> → the built screens; anything that is not a file is the app itself. */
function serveScreens() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    let file = path.normalize(path.join(RENDERER, decodeURIComponent(pathname)))
    if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(RENDERER, 'index.html')
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

function openOutside(url) {
  if (/^(https?:|mailto:)/.test(url)) void shell.openExternal(url)
}

/* -------------------------------------------------------------------------- */
/* Closing: like closing the website's tab, it ends a working session — but    */
/* the screens are given a moment to tell the server first.                     */
/* -------------------------------------------------------------------------- */
let allowClose = false
let closing = false

function onClose(event) {
  if (allowClose) return
  event.preventDefault()
  if (closing) return
  closing = true
  const done = () => {
    if (allowClose) return
    allowClose = true
    tracker.stop()
    if (win && !win.isDestroyed()) win.close()
  }
  ipcMain.once('app:closing-done', done)
  setTimeout(done, 5000)
  win.webContents.send('app:closing')
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Softus Checkin',
    backgroundColor: '#fafaf8',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Screenshots and check-ins keep their timing while the window is minimised.
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault()
      openOutside(url)
    }
  })
  win.on('close', onClose)
  win.on('closed', () => {
    win = null
  })
  if (process.env.SOFTUS_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
  void win.loadURL(`${ORIGIN}/`)
}

/* -------------------------------------------------------------------------- */
/* The bridge                                                                  */
/* -------------------------------------------------------------------------- */
function fromOurScreens(event) {
  return Boolean(event.senderFrame && event.senderFrame.url.startsWith(ORIGIN))
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurScreens(event)) throw new Error('Not allowed.')
    return handler(event, ...args)
  })
}

function registerBridge() {
  ipcMain.on('app:info', (event) => {
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osVersion: osVersion(),
    }
  })
  handle('permissions:status', () => permissions.status())
  handle('permissions:request', (_event, kind) => permissions.request(kind === 'input' ? 'input' : 'screen'))
  handle('permissions:open', (_event, kind) => permissions.openSettings(kind === 'input' ? 'input' : 'screen'))
  handle('app:relaunch', () => {
    tracker.stop()
    app.relaunch()
    app.exit(0)
  })
  // Screenshots only while a punched-in session is being tracked.
  handle('capture:screens', (_event, maxWidth) => {
    if (!tracker.isRunning()) return []
    const width = Math.min(4000, Math.max(320, Number(maxWidth) || 1600))
    return capture.screens(width)
  })
  handle('tracking:start', async () =>
    (await permissions.allGranted())
      ? tracker.start({ interactive: true })
      : { ok: false, error: 'Permissions are missing.' },
  )
  handle('tracking:stop', () => tracker.stop())
  // How long the screen has gone unseen, with the permissions as macOS reports them now.
  handle('capture:health', async () => {
    const now = await permissions.status()
    return { ...tracker.health(), screen: now.screen, input: now.input }
  })
  // The screens punched out because the screen was lost: on macOS the app has
  // to restart before it can see the screen again.
  handle('capture:lost', () => permissions.markScreenLost())
  // Something the person has to act on: the window to the front, and a system
  // notification for when it is hidden behind other windows or minimised.
  handle('app:attention', (_event, message) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    if (process.platform === 'darwin') {
      app.focus({ steal: true })
      app.dock?.bounce('critical')
    }
    const title = String((message && message.title) || 'Softus Checkin').slice(0, 80)
    const body = String((message && message.body) || '').slice(0, 200)
    if (body && Notification.isSupported()) {
      const notice = new Notification({ title, body })
      notice.on('click', () => {
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
        }
      })
      notice.show()
    }
  })
  handle('setup:run', async (event) => {
    if (!setup) return { ok: true, output: '' }
    const result = await setup.run({
      onOutput: (text) => {
        if (!event.sender.isDestroyed()) event.sender.send('setup:output', text)
      },
    })
    // What the setup installed is looked for afresh.
    require('./linux/portal.cjs').forgetChecks()
    require('./linux/grim.cjs').forgetChecks()
    return result
  })
  handle('tracking:take', () => tracker.take())
  handle('update:install', (event, file) =>
    updater.install(file, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress)
    }),
  )
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  // macOS needs a menu for Quit and for copy and paste in text fields. There is
  // deliberately no Reload: reloading would end a working session.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  )
}

/* -------------------------------------------------------------------------- */
/* Start                                                                       */
/* -------------------------------------------------------------------------- */
/* IT can set up a Linux computer without opening the screens: --setup */
if (setup && process.argv.includes('--setup')) {
  app.whenReady().then(async () => {
    const result = await setup.run({ onOutput: (text) => process.stdout.write(text) })
    if (!result.ok && result.output) process.stderr.write(`${result.output}\n`)
    app.exit(result.ok ? 0 : 1)
  })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    serveScreens()
    registerBridge()
    buildMenu()
    // The browser permissions in use: location for punches, from the screens;
    // and on Linux without the screenshot components, the screen stream from
    // the app's own hidden capture page.
    const allowed = (permission, url) =>
      (permission === 'geolocation' && url.startsWith(ORIGIN)) ||
      ((permission === 'media' || permission === 'display-capture') && stream !== null && url.startsWith(stream.pageUrl()))
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(allowed(permission, String(details.requestingUrl || '')))
    })
    session.defaultSession.setPermissionCheckHandler((_contents, permission, origin, details) =>
      allowed(permission, String((details && details.requestingUrl) || origin || '')),
    )
    createWindow()
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => tracker.stop())
}
