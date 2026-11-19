'use strict'
/*
  Activity, counted minute by minute while the employee is punched in.

  - Active seconds: seconds with keyboard or mouse use anywhere on the computer.
  - Key presses, clicks, scrolls and how far the pointer moved — only the
    counts, never which key, never any text. Where they come from:
      Linux: the activity helper (a root service reading the kernel's input
        devices — the only way that works on Wayland; also used on Xorg);
        without it on Xorg, the input hook below.
      macOS / Windows: a system-wide input hook (uiohook; macOS needs the
        Accessibility permission).
  - Software input (Linux): seconds with input from a software device rather
    than hardware — a remote-control tool or a "mouse jiggler" program.
  - Screen changes: every 15 seconds a tiny copy of the screen is compared with
    the previous one (see capture.cjs). Nothing is kept or sent but the count.
  - Locked seconds: the screen was locked.

  Finished minutes wait in a queue; the screens take them with every 30-second
  check-in and send them to the server.
*/
const { powerMonitor } = require('electron')
const capture = require('./capture.cjs')

const linux = process.platform === 'linux'
const helper = linux ? require('./linux/helper-client.cjs') : null
const session = linux ? require('./linux/session.cjs') : null

const SAMPLE_EVERY_MS = 15_000

let source = null // 'helper' | 'hook'
let hook = null
let unsubscribe = null
let running = false
let secondTimer = null
let sampleTimer = null
let current = null
let queue = []
let lastInputAt = 0
let lastPointer = null
let locked = false
let previousFingerprint = null

/*
  Whether the app can still see the screen. Every 15-second look that comes back
  with a picture moves `lastSeenAt` on. Time the person could not be expected
  to be seen is excused (`excusedAt`): the screen locked, nobody at the
  computer for two minutes, or the computer asleep. `health()` reports how long
  the screen has gone unseen otherwise — the screens punch out after a minute.
*/
const AWAY_SECONDS = 120
let lastSeenAt = 0
let excusedAt = 0
let excusedBy = null // why the last excused second was: locked | away | asleep
let lastTickAt = 0
let looking = false

function bucketFor(now) {
  const start = Math.floor(now / 60_000) * 60_000
  if (!current || current.start !== start) {
    if (current && start > current.start) queue.push(finish(current))
    else if (current && start < current.start) return current // a late helper second: keep it in the open minute
    current = {
      start,
      active: 0,
      keys: 0,
      clicks: 0,
      scrolls: 0,
      distance: 0,
      samples: 0,
      changes: 0,
      locked: 0,
      virtual: 0,
    }
  }
  return current
}

function finish(bucket) {
  const samples = Math.min(60, bucket.samples)
  return {
    minute: new Date(bucket.start).toISOString(),
    active_seconds: Math.min(60, bucket.active),
    keys: Math.min(5000, bucket.keys),
    clicks: Math.min(2000, bucket.clicks),
    scrolls: Math.min(5000, bucket.scrolls),
    mouse_distance: Math.min(50_000_000, Math.round(bucket.distance)),
    screen_samples: samples,
    screen_changes: Math.min(samples, bucket.changes),
    locked_seconds: Math.min(60, bucket.locked),
    virtual_seconds: Math.min(60, bucket.virtual),
  }
}

/* ---------------- the input hook (macOS, Windows, Linux Xorg without the helper) ---------------- */
function input() {
  lastInputAt = Date.now()
  return bucketFor(lastInputAt)
}
const onKey = () => {
  input().keys += 1
}
const onClick = () => {
  input().clicks += 1
}
const onWheel = () => {
  input().scrolls += 1
}
const onMove = (event) => {
  const bucket = input()
  if (lastPointer) bucket.distance += Math.hypot(event.x - lastPointer.x, event.y - lastPointer.y)
  lastPointer = { x: event.x, y: event.y }
}

function startHook() {
  // Loaded only once permissions are in place: on macOS the hook needs Accessibility.
  const { uIOhook } = require('uiohook-napi')
  uIOhook.on('keydown', onKey)
  uIOhook.on('mousedown', onClick)
  uIOhook.on('wheel', onWheel)
  uIOhook.on('mousemove', onMove)
  uIOhook.start()
  return uIOhook
}

/* ---------------- the helper (Linux) ---------------- */
function onHelperSecond(second) {
  const bucket = bucketFor(second.t * 1000)
  bucket.keys += second.keys || 0
  bucket.clicks += second.clicks || 0
  bucket.scrolls += second.scrolls || 0
  bucket.distance += second.distance || 0
  if (second.active && !locked) bucket.active += 1
  if (second.virtual > 0) bucket.virtual += 1
  if (second.active) lastInputAt = second.t * 1000
}

/* ---------------- every second: locked, and active time for the hook ---------------- */
// macOS and Windows announce locking; Linux is asked (logind's LockedHint).
let lockAnnounced = false
const onLockEvent = () => {
  lockAnnounced = true
}
const onUnlockEvent = () => {
  lockAnnounced = false
}

async function isLocked() {
  if (linux) return session.locked()
  if (lockAnnounced) return true
  try {
    return powerMonitor.getSystemIdleState(60) === 'locked'
  } catch {
    return false
  }
}

async function everySecond() {
  const now = Date.now()
  // A long gap between ticks: the computer was asleep.
  if (lastTickAt && now - lastTickAt > 5000) {
    excusedAt = now
    excusedBy = 'asleep'
  }
  lastTickAt = now
  locked = await isLocked()
  if (!running) return
  const bucket = bucketFor(now)
  if (locked) {
    excusedAt = now
    excusedBy = 'locked'
    bucket.locked += 1
    return
  }
  let idleSeconds = null
  try {
    idleSeconds = powerMonitor.getSystemIdleTime()
  } catch {
    // Fall back to the input hook alone.
  }
  // Away: no keyboard or mouse for two minutes. The system's own idle time
  // says so on macOS, Windows and Xorg; on Wayland it is always 0, so the
  // input the activity helper counted decides there.
  const wayland = linux && session.sessionType() === 'wayland'
  const idleFor = wayland || idleSeconds === null ? (now - lastInputAt) / 1000 : idleSeconds
  if (idleFor >= AWAY_SECONDS) {
    excusedAt = now
    excusedBy = 'away'
  }
  if (source !== 'hook') return // the helper reports active seconds itself
  if ((idleSeconds ?? 1) < 1 || now - lastInputAt < 1500) bucket.active += 1
}
async function sampleScreen() {
  // A look still waiting (a hung request) is not joined by another.
  if (looking) return
  looking = true
  try {
    const next = await capture.fingerprint()
    if (!running || !next) return
    lastSeenAt = Date.now()
    const bucket = bucketFor(lastSeenAt)
    bucket.samples += 1
    if (previousFingerprint && capture.changed(previousFingerprint, next)) bucket.changes += 1
    previousFingerprint = next
  } catch {
    // Not seen this time; health() counts how long that lasts.
  } finally {
    looking = false
  }
}

const onWake = () => {
  excusedAt = Date.now()
  excusedBy = 'asleep'
}

/** How long the screen has gone unseen while the person was there to be seen. */
function health() {
  const now = Date.now()
  if (!running) return { running: false, unseenMs: 0, lastSeenAt: null }
  return {
    running: true,
    unseenMs: Math.max(0, now - Math.max(lastSeenAt, excusedAt)),
    lastSeenAt: new Date(lastSeenAt).toISOString(),
    excusedBy: excusedAt > lastSeenAt ? excusedBy : null,
  }
}

/**
 * Start counting and start screen capture. `interactive` lets a Wayland
 * desktop show its "share your screen" window (only at the employee's press).
 */
async function start({ interactive = true } = {}) {
  if (running) return { ok: true }

  if (linux && (await helper.ready())) {
    source = 'helper'
    unsubscribe = helper.subscribe(onHelperSecond)
  } else if (linux && session.sessionType() === 'wayland') {
    return { ok: false, error: 'The activity helper is not running.' }
  } else {
    try {
      hook = startHook()
      source = 'hook'
    } catch (error) {
      hook = null
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }

  const sharing = await capture.begin({ interactive })
  if (!sharing.ok) {
    stopInput()
    return { ok: false, error: 'Screen capture did not start.', ...sharing }
  }

  running = true
  lastPointer = null
  previousFingerprint = null
  lastSeenAt = Date.now()
  excusedAt = 0
  lastTickAt = 0
  powerMonitor.on('lock-screen', onLockEvent)
  powerMonitor.on('unlock-screen', onUnlockEvent)
  powerMonitor.on('resume', onWake)
  powerMonitor.on('unlock-screen', onWake)
  bucketFor(Date.now())
  secondTimer = setInterval(() => void everySecond(), 1000)
  sampleTimer = setInterval(() => void sampleScreen(), SAMPLE_EVERY_MS)
  setTimeout(() => void sampleScreen(), 2000)
  return { ok: true, method: sharing.method, source }
}

function stopInput() {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  if (hook) {
    try {
      hook.removeAllListeners()
      hook.stop()
    } catch {
      // Already stopped.
    }
    hook = null
  }
  source = null
}

async function stop() {
  if (!running) return
  running = false
  clearInterval(secondTimer)
  clearInterval(sampleTimer)
  secondTimer = sampleTimer = null
  powerMonitor.removeListener('lock-screen', onLockEvent)
  powerMonitor.removeListener('unlock-screen', onUnlockEvent)
  powerMonitor.removeListener('resume', onWake)
  powerMonitor.removeListener('unlock-screen', onWake)
  stopInput()
  await capture.end()
  // The minute in progress ends here, so the day's activity ends where the day did.
  if (current) queue.push(finish(current))
  current = null
}

/** Finished minutes, oldest first — handed over once. */
function take() {
  if (running) bucketFor(Date.now())
  const out = queue
  queue = []
  return out
}

function isRunning() {
  return running
}

module.exports = { start, stop, take, isRunning, health }
