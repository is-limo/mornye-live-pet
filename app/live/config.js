'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { writeTextAtomic } = require('./storage')

const DEFAULT_CONFIG = {
  sourceUrl: 'ws://127.0.0.1:8888',
  ai: {
    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    model: 'deepseek-v4-flash',
    maxTokens: 180,
    requestTimeoutMs: 45000,
    minIntervalMs: 8000,
    dedupeWindowMs: 30000,
    pendingLimit: 8,
    messageTtlMs: 45000,
    replyMaxChars: 45,
  },
  queue: {
    maxWaiting: 30,
  },
  pet: {
    scale: 1,
    sound: true,
    idleLines: true,
    welcome: true,
    alwaysOnTop: true,
    bubbleMs: 12000,
    locked: false,
    position: null,
  },
  simulation: {
    intervalMs: 2400,
  },
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function safeString(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= maxLength ? text : fallback
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(parts[0]) === 127
}

function safeSourceUrl(value, fallback) {
  try {
    const parsed = new URL(String(value || ''))
    if (!['ws:', 'wss:'].includes(parsed.protocol)) return fallback
    if (parsed.username || parsed.password || !isLoopbackHostname(parsed.hostname)) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

function safeAiEndpoint(value, fallback) {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

function safePosition(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
}

function sanitizeConfig(input = {}) {
  const defaults = cloneDefaults()
  const ai = input.ai && typeof input.ai === 'object' ? input.ai : {}
  const queue = input.queue && typeof input.queue === 'object' ? input.queue : {}
  const pet = input.pet && typeof input.pet === 'object' ? input.pet : {}
  const simulation = input.simulation && typeof input.simulation === 'object' ? input.simulation : {}

  return {
    sourceUrl: safeSourceUrl(input.sourceUrl, defaults.sourceUrl),
    ai: {
      endpoint: safeAiEndpoint(ai.endpoint, defaults.ai.endpoint),
      model: safeString(ai.model, defaults.ai.model, 80),
      maxTokens: Math.round(clampNumber(ai.maxTokens, defaults.ai.maxTokens, 32, 512)),
      requestTimeoutMs: Math.round(clampNumber(ai.requestTimeoutMs, defaults.ai.requestTimeoutMs, 5000, 120000)),
      minIntervalMs: Math.round(clampNumber(ai.minIntervalMs, defaults.ai.minIntervalMs, 1000, 60000)),
      dedupeWindowMs: Math.round(clampNumber(ai.dedupeWindowMs, defaults.ai.dedupeWindowMs, 1000, 300000)),
      pendingLimit: Math.round(clampNumber(ai.pendingLimit, defaults.ai.pendingLimit, 1, 30)),
      messageTtlMs: Math.round(clampNumber(ai.messageTtlMs, defaults.ai.messageTtlMs, 5000, 300000)),
      replyMaxChars: Math.round(clampNumber(ai.replyMaxChars, defaults.ai.replyMaxChars, 12, 80)),
    },
    queue: {
      maxWaiting: Math.round(clampNumber(queue.maxWaiting, defaults.queue.maxWaiting, 1, 200)),
    },
    pet: {
      scale: clampNumber(pet.scale, defaults.pet.scale, 0.65, 1.8),
      sound: typeof pet.sound === 'boolean' ? pet.sound : defaults.pet.sound,
      idleLines: typeof pet.idleLines === 'boolean' ? pet.idleLines : defaults.pet.idleLines,
      welcome: typeof pet.welcome === 'boolean' ? pet.welcome : defaults.pet.welcome,
      alwaysOnTop: typeof pet.alwaysOnTop === 'boolean' ? pet.alwaysOnTop : defaults.pet.alwaysOnTop,
      bubbleMs: Math.round(clampNumber(pet.bubbleMs, defaults.pet.bubbleMs, 3000, 60000)),
      locked: typeof pet.locked === 'boolean' ? pet.locked : defaults.pet.locked,
      position: safePosition(pet.position),
    },
    simulation: {
      intervalMs: Math.round(clampNumber(simulation.intervalMs, defaults.simulation.intervalMs, 500, 30000)),
    },
  }
}

function mergeConfig(base, patch) {
  const next = patch && typeof patch === 'object' ? patch : {}
  return sanitizeConfig({
    ...base,
    ...next,
    ai: { ...(base.ai || {}), ...(next.ai || {}) },
    queue: { ...(base.queue || {}), ...(next.queue || {}) },
    pet: { ...(base.pet || {}), ...(next.pet || {}) },
    simulation: { ...(base.simulation || {}), ...(next.simulation || {}) },
  })
}

function writeConfig(filePath, config) {
  writeTextAtomic(filePath, JSON.stringify(sanitizeConfig(config), null, 2) + '\n')
}

function loadConfig(userDataDir, env = process.env) {
  const filePath = path.join(userDataDir, 'config.json')
  let persisted = {}
  let warning = null

  try {
    if (fs.existsSync(filePath)) persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    warning = '配置文件无法解析，已使用安全默认值'
  }

  const withEnvironment = mergeConfig(cloneDefaults(), persisted)
  if (env.MORNYE_DOUYIN_WS) withEnvironment.sourceUrl = env.MORNYE_DOUYIN_WS
  if (env.MORNYE_OPENCODE_MODEL) withEnvironment.ai.model = env.MORNYE_OPENCODE_MODEL
  if (env.MORNYE_OPENCODE_ENDPOINT) withEnvironment.ai.endpoint = env.MORNYE_OPENCODE_ENDPOINT
  const config = sanitizeConfig(withEnvironment)

  if (!fs.existsSync(filePath)) writeConfig(filePath, config)
  return { config, filePath, warning }
}

module.exports = {
  DEFAULT_CONFIG,
  cloneDefaults,
  isLoopbackHostname,
  loadConfig,
  mergeConfig,
  sanitizeConfig,
  writeConfig,
}
