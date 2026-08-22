'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { readEnvValue, resolveOpenCodeKey } = require('../app/live/secrets')

test('密钥优先从进程环境读取', () => {
  assert.equal(resolveOpenCodeKey({ env: { OPENCODE_GO_API_KEY: 'from-env' } }), 'from-env')
})

test('凭据文件只提取指定变量', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-secret-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const filePath = path.join(tempDir, '.env')
  fs.writeFileSync(filePath, 'OTHER=value\nOPENCODE_GO_API_KEY="from-file"\n', 'utf8')
  assert.equal(readEnvValue(filePath, 'OPENCODE_GO_API_KEY'), 'from-file')
})

test('便携版从可执行文件同目录读取预配置密钥', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-portable-secret-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(tempDir, '.env'), 'OPENCODE_GO_API_KEY=portable-key\n', 'utf8')

  assert.equal(resolveOpenCodeKey({
    env: {},
    portableExecutableDir: tempDir,
    localAppData: path.join(tempDir, 'empty-local-app-data'),
  }), 'portable-key')
})

test('便携密钥文件不会覆盖显式进程环境变量', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-portable-priority-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(tempDir, '.env'), 'OPENCODE_GO_API_KEY=portable-key\n', 'utf8')

  assert.equal(resolveOpenCodeKey({
    env: { OPENCODE_GO_API_KEY: 'process-key' },
    portableExecutableDir: tempDir,
  }), 'process-key')
})

test('不会读取其他程序目录中的 Hermes 密钥', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-hermes-isolation-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const hermesDir = path.join(tempDir, 'hermes')
  fs.mkdirSync(hermesDir)
  fs.writeFileSync(path.join(hermesDir, '.env'), 'OPENCODE_GO_API_KEY=ignored-key\n', 'utf8')

  assert.equal(resolveOpenCodeKey({ env: {}, localAppData: tempDir }), null)
})
