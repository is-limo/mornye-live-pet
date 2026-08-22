'use strict';

(() => {
  const api = window.mornye
  const elements = {
    stage: document.getElementById('stage'),
    pet: document.getElementById('petButton'),
    petImage: document.getElementById('petImage'),
    bubble: document.getElementById('bubble'),
    bubbleTitle: document.getElementById('bubbleTitle'),
    bubbleText: document.getElementById('bubbleText'),
    bubbleKind: document.getElementById('bubbleKind'),
    statusDot: document.getElementById('statusDot'),
    menu: document.getElementById('menu'),
    menuBody: document.getElementById('menuBody'),
    menuClose: document.getElementById('menuClose'),
  }

  const state = {
    config: null,
    locked: false,
    live: null,
    queue: null,
    bubbleTimer: null,
    bubbleImportant: false,
    delayedBubbles: [],
    idleTimer: null,
    audioContext: null,
    hitMask: null,
    clickThrough: null,
  }

  const KIND_LABELS = {
    reply: 'LIVE RESPONSE',
    queue: 'QUEUE RESPONSE',
    call: 'QUEUE CALL',
    welcome: 'VIEWER WELCOME',
    notice: 'SYSTEM NOTICE',
    idle: 'MORNYE',
  }

  function create(tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }

  function playSound() {
    if (!state.config?.pet?.sound) return
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      state.audioContext = state.audioContext || new AudioContext()
      const context = state.audioContext
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(620, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + .08)
      gain.gain.setValueAtTime(.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(.055, context.currentTime + .015)
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .13)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + .14)
    } catch { /* sound is optional */ }
  }

  function hideBubble(showDelayed = true) {
    clearTimeout(state.bubbleTimer)
    state.bubbleTimer = null
    elements.bubble.classList.remove('show', 'important')
    state.bubbleImportant = false
    if (showDelayed && state.delayedBubbles.length) {
      const next = state.delayedBubbles.shift()
      setTimeout(() => showBubble(next), 240)
    }
  }

  function showBubble(payload) {
    if (!payload?.text) return
    if (state.bubbleImportant && !payload.important) {
      state.delayedBubbles.push(payload)
      state.delayedBubbles = state.delayedBubbles.slice(-5)
      return
    }
    clearTimeout(state.bubbleTimer)
    elements.bubbleTitle.textContent = String(payload.title || '莫宁')
    elements.bubbleText.textContent = String(payload.text || '')
    elements.bubbleKind.textContent = KIND_LABELS[payload.kind] || KIND_LABELS.reply
    elements.bubble.classList.toggle('important', Boolean(payload.important))
    elements.bubble.classList.add('show')
    state.bubbleImportant = Boolean(payload.important)
    playSound()
    const normalDuration = state.config?.pet?.bubbleMs || 12000
    const duration = payload.important ? Math.max(24000, normalDuration) : normalDuration
    state.bubbleTimer = setTimeout(() => hideBubble(true), duration)
  }

  function randomLine() {
    const lines = Array.isArray(window.MORN_LINES) ? window.MORN_LINES : []
    if (!lines.length) return '嗯，我在。'
    return String(lines[Math.floor(Math.random() * lines.length)] || '嗯，我在。')
  }

  function bouncePet() {
    elements.pet.classList.remove('bounce')
    void elements.pet.offsetWidth
    elements.pet.classList.add('bounce')
  }

  function prepareHitMask() {
    const createAlphaMask = window.MORN_HIT_MASK?.createAlphaMask
    if (typeof createAlphaMask !== 'function' || !elements.petImage) return
    const build = () => {
      const mask = createAlphaMask(elements.petImage, { width: 160 })
      if (mask) state.hitMask = mask
    }
    if (elements.petImage.complete && elements.petImage.naturalWidth) build()
    else elements.petImage.addEventListener('load', build, { once: true })
  }

  function setSurfaceClickThrough(enabled) {
    const next = Boolean(enabled)
    if (state.clickThrough === next) return
    state.clickThrough = next
    api.setClickThrough(next)
  }

  function isPetPixel(event) {
    const isOpaquePoint = window.MORN_HIT_MASK?.isOpaquePoint
    if (state.hitMask && typeof isOpaquePoint === 'function' && typeof elements.petImage.getBoundingClientRect === 'function') {
      return isOpaquePoint(state.hitMask, elements.petImage.getBoundingClientRect(), event.clientX, event.clientY, 16, 2)
    }
    return elements.pet.contains(event.target)
  }

  function updateSurfaceHit(event) {
    if (state.locked) return
    const menuHit = !elements.menu.hidden && elements.menu.contains(event.target)
    const interactive = Boolean(menuHit || isPetPixel(event))
    setSurfaceClickThrough(!interactive)
  }

  function armIdle() {
    clearTimeout(state.idleTimer)
    if (!state.config?.pet?.idleLines) return
    const delay = 70000 + Math.round(Math.random() * 70000)
    state.idleTimer = setTimeout(() => {
      const liveNow = ['connected', 'simulated'].includes(state.live?.source)
      if (!liveNow && elements.menu.hidden && !elements.bubble.classList.contains('show')) {
        showBubble({ kind: 'idle', title: '莫宁', text: randomLine(), important: false })
      }
      armIdle()
    }, delay)
  }

  function sourceLabel(source) {
    return {
      connected: '弹幕已连接',
      connecting: '正在连接',
      disconnected: '弹幕未连接',
      simulated: '模拟直播',
      stopped: '已停止',
    }[source] || '等待状态'
  }

  function aiLabel(live) {
    if (!live) return '尚未启动'
    if (live.ai === 'ready') return live.model || 'AI 就绪'
    if (live.ai === 'thinking') return '正在组织回复'
    if (live.ai === 'missing-key') return '缺少密钥 · 兜底'
    if (live.ai === 'offline-fallback') return '离线模拟'
    if (live.ai === 'fallback') return '接口异常 · 兜底'
    return '等待中'
  }

  function renderStatusDot() {
    const source = state.live?.source
    elements.statusDot.className = 'status-dot'
    if (source === 'connected') elements.statusDot.classList.add('connected')
    else if (source === 'connecting') elements.statusDot.classList.add('connecting')
    else if (source === 'simulated') elements.statusDot.classList.add('simulated')
    else elements.statusDot.classList.add('warning')
    elements.statusDot.title = `${sourceLabel(source)}；${aiLabel(state.live)}`
  }

  function section(title) {
    const wrapper = create('section', 'menu-section')
    wrapper.appendChild(create('h3', 'section-title', title))
    return wrapper
  }

  function menuButton(label, onClick, options = {}) {
    const button = create('button', `menu-button${options.danger ? ' danger' : ''}${options.wide ? ' wide' : ''}`, label)
    button.type = 'button'
    button.disabled = Boolean(options.disabled)
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        await onClick()
      } catch {
        showBubble({ kind: 'notice', title: '莫宁', text: '这次操作没有保存成功，请稍后再试。', important: false })
      } finally {
        if (elements.menu.hidden === false) renderMenu()
      }
    })
    return button
  }

  async function runCommand(command, target) {
    const result = await api.liveCommand(command, target)
    if (result?.state) {
      state.live = result.state
      state.queue = result.state.queue
      renderStatusDot()
    }
    return result
  }

  function renderMenu() {
    elements.menuBody.textContent = ''
    const live = state.live || {}
    const queue = state.queue || live.queue || { counts: { waiting: 0, priority: 0, normal: 0 }, priority: [], normal: [] }

    const statusSection = section('LIVE STATUS')
    const statusGrid = create('div', 'status-grid')
    const sourceCard = create('div', 'status-card')
    sourceCard.append(create('b', '', '弹幕源'), create('span', '', sourceLabel(live.source)))
    const aiCard = create('div', 'status-card')
    aiCard.append(create('b', '', 'OpenCode Go'), create('span', '', aiLabel(live)))
    statusGrid.append(sourceCard, aiCard)
    statusSection.appendChild(statusGrid)
    elements.menuBody.appendChild(statusSection)

    const queueSection = section('直播帮打队列')
    const currentCard = create('div', 'status-card')
    currentCard.append(
      create('b', '', queue.current ? '当前进行中' : '队列状态'),
      create('span', '', `${queue.current ? `${queue.current.nickname} · ${queue.current.content}` : `等待 ${queue.counts?.waiting || 0} 人${queue.paused ? ' · 已暂停' : ''}`}${queue.storageError ? ' · 存档异常' : ''}`),
    )
    queueSection.appendChild(currentCard)
    const buttons = create('div', 'button-row')
    buttons.append(
      menuButton('下一号', () => runCommand('next'), { disabled: Boolean(queue.current) || !(queue.counts?.waiting > 0) }),
      menuButton('完成并下位', () => runCommand('complete'), { disabled: !queue.current }),
      menuButton('过号', () => runCommand('skip'), { disabled: !queue.current, danger: true }),
    )
    queueSection.appendChild(buttons)
    const pauseButton = menuButton(queue.paused ? '恢复接收排队' : '暂停接收排队', () => runCommand('pause'), { wide: true })
    queueSection.appendChild(pauseButton)

    const waiting = [...(queue.priority || []), ...(queue.normal || [])].slice(0, 8)
    const list = create('div', 'queue-list')
    if (!waiting.length) list.appendChild(create('div', 'queue-empty', '等待队列为空'))
    for (const entry of waiting) {
      const row = create('div', 'queue-item')
      const copy = create('div')
      copy.append(
        create('b', '', `${entry.kind === 'priority' ? '单' : '帮'} #${entry.id} · ${entry.nickname}`),
        create('small', '', `${entry.login === 'qr' ? '扫码' : '手机号'} · ${entry.content}`),
      )
      row.append(copy, menuButton('移除', () => runCommand('remove', entry.id), { danger: true }))
      list.appendChild(row)
    }
    queueSection.appendChild(list)
    elements.menuBody.appendChild(queueSection)

    const petSection = section('桌宠设置')
    const scaleRow = create('div', 'setting-row')
    const settingsDisabled = !state.config?.pet
    scaleRow.appendChild(create('span', '', '尺寸'))
    const scaleActions = create('div', 'setting-actions')
    const scaleOutput = create('output', '', `${Math.round((state.config?.pet?.scale || 1) * 100)}%`)
    scaleActions.append(
      menuButton('－', async () => {
        const next = Math.max(.65, (state.config.pet.scale || 1) - .1)
        state.config = await api.setPetConfig({ scale: next })
      }, { disabled: settingsDisabled }),
      scaleOutput,
      menuButton('＋', async () => {
        const next = Math.min(1.8, (state.config.pet.scale || 1) + .1)
        state.config = await api.setPetConfig({ scale: next })
      }, { disabled: settingsDisabled }),
    )
    scaleRow.appendChild(scaleActions)
    petSection.appendChild(scaleRow)

    const toggleRow = (label, key) => {
      const row = create('div', 'setting-row')
      row.appendChild(create('span', '', label))
      row.appendChild(menuButton(state.config?.pet?.[key] ? '已开启' : '已关闭', async () => {
        state.config = await api.setPetConfig({ [key]: !state.config.pet[key] })
        if (key === 'idleLines') armIdle()
      }, { disabled: settingsDisabled }))
      return row
    }
    petSection.append(
      toggleRow('窗口置顶', 'alwaysOnTop'),
      toggleRow('进场欢迎', 'welcome'),
      toggleRow('提示音', 'sound'),
      toggleRow('空闲台词', 'idleLines'),
    )
    const lockRow = create('div', 'setting-row')
    lockRow.appendChild(create('span', '', '鼠标穿透'))
    lockRow.appendChild(menuButton(state.locked ? '解除' : '开启', async () => {
      state.locked = Boolean(await api.setLocked(!state.locked))
      closeMenu()
    }, { danger: !state.locked }))
    petSection.appendChild(lockRow)
    elements.menuBody.appendChild(petSection)

    const appSection = section('APPLICATION')
    const appButtons = create('div', 'button-row')
    appButtons.append(
      menuButton('数据目录', () => api.openDataFolder()),
      menuButton('收起菜单', async () => closeMenu()),
      menuButton('退出', async () => api.quit(), { danger: true }),
    )
    appSection.appendChild(appButtons)
    elements.menuBody.appendChild(appSection)
  }

  function openMenu() {
    hideBubble(false)
    state.delayedBubbles.length = 0
    renderMenu()
    elements.menu.hidden = false
    setSurfaceClickThrough(false)
  }

  function closeMenu() {
    elements.menu.hidden = true
    setSurfaceClickThrough(true)
    armIdle()
  }

  elements.stage.addEventListener('mousemove', updateSurfaceHit)
  elements.stage.addEventListener('mouseleave', () => {
    if (elements.menu.hidden) setSurfaceClickThrough(true)
  })
  elements.pet.addEventListener('click', () => {
    if (state.locked) return
    bouncePet()
    showBubble({ kind: 'idle', title: '莫宁', text: randomLine(), important: false })
  })
  elements.stage.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    elements.menu.hidden ? openMenu() : closeMenu()
  })
  elements.menuClose.addEventListener('click', closeMenu)
  elements.bubble.addEventListener('click', () => hideBubble(true))
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu() })

  setSurfaceClickThrough(true)
  prepareHitMask()

  function acceptInitial(next) {
    if (!next) return
    state.config = next.config
    state.locked = Boolean(next.locked)
    state.live = next.live
    state.queue = next.live?.queue || null
    renderStatusDot()
    armIdle()
  }

  api.onInitialState(acceptInitial)
  api.onConfigChanged((next) => {
    state.config = next
    armIdle()
    if (!elements.menu.hidden) renderMenu()
  })
  api.onLockChanged((locked) => {
    state.locked = Boolean(locked)
    if (!state.locked) {
      state.clickThrough = null
      setSurfaceClickThrough(true)
    }
    if (!elements.menu.hidden) renderMenu()
  })
  api.onLiveEvent((event) => {
    if (!event) return
    if (event.type === 'bubble:show') showBubble(event.data)
    else if (event.type === 'queue:update') {
      state.queue = event.data
      if (state.live) state.live.queue = event.data
      if (!elements.menu.hidden) renderMenu()
    } else if (event.type === 'status:update') {
      state.live = event.data
      state.queue = event.data?.queue || state.queue
      renderStatusDot()
      if (!elements.menu.hidden) renderMenu()
    }
  })

  api.getState().then(acceptInitial).catch(() => {
    renderStatusDot()
  })
})()
