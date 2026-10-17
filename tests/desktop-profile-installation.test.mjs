import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginDesktopProfileInstallation } from '../bin/desktop-profile-installation.mjs'
import { switchProfile } from '../tavern-plugin/packages/dsh-profile-bridge/lib/helper.mjs'
import { removeTreeSync } from '../bin/portable-fs.mjs'
function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'bridge-install-中文 '))
  t.after(() => removeTreeSync(home))
  const profiles = path.join(home, 'profiles'), desktop = path.join(profiles, 'desktop'), tavern = path.join(profiles, 'tavern')
  mkdirSync(desktop, { recursive: true })
  writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official'] } } }))
  writeFileSync(path.join(desktop, 'cordis.patch.yml'), '# original\n[]\n')
  mkdirSync(path.join(home, 'profile-data/tavern/data'), { recursive: true })
  writeFileSync(path.join(home, 'profile-data/tavern/data/story'), '正文与历史')
  return { home, profiles, desktop, tavern, sourceRoot: path.resolve('.'), checkStopped() {} }
}
function prepare(r) {
  const tx = beginDesktopProfileInstallation(r)
  writeFileSync(path.join(r.tavern, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin'] } }, dshTavern: { profileBridge: true } }))
  return tx
}
test('首次安装、还原原版、重复安装均保留原版配置和存档', t => {
  const r = fixture(t), tx = prepare(r)
  tx.finish(); tx.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  switchProfile({ mode: 'unlink', profilesRoot: r.profiles, liveDir: r.desktop, stamp: 'restore' })
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
  assert.ok(existsSync(path.join(r.desktop, 'node_modules/dsh-profile-bridge/index.js')))
  assert.ok(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).dsh.profile.bundles.includes('dsh-profile-bridge'))
  const again = prepare(r); again.finish(); again.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  const update = prepare(r); update.finish(); update.commit()
  assert.equal(readFileSync(path.join(r.home, 'profile-data/tavern/data/story'), 'utf8'), '正文与历史')
})
test('安装或切换后失败都完整恢复之前的 tavern 和 desktop', t => {
  const r = fixture(t)
  mkdirSync(r.tavern); writeFileSync(path.join(r.tavern, 'custom'), 'old')
  const original = readFileSync(path.join(r.desktop, 'package.json'), 'utf8')
  for (const finish of [false, true]) {
    const tx = prepare(r)
    if (finish) tx.finish()
    tx.rollback()
    assert.equal(readFileSync(path.join(r.tavern, 'custom'), 'utf8'), 'old')
    assert.equal(readFileSync(path.join(r.desktop, 'package.json'), 'utf8'), original)
  }
})
test('中断后下一次安装自动恢复未完成的目录事务', t => {
  const r = fixture(t); const tx = prepare(r); tx.finish()
  const next = prepare(r); next.rollback()
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(existsSync(r.tavern), false)
})
test('旧版占用 desktop：保留酒馆配置并恢复匹配的原版备份', t => {
  const r = fixture(t)
  for (const file of ['package.json', 'cordis.patch.yml']) writeFileSync(path.join(r.desktop, file + '.backup.1'), readFileSync(path.join(r.desktop, file)))
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin'] } } }))
  writeFileSync(path.join(r.desktop, 'cordis.patch.yml'), '# tavern\n[]')
  const tx = beginDesktopProfileInstallation(r)
  assert.equal(readFileSync(path.join(r.tavern, 'cordis.patch.yml'), 'utf8'), '# tavern\n[]')
  tx.finish(); tx.commit()
  switchProfile({ mode: 'unlink', profilesRoot: r.profiles, liveDir: r.desktop, stamp: 'restore' })
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
})
test('缺失原版备份或宿主仍运行时不触碰现有配置', t => {
  const r = fixture(t)
  assert.throws(() => beginDesktopProfileInstallation({ ...r, checkStopped() { throw Error('仍运行') } }), /仍运行/)
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }))
  assert.throws(() => beginDesktopProfileInstallation(r), /原版 desktop/)
  assert.equal(existsSync(r.tavern), false)
  assert.deepEqual(readdirSync(r.desktop).sort(), ['cordis.patch.yml', 'package.json'])
})
