import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A relative import that points at nothing takes the whole host plugin down: `dsh-tavern (plugin) failed to import`
// leaves every client entry that injects a Tavern service pending, and the web boot dies with
// 「Failed to load plugins」. That already happened once when a merge kept `import ... from './image-asset-preset.js'`
// after the file itself was deleted. Reading the graph is cheap; booting the app is not.
const root = fileURLToPath(new URL('..', import.meta.url))
const tavern = path.join(root, 'tavern-plugin')

const SPECIFIER = /(?:^|[\s;{(])(?:import|export)\s[^'"();]*?from\s*['"](\.[^'"]*)['"]|(?:^|[\s;{(])import\s*\(\s*['"](\.[^'"]*)['"]|(?:^|[\s;{(])import\s*['"](\.[^'"]*)['"]/gu
const RESOLVABLE = ['', '.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs']

async function isFile(target) {
  try { return (await stat(target)).isFile() } catch { return false }
}

async function relativeImports(file) {
  const source = await readFile(file, 'utf8').catch(() => '')
  const found = new Set()
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] || match[2] || match[3]
    // `?raw`-style suffixes and type-only `.ts` imports belong to sources that are built, not loaded here.
    if (specifier && !specifier.includes('?') && !specifier.endsWith('.ts')) found.add(specifier)
  }
  return [...found]
}

async function resolveRelative(file, specifier) {
  const target = path.resolve(path.dirname(file), specifier)
  for (const suffix of RESOLVABLE) if (await isFile(target + suffix)) return target + suffix
  return null
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // vendor/ is upstream code copied as-is: it keeps type-only `.ts` imports that its own build strips.
      if (['node_modules', 'assets', 'data', 'vendor'].includes(entry.name)) continue
      out.push(...await walk(full))
    } else if (/\.(?:mjs|cjs|js)$/u.test(entry.name) && !/\.(?:test|spec)\./u.test(entry.name)) out.push(full)
  }
  return out
}

// Every module the host or a bundled client loads at start: the plugin's own lib/, each package's lib/ and client
// half, plus the client bundle sources their build reads. A missing file anywhere here breaks the same boot.
async function startupModules() {
  const entries = new Set([
    path.join(tavern, 'lib/index.js'),
    path.join(tavern, 'lib/client.js'),
    ...await walk(path.join(tavern, 'lib')),
    ...await walk(path.join(tavern, 'packages'))
  ])
  return [...entries]
}

test('every relative import under the plugin resolves to a real file', async () => {
  const missing = []
  let checked = 0
  for (const file of await startupModules()) {
    for (const specifier of await relativeImports(file)) {
      checked++
      if (!await resolveRelative(file, specifier)) missing.push(path.relative(root, file) + ' -> ' + specifier)
    }
  }
  assert.ok(checked > 0, '扫描到了导入语句')
  assert.deepEqual(missing, [], '未解析的相对导入：\n' + missing.join('\n'))
})

test('the host entry names only files that exist, so the plugin can import', async () => {
  const entry = path.join(tavern, 'lib/index.js')
  assert.ok(existsSync(entry), '宿主入口存在')
  const importers = (await relativeImports(entry)).filter(specifier => specifier.endsWith('.js'))
  assert.ok(importers.length > 50, '宿主入口的相对导入都被读到')
  for (const specifier of importers) assert.ok(await resolveRelative(entry, specifier), '缺少 ' + specifier)
})

test('the asset templates the host reads at request time ship with the plugin', async () => {
  const templates = path.join(tavern, 'presets/asset-gen/templates')
  const names = await readdir(templates).catch(() => [])
  assert.ok(names.length > 0, '素材模板目录存在：' + templates)
  for (const name of names) assert.match(name, /\.md$/u)
})
