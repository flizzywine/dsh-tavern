import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, renameSync } from 'node:fs'
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
test('首次安装、还原原版、重复安装均保留原版配置和存档', async t => {
  const r = fixture(t), tx = prepare(r)
  tx.finish(); tx.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  await switchProfile({ mode: 'unlink', profilesRoot: r.profiles, liveDir: r.desktop, stamp: 'restore' })
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
  assert.ok(existsSync(path.join(r.desktop, 'node_modules/dsh-profile-bridge/index.js')))
  assert.ok(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).dsh.profile.bundles.includes('dsh-profile-bridge'))
  const again = prepare(r); again.finish(); again.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
  await switchProfile({ mode: 'link', profilesRoot: r.profiles, liveDir: r.desktop, targetDir: r.tavern, stamp: 'return-tavern' })
  // Already bridged: in-app updates run with the desktop open, so no profile switch and no stop check.
  const update = beginDesktopProfileInstallation({ ...r, checkStopped() { throw Error('不应要求退出桌面') } })
  assert.equal(update.refreshOnly, true)
  update.finish(); update.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(readFileSync(path.join(r.home, 'profile-data/tavern/data/story'), 'utf8'), '正文与历史')
})
test('中断后下一次安装自动恢复未完成的目录事务', t => {
  const r = fixture(t); const tx = prepare(r); tx.finish()
  const next = prepare(r); next.rollback()
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(existsSync(r.tavern), false)
})
test('旧版占用 desktop：保留酒馆配置并恢复匹配的原版备份', async t => {
  const r = fixture(t)
  for (const file of ['package.json', 'cordis.patch.yml']) writeFileSync(path.join(r.desktop, file + '.backup.1'), readFileSync(path.join(r.desktop, file)))
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin'] } } }))
  writeFileSync(path.join(r.desktop, 'cordis.patch.yml'), '# tavern\n[]')
  const tx = beginDesktopProfileInstallation(r)
  assert.equal(readFileSync(path.join(r.tavern, 'cordis.patch.yml'), 'utf8'), '# tavern\n[]')
  tx.finish(); tx.commit()
  await switchProfile({ mode: 'unlink', profilesRoot: r.profiles, liveDir: r.desktop, stamp: 'restore' })
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
})

test('Windows 首次安装等待 desktop 短暂占用释放后完成切换，回滚也重试', t => {
  const r = fixture(t)
  let time = 0, publishAttempts = 0, rollbackAttempts = 0
  const tx = prepare({ ...r,
    retry: { platform: 'win32', timeout: 200, interval: 100, now: () => time, delay: ms => { time += ms } },
    rename(from, to) {
      if (from === r.desktop && ++publishAttempts <= 2) throw Object.assign(Error('sharing violation'), { code: 'EPERM' })
      if (path.basename(from) === 'previous-desktop' && ++rollbackAttempts <= 2) throw Object.assign(Error('busy'), { code: 'EBUSY' })
      renameSync(from, to)
    },
  })
  tx.finish()
  assert.equal(publishAttempts, 3)
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  tx.rollback()
  assert.equal(rollbackAttempts, 3)
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(existsSync(r.tavern), false)
  assert.equal(readFileSync(path.join(r.home, 'profile-data/tavern/data/story'), 'utf8'), '正文与历史')
})

test('Windows desktop 持续拒绝移动：限时退出并提示，原版配置及存档可回滚', t => {
  const r = fixture(t)
  let time = 0, attempts = 0
  const tx = prepare({ ...r,
    retry: { platform: 'win32', timeout: 200, interval: 100, now: () => time, delay: ms => { time += ms } },
    rename(from, to) {
      if (from === r.desktop) { attempts++; throw Object.assign(Error('access denied'), { code: 'EPERM' }) }
      renameSync(from, to)
    },
  })
  assert.throws(() => tx.finish(), error => error.code === 'EPERM' && error.message.includes(r.desktop) && /托盘/.test(error.message) && /权限/.test(error.message))
  assert.equal(attempts, 3)
  tx.rollback()
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
  assert.equal(readFileSync(path.join(r.home, 'profile-data/tavern/data/story'), 'utf8'), '正文与历史')
  assert.equal(JSON.parse(readFileSync(path.join(r.home, 'profile-bridge/install.json'))).phase, 'rolled-back')
  assert.ok(existsSync(tx.backup))
})
