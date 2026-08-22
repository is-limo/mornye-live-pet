'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { normalizeEntry, parseQueueCommand, QueueManager } = require('../app/live/queue')

test('解析单子、帮帮和排队前缀', () => {
  assert.deepEqual(parseQueueCommand('排队 单子 扫码 深塔12层'), {
    type: 'enqueue', kind: 'priority', login: 'qr', content: '深塔12层',
  })
  assert.deepEqual(parseQueueCommand('帮帮手机号全息boss'), {
    type: 'enqueue', kind: 'normal', login: 'phone', content: '全息boss',
  })
  assert.deepEqual(parseQueueCommand('取消排队'), { type: 'cancel' })
  assert.deepEqual(parseQueueCommand('我几号？'), { type: 'status' })
  assert.equal(parseQueueCommand('主播晚上好'), null)
})

test('排队文本不会保留手机号与验证码', () => {
  const parsed = parseQueueCommand('帮帮 手机号 13800138000 深塔 验证码123456')
  assert.equal(parsed.content, '[手机号已隐藏] 深塔 验证码[已隐藏]')
})

test('优先队列先叫，完成后自动进入普通队列', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-queue-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const storagePath = path.join(tempDir, 'queue.json')
  const queue = new QueueManager({ storagePath, maxWaiting: 10, now: () => 1000 })

  assert.equal(queue.enqueue('normal', '普通观众', 'phone', '深塔12层').ok, true)
  assert.equal(queue.enqueue('priority', '单子观众', 'qr', '全息冥宁').ok, true)
  assert.equal(queue.next().entry.nickname, '单子观众')
  assert.equal(queue.completeAndNext().entry.nickname, '普通观众')
  assert.equal(queue.snapshot().counts.waiting, 0)

  const restored = new QueueManager({ storagePath, maxWaiting: 10 })
  assert.equal(restored.snapshot().current.nickname, '普通观众')
})

test('重复报名、查询和本人取消都按昵称处理', () => {
  const queue = new QueueManager({ maxWaiting: 2 })
  assert.equal(queue.enqueue('normal', '小城', 'qr', '周本').ok, true)
  assert.equal(queue.enqueue('priority', '小城', 'phone', '深塔').ok, false)
  assert.equal(queue.statusForNickname('小城').position, 1)
  assert.equal(queue.cancelByNickname('小城').ok, true)
  assert.equal(queue.statusForNickname('小城').ok, false)
})

test('损坏存档中缺少昵称的记录不会伪装成“观众”', () => {
  assert.equal(normalizeEntry({ id: 1, kind: 'normal', login: 'qr', content: '周本' }), null)
})

test('队列存档失败时继续保留内存队列并明确报告警告', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-queue-write-error-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const errors = []
  const queue = new QueueManager({ storagePath: tempDir, onError: (error) => errors.push(error) })

  const result = queue.enqueue('normal', '小城', 'qr', '周本')

  assert.equal(result.ok, true)
  assert.equal(result.persisted, false)
  assert.match(result.message, /存档失败/)
  assert.equal(queue.snapshot().counts.waiting, 1)
  assert.equal(queue.snapshot().storageError, true)
  assert.ok(errors.length >= 1)
})

test('同名观众用哈希标识隔离，不能互相查询或取消', () => {
  const queue = new QueueManager({ maxWaiting: 5 })
  const viewerA = 'a'.repeat(32)
  const viewerB = 'b'.repeat(32)
  assert.equal(queue.enqueue('normal', '同名观众', 'qr', '周本A', viewerA).ok, true)
  assert.equal(queue.enqueue('normal', '同名观众', 'qr', '周本B', viewerB).ok, true)

  assert.equal(queue.statusForNickname('同名观众', viewerB).entry.content, '周本B')
  assert.equal(queue.cancelByNickname('同名观众', viewerB).entry.content, '周本B')
  assert.equal(queue.statusForNickname('同名观众', viewerA).entry.content, '周本A')
  assert.equal(queue.snapshot().normal.some((entry) => 'viewerKey' in entry), false)
})

test('暂停、移除、过号和完成严格按状态机推进', () => {
  const queue = new QueueManager({ maxWaiting: 5 })
  assert.equal(queue.togglePaused().paused, true)
  assert.equal(queue.enqueue('normal', '暂停时观众', 'qr', '不会进入').ok, false)
  assert.equal(queue.togglePaused().paused, false)

  const first = queue.enqueue('normal', '第一位', 'qr', '周本一').entry
  queue.enqueue('normal', '第二位', 'phone', '周本二')
  const removable = queue.enqueue('normal', '待移除', 'qr', '周本三').entry
  assert.equal(queue.remove(removable.id).entry.nickname, '待移除')
  assert.equal(queue.remove(undefined).ok, false)

  assert.equal(queue.completeAndNext().ok, false)
  assert.equal(queue.snapshot().counts.waiting, 2, '无当前号时“完成”不能误叫下一位')
  assert.equal(queue.next().entry.id, first.id)
  assert.equal(queue.skipAndNext().entry.nickname, '第二位')
  assert.equal(queue.completeAndNext().entry, null)
  assert.equal(queue.snapshot().current, null)
  assert.equal(queue.snapshot().counts.waiting, 0)
  assert.equal(queue.skipAndNext().ok, false)
})
