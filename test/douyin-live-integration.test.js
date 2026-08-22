'use strict'

const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { WebSocketServer } = require('ws')
const { cloneDefaults } = require('../app/live/config')
const { LiveService } = require('../app/live/live-service')

test('真实 WebSocket 帧按 v2.8.0 字符串 Data 进入排队状态机', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-ws-integration-'))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 64 * 1024 })
  await once(server, 'listening')
  const address = server.address()
  const config = cloneDefaults()
  config.sourceUrl = `ws://127.0.0.1:${address.port}`

  let resolveQueued
  let rejectQueued
  const queued = new Promise((resolve, reject) => {
    resolveQueued = resolve
    rejectQueued = reject
  })
  const timeout = setTimeout(() => rejectQueued(new Error('等待真实 WebSocket 排队消息超时')), 3000)
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    offlineAi: true,
    onEvent: (event) => {
      if (event.type === 'queue:update' && event.data.counts.waiting === 1) resolveQueued(event.data)
    },
  })
  t.after(async () => {
    clearTimeout(timeout)
    service.stop()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  server.on('connection', (socket) => {
    socket.send(JSON.stringify({
      Type: 1,
      ProcessName: 'chrome',
      Data: JSON.stringify({
        User: { Nickname: '联调观众', SecUid: 'integration-viewer' },
        Content: '帮帮 扫码 联调周本',
      }),
    }))
  })
  service.start()
  const snapshot = await queued
  clearTimeout(timeout)

  assert.equal(snapshot.normal[0].nickname, '联调观众')
  assert.equal(snapshot.normal[0].content, '联调周本')
  assert.equal('viewerKey' in snapshot.normal[0], false)
  assert.equal(service.publicState().source, 'connected')
})

test('真实 WebSocket Type 3 帧进入本地欢迎链路', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-ws-welcome-integration-'))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 64 * 1024 })
  await once(server, 'listening')
  const address = server.address()
  const config = cloneDefaults()
  config.sourceUrl = `ws://127.0.0.1:${address.port}`

  let resolveWelcome
  let rejectWelcome
  const welcomed = new Promise((resolve, reject) => {
    resolveWelcome = resolve
    rejectWelcome = reject
  })
  const timeout = setTimeout(() => rejectWelcome(new Error('等待真实 WebSocket 进场欢迎超时')), 3000)
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    offlineAi: true,
    onEvent: (event) => {
      if (event.type === 'bubble:show' && event.data.kind === 'welcome') resolveWelcome(event.data)
    },
  })
  t.after(async () => {
    clearTimeout(timeout)
    service.stop()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  server.on('connection', (socket) => {
    socket.send(JSON.stringify({
      Type: 3,
      ProcessName: 'chrome',
      Data: JSON.stringify({
        User: { Nickname: '进场联调观众', SecUid: 'integration-welcome-viewer' },
        Content: '进场联调观众 来了 直播间人数:8',
        CurrentCount: 8,
        EnterTipType: 0,
      }),
    }))
  })
  service.start()
  const bubble = await welcomed
  clearTimeout(timeout)

  assert.equal(bubble.title, '欢迎 @进场联调观众')
  assert.match(bubble.text, /欢迎来到直播间/)
  assert.equal(service.publicState().queue.counts.waiting, 0)
  assert.equal(service.aiJobs.length, 0)
})
