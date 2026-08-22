'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

test('渲染脚本能启动并注册桌宠交互', () => {
  const listeners = new Map()
  const documentListeners = new Map()
  const clickThroughStates = []
  const ids = ['stage', 'petButton', 'petImage', 'bubble', 'bubbleTitle', 'bubbleText', 'bubbleKind', 'statusDot', 'menu', 'menuBody', 'menuClose']
  const elements = Object.fromEntries(ids.map((id) => [id, {
    hidden: id === 'menu',
    addEventListener(type, listener) {
      if (!listeners.has(id)) listeners.set(id, new Map())
      listeners.get(id).set(type, listener)
    },
    classList: {
      add() {},
      contains() { return false },
      remove() {},
      toggle() {},
    },
    contains(target) { return target === this },
    releasePointerCapture() {},
    setPointerCapture() {},
  }]))
  const api = {
    getState: async () => null,
    onConfigChanged() {},
    onInitialState() {},
    onLiveEvent() {},
    onLockChanged() {},
    setClickThrough: (enabled) => clickThroughStates.push(enabled),
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8')

  vm.runInNewContext(source, {
    clearTimeout,
    document: {
      addEventListener(type, listener) { documentListeners.set(type, listener) },
      getElementById: (id) => elements[id],
    },
    setTimeout,
    window: { MORN_LINES: [], mornye: api },
  })

  assert.deepEqual(clickThroughStates, [true], '透明舞台启动时应立即把点击交给下层窗口')
  assert.equal(typeof listeners.get('petButton')?.get('click'), 'function')
  assert.equal(listeners.get('petButton')?.has('pointermove'), false)
  assert.equal(typeof listeners.get('stage')?.get('contextmenu'), 'function')
  assert.equal(typeof listeners.get('stage')?.get('mousemove'), 'function')

  listeners.get('stage').get('mousemove')({ target: elements.stage })
  listeners.get('stage').get('mousemove')({ target: elements.petButton })
  assert.deepEqual(clickThroughStates, [true, false])
})
