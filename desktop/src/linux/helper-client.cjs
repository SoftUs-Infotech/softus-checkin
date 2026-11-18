'use strict'
/*
  Reads the activity helper's per-second counts (see desktop/helper/main.go).

  The helper is a root service installed once per Linux computer; it is the
  only way to count key presses and clicks on Wayland, and works the same on
  Xorg. This module keeps a connection open, reconnects when the helper
  restarts, and hands each second's counts to whoever listens.
*/
const net = require('node:net')
const fs = require('node:fs')

// SOFTUS_HELPER_SOCKET points elsewhere for tests (e.g. to act as if it were not installed).
const SOCKET = process.env.SOFTUS_HELPER_SOCKET || '/run/softus-checkin/helper.sock'

let socket = null
let buffer = ''
let connected = false
let info = { version: null, keyboards: 0, pointers: 0 }
let retryTimer = null
const listeners = new Set()

function installed() {
  return fs.existsSync(SOCKET)
}

function connect() {
  if (socket || !installed()) {
    scheduleRetry()
    return
  }
  socket = net.createConnection(SOCKET)
  socket.setEncoding('utf8')
  socket.on('connect', () => {
    connected = true
  })
  socket.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.hello) {
        info = { version: message.version, keyboards: message.keyboards, pointers: message.pointers }
        continue
      }
      info.keyboards = message.keyboards
      info.pointers = message.pointers
      for (const listener of listeners) listener(message)
    }
  })
  const lost = () => {
    connected = false
    socket = null
    buffer = ''
    scheduleRetry()
  }
  socket.on('error', lost)
  socket.on('close', lost)
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, 3000)
}

/** Start listening; returns a function that stops. */
function subscribe(listener) {
  listeners.add(listener)
  connect()
  return () => listeners.delete(listener)
}

/** Whether the helper is installed and sees at least one keyboard or pointer. */
async function ready(timeoutMs = 1500) {
  connect()
  const until = Date.now() + timeoutMs
  while (!connected && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
  return connected && info.keyboards + info.pointers > 0
}

function status() {
  return { installed: installed(), connected, ...info }
}

module.exports = { subscribe, ready, status, installed, SOCKET }
