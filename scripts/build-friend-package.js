'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const pkg = require('../package.json')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageName = `莫宁桌宠-朋友版-${pkg.version}`
const stageDir = path.join(releaseDir, packageName)
const zipPath = path.join(releaseDir, `${packageName}.zip`)
const petSource = path.join(releaseDir, `Mornye-Live-Pet-${pkg.version}-x64.exe`)
const packagingDir = path.join(root, 'packaging')

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`缺少${label}：${filePath}`)
  }
}

function assertReleaseTarget(target) {
  const relative = path.relative(releaseDir, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝操作 release 目录以外的路径：${target}`)
  }
}

function collectFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(fullPath, result)
    else if (entry.isFile()) result.push(fullPath)
  }
  return result
}

function scanPrivacy() {
  const forbiddenText = [
    { label: 'Windows 用户目录', pattern: /[a-z]:\\users\\[^\\\r\n]+\\/i },
    { label: '本机 Codex 项目路径', pattern: /[a-z]:\\codex\\/i },
  ]
  const forbiddenFileNames = [
    /^\.env$/i,
    /^\.env\.(?!example$)/i,
    /^\.npmrc$/i,
    /^queue\.json$/i,
    /\.log(?:\.\d+)?$/i,
    /^session/i,
    /^cookies?\./i,
    /\.(?:pfx|pem|key)$/i,
  ]
  const textExtensions = new Set(['.txt', '.bat', '.cmd', '.config', '.example', '.json', '.md', '.url'])
  const secretPatterns = [
    { label: 'OpenCode Go Key', pattern: /OPENCODE_GO_API_KEY\s*=\s*[a-z0-9._-]{16,}/i },
    { label: 'GitHub Token', pattern: /gh[pousr]_[a-z0-9]{20,}/i },
    { label: '通用 Bearer Token', pattern: /bearer\s+[a-z0-9._-]{24,}/i },
    { label: '私钥正文', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  ]

  for (const filePath of collectFiles(stageDir)) {
    const relative = path.relative(stageDir, filePath)
    if (forbiddenFileNames.some((pattern) => pattern.test(path.basename(filePath)))) {
      throw new Error(`发现不应打包的数据、日志、会话或证书文件：${relative}`)
    }
    const data = fs.readFileSync(filePath)
    const utf8 = data.toString('utf8')
    const utf16 = data.toString('utf16le')

    for (const marker of forbiddenText) {
      if (marker.pattern.test(utf8) || marker.pattern.test(utf16)) {
        throw new Error(`发现不应打包的${marker.label}：${relative}`)
      }
    }

    if (textExtensions.has(path.extname(filePath).toLowerCase())) {
      for (const secret of secretPatterns) {
        if (secret.pattern.test(utf8)) throw new Error(`发现疑似${secret.label}：${relative}`)
      }
      const phone = /(?<!\d)1[3-9]\d{9}(?!\d)/.exec(utf8)
      if (phone) throw new Error(`文本文件中发现疑似手机号：${relative}`)
    }
  }

  const example = fs.readFileSync(path.join(stageDir, '.env.example'), 'utf8')
  if (!/^OPENCODE_GO_API_KEY=\s*$/m.test(example)) {
    throw new Error('.env.example 中的 OPENCODE_GO_API_KEY 必须为空')
  }
}

function main() {
  requireFile(petSource, `${pkg.version} 便携版桌宠`)

  const names = [
    '【先看】3分钟使用说明.txt',
    '【先看】完整使用流程.txt',
    '隐私与安全说明-外部监听器版.txt',
    '第三方监听器下载说明.txt',
    '下载弹幕监听器.url',
    '角色与素材说明.txt',
    '仅启动莫宁桌宠.bat',
    '配置OpenCode Go密钥.bat',
  ]
  for (const name of names) requireFile(path.join(packagingDir, name), name)
  requireFile(path.join(root, '.env.example'), '.env.example')

  assertReleaseTarget(stageDir)
  assertReleaseTarget(zipPath)
  fs.rmSync(stageDir, { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
  fs.mkdirSync(stageDir, { recursive: true })

  fs.copyFileSync(petSource, path.join(stageDir, '莫宁桌宠.exe'))
  for (const name of names) {
    fs.copyFileSync(path.join(packagingDir, name), path.join(stageDir, name))
  }
  fs.copyFileSync(path.join(root, '.env.example'), path.join(stageDir, '.env.example'))

  scanPrivacy()

  const archive = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:MORNYE_STAGE_PATH, $env:MORNYE_ZIP_PATH, [IO.Compression.CompressionLevel]::Optimal, $true)",
  ], {
    env: { ...process.env, MORNYE_STAGE_PATH: stageDir, MORNYE_ZIP_PATH: zipPath },
    encoding: 'utf8',
  })
  if (archive.status !== 0) throw new Error(archive.stderr || archive.stdout || 'ZIP 压缩失败')

  console.log(`朋友版已生成：${packageName}.zip`)
  console.log(`文件数量：${collectFiles(stageDir).length}`)
  console.log('包内不含弹幕监听器、证书、日志、队列、房间号或本机路径。')
  console.log('隐私扫描通过：包内不含 API Key 或其他凭据。')
}

main()
