'use strict'
/*
  What has to be in place before the app can punch in.

  macOS: Screen Recording (screenshots, the screen-change check) and
  Accessibility (counting key presses and clicks), both granted by the person
  in System Settings → Privacy & Security; the app can only ask macOS to show
  its prompt and open the right page. A new Screen Recording permission takes
  effect after the app restarts. Because the app is not signed with an Apple
  Developer ID, macOS asks again after every update.

  Linux: the one-time setup (administrator password), which installs the
  activity helper — the only way to count keys and clicks on Wayland — and the
  screenshot components. On Wayland the screen is also chosen once in the
  desktop's own "share your screen" window. On Xorg the app works before the
  setup too (it then counts input itself), though the setup is still advised.
*/
const { desktopCapturer, shell, systemPreferences } = require('electron')

const linux = process.platform === 'linux'
const capture = require('./capture.cjs')
const helper = linux ? require('./linux/helper-client.cjs') : null
const session = linux ? require('./linux/session.cjs') : null
const portal = linux ? require('./linux/portal.cjs') : null

const PANES = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
}

// Read once at start: a Screen Recording permission granted after this needs a restart.
const screenAtStart = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'
let accessibilityPrompted = false

async function linuxStatus() {
  const type = session.sessionType()
  const helperReady = await helper.ready()
  const method = await capture.method()
  let screen = 'granted'
  if (method === 'portal') screen = portal.hasToken() ? 'granted' : 'not-determined'
  const input = helperReady || type === 'x11' ? 'granted' : 'denied'
  // Needed: nothing can count input on Wayland without the helper. Advised:
  // Xorg without the helper, or Wayland without the screenshot components.
  const setup = !helperReady && type === 'wayland' ? 'needed' : !helperReady || method === 'stream' ? 'advised' : 'ok'
  return {
    screen,
    input,
    session: 'ok',
    restartNeeded: false,
    setup,
    linux: { sessionType: type, desktop: session.desktop(), method, helper: helper.status() },
  }
}

async function status() {
  if (process.platform === 'darwin') {
    const screen = systemPreferences.getMediaAccessStatus('screen')
    const input = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    return {
      screen,
      input,
      session: 'ok',
      restartNeeded: screen === 'granted' && screenAtStart !== 'granted',
      setup: 'ok',
    }
  }
  if (linux) return linuxStatus()
  return { screen: 'granted', input: 'granted', session: 'ok', restartNeeded: false, setup: 'ok' }
}

async function request(kind) {
  if (linux) {
    // Wayland: show the desktop's window once; the choice is remembered.
    if (kind === 'screen' && (await capture.method()) === 'portal' && !portal.hasToken()) {
      const result = await portal.start({ interactive: true })
      await portal.stop()
      return { ...(await status()), lastRequest: result }
    }
    return status()
  }
  if (process.platform !== 'darwin') return status()
  if (kind === 'screen') {
    // The first capture attempt is what makes macOS show its prompt and list
    // the app under Screen Recording; after that only System Settings changes it.
    if (systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      } catch {
        // The prompt is what mattered.
      }
    }
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') await openSettings('screen')
  } else if (kind === 'input') {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      if (!accessibilityPrompted) {
        accessibilityPrompted = true
        // Shows macOS's own "would like to control this computer" prompt.
        systemPreferences.isTrustedAccessibilityClient(true)
      } else {
        await openSettings('input')
      }
    }
  }
  return status()
}

async function openSettings(kind) {
  if (process.platform === 'darwin' && PANES[kind]) await shell.openExternal(PANES[kind])
}

/** Everything needed to punch in, in place. */
async function allGranted() {
  const now = await status()
  return now.screen === 'granted' && now.input === 'granted' && !now.restartNeeded && now.setup !== 'needed'
}

module.exports = { status, request, openSettings, allGranted }
