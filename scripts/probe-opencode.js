'use strict'

const path = require('node:path')
const { cloneDefaults } = require('../app/live/config')
const { OpenCodeClient } = require('../app/live/opencode-client')
const { resolveOpenCodeKey } = require('../app/live/secrets')

async function main() {
  const config = cloneDefaults()
  config.ai.maxTokens = 60
  const client = new OpenCodeClient({
    config: config.ai,
    resolveKey: () => resolveOpenCodeKey(),
    personaDir: path.join(__dirname, '..', 'app', 'live', 'persona'),
  })
  const reply = await client.generateReply({ nickname: '测试观众', text: '晚上好，今天直播顺利吗？', scene: [] })
  console.log(`OpenCode Go / ${config.ai.model}：${reply}`)
}

main().catch((error) => {
  console.error(`OpenCode Go 探测失败：${error.code || 'ERROR'} ${error.message}`)
  process.exitCode = 1
})
