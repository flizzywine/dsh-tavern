import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { planDisable, planEnable, updateProfile } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/bundles.js'
import { TAVERN_BUNDLES, profileDir } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

function fixture(t, bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
  const home = mkdtempSync(path.join(tmpdir(), 'tavern-dshgo-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = profileDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'dsh-profile-web', dependencies: { '@deepseek-ai/dsh-base': '^0.2.2' }, dsh: { profile: { bundles } } }, null, 2)}\n`)
  return { home, dir }
}

test('updateProfile：没变化不写文件，有变化写并保留其它字段', (t) => {
  const { home, dir } = fixture(t, ['@deepseek-ai/dsh-base', ...TAVERN_BUNDLES])
  const before = readFileSync(path.join(dir, 'package.json'), 'utf8')
  const unchanged = updateProfile({ home, apply: planEnable })
  assert.equal(unchanged.changed, false)
  assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), before)

  const changed = updateProfile({ home, apply: planDisable })
  assert.equal(changed.changed, true)
  const after = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(after.dsh.profile.bundles, ['@deepseek-ai/dsh-base'])
  assert.deepEqual(after.dependencies, { '@deepseek-ai/dsh-base': '^0.2.2' })
})
