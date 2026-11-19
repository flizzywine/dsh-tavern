import { test as nodeTest } from 'node:test'
// dsh-go runs on Android/Termux (POSIX paths, sh and links), which Windows cannot exercise.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dataHomePaths, dataHomeHint, ensureDataHome } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/data-home.js'

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tavern-dshgo-data-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

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

test('dataHomeHint：每种状态都有话说，directory 要提示先迁移', () => {
  const base = { target: '/t', link: '/l', current: null }
  assert.match(dataHomeHint({ ...base, state: 'linked' }, true), /重置引擎不会删/)
  assert.match(dataHomeHint({ ...base, state: 'directory' }, true), /先把它移到/)
  assert.match(dataHomeHint({ ...base, state: 'directory' }, false), /move it under/)
  assert.match(dataHomeHint({ ...base, state: 'other-link', current: '/x' }, true), /\/x/)
  assert.match(dataHomeHint({ ...base, state: 'unreadable' }, true), /未改动/)
})
