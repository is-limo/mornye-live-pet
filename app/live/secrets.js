'use strict'

const fs = require('node:fs')
const path = require('node:path')

const KEY_NAME = 'OPENCODE_GO_API_KEY'

function readEnvValue(filePath, name) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^export\s+/, '')
      if (!line || line.startsWith('#')) continue
      const index = line.indexOf('=')
      if (index < 1 || line.slice(0, index).trim() !== name) continue
      const value = line.slice(index + 1).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? '')
      return value || null
    }
  } catch {
    return null
  }
  return null
}

function resolveOpenCodeKey(options = {}) {
  const env = options.env || process.env
  const direct = String(env[KEY_NAME] || '').trim()
  if (direct) return direct

  const portableExecutableDir = options.portableExecutableDir || env.PORTABLE_EXECUTABLE_DIR
  const candidates = [
    options.userDataDir ? path.join(options.userDataDir, '.env') : null,
    portableExecutableDir ? path.join(portableExecutableDir, '.env') : null,
    env.MORNYE_CREDENTIALS_FILE || null,
  ].filter(Boolean)

  for (const filePath of candidates) {
    const value = readEnvValue(filePath, KEY_NAME)
    if (value) return value
  }
  return null
}

module.exports = { KEY_NAME, readEnvValue, resolveOpenCodeKey }
