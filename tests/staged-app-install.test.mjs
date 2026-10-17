import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepare, swap, rollback, commit, stagedPaths } from '../bin/staged-app-install.mjs'

function write(root, relative, text = relative) {
  const file = path.join(root, ...relative.split('/'))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}
function read(root, relative) { return readFileSync(path.join(root, ...relative.split('/')), 'utf8') }
function tree(root) {
  const files = []
  const walk = relative => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const next = relative ? relative + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(next); else files.push(next)
    }
  }
  walk('')
  return files.sort()
}
function release(root, version, files) {
  for (const file of files) write(root, file, version + ':' + file)
}

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'tavern-staged-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const app = path.join(base, 'apps', 'dsh-tavern')
  return { base, app, source: version => path.join(base, 'source-' + version) }
}

function installV1(app, source) {
  release(source('v1'), 'v1', ['package.json', 'bin/dsh-tavern.mjs', 'bin/retired.mjs', 'tavern-plugin/lib/index.js'])
  prepare({ app, source: source('v1') }); swap(app); commit(app)
  // Things the release did not install: legacy data, a user file nested in a
  // release directory, local markers and dependencies of this release.
  write(app, 'data/chats/one.json', '{"chat":1}')
  write(app, 'tavern-plugin/lib/user-note.txt', '用户自己的文件')
  write(app, '.dsh-tavern-local.json', '{"host":"cli"}')
  write(app, 'node_modules/old-dep/index.js', 'old')
}

test('切换后失败可回滚：原版本、用户数据和旧依赖原样恢复', t => {
  const { app, source } = fixture(t)
  installV1(app, source)
  const before = tree(app).map(file => [file, read(app, file)])
  release(source('v2'), 'v2', ['package.json', 'bin/dsh-tavern.mjs'])
  prepare({ app, source: source('v2') })
  swap(app)
  write(app, 'data/chats/during-v2.json', '新版本运行期间写入')
  assert.equal(rollback(app), true)
  assert.deepEqual(tree(app).filter(file => file !== 'data/chats/during-v2.json').map(file => [file, read(app, file)]), before)
  assert.equal(read(app, 'data/chats/during-v2.json'), '新版本运行期间写入', '切换后写入的用户数据随数据目录一起保留')
  const paths = stagedPaths(app)
  assert.deepEqual([existsSync(paths.staging), existsSync(paths.previous), existsSync(app + '.failed')], [false, false, false])
})

test('全新安装失败回滚后不留下半成品目录', t => {
  const { app, source } = fixture(t)
  release(source('v1'), 'v1', ['package.json'])
  prepare({ app, source: source('v1') })
  swap(app)
  assert.equal(rollback(app), true)
  assert.equal(existsSync(app), false)
})

test('提交删除旧目录后、清除记录前中断：回滚识别为已提交，不报错也不改动新版本', t => {
  const { app, source } = fixture(t)
  installV1(app, source)
  release(source('v2'), 'v2', ['package.json', 'bin/dsh-tavern.mjs'])
  prepare({ app, source: source('v2') })
  swap(app)
  rmSync(stagedPaths(app).previous, { recursive: true, force: true })
  assert.equal(rollback(app), false)
  assert.equal(read(app, 'bin/dsh-tavern.mjs'), 'v2:bin/dsh-tavern.mjs')
  assert.equal(read(app, 'data/chats/one.json'), '{"chat":1}')
  assert.equal(existsSync(path.join(app, '.dsh-tavern-swap.json')), false)
})

for (const boundary of ['old-app', 'new-app', 'user-data', 'nested-user-file']) {
  test('切换在实际 rename 后中断仍完整恢复：' + boundary, t => {
    const { app, source } = fixture(t)
    installV1(app, source)
    const before = tree(app).map(file => [file, read(app, file)])
    release(source('v2'), 'v2', ['package.json', 'bin/dsh-tavern.mjs'])
    prepare({ app, source: source('v2') })
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      import path from 'node:path'
      const app = ${JSON.stringify(app)}, boundary = ${JSON.stringify(boundary)}
      const original = fs.renameSync
      fs.renameSync = (from, to) => {
        original(from, to)
        const target = {
          'old-app': app,
          'new-app': app + '.staging',
          'user-data': path.join(app + '.previous', 'data'),
          'nested-user-file': path.join(app + '.previous', 'tavern-plugin/lib/user-note.txt')
        }[boundary]
        if (from === target) process.exit(86)
      }
      syncBuiltinESMExports()
      const { swap } = await import(${JSON.stringify(new URL('../bin/staged-app-install.mjs', import.meta.url).href)})
      swap(app)
    `], { encoding: 'utf8' })
    assert.equal(result.status, 86, result.stderr)
    prepare({ app, source: source('v2') })
    assert.deepEqual(tree(app).map(file => [file, read(app, file)]), before)
    // A second recovery and a successful update must retain the same data too.
    prepare({ app, source: source('v2') })
    swap(app)
    commit(app)
    assert.equal(read(app, 'data/chats/one.json'), '{"chat":1}')
    assert.equal(read(app, 'tavern-plugin/lib/user-note.txt'), '用户自己的文件')
  })
}
