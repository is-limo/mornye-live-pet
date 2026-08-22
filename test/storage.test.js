'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { writeTextAtomic } = require('../app/live/storage')

test('原子写入可以安全替换旧文件且不遗留临时文件', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mornye-storage-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const target = path.join(tempDir, 'state.json')

  writeTextAtomic(target, '{"version":1}\n')
  writeTextAtomic(target, '{"version":2}\n')

  assert.equal(fs.readFileSync(target, 'utf8'), '{"version":2}\n')
  assert.deepEqual(fs.readdirSync(tempDir), ['state.json'])
})
