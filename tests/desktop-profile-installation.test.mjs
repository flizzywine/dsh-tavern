import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, realpathSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginDesktopProfileInstallation, clearUninstalledInstallationRecord } from '../bin/desktop-profile-installation.mjs'
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
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
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
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
})

for (const failAt of ['previous-desktop', 'publish-link']) test(`中断后重装恢复临时链接和原版配置：${failAt}`, t => {
  const r = fixture(t)
  const tx = prepare({ ...r, rename(from, to) {
    if ((failAt === 'previous-desktop' && from === r.desktop)
      || (failAt === 'publish-link' && path.basename(from).startsWith('desktop.switch-stage-'))) throw Error('模拟进程中断')
    renameSync(from, to)
  } })
  assert.throws(() => tx.finish(), /模拟进程中断/)
  assert.equal(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')).length, 1)
  // A new installer recovers the on-disk journal without the old transaction.
  const next = prepare(r)
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  next.finish(); next.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
})

test('回滚清理悬空临时链接，保留后来替换的路径并报告冲突', t => {
  const r = fixture(t)
  const tx = prepare({ ...r, rename(from, to) {
    if (from === r.desktop) throw Error('模拟占用')
    renameSync(from, to)
  } })
  assert.throws(() => tx.finish(), /模拟占用/)
  const link = path.join(r.profiles, readdirSync(r.profiles).find(name => name.startsWith('desktop.switch-stage-')))
  renameSync(r.tavern, path.join(tx.backup, 'external-tavern'))
  assert.equal(existsSync(link), false)
  assert.ok(lstatSync(link).isSymbolicLink())
  unlinkSync(link); mkdirSync(link)
  assert.throws(() => tx.rollback(), /恢复路径冲突/)
  assert.ok(lstatSync(link).isDirectory())
  // Restore the journal-owned link and confirm dangling-link cleanup succeeds.
  // Reuse the stored target rather than following the missing tavern directory.
  removeTreeSync(link)
  symlinkSync(r.tavern, link, process.platform === 'win32' ? 'junction' : 'dir')
  tx.rollback()
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
})

test('卸载记录存在时重新安装：重新建立酒馆 profile 与链接，并清理 uninstalled 标记', async t => {
  const r = fixture(t)
  mkdirSync(path.join(r.home, 'profile-bridge'), { recursive: true })
  const recordFile = path.join(r.home, 'profile-bridge', 'installation.json')
  writeFileSync(recordFile, JSON.stringify({
    schemaVersion: 1,
    phase: 'uninstalled',
    retained: [path.join(r.home, 'apps/dsh-tavern.switch-removed-1')],
    dataDir: path.join(r.home, 'profile-data/tavern')
  }))
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official', 'dsh-profile-bridge'] } } }))
  const tx = prepare(r)
  tx.finish()
  tx.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(existsSync(recordFile), false)
})

test('酒馆 profile 缺失时，原版 desktop 已带切换组件也按首次安装重建', t => {
  const r = fixture(t)
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official', 'dsh-profile-bridge'] } } }))
  const tx = prepare(r)
  tx.finish(); tx.commit()
  assert.equal(realpathSync(r.desktop), realpathSync(r.tavern))
})

test('异常或损坏的安装位置记录阻止重装，避免覆盖未恢复的安装状态', t => {
  const r = fixture(t)
  mkdirSync(path.join(r.home, 'profile-bridge'), { recursive: true })
  const recordFile = path.join(r.home, 'profile-bridge', 'installation.json')
  writeFileSync(recordFile, JSON.stringify({ schemaVersion: 1, phase: 'preparing' }))
  assert.throws(() => beginDesktopProfileInstallation(r), /安装位置记录状态异常/)
  writeFileSync(recordFile, '{invalid')
  assert.throws(() => beginDesktopProfileInstallation(r), /安装位置记录不可读/)
})

test('清理卸载标记时不删除已完成的迁移登记', t => {
  const r = fixture(t)
  mkdirSync(path.join(r.home, 'profile-bridge'), { recursive: true })
  const recordFile = path.join(r.home, 'profile-bridge', 'installation.json')
  writeFileSync(recordFile, JSON.stringify({ schemaVersion: 1, phase: 'completed', entries: [] }))
  clearUninstalledInstallationRecord(r.home)
  assert.equal(existsSync(recordFile), true)
  writeFileSync(recordFile, JSON.stringify({ schemaVersion: 1, phase: 'uninstalled', retained: [] }))
  clearUninstalledInstallationRecord(r.home)
  assert.equal(existsSync(recordFile), false)
})
