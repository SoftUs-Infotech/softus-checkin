'use strict'
/*
  What kind of Linux desktop this is, and whether its screen is locked.

  - Xorg or Wayland, from the session the app was started in.
  - Which desktop (GNOME, KDE, Sway, Hyprland, …), which decides how
    screenshots are taken on Wayland.
  - Locked: systemd-logind's LockedHint for this session, which GNOME, KDE and
    most lock screens set — the one signal that works on every desktop.
*/
const dbus = require('dbus-next')

function sessionType() {
  const type = (process.env.XDG_SESSION_TYPE || '').toLowerCase()
  if (type === 'wayland' || (!type && process.env.WAYLAND_DISPLAY)) return 'wayland'
  return 'x11'
}

/** gnome | kde | wlroots | other */
function desktop() {
  const names = `${process.env.XDG_CURRENT_DESKTOP || ''}:${process.env.XDG_SESSION_DESKTOP || ''}:${process.env.DESKTOP_SESSION || ''}`.toLowerCase()
  if (/gnome|ubuntu|unity|pantheon|budgie/.test(names)) return 'gnome'
  if (/kde|plasma/.test(names)) return 'kde'
  if (/sway|hyprland|river|wayfire|labwc|niri|dwl|cosmic/.test(names) || process.env.SWAYSOCK || process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    return 'wlroots'
  }
  return 'other'
}

let systemBus = null
let sessionPath = null
let lockedCache = false
let lockedAt = 0

/*
  This desktop session's object in logind. An app started from the dock or a
  launcher usually runs outside the session's own process group (GNOME starts
  apps in their own scopes), so "the session of this process" finds nothing.
  "auto" is logind's answer for exactly that: the caller's session, or else the
  user's graphical one.
*/
async function sessionObjectPath() {
  if (sessionPath) return sessionPath
  systemBus = systemBus || dbus.systemBus()
  const login = await systemBus.getProxyObject('org.freedesktop.login1', '/org/freedesktop/login1')
  const manager = login.getInterface('org.freedesktop.login1.Manager')
  for (const name of [process.env.XDG_SESSION_ID, 'auto']) {
    if (!name) continue
    try {
      sessionPath = await manager.GetSession(name)
      return sessionPath
    } catch {
      // Try the next way.
    }
  }
  // Older logind: the user's graphical session, as recorded on the user.
  const userPath = await manager.GetUser(process.getuid())
  const user = await systemBus.getProxyObject('org.freedesktop.login1', userPath)
  const display = await user.getInterface('org.freedesktop.DBus.Properties').Get('org.freedesktop.login1.User', 'Display')
  sessionPath = display.value[1]
  return sessionPath
}

/** Whether this session's screen is locked (cached for a few seconds). */
async function locked() {
  if (Date.now() - lockedAt < 3000) return lockedCache
  lockedAt = Date.now()
  try {
    const path = await sessionObjectPath()
    const object = await systemBus.getProxyObject('org.freedesktop.login1', path)
    const props = object.getInterface('org.freedesktop.DBus.Properties')
    const value = await props.Get('org.freedesktop.login1.Session', 'LockedHint')
    lockedCache = Boolean(value.value)
  } catch {
    lockedCache = false
  }
  return lockedCache
}

module.exports = { sessionType, desktop, locked }
