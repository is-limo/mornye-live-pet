'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { decodeBarrage, decodeLiveEvent, DouyinClient } = require('../app/live/douyin-client')

test('解析 DouyinBarrageGrab 的普通弹幕结构', () => {
  const raw = JSON.stringify({ Type: 1, Data: { User: { Nickname: '星河' }, Content: '晚上好' } })
  assert.deepEqual(decodeBarrage(raw), { nickname: '星河', text: '晚上好' })
})

test('解析 v2.8.0 实际推送的字符串 Data', () => {
  const raw = JSON.stringify({
    Type: 1,
    ProcessName: 'chrome',
    Data: JSON.stringify({ User: { Nickname: '风灯' }, Content: '帮帮 扫码 测试' }),
  })
  assert.deepEqual(decodeBarrage(raw), { nickname: '风灯', text: '帮帮 扫码 测试' })
})

test('观众原始标识只转换为本地匹配哈希，不向后续链路暴露原值', () => {
  const raw = JSON.stringify({
    Type: 1,
    Data: JSON.stringify({ User: { Nickname: '同名观众', SecUid: 'MS4wLjABAAAA-private-user-id' }, Content: '我几号' }),
  })
  const decoded = decodeBarrage(raw)
  assert.equal(decoded.nickname, '同名观众')
  assert.match(decoded.viewerKey, /^[a-f0-9]{32}$/)
  assert.doesNotMatch(JSON.stringify(decoded), /private-user-id/)
})

test('解析 v2.8.0 的进直播间事件且不暴露观众原始标识', () => {
  const raw = JSON.stringify({
    Type: 3,
    ProcessName: 'chrome',
    Data: JSON.stringify({
      User: { Nickname: '新来的观众', SecUid: 'MS4wLjABAAAA-private-enter-id' },
      Content: '新来的观众 来了 直播间人数:12',
      CurrentCount: 12,
      EnterTipType: 0,
    }),
  })
  const decoded = decodeLiveEvent(raw)
  assert.equal(decoded.kind, 'enter')
  assert.equal(decoded.nickname, '新来的观众')
  assert.match(decoded.viewerKey, /^[a-f0-9]{32}$/)
  assert.doesNotMatch(JSON.stringify(decoded), /private-enter-id/)
  assert.equal(decodeBarrage(raw), null)
})

test('忽略非弹幕事件与无效 JSON', () => {
  assert.equal(decodeBarrage(JSON.stringify({ Type: 2, Data: {} })), null)
  assert.equal(decodeBarrage('not-json'), null)
})

test('连接只触发 error 而没有 close 时也会进入自动重连', () => {
  let socket
  class FakeSocket extends EventEmitter {
    constructor() {
      super()
      socket = this
    }
    terminate() {}
    close() {}
  }
  const states = []
  const client = new DouyinClient({
    url: 'ws://127.0.0.1:8888',
    WebSocketImpl: FakeSocket,
    random: () => 0,
    onStatus: (status) => states.push(status),
  })
  client.start()
  socket.emit('error', new Error('连接失败'))

  assert.equal(client.socket, null)
  assert.ok(client.retryTimer)
  assert.equal(states.at(-1).reason, 'socket_error')
  client.stop()
})

test('Type 3 只路由到进场回调，不误入普通弹幕回调', () => {
  let socket
  class FakeSocket extends EventEmitter {
    constructor() {
      super()
      socket = this
    }
    terminate() {}
    close() {}
  }
  const barrages = []
  const enters = []
  const client = new DouyinClient({
    url: 'ws://127.0.0.1:8888',
    WebSocketImpl: FakeSocket,
    onBarrage: (event) => barrages.push(event),
    onViewerEnter: (event) => enters.push(event),
  })
  client.start()
  socket.emit('message', JSON.stringify({
    Type: 3,
    Data: JSON.stringify({ User: { Nickname: '星河', SecUid: 'viewer-enter-route' } }),
  }))

  assert.equal(barrages.length, 0)
  assert.equal(enters.length, 1)
  assert.equal(enters[0].nickname, '星河')
  client.stop()
})
