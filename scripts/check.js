'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const ignored = new Set(['node_modules', 'release', 'output', 'tmp', '.git'])

function collect(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(fullPath, result)
    else if (entry.isFile() && fullPath.endsWith('.js')) result.push(fullPath)
  }
  return result
}

const javascriptFiles = collect(root)
for (const filePath of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status || 1)
  }
}

const sensitiveFileNames = [
  /^\.npmrc$/i,
  /\.(?:pfx|pem|key)$/i,
  /^queue\.json$/i,
  /\.log(?:\.\d+)?$/i,
  /^cookies?\./i,
  /^session/i,
]
const textExtensions = new Set(['.bat', '.cmd', '.config', '.example', '.html', '.js', '.json', '.md', '.txt', '.url', '.yml', '.yaml'])
const secretPatterns = [
  { label: 'OpenCode Go Key', pattern: /OPENCODE_GO_API_KEY\s*=\s*[a-z0-9._-]{16,}/i },
  { label: 'GitHub Token', pattern: /gh[pousr]_[a-z0-9]{20,}/i },
  { label: 'Bearer Token', pattern: /bearer\s+[a-z0-9._-]{24,}/i },
  { label: '私钥正文', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]
const privatePathPattern = /[a-z]:[\\/](?:users|documents and settings)[\\/][^\\/\r\n]+[\\/]/i

function checkPrivacy(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      checkPrivacy(filePath)
      continue
    }
    if (!entry.isFile()) continue
    if (sensitiveFileNames.some((pattern) => pattern.test(entry.name))) {
      throw new Error(`源码目录中发现不应提交的凭据、日志或用户数据文件：${path.relative(root, filePath)}`)
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue
    const text = fs.readFileSync(filePath, 'utf8')
    if (privatePathPattern.test(text)) throw new Error(`源码中发现 Windows 用户绝对路径：${path.relative(root, filePath)}`)
    for (const secret of secretPatterns) {
      if (secret.pattern.test(text)) throw new Error(`源码中发现疑似${secret.label}：${path.relative(root, filePath)}`)
    }
  }
}

checkPrivacy(root)

const required = [
  'app/assets/mornye-pet.png',
  'app/live/persona/system_prompt.txt',
  'app/live/persona/fallback_lines.txt',
  'app/renderer.html',
]
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`缺少必要文件：${relative}`)
}

const html = fs.readFileSync(path.join(root, 'app', 'renderer.html'), 'utf8')
if (!html.includes('Content-Security-Policy')) throw new Error('renderer.html 缺少 CSP')
if (/<script(?![^>]*\bsrc=)/i.test(html)) throw new Error('renderer.html 不允许内联脚本')

console.log(`检查通过：${javascriptFiles.length} 个 JavaScript 文件；必要资源与隐私规则均通过。`)
