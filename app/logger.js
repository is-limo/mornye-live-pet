'use strict'

const fs = require('node:fs')
const path = require('node:path')

function sanitize(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[PHONE]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1000)
}

function createLogger(userDataDir) {
  const logDir = path.join(userDataDir, 'logs')
  const logPath = path.join(logDir, 'mornye-pet.log')
  fs.mkdirSync(logDir, { recursive: true })
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      fs.copyFileSync(logPath, `${logPath}.1`)
      fs.writeFileSync(logPath, '', 'utf8')
    }
  } catch { /* logging must never prevent startup */ }

  function write(level, message, meta) {
    const suffix = meta && typeof meta === 'object' ? ` ${sanitize(JSON.stringify(meta))}` : ''
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${sanitize(message)}${suffix}\n`
    try { fs.appendFileSync(logPath, line, 'utf8') } catch { /* ignore */ }
  }

  return {
    path: logPath,
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  }
}

module.exports = { createLogger, sanitize }
