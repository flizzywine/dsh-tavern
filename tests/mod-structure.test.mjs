// The mechanical half of docs/mod-authoring.md: every stage mod is one folder tavern-plugin/mods/<name>/ with one
// manifest, its own Skill reference and tests, and it reaches the stage and the host only through declared seams.
// PENDING lists today's known deviations (the migration in docs/mod-authoring.md §迁移). It only shrinks: a new
// deviation fails, and an entry that no longer deviates fails until it is removed from the list.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDistributionManifest } from '../tavern-plugin/lib/domain/mod-system.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const modsRoot = path.join(root, 'tavern-plugin/mods')
const skillRoot = path.join(root, 'presets/tavern/skills/stage-mods')
const posix = file => path.relative(root, file).split(path.sep).join('/')
const exists = file => stat(file).then(() => true, () => false)

// rule:subject. Rules: manifest (mod.json missing or invalid), legacy-manifest (a second manifest.json), skill (no
// references/<name>.md or no index line), import-out (a mod file imports outside its folder), import-in (code outside
// mods/ imports a mod file), names-mod (code outside mods/ names a first-party mod id), names-part (code outside mods/
// names a client part a mod registers in client/core.js).
const PENDING = new Set([
  'legacy-manifest:dice', 'legacy-manifest:phone', 'legacy-manifest:textcard', 'legacy-manifest:timer',
  'skill:dice', 'skill:phone', 'skill:textcard', 'skill:timer',
  'import-out:tavern-plugin/mods/phone/call-context.js', 'import-out:tavern-plugin/mods/phone/call.js',
  'import-out:tavern-plugin/mods/phone/stage.js',
  'import-in:tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js',
  'import-in:tavern-plugin/packages/dsh-tavern-stage/lib/mods/phone/host.js',
  'import-in:tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js',
  'names-mod:tavern-plugin/lib/domain/user-plugin-install.js',
  'names-mod:tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js',
  'names-mod:tavern-plugin/packages/dsh-tavern-stage/lib/mods/phone/host.js',
  'names-mod:tavern-plugin/packages/dsh-tavern-stage/src/client/phone-layout.cjs',
  'names-mod:tavern-plugin/packages/dsh-tavern-stage/src/client/source-widgets.cjs',
  'names-mod:tavern-plugin/packages/dsh-tavern-stage/src/client/widgets.cjs',
  'names-mod:tavern-plugin/src/client/asset-pack-ui.js', 'names-mod:tavern-plugin/src/client/mod-config-pages.js',
  'names-mod:tavern-plugin/src/client/mod-page.js', 'names-mod:tavern-plugin/src/client/phone-beat.cjs',
])

async function walk(directory, skip) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (skip(posix(full) + (entry.isDirectory() ? '/' : ''))) continue
    if (entry.isDirectory()) files.push(...await walk(full, skip))
    else if (/\.(c|m)?js$|\.css$/.test(entry.name)) files.push(full)
  }
  return files
}

// Relative module specifiers: import/export from, dynamic import(), require(), new URL(), and client `// @include`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bnew URL\s*\(\s*|@include(?:-protocol)?\s+)['"]?(\.{1,2}\/[^'"\s)]+)/g
const specifiers = text => [...text.matchAll(SPECIFIER)].map(match => match[1])

const names = (await readdir(modsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
const found = new Set()

test('each mod folder has one valid mod.json whose id, package and entry match the folder', async () => {
  for (const name of names) {
    const folder = path.join(modsRoot, name)
    if (await exists(path.join(folder, 'manifest.json'))) found.add('legacy-manifest:' + name)
    const text = await readFile(path.join(folder, 'mod.json'), 'utf8').catch(() => null)
    if (text === null) { found.add('manifest:' + name); continue }
    const manifest = JSON.parse(text)
    try {
      validateDistributionManifest(manifest)
      assert.equal(manifest.id, 'dsh.' + name, name + ': id is dsh.<folder>')
      const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
      assert.equal(pkg.name, manifest.packageName, name + ': package.json name is the manifest packageName')
      assert.ok(await exists(path.join(folder, manifest.entry)), name + ': entry exists')
    } catch (error) {
      found.add('manifest:' + name)
      if (!PENDING.has('manifest:' + name)) throw error
    }
  }
})

test('each mod has a Skill reference with an index line and at least one test of its own', async () => {
  const index = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8')
  const tests = await readdir(path.join(root, 'tests'))
  for (const name of names) {
    if (!await exists(path.join(skillRoot, 'references', name + '.md')) || !index.includes('references/' + name + '.md')) found.add('skill:' + name)
    if (!tests.some(file => file.endsWith('.test.mjs') && file.includes(name))) found.add('tests:' + name)
  }
})

test('a mod imports only its own folder and the presentation protocol; nothing outside mods/ imports a mod', async () => {
  for (const name of names) {
    const folder = path.join(modsRoot, name)
    for (const file of await walk(folder, () => false)) {
      for (const spec of specifiers(await readFile(file, 'utf8'))) {
        const target = path.resolve(path.dirname(file), spec)
        if (target.startsWith(folder + path.sep)) continue
        if (posix(target).startsWith('tavern-plugin/packages/dsh-presentation-protocol/src/')) continue
        found.add('import-out:' + posix(file))
      }
    }
  }
  // Built bundles (lib/client.js, lib/host/mod-*.mjs) are outputs of the sources checked here.
  const generated = rel => /\/lib\/client\.js$/.test(rel) || /^tavern-plugin\/lib\/host\/mod-[^/]+\.mjs$/.test(rel)
  const skip = rel => rel.startsWith('tavern-plugin/mods/') || /\/(node_modules|vendor|tests)\//.test(rel) || generated(rel)
  const ids = new RegExp(`['"\`]dsh\\.(?:${names.join('|')})['"\`]`)
  // The names a mod's core client parts register (client/core.js): core and stage render parts by slot, never by name.
  const parts = []
  for (const name of names) {
    const core = await readFile(path.join(modsRoot, name, 'client/core.js'), 'utf8').catch(() => '')
    for (const match of core.matchAll(/\b(?:floor|page|overlay|use|entries|line):\s*([A-Za-z_$][\w$]*)/g)) parts.push(match[1])
  }
  const partNames = parts.length ? new RegExp(`\\b(?:${[...new Set(parts)].join('|')})\\b`) : null
  for (const file of await walk(path.join(root, 'tavern-plugin'), skip)) {
    const text = await readFile(file, 'utf8'), rel = posix(file)
    if (specifiers(text).some(spec => posix(path.resolve(path.dirname(file), spec)).startsWith('tavern-plugin/mods/'))) found.add('import-in:' + rel)
    if (ids.test(text)) found.add('names-mod:' + rel)
    if (partNames?.test(text)) found.add('names-part:' + rel)
  }
})

test('the pending deviations only shrink', () => {
  const added = [...found].filter(key => !PENDING.has(key)).sort()
  const fixed = [...PENDING].filter(key => !found.has(key)).sort()
  assert.deepEqual(added, [], 'new deviations from docs/mod-authoring.md (fix them; do not add them to PENDING)')
  assert.deepEqual(fixed, [], 'these deviations are gone: remove them from PENDING')
})
