'use strict'

const { WebSocketServer } = require('ws')

const messages = [
  { nickname: '测试观众', text: '晚上好，今天直播顺利吗？' },
  { nickname: '风灯', text: '帮帮 手机号 深塔12层' },
  { nickname: '莫方', text: '单子 扫码 全息冥宁' },
]

const server = new WebSocketServer({ host: '127.0.0.1', port: 8888, maxPayload: 64 * 1024 })
server.on('listening', () => console.log('模拟 DouyinBarrageGrab 已监听 ws://127.0.0.1:8888'))
server.on('connection', (socket) => {
  console.log('桌宠已连接，开始推送 3 条模拟弹幕')
  messages.forEach((message, index) => {
    setTimeout(() => {
      if (socket.readyState !== 1) return
      socket.send(JSON.stringify({
        Type: 1,
        Data: { User: { Nickname: message.nickname }, Content: message.text },
      }))
    }, 1200 + index * 4500)
  })
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
