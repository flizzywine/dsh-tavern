import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateInstallationRequest, inspectInstallation, performInstallation } from '../tavern-plugin/packages/dsh-profile-bridge/lib/installation.mjs'
import { registeredTavernTarget, switchProfile, scheduleSwitch } from '../tavern-plugin/packages/dsh-profile-bridge/lib/helper.mjs'
import { beginDesktopProfileInstallation } from '../bin/desktop-profile-installation.mjs'
import location from '../bin/installation-location.cjs'
import { copyTreeSync } from '../bin/portable-fs.mjs'
const repo = fileURLToPath(new URL('../', import.meta.url))
const put = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value)) }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'pb-management-e2e-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), app = path.join(home, 'apps/dsh-tavern')
  const paths = { home, stateDir: path.join(home, 'profile-bridge'), activeDir: path.join(home, 'profiles/desktop') }
  const manifest = name => ({ name, dsh: { profile: { bundles: ['dsh-profile-bridge'] } } })
  put(path.join(app, 'package.json'), manifest('dsh-profile-tavern'))
  put(path.join(app, '.dsh-tavern-local.json'), { host: 'desktop', dshHome: home })
  fs.mkdirSync(path.join(app, 'bin')); fs.copyFileSync(path.join(repo, 'bin/installation-state.cjs'), path.join(app, 'bin/installation-state.cjs'))
  put(path.join(home, 'profiles/tavern/package.json'), manifest('dsh-profile-tavern'))
  put(path.join(paths.activeDir, 'package.json'), manifest('dsh-profile-desktop'))
  put(path.join(home, 'logs/tavern-installation.json'), { host: 'desktop', dshHome: home, sourceRoot: app })
  put(path.join(home, 'profile-data/tavern/sessions/saved.json'), { saved: true })
  put(path.join(home, '.credentials.json'), { token: 'untouched' })
  return { root, home, app, paths, destination: path.join(root, 'other volume 酒馆'), profilesRoot: path.join(home, 'profiles') }
}
const plan = f => validateInstallationRequest(f.paths, 'relocate', { confirmed: true, destination: f.destination })
test('relocation → managed switch → reinstall target → second relocation keeps stable desktop alias', async t => {
  const f = fixture(t)
  const bridgeSource = path.join(repo, 'tavern-plugin/packages/dsh-profile-bridge')
  copyTreeSync(bridgeSource, path.join(f.app, 'tavern-plugin/packages/dsh-profile-bridge'))
  for (const target of ['vendor', 'node_modules']) copyTreeSync(bridgeSource, path.join(f.paths.activeDir, target, 'dsh-profile-bridge'))
  await performInstallation(plan(f))
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), path.join(f.destination, 'app'))
  assert.equal(registeredTavernTarget(f.profilesRoot, path.join(f.profilesRoot, 'tavern')), path.join(f.destination, 'profile'))
  await switchProfile({ mode: 'link', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, targetDir: path.join(f.profilesRoot, 'tavern'), stamp: 'managed' })
  assert.equal(fs.readlinkSync(f.paths.activeDir), path.join(f.profilesRoot, 'tavern'))
  const update = beginDesktopProfileInstallation({ home: f.home, sourceRoot: path.join(f.destination, 'app'), checkStopped() {} })
  assert.equal(update.refreshOnly, true)
  update.finish(); update.commit()
  f.destination = path.join(f.root, 'second location')
  await performInstallation(plan(f))
  assert.equal(fs.realpathSync(f.paths.activeDir), path.join(f.destination, 'profile'))
  await switchProfile({ mode: 'unlink', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, stamp: 'restore' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.paths.activeDir, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(inspectInstallation(f.paths).appDir, path.join(f.destination, 'app'))
})
test('unregistered external profile and symlinked registry fail closed', async t => {
  const f = fixture(t); await performInstallation(plan(f))
  const record = path.join(f.paths.stateDir, 'installation.json'), saved = record + '.saved'
  fs.renameSync(record, saved); fs.symlinkSync(saved, record)
  assert.equal(registeredTavernTarget(f.profilesRoot, path.join(f.profilesRoot, 'tavern')), undefined)
  await assert.rejects(switchProfile({ mode: 'link', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, targetDir: path.join(f.profilesRoot, 'tavern'), stamp: 'bad' }), /独立 profile/)
  assert.equal(fs.lstatSync(f.paths.activeDir).isSymbolicLink(), false)
})
test('standalone management worker survives relocating its source and uninstall restores original', async t => {
  const f = fixture(t)
  const run = async request => {
    const receipt = scheduleSwitch({ ...request, stamp: String(Date.now()), pids: [], relaunch: undefined })
    const end = Date.now() + 15000
    let result
    do {
      await new Promise(resolve => setTimeout(resolve, 25))
      result = JSON.parse(fs.readFileSync(path.join(f.paths.stateDir, 'last-result.json')))
    } while ((result.status === 'pending' || fs.existsSync(path.join(f.paths.stateDir, 'pending'))) && Date.now() < end)
    assert.equal(result.status, 'succeeded', JSON.stringify(result))
    assert.ok(receipt.pid > 1)
  }
  await run(plan(f))
  await switchProfile({ mode: 'link', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, targetDir: path.join(f.profilesRoot, 'tavern'), stamp: 'before-remove' })
  await run(validateInstallationRequest(f.paths, 'uninstall', { confirmed: true }))
  assert.equal(fs.lstatSync(f.paths.activeDir).isSymbolicLink(), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.paths.activeDir, 'package.json'))).name, 'dsh-profile-desktop')
  assert.equal(fs.existsSync(path.join(f.profilesRoot, 'tavern')), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'profile-data/tavern/sessions/saved.json'))), { saved: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, '.credentials.json'))), { token: 'untouched' })
  assert.equal(fs.existsSync(path.join(f.home, '.tavern-install.lock')), false)
})
test('unfinished or corrupt management evidence prevents all queued switches before overwriting status', t => {
  const f = fixture(t)
  const record = path.join(f.paths.stateDir, 'installation-operation.json')
  for (const value of [{ schemaVersion: 1, phase: 'preparing' }, { phase: 'completed' }, { schemaVersion: 1, phase: 'unknown' }]) {
    put(record, value)
    assert.throws(() => scheduleSwitch({ mode: 'link', stateDir: f.paths.stateDir }), error => error.recoveryRequired === true)
    assert.equal(fs.existsSync(path.join(f.paths.stateDir, 'pending')), false)
  }
})

for (const priorMigration of [false, true]) test(`redirected user-home ancestry supports managed relocation and switch, legacy registry ${priorMigration}`, async t => {
  const f = fixture(t)
  if (priorMigration) await performInstallation(plan(f))
  // A real Windows junction (not a platform mock); a directory symlink on POSIX.
  const userAlias = path.join(f.root, 'redirected-user')
  const physicalUser = path.join(f.root, 'physical-user')
  fs.mkdirSync(physicalUser)
  const physicalHome = path.join(physicalUser, 'home')
  fs.renameSync(f.home, physicalHome)
  fs.symlinkSync(physicalUser, userAlias, process.platform === 'win32' ? 'junction' : 'dir')
  const oldHome = f.home
  f.home = path.join(userAlias, 'home'); f.app = path.join(f.home, 'apps/dsh-tavern')
  f.paths = { home: f.home, stateDir: path.join(f.home, 'profile-bridge'), activeDir: path.join(f.home, 'profiles/desktop') }
  f.profilesRoot = path.join(f.home, 'profiles')
  // Simulate records originally written with the configured logical home.
  for (const file of ['logs/tavern-installation.json', ...(priorMigration ? ['profile-bridge/installation.json'] : [])]) {
    const filename = path.join(f.home, file)
    fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').split(oldHome.replaceAll('\\', '\\\\')).join(f.home.replaceAll('\\', '\\\\')))
  }
  put(path.join(f.app, '.dsh-tavern-local.json'), { host: 'desktop', dshHome: f.home })
  assert.equal(inspectInstallation(f.paths).available, true, inspectInstallation(f.paths).reason)
  if (priorMigration) assert.equal(registeredTavernTarget(f.profilesRoot, path.join(f.profilesRoot, 'tavern')), path.join(f.destination, 'profile'))
  fs.symlinkSync(path.join(f.home, 'profile-data/tavern/sessions'), path.join(f.home, 'profile-data/tavern/saved-link'), process.platform === 'win32' ? 'junction' : 'dir')
  f.destination = path.join(f.root, 'redirected-migration')
  await performInstallation(plan(f))
  assert.equal(fs.realpathSync(path.join(f.destination, 'data/saved-link')), path.join(f.destination, 'data/sessions'))
  assert.equal(inspectInstallation(f.paths).available, true, inspectInstallation(f.paths).reason)
  assert.equal(registeredTavernTarget(f.profilesRoot, path.join(f.profilesRoot, 'tavern')), path.join(f.destination, 'profile'))
  await switchProfile({ mode: 'link', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, targetDir: path.join(f.profilesRoot, 'tavern'), stamp: 'redirected' })
  assert.equal(fs.realpathSync(f.paths.activeDir), path.join(f.destination, 'profile'))
  await switchProfile({ mode: 'unlink', profilesRoot: f.profilesRoot, liveDir: f.paths.activeDir, stamp: 'redirected-restore' })
  assert.equal(fs.lstatSync(f.paths.activeDir).isSymbolicLink(), false)
})

test('configured managed home itself remains an untrusted link', t => {
  const f = fixture(t), physical = path.join(f.root, 'moved-home')
  fs.renameSync(f.home, physical)
  fs.symlinkSync(physical, f.home, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(inspectInstallation(f.paths).available, false)
  assert.throws(() => plan(f), /链接/)
})

test('redirected user home does not authorize replaced managed state or unregistered external target', async t => {
  const f = fixture(t), alias = path.join(f.root, 'user-alias')
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  f.paths.home = path.join(alias, 'home'); f.paths.stateDir = path.join(f.paths.home, 'profile-bridge')
  // Physical receipt paths remain valid when the configured home uses an alias.
  assert.equal(inspectInstallation(f.paths).available, true)
  const external = path.join(f.root, 'external')
  put(path.join(external, 'package.json'), { dsh: { profile: { bundles: ['dsh-profile-bridge'] } } })
  await assert.rejects(switchProfile({ mode: 'link', profilesRoot: path.join(f.paths.home, 'profiles'), liveDir: path.join(f.paths.home, 'profiles/desktop'), targetDir: external, stamp: 'reject' }), /独立 profile/)
  fs.mkdirSync(f.paths.stateDir)
  const moved = path.join(f.root, 'untrusted-state')
  fs.renameSync(f.paths.stateDir, moved)
  fs.symlinkSync(moved, f.paths.stateDir, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(inspectInstallation(f.paths).available, false)
  assert.throws(() => scheduleSwitch({ mode: 'link', stateDir: f.paths.stateDir }), /链接/)
  assert.equal(fs.existsSync(path.join(moved, 'pending')), false)
})

test('read-only redirected management storage is inspectable but never bypasses write permissions', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = fixture(t), alias = path.join(f.root, 'readonly-user')
  fs.symlinkSync(f.root, alias, 'dir')
  f.paths.home = path.join(alias, 'home'); f.paths.stateDir = path.join(f.paths.home, 'profile-bridge')
  fs.mkdirSync(f.paths.stateDir)
  fs.chmodSync(f.paths.stateDir, 0o500)
  try {
    assert.equal(inspectInstallation(f.paths).available, true)
    await assert.rejects(performInstallation(plan(f)), error => error.code === 'EACCES')
    assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
    assert.equal(fs.existsSync(f.destination), false)
  } finally { fs.chmodSync(f.paths.stateDir, 0o700) }
})

test('custom app sibling under redirected user ancestry remains manageable', async t => {
  const f = fixture(t), alias = path.join(f.root, 'custom-user')
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const app = path.join(f.root, 'custom-app')
  fs.renameSync(f.app, app)
  f.paths.home = path.join(alias, 'home'); f.paths.stateDir = path.join(f.paths.home, 'profile-bridge')
  put(path.join(f.home, 'logs/tavern-installation.json'), { host: 'desktop', dshHome: f.paths.home, sourceRoot: path.join(alias, 'custom-app') })
  put(path.join(app, '.dsh-tavern-local.json'), { host: 'desktop', dshHome: f.paths.home })
  assert.equal(inspectInstallation(f.paths).appDir, app)
  f.destination = path.join(alias, 'custom-app-relocated')
  await performInstallation(plan(f))
  assert.equal(inspectInstallation(f.paths).available, true)
  assert.equal(inspectInstallation(f.paths).appDir, path.join(f.root, 'custom-app-relocated/app'))
})

test('legacy logical sibling destination and direct alias targets survive repeated relocation', async t => {
  const f = fixture(t), alias = path.join(f.root, 'legacy-user')
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await performInstallation(plan(f))
  f.paths.home = path.join(alias, 'home'); f.paths.stateDir = path.join(f.paths.home, 'profile-bridge')
  const file = path.join(f.paths.stateDir, 'installation.json')
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  const logical = value => path.join(alias, path.relative(f.root, value))
  record.appDir = logical(record.appDir); record.destination = logical(record.destination)
  for (const entry of record.entries) {
    entry.from = logical(entry.from); entry.to = logical(entry.to)
    fs.unlinkSync(entry.from)
    fs.symlinkSync(entry.to, entry.from, process.platform === 'win32' ? 'junction' : 'dir')
  }
  put(file, record)
  assert.equal(inspectInstallation(f.paths).available, true, inspectInstallation(f.paths).reason)
  assert.equal(registeredTavernTarget(path.join(f.paths.home, 'profiles'), path.join(f.paths.home, 'profiles/tavern')), path.join(f.destination, 'profile'))
  f.destination = path.join(alias, 'second-legacy-destination')
  await performInstallation(plan(f))
  assert.equal(inspectInstallation(f.paths).available, true, inspectInstallation(f.paths).reason)
})
