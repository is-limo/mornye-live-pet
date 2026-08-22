'use strict'

const crypto = require('node:crypto')
const { WebSocket } = require('ws')
const { safeNickname, sanitizeBarrageText } = require('./text')

function hashViewer(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null
  const candidates = [
    user.SecUid ?? user.secUid ?? user.sec_uid,
    user.Id ?? user.id,
    user.DisplayId ?? user.displayId ?? user.display_id,
    user.ShortId ?? user.shortId ?? user.short_id,
  ]
  const raw = candidates.find((value) => {
    const text = String(value ?? '').trim()
    return text && text !== '0'
  })
  if (raw === undefined) return null
  const value = String(raw).trim().slice(0, 512)
  return crypto.createHash('sha256').update(`mornye-viewer:${value}`, 'utf8').digest('hex').slice(0, 32)
}

function decodeLiveEvent(raw) {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')
    if (!text || Buffer.byteLength(text, 'utf8') > 64 * 1024) return null
    const message = JSON.parse(text)
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null
    const type = Number(message.Type ?? message.type)
    if (type !== 1 && type !== 3) return null
    let data = message.Data ?? message.data ?? {}
    if (typeof data === 'string') {
      if (!data || Buffer.byteLength(data, 'utf8') > 64 * 1024) return null
      data = JSON.parse(data)
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const user = data.User || data.user || {}
    const rawNickname = user.Nickname ?? user.nickname ?? data.Nickname ?? data.nickname
    const viewerKey = hashViewer(user)

    if (type === 3) {
      if (!sanitizeBarrageText(rawNickname, 80)) return null
      return {
        kind: 'enter',
        nickname: safeNickname(rawNickname),
        ...(viewerKey ? { viewerKey } : {}),
      }
    }

    const content = sanitizeBarrageText(data.Content ?? data.content ?? data.Message ?? data.message, 120)
    if (!content) return null
    return {
      kind: 'barrage',
      nickname: safeNickname(rawNickname ?? '观众'),
      text: content,
      ...(viewerKey ? { viewerKey } : {}),
    }
  } catch {
    return null
  }
}

function decodeBarrage(raw) {
  const event = decodeLiveEvent(raw)
  if (!event || event.kind !== 'barrage') return null
  const { kind: _kind, ...barrage } = event
  return barrage
}

class DouyinClient {
  constructor(options = {}) {
    this.url = options.url
    this.onBarrage = typeof options.onBarrage === 'function' ? options.onBarrage : () => {}
    this.onViewerEnter = typeof options.onViewerEnter === 'function' ? options.onViewerEnter : () => {}
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
    this.WebSocketImpl = options.WebSocketImpl || WebSocket
    this.random = typeof options.random === 'function' ? options.random : Math.random
    this.socket = null
    this.retryTimer = null
    this.retryCount = 0
    this.stopped = true
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  notifyStatus(status) {
    try { this.onStatus(status) } catch { /* consumer errors must not break reconnects */ }
  }

  disposeSocket(socket, terminate = false) {
    if (!socket) return
    try {
      socket.removeAllListeners()
      socket.on('error', () => {})
      if (terminate && typeof socket.terminate === 'function') socket.terminate()
      else socket.close()
    } catch { /* ignore shutdown errors */ }
  }

  disconnect(socket, reason, terminate = false) {
    if (this.socket !== socket) return
    this.socket = null
    this.disposeSocket(socket, terminate)
    if (this.stopped) return
    this.notifyStatus({ state: 'disconnected', reason })
    this.scheduleReconnect()
  }

  connect() {
    if (this.stopped || this.socket) return
    this.notifyStatus({ state: 'connecting' })
    let socket
    try {
      socket = new this.WebSocketImpl(this.url, {
        handshakeTimeout: 6000,
        maxPayload: 64 * 1024,
        perMessageDeflate: false,
      })
    } catch {
      this.notifyStatus({ state: 'disconnected', reason: 'connect_failed' })
      this.scheduleReconnect()
      return
    }

    this.socket = socket
    socket.on('open', () => {
      if (this.stopped || this.socket !== socket) return
      this.retryCount = 0
      this.notifyStatus({ state: 'connected' })
    })
    socket.on('message', (raw) => {
      if (this.stopped || this.socket !== socket) return
      const event = decodeLiveEvent(raw)
      if (!event) return
      try {
        if (event.kind === 'barrage') {
          const { kind: _kind, ...barrage } = event
          this.onBarrage(barrage)
        } else if (event.kind === 'enter') {
          const { kind: _kind, ...viewer } = event
          this.onViewerEnter(viewer)
        }
      } catch { /* one bad consumer callback must not disconnect the source */ }
    })
    socket.on('error', () => {
      this.disconnect(socket, 'socket_error', true)
    })
    socket.on('close', () => {
      this.disconnect(socket, 'closed')
    })
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer) return
    const base = Math.min(15000, 1500 * (2 ** Math.min(this.retryCount, 4)))
    const delay = Math.round(base + this.random() * 500)
    this.retryCount += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  stop() {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const socket = this.socket
    this.socket = null
    this.disposeSocket(socket)
    this.notifyStatus({ state: 'stopped' })
  }
}

module.exports = { decodeBarrage, decodeLiveEvent, DouyinClient, hashViewer }
