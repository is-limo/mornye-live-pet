'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} = require('electron')
const { loadConfig, mergeConfig, writeConfig } = require('./live/config')
const { LiveService } = require('./live/live-service')
const { resolveOpenCodeKey } = require('./live/secrets')
const { createLogger } = require('./logger')

app.setName('莫宁桌宠')

const BASE_WIDTH = 560
const BASE_HEIGHT = 440
const WINDOW_MARGIN = 8
const RENDERER_PATH = path.join(__dirname, 'renderer.html')
const ASSET_PATH = path.join(__dirname, 'assets', 'mornye-pet.png')
const ALLOWED_LIVE_COMMANDS = new Set(['next', 'complete', 'skip', 'remove', 'pause', 'sync'])

let mainWindow = null
let tray = null
let liveService = null
let config = null
let configFile = null
let logger = null
let rendererReady = false
let pendingUiEvents = []
let surfaceClickThrough = false

function windowGeometry() {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const availableWidth = Math.max(1, area.width - WINDOW_MARGIN * 2)
  const availableHeight = Math.max(1, area.height - WINDOW_MARGIN * 2)
  const zoom = Math.min(
    config.pet.scale,
    availableWidth / BASE_WIDTH,
    availableHeight / BASE_HEIGHT,
  )
  const width = Math.min(availableWidth, Math.round(BASE_WIDTH * zoom))
  const height = Math.min(availableHeight, Math.round(BASE_HEIGHT * zoom))
  return {
    width,
    height,
    zoom,
    position: {
      x: Math.round(area.x + area.width - width - WINDOW_MARGIN),
      y: Math.round(area.y + area.height - height - WINDOW_MARGIN),
    },
  }
}

function persistConfig(nextConfig) {
  writeConfig(configFile, nextConfig)
  config = nextConfig
  return config
}

function applyWindowGeometry() {
  if (!mainWindow) return
  const geometry = windowGeometry()
  const position = geometry.position
  mainWindow.webContents.setZoomFactor(geometry.zoom)
  mainWindow.setBounds({ ...position, width: geometry.width, height: geometry.height })
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!rendererReady) {
    if (channel === 'live:event') {
      pendingUiEvents.push(payload)
      pendingUiEvents = pendingUiEvents.slice(-20)
    }
    return
  }
  try {
    mainWindow.webContents.send(channel, payload)
  } catch (error) {
    if (logger) logger.warn('renderer delivery failed', { channel, code: error?.code || 'UNKNOWN' })
  }
}

function publicState() {
  return {
    config,
    locked: config.pet.locked,
    live: liveService ? liveService.publicState() : null,
  }
}

function updatePetConfig(patch) {
  const raw = patch && typeof patch === 'object' ? patch : {}
  const allowed = {}
  if (typeof raw.scale === 'number') allowed.scale = raw.scale
  if (typeof raw.sound === 'boolean') allowed.sound = raw.sound
  if (typeof raw.idleLines === 'boolean') allowed.idleLines = raw.idleLines
  if (typeof raw.welcome === 'boolean') allowed.welcome = raw.welcome
  if (typeof raw.alwaysOnTop === 'boolean') allowed.alwaysOnTop = raw.alwaysOnTop
  if (typeof raw.bubbleMs === 'number') allowed.bubbleMs = raw.bubbleMs
  const previousScale = config.pet.scale
  const previousAlwaysOnTop = config.pet.alwaysOnTop
  persistConfig(mergeConfig(config, { pet: allowed }))
  if (typeof liveService?.updateConfig === 'function') liveService.updateConfig(config)
  if (mainWindow && previousScale !== config.pet.scale) applyWindowGeometry()
  if (mainWindow && previousAlwaysOnTop !== config.pet.alwaysOnTop) applyAlwaysOnTop()
  sendToRenderer('config:changed', config)
  rebuildTrayMenu()
  return config
}

function applyMouseMode() {
  if (!mainWindow) return
  mainWindow.setIgnoreMouseEvents(Boolean(config.pet.locked || surfaceClickThrough), { forward: true })
}

function applyAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (config.pet.alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'screen-saver')
  else mainWindow.setAlwaysOnTop(false)
}

function applyLock(locked) {
  persistConfig(mergeConfig(config, { pet: { locked: Boolean(locked) } }))
  applyMouseMode()
  sendToRenderer('lock:changed', config.pet.locked)
  rebuildTrayMenu()
  return config.pet.locked
}

function toggleWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else {
    mainWindow.showInactive()
    mainWindow.moveTop()
  }
  rebuildTrayMenu()
}

function liveStatusLabel(state) {
  const source = {
    connected: '弹幕已连接',
    connecting: '正在连接弹幕',
    disconnected: '弹幕未连接',
    simulated: '模拟弹幕',
    stopped: '弹幕已停止',
  }[state?.source] || '弹幕状态未知'
  const ai = state?.ai === 'ready' ? `AI：${state.model}`
    : state?.ai === 'thinking' ? 'AI：正在回复'
      : state?.ai === 'missing-key' ? 'AI：缺少密钥，使用兜底'
        : state?.ai === 'offline-fallback' ? 'AI：离线模拟'
          : 'AI：兜底模式'
  return { source, ai }
}

function runLiveCommand(command, target) {
  if (!liveService || !ALLOWED_LIVE_COMMANDS.has(command)) return { ok: false, message: '直播服务尚未启动。' }
  const result = liveService.command(command, target)
  rebuildTrayMenu()
  return result
}

function rebuildTrayMenu() {
  if (!tray) return
  const state = liveService ? liveService.publicState() : null
  const queue = state?.queue
  const labels = liveStatusLabel(state)
  const waiting = queue?.counts?.waiting || 0
  tray.setToolTip(`莫宁桌宠 · ${labels.source} · 等待 ${waiting}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mainWindow?.isVisible() ? '隐藏莫宁' : '显示莫宁', click: toggleWindow },
    { label: config?.pet?.locked ? '解除鼠标穿透（Ctrl+Alt+M）' : '开启鼠标穿透（Ctrl+Alt+M）', click: () => applyLock(!config.pet.locked) },
    { label: '窗口置顶', type: 'checkbox', checked: config?.pet?.alwaysOnTop !== false, click: (item) => updatePetConfig({ alwaysOnTop: item.checked }) },
    { label: '进场欢迎', type: 'checkbox', checked: config?.pet?.welcome !== false, click: (item) => updatePetConfig({ welcome: item.checked }) },
    { type: 'separator' },
    { label: labels.source, enabled: false },
    { label: labels.ai, enabled: false },
    { label: queue?.current ? `进行中：${queue.current.nickname}` : `等待：${waiting} 人`, enabled: false },
    { type: 'separator' },
    { label: '下一号', enabled: !queue?.current && waiting > 0, click: () => runLiveCommand('next') },
    { label: '完成并下一位', enabled: Boolean(queue?.current), click: () => runLiveCommand('complete') },
    { label: '过号并下一位', enabled: Boolean(queue?.current), click: () => runLiveCommand('skip') },
    { label: queue?.paused ? '恢复排队' : '暂停排队', click: () => runLiveCommand('pause') },
    { type: 'separator' },
    { label: '打开数据与日志目录', click: () => shell.openPath(app.getPath('userData')) },
    { label: '退出莫宁桌宠', click: () => app.quit() },
  ]))
}

function createTray() {
  const image = nativeImage.createFromPath(ASSET_PATH).resize({ width: 32, height: 32 })
  tray = new Tray(image)
  tray.on('click', () => {
    if (!mainWindow?.isVisible()) mainWindow.showInactive()
    else mainWindow.moveTop()
  })
  rebuildTrayMenu()
}

function createWindow() {
  const geometry = windowGeometry()
  mainWindow = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: config.pet.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  })
  applyAlwaysOnTop()
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const allowedUrl = pathToFileURL(RENDERER_PATH).href
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    sendToRenderer('state:initial', publicState())
    for (const event of pendingUiEvents) sendToRenderer('live:event', event)
    pendingUiEvents = []
  })
  mainWindow.loadFile(RENDERER_PATH)
  mainWindow.once('ready-to-show', () => {
    applyWindowGeometry()
    mainWindow.showInactive()
    applyLock(config.pet.locked)
  })
  mainWindow.on('closed', () => {
    rendererReady = false
    mainWindow = null
  })
}

function registerIpc() {
  const trusted = (event) => Boolean(mainWindow && event.sender === mainWindow.webContents)

  ipcMain.handle('state:get', (event) => trusted(event) ? publicState() : null)
  ipcMain.handle('config:set', (event, patch) => trusted(event) ? updatePetConfig(patch) : null)
  ipcMain.handle('live:command', (event, command, target) => {
    if (!trusted(event) || !ALLOWED_LIVE_COMMANDS.has(String(command))) return { ok: false, message: '命令被拒绝。' }
    const safeTarget = typeof target === 'number' ? target : String(target || '').slice(0, 40)
    return runLiveCommand(String(command), safeTarget)
  })
  ipcMain.handle('app:openData', (event) => trusted(event) ? shell.openPath(app.getPath('userData')) : '')
  ipcMain.on('pet:clickThrough', (event, enabled) => {
    if (!trusted(event)) return
    surfaceClickThrough = Boolean(enabled)
    applyMouseMode()
  })
  ipcMain.handle('pet:lock', (event, locked) => trusted(event) ? applyLock(Boolean(locked)) : null)
  ipcMain.on('pet:quit', (event) => { if (trusted(event)) app.quit() })
}

function startLiveService() {
  const simulate = process.argv.includes('--simulate-live')
  const offlineAi = process.argv.includes('--offline-ai')
  liveService = new LiveService({
    config,
    userDataDir: app.getPath('userData'),
    personaDir: path.join(__dirname, 'live', 'persona'),
    resolveKey: () => resolveOpenCodeKey({ userDataDir: app.getPath('userData') }),
    offlineAi,
    logger,
    onEvent: (event) => {
      sendToRenderer('live:event', event)
      if (event.type === 'queue:update' || event.type === 'status:update') rebuildTrayMenu()
    },
  })
  liveService.start({ simulate })
  rebuildTrayMenu()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.showInactive()
      mainWindow.moveTop()
    }
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.mornye.livepet')
    const loaded = loadConfig(app.getPath('userData'))
    config = loaded.config
    configFile = loaded.filePath
    logger = createLogger(app.getPath('userData'))
    if (loaded.warning) logger.warn(loaded.warning)
    registerIpc()
    createWindow()
    const anchorWindow = () => applyWindowGeometry()
    screen.on('display-added', anchorWindow)
    screen.on('display-removed', anchorWindow)
    screen.on('display-metrics-changed', anchorWindow)
    createTray()
    startLiveService()
    globalShortcut.register('CommandOrControl+Alt+M', () => applyLock(!config.pet.locked))
  }).catch((error) => {
    if (logger) logger.error('startup failed', { message: error?.message || String(error) })
    app.quit()
  })
  app.on('before-quit', () => {
    if (liveService) liveService.stop()
    globalShortcut.unregisterAll()
  })
  app.on('window-all-closed', () => app.quit())
}

process.on('uncaughtException', (error) => {
  if (logger) logger.error('uncaught exception', { message: error?.message || String(error) })
})
process.on('unhandledRejection', (error) => {
  if (logger) logger.error('unhandled rejection', { message: error?.message || String(error) })
})
