#!/usr/bin/env node
// 原生 APK 的应用内更新工具，由 TavernService 用 libnode.so 调用（主机上也能跑，便于测试）。
//   fingerprint <src>                         打印依赖指纹
//   check    --root <t> [--apk-version-code N] 对比运行清单与 APK 发布信息，打印 RESULT {...}
//   stage    --root <t>                       下载新源码到 <t>/src.next，判断依赖与 DSH 运行时是否变化
//   swap     --root <t> [--copy-modules]      （服务已停）src.next 换上，旧的留作 src.prev
//   backup   --root <t> [--modules]           （服务已停）备份 profile 配置；--modules 连 node_modules 一起备份
//   install  --root <t>                       （服务已停）与命令行版 install.sh 相同的两步：根依赖 + 酒馆安装器
//   commit   --root <t>                       更新成功：删掉备份和 pnpm 临时 store
//   rollback --root <t>                       更新失败：换回 src.prev 与备份的 profile
// 只有 DSH 运行时（config/cli-runtime）变了才需要换 APK；其余依赖变化由 APK 自带的 pnpm 在手机上补装，
// 已装好的包直接复用，只下载新增或变化的包。
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// 与本文件放在一起（APK 里是 usr/lib/dsh-android/）；仓库内直跑时退回 bin/download.cjs。
const downloader = () => {
  try { return require('./download.cjs') } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') return require('../../../bin/download.cjs')
    throw error
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'pnpm', 'dsh', 'engines', 'overrides']
const RUNTIME_FILES = ['config/cli-runtime/package.json', 'config/cli-runtime/package-lock.json']
const DEP_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tavern-plugin/pnpm-lock.yaml', ...RUNTIME_FILES, 'config/dsh-compatibility.json']
// 不在运行清单里、由安装过程生成的内容：换源码时从旧目录带过来。
const PRESERVE = ['.dsh-tavern-local.json', 'node_modules', 'tavern-plugin/node_modules']
const MARKER = '.native-source.json'
const PROFILE = 'home/.dsh-tavern/profiles/tavern'
const CONFIG_BACKUPS = ['home/.dsh-tavern/settings.yaml', `${PROFILE}/cordis.patch.yml`, `${PROFILE}/package.json`,
  `${PROFILE}/pnpm-lock.yaml`, `${PROFILE}/pnpm-workspace.yaml`, `${PROFILE}/patches`]

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const exists = file => stat(file).then(() => true, () => false)
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

async function depFields(file) {
  try {
    const doc = await readJson(file)
    return JSON.stringify(Object.fromEntries(DEP_FIELDS.filter(key => doc[key] !== undefined).map(key => [key, doc[key]])))
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent'
    throw error
  }
}
async function fileHash(file) {
  try { return sha256(await readFile(file)) } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error }
}
async function listDir(dir) {
  try { return (await readdir(dir, { withFileTypes: true })) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function packageDirs(src) {
  return (await listDir(path.join(src, 'tavern-plugin/packages'))).filter(e => e.isDirectory()).map(e => `tavern-plugin/packages/${e.name}`).sort()
}
async function patchFiles(src) {
  return (await listDir(path.join(src, 'patches'))).filter(e => e.isFile()).map(e => `patches/${e.name}`).sort()
}

/** 依赖指纹：锁文件、各 package.json 的依赖字段、补丁、DSH 版本约束。变了就要在手机上补装依赖。 */
export async function fingerprint(src) {
  const parts = []
  for (const rel of ['package.json', 'tavern-plugin/package.json']) parts.push(`${rel} ${await depFields(path.join(src, rel))}`)
  for (const dir of await packageDirs(src)) parts.push(`${dir}/package.json ${await depFields(path.join(src, dir, 'package.json'))}`)
  for (const rel of [...DEP_FILES, ...await patchFiles(src)]) parts.push(`${rel} ${await fileHash(path.join(src, rel))}`)
  return sha256(parts.join('\n'))
}

/** DSH 运行时指纹：变了只能换 APK（运行时约 680 个包、带 bionic 替身，不在手机上重装）。 */
export async function runtimeFingerprint(src) {
  const parts = []
  for (const rel of RUNTIME_FILES) parts.push(`${rel} ${await fileHash(path.join(src, rel))}`)
  return sha256(parts.join('\n'))
}

async function preservePaths(src) {
  return [...PRESERVE, ...(await packageDirs(src)).map(dir => `${dir}/node_modules`)]
}

function options(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    else out._.push(argv[i])
  }
  return out
}
const status = message => console.log(`DSH_STATUS ${message}`)
const result = value => console.log(`RESULT ${JSON.stringify(value)}`)

function endpoints(current) {
  const branch = current.branch || 'main'
  const customCdn = process.env.DSH_TAVERN_CDN_METADATA_URL || ''
  const customGithub = process.env.DSH_TAVERN_GITHUB_METADATA_URL || ''
  return {
    // 主源与酒馆内置更新器一致：先读 GitHub raw 运行清单（无 jsDelivr 分发分支缓存滞后），
    // 失败时再回退到 jsDelivr。若调用方只显式覆盖了 CDN 清单（本地冒烟测试），则只用该地址。
    githubMetadataUrl: customGithub || (customCdn ? '' : `https://raw.githubusercontent.com/flizzywine/dsh-tavern/${branch}/dsh-tavern-runtime.json`),
    metadataUrl: customCdn || `https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-${branch}/dsh-tavern-runtime.json`,
    rootUrl: (process.env.DSH_TAVERN_CDN_ROOT_URL || 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern').replace(/\/+$/, ''),
    exact: Boolean(customCdn),
    // 原生版安装包随酒馆版本一起发布：资产放在仓库「最新 Release」（如 v3.4）里。
    apkFeed: process.env.DSH_NATIVE_APK_FEED || 'https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-native.json',
  }
}

function validateManifest(manifest) {
  if (!/^[0-9a-f]{40}$/i.test(String(manifest?.revision || ''))) throw new Error('运行清单缺少有效提交号')
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) throw new Error('运行清单未包含文件列表')
  return manifest
}

export async function readLatestManifest(urls, { fetch: request = fetch, readCdnManifest, status: report = status, githubTimeoutMs = 8000 } = {}) {
  let githubError = null
  if (urls.githubMetadataUrl) {
    try {
      const response = await request(urls.githubMetadataUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(githubTimeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const manifest = validateManifest(await response.json())
      return { manifest, checkSource: 'github-manifest' }
    } catch (error) {
      githubError = String(error?.message || error)
    }
  }
  const readCdn = readCdnManifest || (() => downloader().readManifest({
    metadataUrl: urls.metadataUrl, exact: urls.exact, stallMs: 15000, attempts: 2, status: report,
  }))
  try {
    const manifest = validateManifest(await readCdn())
    return { manifest, checkSource: urls.githubMetadataUrl ? 'jsdelivr' : 'custom', ...(githubError ? { githubError } : {}) }
  } catch (cdnError) {
    const cdnMessage = downloader().describeFailure?.(cdnError) || String(cdnError?.message || cdnError)
    if (githubError) throw new Error(`GitHub 核实失败（${githubError}）；备用清单检查失败（${cdnMessage}）`)
    throw cdnError
  }
}

async function currentSource(root) {
  const marker = path.join(root, 'src', MARKER)
  if (!await exists(marker)) throw new Error('当前源码没有版本记录（src/' + MARKER + '），无法判断是否需要更新')
  const current = await readJson(marker)
  // 旧版安装包写的记录没有运行时指纹：按当前源码现算。
  if (!current.runtimeFingerprint) current.runtimeFingerprint = await runtimeFingerprint(path.join(root, 'src'))
  return current
}

async function apkRelease(feed, currentCode) {
  const response = await fetch(feed, { signal: AbortSignal.timeout(15000), redirect: 'follow', headers: { accept: 'application/json' } })
  if (response.status === 404) return { available: false, note: '还没有发布原生版安装包' }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const info = await response.json()
  for (const key of ['versionCode', 'versionName', 'url', 'sha256', 'size']) if (info[key] === undefined) throw new Error(`发布信息缺少 ${key}`)
  return { available: Number(info.versionCode) > Number(currentCode || 0), ...info, url: new URL(info.url, response.url || feed).href }
}

async function check(root, opts) {
  const current = await currentSource(root)
  const urls = endpoints(current)
  const out = { current, source: 'up-to-date' }
  try {
    const { manifest, checkSource } = await readLatestManifest(urls, { status })
    out.checkSource = checkSource
    out.latest = { revision: manifest.revision, sequence: Number(manifest.releaseSequence) || 0, version: manifest.version }
    if (out.latest.sequence > (Number(current.sequence) || 0) && manifest.revision !== current.revision) {
      // 预判：锁文件和补丁在清单里有摘要；package.json 的依赖字段要等下载后（stage）才能最终判定。
      const listed = new Map(manifest.files.map(file => [file.path, String(file.sha256).toLowerCase()]))
      const local = path.join(root, 'src')
      const patchPaths = new Set([...await patchFiles(local), ...[...listed.keys()].filter(p => p.startsWith('patches/'))])
      const changed = []
      for (const rel of [...DEP_FILES, ...patchPaths]) {
        if ((listed.get(rel) || 'absent') !== await fileHash(path.join(local, rel))) changed.push(rel)
      }
      out.source = changed.some(rel => RUNTIME_FILES.includes(rel)) ? 'needs-apk' : 'available'
      out.deps = changed.length > 0
      if (changed.length) out.depsChanged = changed
      else {
        // package.json 的依赖字段要下载后才能比；文件变了（也可能只是版本号）先标成「可能」。
        const manifests = ['package.json', 'tavern-plugin/package.json', ...(await packageDirs(local)).map(dir => `${dir}/package.json`),
          ...[...listed.keys()].filter(p => /^tavern-plugin\/packages\/[^/]+\/package\.json$/.test(p))]
        const touched = []
        for (const rel of new Set(manifests)) if ((listed.get(rel) || 'absent') !== await fileHash(path.join(local, rel))) touched.push(rel)
        if (touched.length) { out.deps = 'maybe'; out.depsChanged = touched }
      }
    }
    if (checkSource === 'jsdelivr') {
      out.checkWarning = out.source === 'up-to-date'
        ? 'GitHub 核实不可用；备用清单未显示更新构建，CDN 可能有数小时缓存延迟。'
        : 'GitHub 核实不可用；已通过备用清单发现较新构建。'
    }
  } catch (error) {
    out.source = 'error'
    out.sourceError = downloader().describeFailure?.(error) || String(error.message || error)
  }
  try {
    out.apk = await apkRelease(urls.apkFeed, opts['apk-version-code'])
  } catch (error) {
    out.apk = { available: false, error: String(error.message || error) }
  }
  result(out)
}

async function stage(root) {
  const current = await currentSource(root)
  const urls = endpoints(current)
  const src = path.join(root, 'src')
  const next = path.join(root, 'src.next')
  const { manifest: latest } = await readLatestManifest(urls, { status })
  const sequence = Number(latest.releaseSequence) || 0
  if (sequence <= (Number(current.sequence) || 0)) {
    return result({ kind: 'up-to-date', latest: { revision: latest.revision, sequence } })
  }
  await rm(next, { recursive: true, force: true })
  await mkdir(next, { recursive: true })
  const manifest = await downloader().downloadRuntime({ manifest: latest, metadataUrl: urls.metadataUrl, rootUrl: urls.rootUrl, destination: next, installed: src,
    exactManifest: urls.exact, stallMs: 30000, budgetMs: 600000, status })
  const runtimePrint = await runtimeFingerprint(next)
  if (runtimePrint !== current.runtimeFingerprint) {
    await rm(next, { recursive: true, force: true })
    return result({ kind: 'needs-apk', reason: '新版本更换了 DSH 运行时，需要安装新版安装包' })
  }
  const print = await fingerprint(next)
  const deps = print !== current.fingerprint
  await writeFile(path.join(next, MARKER), JSON.stringify({ revision: manifest.revision, sequence, version: manifest.version,
    fingerprint: print, runtimeFingerprint: runtimePrint, branch: current.branch || 'main', from: 'hot-update',
    previous: current.revision, depsUpdated: deps, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  result({ kind: 'staged', deps, latest: { revision: manifest.revision, sequence, version: manifest.version } })
}

/** 复制目录：优先用系统的 cp -a（大量小文件时比 fs.cp 快得多），失败再退回 fs.cp。 */
async function copyTree(from, to) {
  await rm(to, { recursive: true, force: true })
  await mkdir(path.dirname(to), { recursive: true })
  const r = spawnSync('cp', ['-a', from, to], { stdio: 'ignore' })
  if (r.status === 0) return
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true, verbatimSymlinks: true })
}

async function carryPreserved(from, to, copy) {
  for (const rel of await preservePaths(from)) {
    const source = path.join(from, rel), target = path.join(to, rel)
    if (!await exists(source) || await exists(target)) continue
    await mkdir(path.dirname(target), { recursive: true })
    if (copy && rel.endsWith('node_modules')) await copyTree(source, target)
    else if (copy) await cp(source, target, { recursive: true, verbatimSymlinks: true })
    else await rename(source, target)
  }
}

async function swap(root, opts) {
  const src = path.join(root, 'src'), next = path.join(root, 'src.next'), prev = path.join(root, 'src.prev')
  if (!await exists(path.join(next, MARKER))) throw new Error('没有已下载完成的新源码')
  // 依赖要变：node_modules 复制一份给新源码，旧源码保持完整，失败时能原样换回。
  await carryPreserved(src, next, Boolean(opts['copy-modules']))
  await rm(prev, { recursive: true, force: true })
  await rename(src, prev)
  await rename(next, src)
  result({ kind: 'swapped', source: await readJson(path.join(src, MARKER)) })
}

async function backup(root, opts) {
  const dir = path.join(root, 'update-backup')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const saved = []
  for (const rel of CONFIG_BACKUPS) {
    const source = path.join(root, rel)
    if (!await exists(source)) continue
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await cp(source, path.join(dir, rel), { recursive: true, verbatimSymlinks: true })
    saved.push(rel)
  }
  if (opts.modules) {
    status('正在备份已装好的依赖')
    await copyTree(path.join(root, PROFILE, 'node_modules'), path.join(dir, PROFILE, 'node_modules'))
    saved.push(`${PROFILE}/node_modules`)
  }
  await writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved))
  result({ kind: 'backed-up', saved })
}

/** 跑一个子进程，输出写进日志；pnpm / 安装器的进度行转成 DSH_STATUS 给启动页显示。 */
function runLogged(label, command, args, { cwd, env, log }) {
  return new Promise((resolve, reject) => {
    log.write(`\n$ ${label}: ${command} ${args.join(' ')}\n`)
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail = []
    const onData = chunk => {
      log.write(chunk)
      for (const line of String(chunk).split(/\r?\n/)) {
        const text = line.replace(/\u001b\[[0-9;]*m/g, '').trim()
        if (!text) continue
        tail.push(text)
        if (tail.length > 30) tail.shift()
        const progress = text.match(/^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/)
        if (progress) status(`${label}：已解析 ${progress[1]}，下载 ${progress[3]} 个包，新增 ${progress[4]}`)
        else if (/^(已|正在|复用|内置|Packages:)/.test(text)) status(`${label}：${text.slice(0, 80)}`)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label}失败（退出码 ${code}）：${tail.slice(-6).join(' / ')}`)))
  })
}

async function install(root) {
  const src = path.join(root, 'src')
  const home = path.join(root, 'home', '.dsh-tavern')
  const pnpm = process.env.DSH_ANDROID_PNPM_CLI || path.join(HERE, 'pnpm', 'bin', 'pnpm.cjs')
  const store = path.join(root, 'pnpm-store')
  const logs = path.join(root, '..', 'logs')
  await mkdir(logs, { recursive: true })
  // node_modules 是在打包机上装的，.modules.yaml 记着那边的 store 路径；不一致时 pnpm 会清空整个目录重装。
  // 改成本机 store：已装的包按原样复用，只下载新增和变化的包。
  const moduleDirs = [path.join(src, 'node_modules'), path.join(src, 'tavern-plugin', 'node_modules'), path.join(root, PROFILE, 'node_modules'),
    ...(await packageDirs(src)).map(dir => path.join(src, dir, 'node_modules'))]
  for (const dir of moduleDirs) {
    const file = path.join(dir, '.modules.yaml')
    try {
      const doc = await readJson(file)
      if (doc.storeDir !== path.join(store, 'v11')) await writeFile(file, JSON.stringify({ ...doc, storeDir: path.join(store, 'v11') }, null, 2))
    } catch {}
  }
  const log = createWriteStream(path.join(logs, 'update.log'))
  // 与命令行版的 pnpm 设置一致；Android 不能建硬链接，改成复制；不运行第三方安装脚本。
  // 预加载（APK 里与本文件同目录）经 NODE_OPTIONS 传给安装器、pnpm、DSH 版本探测等所有 node 子进程。
  const preload = process.env.DSH_ANDROID_PRELOAD ?? path.join(HERE, 'preload.cjs')
  const nodeOptions = [process.env.NODE_OPTIONS, preload && await exists(preload) ? `--require ${preload}` : ''].filter(Boolean).join(' ')
  const pnpmConfig = { ignore_scripts: 'true', package_import_method: 'copy', store_dir: store, cache_dir: path.join(root, 'pnpm-cache'),
    update_notifier: 'false', confirm_modules_purge: 'false',
    // 缓存里有满足版本要求的元数据就不再联网（APK 打包时预置了一份）；缺了才去镜像取。
    prefer_offline: 'true', registry: process.env.DSH_TAVERN_NPM_REGISTRY || 'https://registry.npmmirror.com/' }
  // pnpm 11 只读 pnpm_config_*；npm_config_* 留给 npm（安装器在运行时缺失时会用 npm 装 DSH）。
  const env = { ...process.env,
    ...Object.fromEntries(Object.entries(pnpmConfig).flatMap(([key, value]) => [[`pnpm_config_${key}`, value], [`npm_config_${key}`, value]])),
    DSH_ANDROID_PNPM_CLI: pnpm, NODE_OPTIONS: nodeOptions,
    DSH_TAVERN_CLI_HOME: home, DSH_HOME: home, DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_NO_OPEN: '1', DSH_TAVERN_MOBILE_LAYOUT: '1' }
  const started = Date.now()
  try {
    status('正在更新根依赖')
    // 平台参数与打包时一致（stage-payload.sh）：sharp 只装 wasm 版，其余平台预编译一律跳过。
    await runLogged('根依赖', process.execPath, [pnpm, '--dir', src, 'install', '--prod', '--frozen-lockfile', '--ignore-scripts',
      '--os=android', '--cpu=arm64', '--cpu=x64', '--cpu=wasm32', '--config.minimum-release-age=0', '--reporter=append-only'], { cwd: src, env, log })
    status('正在运行酒馆安装器')
    await runLogged('安装器', process.execPath, [path.join(src, 'bin', 'dsh-tavern.mjs'), 'install', '--host', 'cli'], { cwd: src, env, log })
  } finally {
    await new Promise(resolve => log.end(resolve))
  }
  result({ kind: 'installed', ms: Date.now() - started })
}

async function commit(root) {
  for (const dir of ['update-backup', 'src.prev', 'pnpm-store']) await rm(path.join(root, dir), { recursive: true, force: true })
  result({ kind: 'committed' })
}

async function rollback(root) {
  const src = path.join(root, 'src'), prev = path.join(root, 'src.prev'), bad = path.join(root, 'src.bad')
  if (!await exists(path.join(prev, MARKER))) throw new Error('没有可回退的上一版源码')
  await carryPreserved(src, prev, false)
  await rm(bad, { recursive: true, force: true })
  await rename(src, bad)
  await rename(prev, src)
  await rm(bad, { recursive: true, force: true })
  const dir = path.join(root, 'update-backup')
  const restored = []
  if (await exists(path.join(dir, 'saved.json'))) {
    for (const rel of await readJson(path.join(dir, 'saved.json'))) {
      const target = path.join(root, rel)
      await rm(target, { recursive: true, force: true })
      await rename(path.join(dir, rel), target)
      restored.push(rel)
    }
    await rm(dir, { recursive: true, force: true })
  }
  await rm(path.join(root, 'pnpm-store'), { recursive: true, force: true })
  result({ kind: 'rolled-back', restored, source: await readJson(path.join(src, MARKER)) })
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const opts = options(rest)
  if (command === 'fingerprint') return console.log(await fingerprint(opts._[0]))
  if (command === 'runtime-fingerprint') return console.log(await runtimeFingerprint(opts._[0]))
  const root = opts.root
  if (!root) throw new Error('缺少 --root')
  if (command === 'check') return check(root, opts)
  if (command === 'stage') return stage(root)
  if (command === 'swap') return swap(root, opts)
  if (command === 'backup') return backup(root, opts)
  if (command === 'install') return install(root)
  if (command === 'commit') return commit(root)
  if (command === 'rollback') return rollback(root)
  throw new Error('未知命令：' + command)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('source-update.mjs')) {
  main().catch(error => { result({ kind: 'error', error: String(error.message || error) }); process.exitCode = 1 })
}
