'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { OpenCodeClient } = require('../app/live/opencode-client')

function baseConfig() {
  return {
    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    model: 'deepseek-v4-flash',
    maxTokens: 80,
    requestTimeoutMs: 5000,
    replyMaxChars: 45,
  }
}

test('OpenCode Go 请求使用指定模型并只返回清洗后的气泡正文', async () => {
  let captured
  const client = new OpenCodeClient({
    config: baseConfig(),
    resolveKey: () => 'test-key',
    personaDir: path.join(__dirname, '..', 'app', 'live', 'persona'),
    fetchImpl: async (_url, options) => {
      captured = options
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<think>推理</think>莫宁：先确认数据。' } }] }),
      }
    },
  })
  const reply = await client.generateReply({ nickname: '观众', text: '能打吗', scene: [] })
  assert.equal(reply, '先确认数据。')
  const body = JSON.parse(captured.body)
  assert.equal(body.model, 'deepseek-v4-flash')
  assert.equal(body.stream, false)
  assert.match(body.messages[0].content, /桌宠气泡/)
  assert.equal(captured.headers['User-Agent'], 'mornye-live-pet/0.1.8')
})

test('缺少密钥时给出可识别错误且不发网络请求', async () => {
  const client = new OpenCodeClient({
    config: baseConfig(),
    resolveKey: () => null,
    personaDir: path.join(__dirname, '..', 'app', 'live', 'persona'),
    fetchImpl: async () => { throw new Error('不应调用') },
  })
  await assert.rejects(() => client.generateReply({ nickname: '观众', text: '你好' }), { code: 'MISSING_CREDENTIAL' })
})

test('上游只有 reasoning_content 时不会把内部推理显示到气泡', async () => {
  const client = new OpenCodeClient({
    config: baseConfig(),
    resolveKey: () => 'test-key',
    personaDir: path.join(__dirname, '..', 'app', 'live', 'persona'),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '', reasoning_content: '内部推理不应显示' } }] }),
    }),
  })
  await assert.rejects(() => client.generateReply({ nickname: '观众', text: '你好' }), { code: 'EMPTY_RESPONSE' })
})
