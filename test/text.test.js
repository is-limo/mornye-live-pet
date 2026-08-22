'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { cleanReply, redactSensitive, safeNickname } = require('../app/live/text')

test('模型正文会移除思考过程、前缀和 Markdown', () => {
  const reply = cleanReply('<think>内部推理</think>\n### 莫宁：先确认状态，再继续。', 45)
  assert.equal(reply, '先确认状态，再继续。')
})

test('回复严格按 Unicode 字符限长', () => {
  assert.equal(cleanReply('一二三四五六七八九十', 5), '一二三四五')
  assert.equal(cleanReply('🌟🌟🌟🌟', 3), '🌟🌟🌟')
})

test('隐私信息会在显示和持久化前被遮盖', () => {
  assert.equal(redactSensitive('电话 13800138000，验证码：123456'), '电话 [手机号已隐藏]，验证码：[已隐藏]')
  assert.equal(safeNickname('这是一个非常非常长的观众昵称'), '这是一个非常非常长的观众…')
  assert.equal(safeNickname('用户13800138000'), '用户[手机号已隐藏]')
})

test('未闭合思考标签和链接不会进入最终气泡', () => {
  assert.equal(cleanReply('<think>只有内部推理，没有结束标签', 45), '')
  assert.equal(cleanReply('看这里 https://example.com/path', 45), '看这里 [链接已隐藏]')
})
