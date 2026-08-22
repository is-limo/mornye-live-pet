'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { writeTextAtomic } = require('./storage')
const { safeNickname, sanitizeBarrageText, sanitizeQueueContent } = require('./text')

const KIND_LABELS = { priority: '单子', normal: '帮帮' }
const LOGIN_LABELS = { qr: '扫码', phone: '手机号' }

function withPersistence(result, persisted) {
  if (persisted) return { ...result, persisted: true }
  return {
    ...result,
    persisted: false,
    message: `${result.message} 注意：本地存档失败，重启后这次变更可能丢失。`,
  }
}

function normalizeViewerKey(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-f0-9]{32,64}$/.test(key) ? key.slice(0, 64) : null
}

function publicEntry(entry) {
  if (!entry) return null
  const { viewerKey: _viewerKey, ...result } = entry
  return result
}

function parseQueueCommand(input) {
  let text = sanitizeBarrageText(input, 120)
  if (!text) return null

  if (/^(?:取消排队|退出排队|不排了|撤销排队)[！!。.]?$/.test(text)) return { type: 'cancel' }
  if (/^(?:查队|查排队|我的位置|我几号|排队情况|队列情况|还要多久|排队多久)[？?！!。.]?$/.test(text)) return { type: 'status' }

  text = text.replace(/^(?:我要|我想)?\s*排队[\s,，、:：]*/u, '')
  const kindMatch = /^(单子|套餐|蛋子|帮帮|帮打)[\s,，、:：]*/u.exec(text)
  if (!kindMatch) return null

  const kind = ['单子', '套餐', '蛋子'].includes(kindMatch[1]) ? 'priority' : 'normal'
  let rest = text.slice(kindMatch[0].length)
  const loginMatch = /(二维码|扫码|手机号|手机登录|手机)/u.exec(rest)
  let login = null
  if (loginMatch) {
    login = ['二维码', '扫码'].includes(loginMatch[1]) ? 'qr' : 'phone'
    rest = rest.slice(0, loginMatch.index) + ' ' + rest.slice(loginMatch.index + loginMatch[0].length)
  }

  return {
    type: 'enqueue',
    kind,
    login,
    content: sanitizeQueueContent(rest.replace(/^[\s,，、:：]+|[\s,，、:：]+$/g, '')),
  }
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = Number(raw.id ?? raw.kid)
  const kind = raw.kind === 'priority' || raw.kind === 'dan' ? 'priority' : (raw.kind === 'normal' || raw.kind === 'bang' ? 'normal' : null)
  const login = raw.login === 'qr' || raw.login === '扫码' ? 'qr' : (raw.login === 'phone' || String(raw.login || '').includes('手机') ? 'phone' : null)
  const rawNickname = sanitizeBarrageText(raw.nickname, 80)
  const nickname = rawNickname ? safeNickname(rawNickname) : ''
  const content = sanitizeQueueContent(raw.content)
  const viewerKey = normalizeViewerKey(raw.viewerKey)
  if (!Number.isInteger(id) || id < 1 || !kind || !login || !nickname || !content) return null
  return {
    id,
    kind,
    nickname,
    login,
    content,
    createdAt: Number.isFinite(Number(raw.createdAt ?? raw.ts)) ? Number(raw.createdAt ?? raw.ts) : Date.now(),
    status: ['waiting', 'current'].includes(raw.status) ? raw.status : 'waiting',
    ...(viewerKey ? { viewerKey } : {}),
  }
}

function formatEntry(entry) {
  if (!entry) return ''
  return `${KIND_LABELS[entry.kind] || '排队'}「${safeNickname(entry.nickname)}」${LOGIN_LABELS[entry.login] || ''} ${sanitizeQueueContent(entry.content)}`.trim()
}

class QueueManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || null
    this.maxWaiting = Math.max(1, Number(options.maxWaiting) || 30)
    this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
    this.onError = typeof options.onError === 'function' ? options.onError : () => {}
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.priority = []
    this.normal = []
    this.current = null
    this.paused = false
    this.nextId = 1
    this.storageError = false
    this.load()
  }

  reportError(error, operation) {
    try { this.onError(error, operation) } catch { /* error reporting must not break the queue */ }
  }

  load() {
    if (!this.storagePath) return
    try {
      if (!fs.existsSync(this.storagePath)) return
      const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
      const priority = Array.isArray(data.priority) ? data.priority : (Array.isArray(data.dans) ? data.dans : [])
      const normal = Array.isArray(data.normal) ? data.normal : (Array.isArray(data.bangs) ? data.bangs : [])
      this.priority = priority.map(normalizeEntry).filter(Boolean).slice(0, this.maxWaiting)
      this.normal = normal.map(normalizeEntry).filter(Boolean).slice(0, this.maxWaiting - this.priority.length)
      this.current = normalizeEntry(data.current)
      if (this.current) this.current.status = 'current'
      this.paused = Boolean(data.paused)
      const ids = [...this.priority, ...this.normal, ...(this.current ? [this.current] : [])].map((entry) => entry.id)
      this.nextId = Math.max(0, ...ids) + 1
      this.storageError = false
    } catch (error) {
      this.priority = []
      this.normal = []
      this.current = null
      this.paused = false
      this.nextId = 1
      this.storageError = true
      this.reportError(error, 'load')
    }
  }

  save() {
    if (!this.storagePath) {
      this.storageError = false
      return
    }
    const payload = {
      version: 1,
      paused: this.paused,
      current: this.current,
      priority: this.priority,
      normal: this.normal,
      updatedAt: new Date(this.now()).toISOString(),
    }
    writeTextAtomic(this.storagePath, JSON.stringify(payload, null, 2) + '\n')
    this.storageError = false
  }

  commit() {
    let persisted = true
    try {
      this.save()
    } catch (error) {
      persisted = false
      this.storageError = true
      this.reportError(error, 'save')
    }
    const snapshot = this.snapshot()
    try { this.onChange(snapshot) } catch (error) { this.reportError(error, 'notify') }
    return { persisted, snapshot }
  }

  findByNickname(nickname, viewerKey = null) {
    const name = safeNickname(nickname)
    const identity = normalizeViewerKey(viewerKey)
    const matches = (entry) => identity
      ? entry.viewerKey === identity || (!entry.viewerKey && entry.nickname === name)
      : entry.nickname === name
    if (this.current && matches(this.current)) return { where: 'current', entry: this.current, position: 0 }
    const waiting = [...this.priority, ...this.normal]
    const index = waiting.findIndex(matches)
    return index >= 0 ? { where: 'waiting', entry: waiting[index], position: index + 1 } : null
  }

  enqueue(kind, nickname, login, content, viewerKey = null) {
    const name = safeNickname(nickname)
    const identity = normalizeViewerKey(viewerKey)
    const safeContent = sanitizeQueueContent(content)
    if (this.paused) return { ok: false, message: '主播暂时停收，恢复后再来排队吧。' }
    if (!['priority', 'normal'].includes(kind)) return { ok: false, message: '排队类型没看清，请用“单子”或“帮帮”开头。' }
    if (!['qr', 'phone'].includes(login)) return { ok: false, message: '还缺登录方式：请写“扫码”或“手机号”。' }
    if (!safeContent) return { ok: false, message: '还缺帮打内容，例如“深塔12层”。' }
    if (this.findByNickname(name, identity)) return { ok: false, message: '你已经在队里了，先别重复报名。' }
    if (this.priority.length + this.normal.length >= this.maxWaiting) return { ok: false, message: `队伍满了（${this.maxWaiting}人），稍后再来。` }

    const entry = {
      id: this.nextId++,
      kind,
      nickname: name,
      login,
      content: safeContent,
      createdAt: this.now(),
      status: 'waiting',
      ...(identity ? { viewerKey: identity } : {}),
    }
    ;(kind === 'priority' ? this.priority : this.normal).push(entry)
    const position = kind === 'priority' ? this.priority.length : this.priority.length + this.normal.length
    const { persisted } = this.commit()
    return withPersistence({ ok: true, entry, position, message: `收到${KIND_LABELS[kind]}，你在等待队列第 ${position} 位。` }, persisted)
  }

  cancelByNickname(nickname, viewerKey = null) {
    const name = safeNickname(nickname)
    const identity = normalizeViewerKey(viewerKey)
    const matches = (entry) => identity
      ? entry.viewerKey === identity || (!entry.viewerKey && entry.nickname === name)
      : entry.nickname === name
    if (this.current && matches(this.current)) return { ok: false, message: '已经叫到你了，需要取消请和主播说一声。' }
    for (const list of [this.priority, this.normal]) {
      const index = list.findIndex(matches)
      if (index >= 0) {
        const [entry] = list.splice(index, 1)
        const { persisted } = this.commit()
        return withPersistence({ ok: true, entry, message: '已经帮你取消排队。' }, persisted)
      }
    }
    return { ok: false, message: '队伍里暂时没有找到你。' }
  }

  statusForNickname(nickname, viewerKey = null) {
    const found = this.findByNickname(nickname, viewerKey)
    if (!found) return { ok: false, message: '你还没在队里；用“单子/帮帮 + 扫码/手机号 + 内容”报名。' }
    if (found.where === 'current') return { ok: true, entry: found.entry, position: 0, message: '现在正轮到你。' }
    return { ok: true, entry: found.entry, position: found.position, message: `你在等待队列第 ${found.position} 位。` }
  }

  takeNext() {
    const list = this.priority.length ? this.priority : this.normal
    const entry = list.shift() || null
    if (entry) {
      entry.status = 'current'
      this.current = entry
    }
    return entry
  }

  next() {
    if (this.current) return { ok: false, message: `当前还在处理 ${formatEntry(this.current)}。` }
    const entry = this.takeNext()
    if (!entry) return { ok: false, message: '队列已经空了。' }
    const { persisted } = this.commit()
    return withPersistence({ ok: true, entry, message: `轮到 ${formatEntry(entry)}。` }, persisted)
  }

  completeAndNext() {
    const completed = this.current
    if (!completed) return { ok: false, message: '当前没有进行中的号，请先使用“下一号”。' }
    this.current = null
    const next = this.takeNext()
    const { persisted } = this.commit()
    if (next) return withPersistence({ ok: true, completed, entry: next, message: `已完成上一位；轮到 ${formatEntry(next)}。` }, persisted)
    return withPersistence({ ok: true, completed, entry: null, message: '已完成，队列空了。' }, persisted)
  }

  skipAndNext() {
    const skipped = this.current
    if (!skipped) return { ok: false, message: '当前没有可过的号。' }
    this.current = null
    const next = this.takeNext()
    const { persisted } = this.commit()
    if (next) return withPersistence({ ok: true, skipped, entry: next, message: `已过号；轮到 ${formatEntry(next)}。` }, persisted)
    return withPersistence({ ok: true, skipped, entry: null, message: '已过号，队列空了。' }, persisted)
  }

  remove(target) {
    const id = Number(target)
    const rawName = sanitizeBarrageText(target, 80)
    const name = rawName ? safeNickname(rawName) : null
    if ((!Number.isInteger(id) || id < 1) && !name) return { ok: false, message: '没有找到这条排队记录。' }
    for (const list of [this.priority, this.normal]) {
      const index = list.findIndex((entry) => entry.id === id || entry.nickname === name)
      if (index >= 0) {
        const [entry] = list.splice(index, 1)
        const { persisted } = this.commit()
        return withPersistence({ ok: true, entry, message: `已移除 ${formatEntry(entry)}。` }, persisted)
      }
    }
    return { ok: false, message: '没有找到这条排队记录。' }
  }

  togglePaused() {
    this.paused = !this.paused
    const { persisted } = this.commit()
    return withPersistence({ ok: true, paused: this.paused, message: this.paused ? '排队已暂停。' : '排队已恢复。' }, persisted)
  }

  snapshot() {
    return {
      paused: this.paused,
      current: publicEntry(this.current),
      priority: this.priority.map(publicEntry),
      normal: this.normal.map(publicEntry),
      counts: {
        priority: this.priority.length,
        normal: this.normal.length,
        waiting: this.priority.length + this.normal.length,
      },
      storageError: this.storageError,
    }
  }
}

module.exports = {
  KIND_LABELS,
  LOGIN_LABELS,
  QueueManager,
  formatEntry,
  normalizeEntry,
  normalizeViewerKey,
  parseQueueCommand,
  publicEntry,
}
