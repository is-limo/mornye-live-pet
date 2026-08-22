'use strict'

const fs = require('node:fs')
const path = require('node:path')

let temporarySequence = 0

function writeTextAtomic(filePath, content) {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  temporarySequence += 1
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporarySequence}.tmp`,
  )
  let descriptor = null
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
    fs.writeFileSync(descriptor, String(content), 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch { /* ignore cleanup failure */ }
    }
    try { fs.rmSync(temporaryPath, { force: true }) } catch { /* ignore cleanup failure */ }
    throw error
  }
}

module.exports = { writeTextAtomic }
