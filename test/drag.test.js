'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const APP_DIR = path.join(__dirname, '..', 'app')
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 }

async function bootMainForPositionTest() {
  const ipcListeners = new Map()
  const ipcHandlers = new Map()
  const screenListeners = new Map()
  let windowInstance = null
  let liveServiceInstance = null
  let workArea = { ...WORK_AREA }

  class FakeBrowserWindow {
    constructor(options) {
      this.bounds = { x: 1352, y: 500, width: options.width, height: options.height }
      this.ignoreMouseEventsCalls = []
      this.alwaysOnTopCalls = []
      this.onceListeners = new Map()
      this.webContents = {
        on() {},
        send() {},
        setWindowOpenHandler() {},
        setZoomFactor() {},
      }
      windowInstance = this
    }

    getBounds() { return { ...this.bounds } }
    getPosition() { return [this.bounds.x, this.bounds.y] }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds } }
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y }
    setAlwaysOnTop(...args) { this.alwaysOnTopCalls.push(args) }
    setIgnoreMouseEvents(ignore, options) { this.ignoreMouseEventsCalls.push([ignore, options]) }
    loadFile() {}
    once(name, listener) { this.onceListeners.set(name, listener) }
    on() {}
    isVisible() { return true }
    isDestroyed() { return false }
    hide() {}
    showInactive() {}
    moveTop() {}
  }

  class FakeTray {
    on() {}
    setToolTip() {}
    setContextMenu() {}
  }

  class FakeLiveService {
    constructor() { liveServiceInstance = this }
    start() {}
    stop() {}
    updateConfig(nextConfig) { this.config = nextConfig }
    publicState() {
      return {
        source: 'disconnected',
        ai: 'missing-key',
        queue: { counts: { waiting: 0 }, current: null, paused: false },
      }
    }
  }

  const appEvents = new Map()
  const electron = {
    app: {
      setName() {},
      requestSingleInstanceLock: () => true,
      on: (name, listener) => appEvents.set(name, listener),
      whenReady: () => Promise.resolve(),
      setAppUserModelId() {},
      getPath: () => 'C:\\mornye-test-data',
      quit() {},
    },
    BrowserWindow: FakeBrowserWindow,
    globalShortcut: { register() {}, unregisterAll() {} },
    ipcMain: {
      handle: (channel, listener) => ipcHandlers.set(channel, listener),
      on: (channel, listener) => ipcListeners.set(channel, listener),
    },
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    screen: {
      getPrimaryDisplay: () => ({ workArea }),
      on: (name, listener) => screenListeners.set(name, listener),
    },
    shell: { openPath: async () => '' },
    Tray: FakeTray,
  }

  const defaults = {
    queue: { maxWaiting: 30 },
    pet: {
      scale: 1,
      sound: true,
      idleLines: true,
      welcome: true,
      alwaysOnTop: true,
      bubbleMs: 12000,
      locked: false,
      position: { x: 1352, y: 500 },
    },
    simulation: { intervalMs: 2400 },
  }
  const { mergeConfig } = require(path.join(APP_DIR, 'live', 'config'))
  const localModules = {
    './live/config': {
      loadConfig: () => ({ config: structuredClone(defaults), filePath: 'config.json' }),
      mergeConfig,
      writeConfig() {},
    },
    './live/live-service': { LiveService: FakeLiveService },
    './live/secrets': { resolveOpenCodeKey: () => null },
    './logger': { createLogger: () => ({ error() {}, warn() {} }) },
  }
  const context = {
    __dirname: APP_DIR,
    console,
    process: { argv: [], on() {} },
    require(request) {
      if (request === 'electron') return electron
      if (localModules[request]) return localModules[request]
      return require(request)
    },
    setTimeout,
    clearTimeout,
  }

  const source = fs.readFileSync(path.join(APP_DIR, 'main.js'), 'utf8')
  vm.runInNewContext(source, context, { filename: path.join(APP_DIR, 'main.js') })
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(windowInstance, '主窗口应完成初始化')
  windowInstance.onceListeners.get('ready-to-show')?.()
  return {
    ipcHandlers,
    ipcListeners,
    screenListeners,
    setWorkArea(next) { workArea = { ...next } },
    get liveService() { return liveServiceInstance },
    window: windowInstance,
  }
}

test('启动后固定在主屏幕工作区右下角且不注册拖拽通道', async () => {
  const runtime = await bootMainForPositionTest()

  assert.deepEqual(runtime.window.getBounds(), { x: 1352, y: 632, width: 560, height: 440 })
  assert.equal(runtime.ipcListeners.has('pet:dragStart'), false)
  assert.equal(runtime.ipcListeners.has('pet:dragMove'), false)
  assert.equal(runtime.ipcListeners.has('pet:dragEnd'), false)
})

test('修改桌宠尺寸后仍重新固定到右下角', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }

  runtime.ipcHandlers.get('config:set')(event, { scale: 1.2 })

  assert.deepEqual(runtime.window.getBounds(), { x: 1240, y: 544, width: 672, height: 528 })
})

test('主屏幕工作区变化后自动重新固定到右下角', async () => {
  const runtime = await bootMainForPositionTest()
  runtime.setWorkArea({ x: 0, y: 0, width: 1600, height: 900 })

  runtime.screenListeners.get('display-metrics-changed')()

  assert.deepEqual(runtime.window.getBounds(), { x: 1032, y: 452, width: 560, height: 440 })
})

test('模型外的透明舞台可切换点击穿透', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }
  const setClickThrough = runtime.ipcListeners.get('pet:clickThrough')

  assert.equal(typeof setClickThrough, 'function')
  setClickThrough(event, true)
  setClickThrough(event, false)

  const calls = runtime.window.ignoreMouseEventsCalls.slice(-2)
  assert.equal(calls[0][0], true)
  assert.equal(calls[0][1].forward, true)
  assert.equal(calls[1][0], false)
  assert.equal(calls[1][1].forward, true)
})

test('鼠标穿透锁定通过可确认的 IPC 切换并立即作用于窗口', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }
  const setLocked = runtime.ipcHandlers.get('pet:lock')

  assert.equal(typeof setLocked, 'function')
  assert.equal(setLocked(event, true), true)
  assert.equal(runtime.window.ignoreMouseEventsCalls.at(-1)[0], true)
  assert.equal(setLocked(event, false), false)
  assert.equal(runtime.window.ignoreMouseEventsCalls.at(-1)[0], false)
})

test('朋友可以关闭并重新开启窗口置顶', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }

  runtime.ipcHandlers.get('config:set')(event, { alwaysOnTop: false })
  assert.deepEqual(runtime.window.alwaysOnTopCalls.at(-1), [false])

  runtime.ipcHandlers.get('config:set')(event, { alwaysOnTop: true })
  assert.deepEqual(runtime.window.alwaysOnTopCalls.at(-1), [true, 'screen-saver'])
})

test('朋友可以关闭并重新开启进场欢迎且直播服务立即收到新配置', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }

  const disabled = runtime.ipcHandlers.get('config:set')(event, { welcome: false })
  assert.equal(disabled.pet.welcome, false)
  assert.equal(runtime.liveService.config.pet.welcome, false)

  const enabled = runtime.ipcHandlers.get('config:set')(event, { welcome: true })
  assert.equal(enabled.pet.welcome, true)
  assert.equal(runtime.liveService.config.pet.welcome, true)
})

test('大尺寸在较小屏幕上会自动缩到工作区以内', async () => {
  const runtime = await bootMainForPositionTest()
  const event = { sender: runtime.window.webContents }
  runtime.setWorkArea({ x: 0, y: 0, width: 800, height: 600 })

  runtime.ipcHandlers.get('config:set')(event, { scale: 1.8 })

  const bounds = runtime.window.getBounds()
  assert.ok(bounds.x >= 8)
  assert.ok(bounds.y >= 8)
  assert.ok(bounds.x + bounds.width <= 792)
  assert.ok(bounds.y + bounds.height <= 592)
})
