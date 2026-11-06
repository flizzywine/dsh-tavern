// Compatibility only: Windows install.ps1 copies from 1f049ddb..b7a48102 (2026-09-22..10-01),
// already on users' machines and inside Setup EXEs of that period, require and run this file.
// Current installers use Desktop's own pnpm and never call it. Keep until those installs have updated.
import { desktopHostAnchors } from './desktop-host-paths.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NODE_VERSION = '22.22.3'
// Official https://nodejs.org/dist/v22.22.3/SHASUMS256.txt
const hashes = { x64: '780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b', arm64: '65044d409333b941086486545992141d1145198d7f0e0fc0c3bf62080fd8ee51' }
// Sibling file both in the repository bin/ and beside the Windows runtime copy.
const { download } = createRequire(import.meta.url)('./download.cjs')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function prepareDesktopPackageManager(options = {}) {
  const platform = options.platform || process.platform
  const host = options.host || process.env.DSH_TAVERN_HOST || process.env.DSH_TAVERN_RUNTIME_HOST
  if (platform !== 'win32' || host !== 'desktop') return null
  const env = options.env || process.env
  const arch = options.arch || process.arch
  if (!hashes[arch]) throw new Error(`不支持的 Windows 包管理架构：${arch}`)
  const home = options.home || env.DSH_HOME
  if (!home || !path.isAbsolute(home)) throw new Error('Desktop 包管理需要明确的 DSH_HOME')
  const executable = env.DSH_DESKTOP_APP_EXECUTABLE || process.execPath
  const unpack = value => value.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const anchors = [
    path.join(path.dirname(executable), 'resources/app/package.json'),
    path.join(path.dirname(executable), 'resources/app.asar.unpacked/package.json'),
    ...(env.DSH_DESKTOP_DSH_BOOTSTRAP ? [unpack(env.DSH_DESKTOP_DSH_BOOTSTRAP)] : []),
  ]
  // The detached updater may run under system Node without Desktop terminal
  // variables. Follow the existing host link, not an unrelated global pnpm.
  const dependencyAnchor = env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR || fileURLToPath(new URL('../tavern-plugin/lib/index.js', import.meta.url))
  anchors.push(dependencyAnchor)
  const candidates = env.DSH_DESKTOP_PNPM_ENTRY ? [unpack(env.DSH_DESKTOP_PNPM_ENTRY)] : []
  for (const anchor of new Set(anchors.flatMap(desktopHostAnchors))) {
    for (const directory of createRequire(anchor).resolve.paths('pnpm') || []) {
      const root = path.join(directory, 'pnpm')
      try {
        const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
        if (manifest.name === 'pnpm' && bin) candidates.push(path.resolve(root, bin))
      } catch {}
      // Older Desktop bundles may omit package metadata after packaging.
      candidates.push(path.join(root, 'bin/pnpm.mjs'), path.join(root, 'bin/pnpm.cjs'))
    }
  }
  const entry = options.entry || candidates.find(existsSync)
  if (!entry || !existsSync(entry)) throw new Error('找不到当前 Desktop 自带的 pnpm，请从该 Desktop 的 DSH Terminal 运行安装。')
  const root = path.join(home, 'tools', 'desktop-package-manager')
  const bin = path.join(root, 'bin')
  const nodeDir = path.join(root, `node-v${PACKAGE_NODE_VERSION}-${arch}`)
  const node = path.join(nodeDir, 'node.exe')
  await mkdir(bin, { recursive: true }); await mkdir(nodeDir, { recursive: true })
  let valid = false
  try { valid = digest(await readFile(node)) === hashes[arch] } catch {}
  if (!valid) {
    let bytes
    const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
    const localNodes = new Set([process.execPath, env.NODE,
      ...searchPath.split(';').filter(Boolean).map(directory => path.join(directory.replace(/^"|"$/g, ''), 'node.exe')),
    ].filter(Boolean))
    for (const candidate of localNodes) {
      try {
        const localBytes = await readFile(candidate)
        if (digest(localBytes) !== hashes[arch]) continue
        bytes = localBytes
        options.onProgress?.(`已校验并复用本机 Windows 更新运行环境：${candidate}`)
        break
      } catch {}
    }
    // The mirror is usually much faster from mainland China; SHA-256 makes either source safe.
    const urls = [
      `https://npmmirror.com/mirrors/node/v${PACKAGE_NODE_VERSION}/win-${arch}/node.exe`,
      `https://nodejs.org/dist/v${PACKAGE_NODE_VERSION}/win-${arch}/node.exe`,
    ]
    if (!bytes) {
      let reportedAt = 0
      bytes = (await download(urls, {
        label: 'Windows 更新运行环境', sha256: hashes[arch], attempts: 3, stallMs: 30000, deadlineMs: 30 * 60000, fetch: options.fetch,
        onAttempt: ({ host, attempt, attempts }) => options.onProgress?.(`正在下载 Windows 更新运行环境（${attempt}/${attempts}）：${host}`),
        onProgress: ({ host, received, total }) => {
          if (Date.now() - reportedAt < 500 && received !== total) return
          reportedAt = Date.now()
          options.onProgress?.(`下载更新运行环境（${host}）：已下载 ${(received / 1048576).toFixed(1)}${total > 0 ? ' / ' + (total / 1048576).toFixed(1) : ''} MB`)
        },
        onRetry: ({ host, reason, willRetry }) => options.onProgress?.(`更新运行环境下载失败（${host}）：${reason}；${willRetry ? '正在切换或重试下载源' : '已停止，请检查网络后重试'}。`),
      })).bytes
    }
    if (digest(bytes) !== hashes[arch]) throw new Error('Windows 更新运行环境 SHA-256 校验失败，已停止安装')
    const temporary = node + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, bytes); await rename(temporary, node) }
    finally { await rm(temporary, { force: true }) }
  }
  const runner = `const path=require('node:path');\nconst entry=${JSON.stringify(entry)};\nfor(const key of Object.keys(process.env))if(key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete process.env[key];\nprocess.env.NODE=process.execPath;\nconst key=Object.keys(process.env).find(k=>k.toLowerCase()==='path')||'PATH';\nprocess.env[key]=path.dirname(process.execPath)+';'+(process.env[key]||'');\nprocess.env.npm_config_runtime='electron';\n${process.versions.electron ? `process.env.npm_config_target=${JSON.stringify(process.versions.electron)};\n` : ''}process.env.npm_config_disturl='https://electronjs.org/headers';\nprocess.argv=[process.execPath,entry,'--config.minimumReleaseAge=0',...process.argv.slice(2)];\nimport(require('node:url').pathToFileURL(entry).href).catch(e=>{console.error(e);process.exitCode=1});\n`
  await writeFile(path.join(bin, 'pnpm-runner.cjs'), runner)
  await writeFile(path.join(bin, 'pnpm.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE="\r\n"%~dp0..\\node-v${PACKAGE_NODE_VERSION}-${arch}\\node.exe" "%~dp0pnpm-runner.cjs" %*\r\nexit /b %errorlevel%\r\n`)
  return { bin, node, runner: path.join(bin, 'pnpm-runner.cjs') }
}

// Installers run this from a temp directory whose path may be a symlink (macOS
// /var -> /private/var); compare real paths or the command silently does nothing.
let isEntryPoint = false
try { isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (isEntryPoint) {
  try {
    const result = await prepareDesktopPackageManager({ onProgress: message => console.error("DSH_STATUS " + message) })
    if (result) console.log(result.bin)
  } catch (error) { console.error(error); process.exitCode = 1 }
}
