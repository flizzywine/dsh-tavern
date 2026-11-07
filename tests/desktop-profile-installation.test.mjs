import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, realpathSync, renameSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginDesktopProfileInstallation, clearUninstalledInstallationRecord } from '../bin/desktop-profile-installation.mjs'
import { switchProfile } from '../tavern-plugin/packages/dsh-tavern/lib/helper.mjs'
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
test('首装遇到其他来源的同名 dsh-tavern 时保留该插件和 Profile', t => {
  const r = fixture(t)
  const manifest = path.join(r.desktop, 'package.json')
  const existing = JSON.stringify({ dependencies: { 'dsh-tavern': '2.8.1' }, dsh: { profile: { bundles: ['dsh-tavern'] } } })
  writeFileSync(manifest, existing)
  assert.throws(() => beginDesktopProfileInstallation(r), /已有同名的 dsh-tavern/)
  assert.equal(readFileSync(manifest, 'utf8'), existing)
  assert.equal(existsSync(r.tavern), false)
})

test('首次安装保留原版默认，主动选择酒馆后更新保留选择', async t => {
  const r = fixture(t)
  // A previous NEXT installation must not block the user's official Desktop choice.
  writeFileSync(path.join(r.home, 'desktop-next.json'), JSON.stringify({ active: 'desktop' }))
  const tx = prepare(r)
  tx.finish(); tx.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(lstatSync(r.desktop).isSymbolicLink(), false)
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
  assert.ok(existsSync(path.join(r.desktop, 'node_modules/dsh-tavern/index.js')))
  assert.ok(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).dsh.profile.bundles.includes('dsh-tavern'))
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
test('从 NEXT 安装到官方桌面时保留旧 Profile 备份和酒馆数据', t => {
  const r = fixture(t)
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['official', 'dsh-tavern'] } } }))
  const installed = path.join(r.desktop, 'node_modules/dsh-tavern')
  mkdirSync(installed, { recursive: true })
  const repository = { url: 'git+https://github.com/flizzywine/dsh-tavern.git' }
  writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ repository, dshTavern: { profileHandoff: true } }))
  mkdirSync(r.tavern)
  const archive = `https://raw.githubusercontent.com/flizzywine/dsh-tavern/${'a'.repeat(40)}/dsh-tavern-bundle.tgz`
  const oldManifest = JSON.stringify({ dependencies: { 'dsh-tavern-bundle': archive }, dsh: { profile: { bundles: ['dsh-tavern-bundle'] } } })
  writeFileSync(path.join(r.tavern, 'package.json'), oldManifest)
  mkdirSync(path.join(r.tavern, 'node_modules/dsh-tavern-bundle'), { recursive: true })
  writeFileSync(path.join(r.tavern, 'node_modules/dsh-tavern-bundle/package.json'), JSON.stringify({ name: 'dsh-tavern-bundle', repository }))
  writeFileSync(path.join(r.tavern, 'cordis.patch.yml'), '# user overrides\n[]\n')
  const tx = beginDesktopProfileInstallation(r)
  assert.equal(readFileSync(path.join(r.tavern, 'package.json'), 'utf8'), oldManifest)
  assert.equal(readFileSync(path.join(r.tavern, 'cordis.patch.yml'), 'utf8'), '# user overrides\n[]\n')
  assert.equal(readFileSync(path.join(tx.backup, 'previous-tavern/package.json'), 'utf8'), oldManifest)
  tx.rollback()
  assert.equal(readFileSync(path.join(r.tavern, 'package.json'), 'utf8'), oldManifest)
  const retry = prepare({ ...r, host: 'next' })
  retry.finish()
  retry.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).dependencies['dsh-tavern'], 'file:./vendor/dsh-tavern')
  assert.equal(readFileSync(path.join(r.home, 'profile-data/tavern/data/story'), 'utf8'), '正文与历史')
})
test('应用内安装保留原版默认和下载期间保存的配置', async t => {
  const r = fixture(t)
  const manifest = path.join(r.desktop, 'package.json')
  writeFileSync(manifest, JSON.stringify({ dsh: { profile: { bundles: ['official', 'dsh-tavern'] } } }))
  const installed = path.join(r.desktop, 'node_modules/dsh-tavern')
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), readFileSync(path.join(r.sourceRoot, 'tavern-plugin/packages/dsh-tavern/package.json')))
  const checks = []
  const tx = prepare({ ...r, preparingForPid: 123, checkStopped: pid => checks.push(pid) })
  assert.equal(tx.desktopStage, r.desktop)
  assert.equal(lstatSync(r.desktop).isSymbolicLink(), false)
  writeFileSync(path.join(r.desktop, 'cordis.patch.yml'), '# saved before restart')
  tx.finish()
  tx.commit()
  assert.deepEqual(checks, [123, undefined])
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(lstatSync(r.desktop).isSymbolicLink(), false)
  assert.equal(readFileSync(path.join(r.desktop, 'cordis.patch.yml'), 'utf8'), '# saved before restart')
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
  assert.equal(lstatSync(r.desktop).isSymbolicLink(), false)
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
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
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

for (const failAt of ['previous-desktop', 'publish-desktop']) test(`中断后重装恢复临时链接和原版配置：${failAt}`, t => {
  const r = fixture(t)
  const tx = prepare({ ...r, rename(from, to) {
    if ((failAt === 'previous-desktop' && from === r.desktop)
      || (failAt === 'publish-desktop' && path.basename(from) === 'prepared-desktop')) throw Error('模拟进程中断')
    renameSync(from, to)
  } })
  assert.throws(() => tx.finish(), /模拟进程中断/)
  assert.equal(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')).length, 0)
  // A new installer recovers the on-disk journal without the old transaction.
  const next = prepare(r)
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
  assert.equal(JSON.parse(readFileSync(path.join(r.desktop, 'package.json'))).name, 'dsh-profile-desktop')
  next.finish(); next.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
})

test('重装仍能恢复旧安装器遗留的悬空链接事务', t => {
  const r = fixture(t)
  const state = path.join(r.home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  const link = path.join(r.profiles, 'desktop.switch-stage-legacy')
  symlinkSync(r.tavern, link, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(path.join(state, 'install.json'), JSON.stringify({ phase: 'preparing', actions: [{ type: 'symlink', path: link, target: r.tavern }] }))
  unlinkSync(link); mkdirSync(link)
  assert.throws(() => prepare(r), /恢复路径冲突/)
  assert.ok(lstatSync(link).isDirectory())
  removeTreeSync(link)
  symlinkSync(r.tavern, link, process.platform === 'win32' ? 'junction' : 'dir')
  const next = prepare(r)
  assert.deepEqual(readdirSync(r.profiles).filter(name => name.startsWith('desktop.switch-stage-')), [])
  next.finish(); next.commit()
  assert.equal(lstatSync(r.desktop).isSymbolicLink(), false)
})

test('卸载记录存在时重新安装：重新建立独立酒馆 profile，并清理 uninstalled 标记', async t => {
  const r = fixture(t)
  mkdirSync(path.join(r.home, 'profile-bridge'), { recursive: true })
  const recordFile = path.join(r.home, 'profile-bridge', 'installation.json')
  writeFileSync(recordFile, JSON.stringify({
    schemaVersion: 1,
    phase: 'uninstalled',
    retained: [path.join(r.home, 'apps/dsh-tavern.switch-removed-1')],
    dataDir: path.join(r.home, 'profile-data/tavern')
  }))
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official'] } } }))
  const tx = prepare(r)
  tx.finish()
  tx.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
  assert.equal(existsSync(recordFile), false)
})

test('酒馆 profile 缺失时，原版 desktop 已带切换组件也按首次安装重建', t => {
  const r = fixture(t)
  const installed = path.join(r.desktop, 'node_modules/dsh-tavern')
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), readFileSync(path.join(r.sourceRoot, 'tavern-plugin/packages/dsh-tavern/package.json')))
  writeFileSync(path.join(r.desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official', 'dsh-tavern'] } } }))
  const tx = prepare(r)
  tx.finish(); tx.commit()
  assert.notEqual(realpathSync(r.desktop), realpathSync(r.tavern))
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


test('直接重装仍拒绝未恢复或损坏的卸载事务，不创建 profile 或清除标记', t => {
  const r = fixture(t)
  const state = path.join(r.home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  const registry = path.join(state, 'installation.json')
  const marker = JSON.stringify({ schemaVersion: 1, phase: 'uninstalled', retained: [] })
  writeFileSync(registry, marker)
  for (const operation of [
    JSON.stringify({ schemaVersion: 1, phase: 'preparing', mode: 'uninstall' }),
    JSON.stringify({ schemaVersion: 1, phase: 'unknown' }),
    '{broken'
  ]) {
    writeFileSync(path.join(state, 'installation-operation.json'), operation)
    assert.throws(() => beginDesktopProfileInstallation(r), /安装管理.*(?:尚未安全结束|无法读取)|无法读取安装管理/)
    assert.equal(existsSync(r.tavern), false)
    assert.equal(existsSync(path.join(state, 'install.json')), false)
    assert.equal(readFileSync(registry, 'utf8'), marker)
  }
})

test('存在但不是对象的安装位置记录不能按缺失记录放行', t => {
  const r = fixture(t)
  const state = path.join(r.home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  for (const value of [null, false, 0, '']) {
    writeFileSync(path.join(state, 'installation.json'), JSON.stringify(value))
    assert.throws(() => beginDesktopProfileInstallation(r), /安装位置记录状态异常/)
    assert.equal(existsSync(r.tavern), false)
  }
})


test('外部数据登记写入失败时保留卸载标记与数据，不留下无登记的成功状态', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const r = fixture(t)
  const external = mkdtempSync(path.join(tmpdir(), 'retained-tavern-data-'))
  t.after(() => removeTreeSync(external))
  const data = path.join(external, 'data'), alias = path.join(r.home, 'profile-data/tavern')
  renameSync(alias, data)
  symlinkSync(data, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const state = path.join(r.home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  const recordFile = path.join(state, 'installation.json')
  const record = { schemaVersion: 1, phase: 'uninstalled', dataDir: data, retained: [] }
  writeFileSync(recordFile, JSON.stringify(record))
  chmodSync(state, 0o555) // Inject a failure before atomic record publication.
  try { assert.equal(clearUninstalledInstallationRecord(r.home), false) }
  finally { chmodSync(state, 0o755) }
  assert.deepEqual(JSON.parse(readFileSync(recordFile, 'utf8')), record)
  assert.equal(readFileSync(path.join(alias, 'data/story'), 'utf8'), '正文与历史')
})
