import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 更新时源码目录会整体换掉，只有 node_modules 会被搬过来（见 android/setup.sh）。
// pnpm 自己在 node_modules/.pnpm/lock.yaml 里留了一份安装时的 lockfile，正常情况下
// 比较它就够；但这份文件在复制/中断的安装里可能缺失，旧版安装器根本没写过它。
// 缺了就用 lockfile 逐项核对 node_modules 是否真的装到位，而不是一律重装 287 个包。
const DEPENDENCY_SECTIONS = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])
const PEER_SUFFIX = /\(.*$/

function unquote(value) {
  const text = value.trim()
  if (text.length >= 2 && (text[0] === "'" || text[0] === '"') && text.at(-1) === text[0]) return text.slice(1, -1)
  return text
}

// pnpm-lock.yaml 只有 importers 这一段和节点安装有关：它记录了每个工作区包直接依赖的
// 解析结果。lockfile 由 pnpm 自己写出，格式稳定（v9），这里只按缩进读这一小段。
export function readImporterDependencies(lockfileText) {
  const importers = new Map()
  let inImporters = false
  let importer = ''
  let section = ''
  let dependency = ''
  for (const line of lockfileText.split(/\r?\n/)) {
    const text = line.trim()
    if (text === '' || text.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inImporters = text === 'importers:'
      importer = section = dependency = ''
      continue
    }
    if (!inImporters) continue
    if (indent === 2) {
      importer = unquote(text.replace(/:\s*$/, ''))
      section = dependency = ''
      if (importer !== '') importers.set(importer, new Map())
      continue
    }
    if (importer === '') continue
    if (indent === 4) {
      section = text.replace(/:\s*$/, '')
      dependency = ''
      continue
    }
    if (!DEPENDENCY_SECTIONS.has(section)) continue
    const entry = importers.get(importer)
    if (indent === 6) {
      dependency = unquote(text.replace(/:\s*$/, ''))
      if (dependency !== '') entry.set(dependency, { name: dependency, version: '', optional: section === 'optionalDependencies' })
      continue
    }
    if (indent === 8 && dependency !== '' && text.startsWith('version:')) {
      entry.get(dependency).version = unquote(text.slice('version:'.length))
    }
  }
  return importers
}

// 锁文件里的版本可能带 peer 后缀（1.2.3(react@19.2.0)）或是 npm 别名（bar@1.2.3）。
export function resolvedVersion(value) {
  const text = String(value || '').trim()
  if (text === '' || text.startsWith('link:')) return ''
  const withoutPeers = text.replace(PEER_SUFFIX, '')
  const at = withoutPeers.lastIndexOf('@')
  return at > 0 ? withoutPeers.slice(at + 1) : withoutPeers
}

function installedVersion(directory) {
  try {
    if (!statSync(directory).isDirectory() && !statSync(directory).isSymbolicLink()) return null
  } catch { return null }
  try { return String(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).version || '') } catch { return null }
}

export function checkDependencyTree(sourceRoot) {
  let lockfileText
  try { lockfileText = readFileSync(path.join(sourceRoot, 'pnpm-lock.yaml'), 'utf8') } catch { return { complete: false, reason: '缺少 pnpm-lock.yaml', checked: 0 } }
  const importers = readImporterDependencies(lockfileText)
  if (importers.size === 0) return { complete: false, reason: 'pnpm-lock.yaml 里没有 importers', checked: 0 }
  const missing = []
  const mismatched = []
  let checked = 0
  for (const [importer, dependencies] of importers) {
    const nodeModules = path.join(sourceRoot, importer, 'node_modules')
    for (const dependency of dependencies.values()) {
      checked += 1
      const directory = path.join(nodeModules, dependency.name)
      const expected = resolvedVersion(dependency.version)
      const found = installedVersion(directory)
      if (found === null) {
        if (!dependency.optional && !String(dependency.version).startsWith('link:')) missing.push(`${importer === '.' ? '' : importer + '/'}${dependency.name}`)
        continue
      }
      if (expected !== '' && found !== expected) mismatched.push(`${importer === '.' ? '' : importer + '/'}${dependency.name}（需要 ${expected}，实装 ${found || '未知'}）`)
    }
  }
  if (missing.length || mismatched.length) {
    const parts = []
    if (missing.length) parts.push(`缺少 ${missing.length} 个包：${missing.slice(0, 5).join('、')}`)
    if (mismatched.length) parts.push(`版本不符 ${mismatched.length} 个：${mismatched.slice(0, 5).join('、')}`)
    return { complete: false, reason: parts.join('；'), checked, missing, mismatched }
  }
  return { complete: true, checked }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDependencyTree(path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')))
  if (!result.complete) {
    console.error(`依赖按 lockfile 核对未通过：${result.reason}`)
    process.exit(1)
  }
  console.log(`依赖按 lockfile 核对通过（${result.checked} 项）`)
}
