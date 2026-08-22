'use strict'

const path = require('node:path')
const { DouyinClient } = require('./douyin-client')
const { OpenCodeClient } = require('./opencode-client')
const { formatEntry, normalizeViewerKey, parseQueueCommand, publicEntry, QueueManager } = require('./queue')
const { cleanReply, redactSensitive, safeNickname, sanitizeBarrageText } = require('./text')

const RECENT_MESSAGE_LIMIT = 500
const RECENT_WELCOME_LIMIT = 500
const WELCOME_GLOBAL_INTERVAL_MS = 5000
const WELCOME_VIEWER_WINDOW_MS = 10 * 60 * 1000
const WELCOME_TEXT = '欢迎来到直播间。先坐稳，观测马上开始。'
const HARD_FALLBACK = '嗯，信号有些迟缓。我还在。'

const SIMULATION_MESSAGES = [
  { nickname: '阿黎', text: '主播晚上好' },
  { nickname: '风灯', text: '帮帮 手机号 深塔12层' },
  { nickname: '莫方', text: '单子 扫码 全息冥宁' },
  { nickname: '小城', text: '我几号' },
  { nickname: '夜航', text: '今天准备打什么？' },
  { nickname: '小城', text: '取消排队' },
]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class LiveService {
  constructor(options = {}) {
    this.config = options.config
    this.userDataDir = options.userDataDir
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {}
    this.logger = options.logger || { info() {}, warn() {}, error() {} }
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.sleep = typeof options.sleep === 'function' ? options.sleep : wait
    this.offlineAi = Boolean(options.offlineAi)
    this.running = false
    this.sourceState = 'stopped'
    this.aiState = 'idle'
    this.aiErrorCode = null
    this.aiJobs = []
    this.processingAi = false
    this.lastAiBubbleAt = 0
    this.recent = new Map()
    this.recentWelcomes = new Map()
    this.lastWelcomeAt = null
    this.scene = []
    this.simulationTimer = null
    this.simulationIndex = 0

    this.queue = options.queue || new QueueManager({
      storagePath: path.join(this.userDataDir, 'queue.json'),
      maxWaiting: this.config.queue.maxWaiting,
      now: this.now,
      onChange: (snapshot) => this.emit('queue:update', snapshot),
      onError: (error, operation) => this.logger.warn('queue persistence issue', { operation, code: error?.code || 'UNKNOWN' }),
    })
    this.aiClient = options.aiClient || new OpenCodeClient({
      config: this.config.ai,
      resolveKey: options.resolveKey,
      personaDir: options.personaDir,
    })
    this.sourceClient = options.sourceClient || new DouyinClient({
      url: this.config.sourceUrl,
      onBarrage: (message) => this.ingestBarrage(message),
      onViewerEnter: (viewer) => this.ingestViewerEnter(viewer),
      onStatus: (status) => this.handleSourceStatus(status),
    })
  }

  updateConfig(nextConfig) {
    if (nextConfig && typeof nextConfig === 'object') this.config = nextConfig
  }

  emit(type, data) {
    try {
      this.onEvent({ type, data, timestamp: this.now() })
    } catch (error) {
      this.logger.warn('ui event delivery failed', { type, code: error?.code || 'UNKNOWN' })
    }
  }

  publicState() {
    return {
      source: this.sourceState,
      sourceUrl: this.config.sourceUrl,
      ai: this.aiState,
      aiErrorCode: this.aiErrorCode,
      model: this.config.ai.model,
      hasCredential: this.aiClient.hasCredential(),
      pendingReplies: this.aiJobs.length + (this.processingAi ? 1 : 0),
      queue: this.queue.snapshot(),
      simulation: Boolean(this.simulationTimer),
    }
  }

  emitState() {
    this.emit('status:update', this.publicState())
  }

  start(options = {}) {
    if (this.running) return
    this.running = true
    this.recentWelcomes.clear()
    this.lastWelcomeAt = null
    this.emit('queue:update', this.queue.snapshot())
    this.aiState = this.offlineAi ? 'offline-fallback' : (this.aiClient.hasCredential() ? 'ready' : 'missing-key')
    if (options.simulate) this.startSimulation()
    else this.sourceClient.start()
    this.emitState()
    this.logger.info('live service started', { simulation: Boolean(options.simulate), model: this.config.ai.model })
  }

  stop() {
    this.running = false
    this.sourceClient.stop()
    if (typeof this.aiClient.cancelPending === 'function') this.aiClient.cancelPending()
    if (this.simulationTimer) clearTimeout(this.simulationTimer)
    this.simulationTimer = null
    this.aiJobs.length = 0
    this.sourceState = 'stopped'
    this.emitState()
    this.logger.info('live service stopped')
  }

  handleSourceStatus(status) {
    this.sourceState = status?.state || 'disconnected'
    this.emitState()
    this.logger.info('douyin source status', { state: this.sourceState, reason: status?.reason || null })
  }

  startSimulation() {
    this.sourceState = 'simulated'
    const tick = () => {
      if (!this.running) return
      const message = SIMULATION_MESSAGES[this.simulationIndex % SIMULATION_MESSAGES.length]
      this.simulationIndex += 1
      this.ingestBarrage(message)
      this.simulationTimer = setTimeout(tick, this.config.simulation.intervalMs)
    }
    this.simulationTimer = setTimeout(tick, 500)
  }

  isDuplicate(nickname, text, viewerKey = null) {
    const now = this.now()
    const key = `${normalizeViewerKey(viewerKey) || nickname}\u0000${text}`
    for (const [candidate, timestamp] of this.recent) {
      if (now - timestamp <= this.config.ai.dedupeWindowMs) break
      this.recent.delete(candidate)
    }
    if (this.recent.has(key)) return true
    this.recent.set(key, now)
    while (this.recent.size > RECENT_MESSAGE_LIMIT) {
      this.recent.delete(this.recent.keys().next().value)
    }
    return false
  }

  rememberViewerEnter(key, now) {
    for (const [candidate, timestamp] of this.recentWelcomes) {
      if (now - timestamp <= WELCOME_VIEWER_WINDOW_MS) break
      this.recentWelcomes.delete(candidate)
    }
    if (this.recentWelcomes.has(key)) return false
    this.recentWelcomes.set(key, now)
    while (this.recentWelcomes.size > RECENT_WELCOME_LIMIT) {
      this.recentWelcomes.delete(this.recentWelcomes.keys().next().value)
    }
    return true
  }

  ingestViewerEnter(input = {}) {
    if (!this.running || this.config?.pet?.welcome === false) return
    const rawNickname = sanitizeBarrageText(redactSensitive(input.nickname), 80)
    if (!rawNickname) return
    const nickname = safeNickname(rawNickname)
    const viewerKey = normalizeViewerKey(input.viewerKey)
    const key = viewerKey || `nickname:${nickname.toLocaleLowerCase()}`
    const now = this.now()
    if (!this.rememberViewerEnter(key, now)) return
    if (this.lastWelcomeAt !== null && now - this.lastWelcomeAt < WELCOME_GLOBAL_INTERVAL_MS) return

    this.lastWelcomeAt = now
    this.emitBubble({
      kind: 'welcome',
      title: `欢迎 @${nickname}`,
      text: WELCOME_TEXT,
      important: false,
    })
  }

  ingestBarrage(input = {}) {
    if (!this.running) return
    const nickname = safeNickname(input.nickname)
    const viewerKey = normalizeViewerKey(input.viewerKey)
    const text = sanitizeBarrageText(redactSensitive(input.text), 120)
    if (!text) return

    const command = parseQueueCommand(text)
    if (command) {
      this.handleViewerQueueCommand(nickname, command, viewerKey)
      return
    }
    if (this.isDuplicate(nickname, text, viewerKey)) return

    const scene = this.scene.slice(-3)
    this.scene.push({ nickname, text })
    if (this.scene.length > 12) this.scene.shift()
    if (this.aiJobs.length >= this.config.ai.pendingLimit) {
      this.logger.warn('ai inbox full; comment dropped')
      return
    }
    this.aiJobs.push({ nickname, text, scene, createdAt: this.now() })
    this.emitState()
    void this.processAiJobs()
  }

  handleViewerQueueCommand(nickname, command, viewerKey = null) {
    let result
    if (command.type === 'enqueue') result = this.queue.enqueue(command.kind, nickname, command.login, command.content, viewerKey)
    else if (command.type === 'cancel') result = this.queue.cancelByNickname(nickname, viewerKey)
    else result = this.queue.statusForNickname(nickname, viewerKey)
    this.emitBubble({ kind: 'queue', title: `@${nickname}`, text: result.message, important: false })
  }

  emitBubble(payload) {
    this.emit('bubble:show', {
      kind: payload.kind || 'reply',
      title: String(payload.title || '莫宁'),
      text: String(payload.text || ''),
      important: Boolean(payload.important),
    })
  }

  fallbackReply() {
    try {
      return cleanReply(this.aiClient.fallback(), this.config.ai.replyMaxChars) || HARD_FALLBACK
    } catch (error) {
      this.logger.warn('local fallback unavailable', { code: error?.code || 'FALLBACK_ERROR' })
      return HARD_FALLBACK
    }
  }

  async processAiJobs() {
    if (this.processingAi) return
    this.processingAi = true
    try {
      while (this.running && this.aiJobs.length) {
        const job = this.aiJobs.shift()
        if (this.now() - job.createdAt > this.config.ai.messageTtlMs) continue
        const remaining = this.config.ai.minIntervalMs - (this.now() - this.lastAiBubbleAt)
        if (remaining > 0) await this.sleep(remaining)
        if (!this.running || this.now() - job.createdAt > this.config.ai.messageTtlMs) continue

        let reply
        try {
          this.aiState = this.offlineAi ? 'offline-fallback' : 'thinking'
          this.aiErrorCode = null
          this.emitState()
          reply = this.offlineAi ? this.fallbackReply() : await this.aiClient.generateReply(job)
          if (!this.running) break
          reply = cleanReply(reply, this.config.ai.replyMaxChars)
          if (!reply) {
            const error = new Error('AI reply was empty after sanitization')
            error.code = 'EMPTY_RESPONSE'
            throw error
          }
          this.aiState = this.offlineAi ? 'offline-fallback' : 'ready'
        } catch (error) {
          if (!this.running) break
          this.aiErrorCode = error?.code || 'AI_ERROR'
          this.aiState = error?.code === 'MISSING_CREDENTIAL' ? 'missing-key' : 'fallback'
          reply = this.fallbackReply()
          this.logger.warn('ai reply fell back', { code: this.aiErrorCode })
        }
        if (!this.running) break
        this.lastAiBubbleAt = this.now()
        this.emitBubble({ kind: 'reply', title: `回应 @${job.nickname}`, text: reply, important: false })
        this.emitState()
      }
    } catch (error) {
      this.logger.error('ai queue processing failed', { code: error?.code || 'AI_QUEUE_ERROR' })
    } finally {
      this.processingAi = false
      if (this.running) this.emitState()
    }
  }

  command(command, target) {
    let result
    if (command === 'next') result = this.queue.next()
    else if (command === 'complete') result = this.queue.completeAndNext()
    else if (command === 'skip') result = this.queue.skipAndNext()
    else if (command === 'remove') result = this.queue.remove(target)
    else if (command === 'pause') result = this.queue.togglePaused()
    else if (command === 'sync') return { ok: true, state: this.publicState() }
    else return { ok: false, message: '未知直播队列命令。' }

    const current = result.entry || null
    this.emitBubble({
      kind: current ? 'call' : 'notice',
      title: current ? '轮到你了' : '莫宁',
      text: current ? formatEntry(current) : result.message,
      important: Boolean(current),
    })
    return {
      ...result,
      entry: publicEntry(result.entry),
      completed: publicEntry(result.completed),
      skipped: publicEntry(result.skipped),
      state: this.publicState(),
    }
  }
}

module.exports = {
  LiveService,
  SIMULATION_MESSAGES,
  WELCOME_GLOBAL_INTERVAL_MS,
  WELCOME_TEXT,
  WELCOME_VIEWER_WINDOW_MS,
}
