#!/usr/bin/env node
// 原生 APK 的源码热更新工具，由 TavernService 用 libnode.so 调用（主机上也能跑，便于测试）。
//   fingerprint <src>                                   打印依赖指纹
//   check  --root <t> [--apk-version-code N]            对比运行清单与 APK 发布信息，打印 RESULT {...}
//   stage  --root <t>                                   下载新源码到 <t>/src.next 并校验依赖没变，打印 RESULT {...}
//   swap   --root <t>                                   （服务已停）src.next 换上，旧的留作 src.prev
//   rollback --root <t>                                 （服务已停）换回 src.prev
// 只有依赖（锁文件、package.json 的依赖字段、补丁、DSH 版本约束）不变时才热更新源码；
// 依赖变了必须换 APK：APK 里的 node_modules 是打包时装好的，设备上没有 npm/pnpm。
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// 与本文件放在一起（APK 里是 usr/lib/dsh-android/）；指纹计算不需要它，按需加载。
const downloader = () => require('./download.cjs')

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'pnpm', 'dsh', 'engines', 'overrides']
const DEP_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tavern-plugin/pnpm-lock.yaml', 'config/cli-runtime/package.json',
  'config/cli-runtime/package-lock.json', 'config/dsh-compatibility.json']
// 不在运行清单里、由安装器生成的内容：换源码时从旧目录搬过来。
const PRESERVE = ['.dsh-tavern-local.json', 'tavern-plugin/node_modules']
const MARKER = '.native-source.json'

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

/** 依赖指纹：决定这份源码能否直接跑在 APK 打包时装好的依赖上。 */
export async function fingerprint(src) {
  const parts = []
  for (const rel of ['package.json', 'tavern-plugin/package.json']) parts.push(`${rel} ${await depFields(path.join(src, rel))}`)
  for (const dir of await packageDirs(src)) parts.push(`${dir}/package.json ${await depFields(path.join(src, dir, 'package.json'))}`)
  for (const rel of [...DEP_FILES, ...await patchFiles(src)]) parts.push(`${rel} ${await fileHash(path.join(src, rel))}`)
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
  return {
    metadataUrl: process.env.DSH_TAVERN_CDN_METADATA_URL || `https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-${branch}/dsh-tavern-runtime.json`,
    rootUrl: (process.env.DSH_TAVERN_CDN_ROOT_URL || 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern').replace(/\/+$/, ''),
    exact: Boolean(process.env.DSH_TAVERN_CDN_METADATA_URL),
    apkFeed: process.env.DSH_NATIVE_APK_FEED || 'https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-native.json',
  }
}

async function currentSource(root) {
  const marker = path.join(root, 'src', MARKER)
  if (!await exists(marker)) throw new Error('当前源码没有版本记录（src/' + MARKER + '），无法判断是否需要更新')
  return readJson(marker)
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
    const manifest = await downloader().readManifest({ metadataUrl: urls.metadataUrl, exact: urls.exact, stallMs: 15000, attempts: 2, status })
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
      out.source = changed.length ? 'needs-apk' : 'available'
      if (changed.length) out.depsChanged = changed
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
  await rm(next, { recursive: true, force: true })
  await mkdir(next, { recursive: true })
  const manifest = await downloader().downloadRuntime({ metadataUrl: urls.metadataUrl, rootUrl: urls.rootUrl, destination: next, installed: src,
    exactManifest: urls.exact, stallMs: 30000, budgetMs: 600000, status })
  const sequence = Number(manifest.releaseSequence) || 0
  if (sequence <= (Number(current.sequence) || 0)) {
    await rm(next, { recursive: true, force: true })
    return result({ kind: 'up-to-date', latest: { revision: manifest.revision, sequence } })
  }
  const print = await fingerprint(next)
  if (print !== current.fingerprint) {
    await rm(next, { recursive: true, force: true })
    return result({ kind: 'needs-apk', reason: '新版本的依赖有变化，需要安装新版安装包' })
  }
  await writeFile(path.join(next, MARKER), JSON.stringify({ revision: manifest.revision, sequence, version: manifest.version,
    fingerprint: print, branch: current.branch || 'main', from: 'hot-update', previous: current.revision, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  result({ kind: 'staged', latest: { revision: manifest.revision, sequence, version: manifest.version } })
}

async function movePreserved(from, to) {
  for (const rel of await preservePaths(from)) {
    const source = path.join(from, rel), target = path.join(to, rel)
    if (!await exists(source) || await exists(target)) continue
    await mkdir(path.dirname(target), { recursive: true })
    await rename(source, target)
  }
}

async function swap(root) {
  const src = path.join(root, 'src'), next = path.join(root, 'src.next'), prev = path.join(root, 'src.prev')
  if (!await exists(path.join(next, MARKER))) throw new Error('没有已下载完成的新源码')
  await movePreserved(src, next)
  await rm(prev, { recursive: true, force: true })
  await rename(src, prev)
  await rename(next, src)
  result({ kind: 'swapped', source: await readJson(path.join(src, MARKER)) })
}

async function rollback(root) {
  const src = path.join(root, 'src'), prev = path.join(root, 'src.prev'), bad = path.join(root, 'src.bad')
  if (!await exists(path.join(prev, MARKER))) throw new Error('没有可回退的上一版源码')
  await movePreserved(src, prev)
  await rm(bad, { recursive: true, force: true })
  await rename(src, bad)
  await rename(prev, src)
  await rm(bad, { recursive: true, force: true })
  result({ kind: 'rolled-back', source: await readJson(path.join(src, MARKER)) })
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const opts = options(rest)
  if (command === 'fingerprint') return console.log(await fingerprint(opts._[0]))
  const root = opts.root
  if (!root) throw new Error('缺少 --root')
  if (command === 'check') return check(root, opts)
  if (command === 'stage') return stage(root)
  if (command === 'swap') return swap(root)
  if (command === 'rollback') return rollback(root)
  throw new Error('未知命令：' + command)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('source-update.mjs')) {
  main().catch(error => { result({ kind: 'error', error: String(error.message || error) }); process.exitCode = 1 })
}
