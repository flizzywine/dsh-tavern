import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { dataHomePaths, dataHomeHint, ensureDataHome, inspectDataHome } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/data-home.js'

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tavern-dshgo-data-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('dataHomePaths：实体在 dsh-go 下，profile-data 只放链接', (t) => {
  const dsh = home(t)
  assert.deepEqual(dataHomePaths(dsh), {
    target: join(dsh, 'dsh-go', 'tavern-data'),
    link: join(dsh, 'profile-data', 'tavern'),
  })
})

test('inspectDataHome：目录都还没有时是 absent', (t) => {
  const found = inspectDataHome(home(t))
  assert.equal(found.state, 'absent')
  assert.equal(found.current, null)
})

test('ensureDataHome：建出实体目录与相对链接，重复调用不再改动', (t) => {
  const dsh = home(t)
  const first = ensureDataHome(dsh)
  assert.deepEqual(first, { changed: true, state: 'linked', ...dataHomePaths(dsh) })
  assert.ok(lstatSync(first.link).isSymbolicLink())
  assert.equal(readlinkSync(first.link), '../dsh-go/tavern-data')
  assert.equal(realpathSync(first.link), realpathSync(first.target))

  const again = ensureDataHome(dsh)
  assert.deepEqual(again, { changed: false, state: 'linked', ...dataHomePaths(dsh) })
  assert.equal(inspectDataHome(dsh).state, 'linked')
})

test('ensureDataHome：已有的实体目录一律不动，报 directory 让用户迁移', (t) => {
  const dsh = home(t)
  const { link, target } = dataHomePaths(dsh)
  mkdirSync(link, { recursive: true })
  writeFileSync(join(link, 'card.json'), '{"keep":true}')

  const result = ensureDataHome(dsh)
  assert.equal(result.changed, false)
  assert.equal(result.state, 'directory')
  assert.equal(existsSync(target), false, '不建空实体目录，免得把数据留在两处')
  assert.equal(readFileSync(join(link, 'card.json'), 'utf8'), '{"keep":true}')
})

test('ensureDataHome：链接指向别处时不夺权', (t) => {
  const dsh = home(t)
  const { link, target } = dataHomePaths(dsh)
  const elsewhere = join(dsh, 'sync-dir')
  mkdirSync(elsewhere, { recursive: true })
  mkdirSync(join(dsh, 'profile-data'), { recursive: true })
  symlinkSync(relative(join(dsh, 'profile-data'), elsewhere), link)

  const found = inspectDataHome(dsh)
  assert.equal(found.state, 'other-link')
  assert.equal(found.current, elsewhere)
  assert.equal(ensureDataHome(dsh).state, 'other-link')
  assert.equal(existsSync(target), false)
})

test('dataHomeHint：每种状态都有话说，directory 要提示先迁移', () => {
  const base = { target: '/t', link: '/l', current: null }
  assert.match(dataHomeHint({ ...base, state: 'linked' }, true), /重置引擎不会删/)
  assert.match(dataHomeHint({ ...base, state: 'directory' }, true), /先把它移到/)
  assert.match(dataHomeHint({ ...base, state: 'directory' }, false), /move it under/)
  assert.match(dataHomeHint({ ...base, state: 'other-link', current: '/x' }, true), /\/x/)
  assert.match(dataHomeHint({ ...base, state: 'unreadable' }, true), /未改动/)
})
