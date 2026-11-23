import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { syncDesktop } from '../bin/dev-sync-desktop.mjs'
import { removeTreeSync } from '../bin/portable-fs.mjs'

test('copies tracked and uncommitted runtime files while preserving desktop data and dependencies', t => {
  const parent = realpathSync(os.tmpdir()), root = mkdtempSync(path.join(parent, 'desktop-sync-'))
  t.after(() => { assert.equal(path.dirname(realpathSync(root)), parent); removeTreeSync(root) })
  const sourceRoot = path.join(root, '开发'), target = path.join(root, '桌面'), home = path.join(root, 'home')
  const put = (base, name, text) => { mkdirSync(path.dirname(path.join(base, name)), { recursive: true }); writeFileSync(path.join(base, name), text) }
  const manifest = JSON.stringify({ name: 'dsh-profile-tavern' })
  put(sourceRoot, 'package.json', manifest)
  put(sourceRoot, '.gitignore', 'node_modules/\n')
  put(sourceRoot, 'tavern-plugin/lib/client.js', 'current code')
  put(sourceRoot, 'presets/skills/game/references/api.md', 'runtime reference')
  for (const args of [['init', '-q'], ['add', '.']]) assert.equal(spawnSync('git', args, { cwd: sourceRoot }).status, 0)
  put(sourceRoot, 'bin/new.mjs', 'uncommitted code')
  put(sourceRoot, 'node_modules/library.js', 'development dependency')
  put(target, 'package.json', manifest)
  put(target, 'data/save.json', 'saved game')
  put(target, 'node_modules/library.js', 'installed dependency')
  put(home, 'profiles/tavern/package.json', JSON.stringify({ dshTavern: { host: 'desktop', source: target } }))
  const result = syncDesktop({ sourceRoot, home, build: false })
  assert.equal(result.target, realpathSync(target))
  assert.equal(readFileSync(path.join(target, 'tavern-plugin/lib/client.js'), 'utf8'), 'current code')
  assert.equal(readFileSync(path.join(target, 'bin/new.mjs'), 'utf8'), 'uncommitted code')
  assert.equal(readFileSync(path.join(target, 'presets/skills/game/references/api.md'), 'utf8'), 'runtime reference')
  assert.equal(readFileSync(path.join(target, 'data/save.json'), 'utf8'), 'saved game')
  assert.equal(readFileSync(path.join(target, 'node_modules/library.js'), 'utf8'), 'installed dependency')
})

test('achievement sync refreshes the launcher and the active bundled plugin while preserving its records and disabled state', t => {
  const parent = realpathSync(os.tmpdir()), root = mkdtempSync(path.join(parent, 'desktop-achievements-sync-'))
  t.after(() => { assert.equal(path.dirname(realpathSync(root)), parent); removeTreeSync(root) })
  const sourceRoot = path.join(root, 'dev'), target = path.join(root, 'desktop'), home = path.join(root, 'home')
  const data = path.join(home, 'profile-data', 'tavern', 'data')
  const medal = 'dsh-tavern-adventure-medal'
  const launcher = 'tavern-plugin/packages/dsh-tavern/client.js'
  const relativeBundle = 'tavern-plugin/packages/' + medal
  const active = path.join(data, 'plugins', medal)
  const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text) }
  cpSync(new URL('../' + relativeBundle, import.meta.url), path.join(sourceRoot, relativeBundle), { recursive: true })
  cpSync(path.join(sourceRoot, relativeBundle), active, { recursive: true })
  put(path.join(active, 'lib/index.js'), 'export const old = true')
  put(path.join(active, '.tavern-disabled'), '{"byPlayer":true}')
  put(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }))
  put(path.join(target, launcher), 'previous launcher')
  put(path.join(sourceRoot, launcher), 'launcher with achievement refresh')
  put(path.join(sourceRoot, 'bin/unrelated.mjs'), 'other development work')
  put(path.join(target, 'bin/unrelated.mjs'), 'installed code')
  put(path.join(data, 'plugin-data', medal + '.json'), 'existing collection')
  put(path.join(home, 'profiles/tavern/package.json'), JSON.stringify({ dshTavern: { host: 'desktop', source: target } }))

  const result = syncDesktop({ sourceRoot, home, achievementsOnly: true })
  assert.equal(result.medalPlugin, active)
  assert.equal(readFileSync(path.join(target, launcher), 'utf8'), 'launcher with achievement refresh')
  const medalCode = readFileSync(path.join(sourceRoot, relativeBundle, 'lib/index.js'), 'utf8')
  assert.equal(readFileSync(path.join(target, relativeBundle, 'lib/index.js'), 'utf8'), medalCode)
  assert.equal(readFileSync(path.join(active, 'lib/index.js'), 'utf8'), medalCode)
  assert.equal(readFileSync(path.join(active, '.tavern-disabled'), 'utf8'), '{"byPlayer":true}')
  assert.equal(readFileSync(path.join(data, 'plugin-data', medal + '.json'), 'utf8'), 'existing collection')
  assert.equal(readFileSync(path.join(target, 'bin/unrelated.mjs'), 'utf8'), 'installed code')
  assert.equal(syncDesktop({ sourceRoot, home, achievementsOnly: true }).medalPlugin, active)
})
