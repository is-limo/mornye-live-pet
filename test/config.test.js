'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { DEFAULT_CONFIG, sanitizeConfig } = require('../app/live/config')

test('弹幕源只能使用本机回环 WebSocket', () => {
  const remote = sanitizeConfig({ sourceUrl: 'ws://example.com:8888' })
  assert.equal(remote.sourceUrl, DEFAULT_CONFIG.sourceUrl)
  const local = sanitizeConfig({ sourceUrl: 'ws://127.0.0.2:9999' })
  assert.equal(local.sourceUrl, 'ws://127.0.0.2:9999/')
})

test('AI 端点强制 HTTPS，数值配置会钳制到安全范围', () => {
  const config = sanitizeConfig({
    ai: { endpoint: 'http://opencode.ai/v1', replyMaxChars: 500, pendingLimit: 0 },
    pet: { scale: 9 },
  })
  assert.equal(config.ai.endpoint, DEFAULT_CONFIG.ai.endpoint)
  assert.equal(config.ai.replyMaxChars, 80)
  assert.equal(config.ai.pendingLimit, 1)
  assert.equal(config.pet.scale, 1.8)
})

test('窗口置顶默认开启并允许持久化关闭', () => {
  assert.equal(sanitizeConfig({}).pet.alwaysOnTop, true)
  assert.equal(sanitizeConfig({ pet: { alwaysOnTop: false } }).pet.alwaysOnTop, false)
})

test('进场欢迎默认开启并允许持久化关闭', () => {
  assert.equal(sanitizeConfig({}).pet.welcome, true)
  assert.equal(sanitizeConfig({ pet: { welcome: false } }).pet.welcome, false)
})
