'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { cloneDefaults } = require('../app/live/config')
const { LiveService } = require('../app/live/live-service')

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

test('普通弹幕只产生 AI 气泡，不把原始弹幕发送给渲染层', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  const config = cloneDefaults()
  config.ai.minIntervalMs = 0
  const sourceClient = { start() {}, stop() {} }
  const aiClient = {
    hasCredential: () => true,
    fallback: () => '兜底',
    generateReply: async () => '晚上好。先坐稳，直播刚开始。',
  }
  const service = new LiveService({ config, userDataDir: tempDir, sourceClient, aiClient, onEvent: (event) => events.push(event) })
  service.start()
  service.ingestBarrage({ nickname: '星河', text: '主播晚上好' })
  await tick()

  const bubbles = events.filter((event) => event.type === 'bubble:show')
  assert.equal(bubbles.length, 1)
  assert.equal(bubbles[0].data.title, '回应 @星河')
  assert.equal(bubbles[0].data.text, '晚上好。先坐稳，直播刚开始。')
  assert.equal(events.some((event) => event.type === 'danmaku' || event.type === 'barrage'), false)
  service.stop()
})

test('排队弹幕走规则系统，不调用 AI', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-queue-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  let aiCalls = 0
  const config = cloneDefaults()
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: { hasCredential: () => true, fallback: () => '兜底', generateReply: async () => { aiCalls += 1; return '不应调用' } },
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestBarrage({ nickname: '风灯', text: '单子 扫码 深塔12层' })
  await tick()
  assert.equal(aiCalls, 0)
  assert.equal(service.publicState().queue.counts.priority, 1)
  assert.match(events.find((event) => event.type === 'bubble:show').data.text, /第 1 位/)
  service.stop()
})

test('观众进场只产生本地欢迎气泡，不调用 AI、写入语境或改变队列', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-welcome-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  let aiCalls = 0
  const service = new LiveService({
    config: cloneDefaults(),
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: {
      hasCredential: () => true,
      fallback: () => '兜底',
      generateReply: async () => { aiCalls += 1; return '不应调用' },
    },
    now: () => 10000,
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestViewerEnter({ nickname: '星河', viewerKey: 'a'.repeat(32) })

  const bubbles = events.filter((event) => event.type === 'bubble:show')
  assert.equal(bubbles.length, 1)
  assert.equal(bubbles[0].data.kind, 'welcome')
  assert.equal(bubbles[0].data.title, '欢迎 @星河')
  assert.match(bubbles[0].data.text, /欢迎来到直播间/)
  assert.equal(aiCalls, 0)
  assert.deepEqual(service.scene, [])
  assert.equal(service.publicState().queue.counts.waiting, 0)
  service.stop()
})

test('进场欢迎按观众去重并受全局间隔限制', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-welcome-throttle-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  let now = 10000
  const service = new LiveService({
    config: cloneDefaults(),
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: { hasCredential: () => false, fallback: () => '兜底' },
    now: () => now,
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestViewerEnter({ nickname: '甲', viewerKey: 'a'.repeat(32) })
  now += 1000
  service.ingestViewerEnter({ nickname: '甲', viewerKey: 'a'.repeat(32) })
  service.ingestViewerEnter({ nickname: '乙', viewerKey: 'b'.repeat(32) })
  now += 5000
  service.ingestViewerEnter({ nickname: '丙', viewerKey: 'c'.repeat(32) })
  now += 5000
  service.ingestViewerEnter({ nickname: '乙', viewerKey: 'b'.repeat(32) })

  const bubbles = events.filter((event) => event.type === 'bubble:show')
  assert.deepEqual(bubbles.map((event) => event.data.title), ['欢迎 @甲', '欢迎 @丙'])
  service.stop()
})

test('关闭进场欢迎后不产生气泡，运行中重新开启即可生效', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-welcome-toggle-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  const config = cloneDefaults()
  config.pet.welcome = false
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: { hasCredential: () => false, fallback: () => '兜底' },
    now: () => 10000,
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestViewerEnter({ nickname: '关闭时进入', viewerKey: 'a'.repeat(32) })
  const nextConfig = cloneDefaults()
  nextConfig.pet.welcome = true
  service.updateConfig(nextConfig)
  service.ingestViewerEnter({ nickname: '开启后进入', viewerKey: 'b'.repeat(32) })

  const bubbles = events.filter((event) => event.type === 'bubble:show')
  assert.deepEqual(bubbles.map((event) => event.data.title), ['欢迎 @开启后进入'])
  service.stop()
})

test('普通弹幕在进入 AI 当前消息和语境前遮盖敏感数字，且语境不重复当前弹幕', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-redact-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const jobs = []
  const config = cloneDefaults()
  config.ai.minIntervalMs = 0
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: {
      hasCredential: () => true,
      fallback: () => '兜底',
      generateReply: async (job) => { jobs.push(job); return '知道了。' },
    },
  })
  service.start()
  service.ingestBarrage({ nickname: '前一位', text: '普通语境' })
  await tick()
  service.ingestBarrage({ nickname: '用户13800138000', text: '电话 13800138000，验证码 123456' })
  await tick()

  assert.equal(jobs[1].nickname, '用户[手机号已隐藏]')
  assert.equal(jobs[1].text, '电话 [手机号已隐藏]，验证码 [已隐藏]')
  assert.deepEqual(jobs[1].scene, [{ nickname: '前一位', text: '普通语境' }])
  service.stop()
})

test('服务停止后不会显示仍在请求中的迟到 AI 回复', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-stop-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  let resolveReply
  const pendingReply = new Promise((resolve) => { resolveReply = resolve })
  const config = cloneDefaults()
  config.ai.minIntervalMs = 0
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: {
      hasCredential: () => true,
      fallback: () => '兜底',
      generateReply: () => pendingReply,
    },
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestBarrage({ nickname: '星河', text: '这条会迟到' })
  await tick()
  service.stop()
  resolveReply('已经停止后才返回')
  await tick()

  assert.equal(events.some((event) => event.type === 'bubble:show'), false)
  assert.equal(service.processingAi, false)
})

test('高弹幕量下去重缓存保持固定上限', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-dedupe-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const service = new LiveService({
    config: cloneDefaults(),
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: { hasCredential: () => false, fallback: () => '兜底' },
    now: () => 1000,
  })
  for (let index = 0; index < 800; index += 1) service.isDuplicate(`观众${index}`, `弹幕${index}`)
  assert.ok(service.recent.size <= 500)
})

test('高进场量下欢迎去重缓存保持固定上限', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-welcome-cache-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  let now = 1000
  const service = new LiveService({
    config: cloneDefaults(),
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: { hasCredential: () => false, fallback: () => '兜底' },
    now: () => now,
  })
  service.start()
  for (let index = 0; index < 800; index += 1) {
    now += 1
    service.ingestViewerEnter({ nickname: `观众${index}`, viewerKey: index.toString(16).padStart(32, '0') })
  }
  assert.ok(service.recentWelcomes.size <= 500)
  service.stop()
})

test('API 与本地台词同时异常时仍显示硬兜底且不会卡死回复队列', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-live-hard-fallback-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const events = []
  const config = cloneDefaults()
  config.ai.minIntervalMs = 0
  const upstreamError = new Error('上游失败')
  upstreamError.code = 'UPSTREAM_HTTP'
  const service = new LiveService({
    config,
    userDataDir: tempDir,
    sourceClient: { start() {}, stop() {} },
    aiClient: {
      hasCredential: () => true,
      generateReply: async () => { throw upstreamError },
      fallback: () => { throw new Error('本地台词损坏') },
    },
    onEvent: (event) => events.push(event),
  })
  service.start()
  service.ingestBarrage({ nickname: '星河', text: '还能回复吗' })
  await tick()

  const bubble = events.find((event) => event.type === 'bubble:show')
  assert.equal(bubble.data.text, '嗯，信号有些迟缓。我还在。')
  assert.equal(service.aiState, 'fallback')
  assert.equal(service.processingAi, false)
  service.stop()
})
