'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { isOpaquePoint } = require('../app/hit-mask')

test('模型透明像素会穿透，实体像素保持可交互', () => {
  const mask = new Uint8ClampedArray([
    0, 255,
    255, 255,
  ])
  const rect = { left: 10, top: 20, width: 100, height: 100 }

  assert.equal(isOpaquePoint({ mask, width: 2, height: 2 }, rect, 20, 30), false)
  assert.equal(isOpaquePoint({ mask, width: 2, height: 2 }, rect, 80, 30), true)
  assert.equal(isOpaquePoint({ mask, width: 2, height: 2 }, rect, 20, 90), true)
  assert.equal(isOpaquePoint({ mask, width: 2, height: 2 }, rect, 4, 30), false)
})
