import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beginDesktopProfileInstallation } from '../bin/desktop-profile-installation.mjs'
import { beginOriginalBridgeUpdate } from '../bin/original-bridge-update.mjs'
import { recordInstallationReceipt, readInstallationReceipt } from '../bin/installation-receipt.mjs'
import { switchProfile, acquirePendingLock, scheduleSwitch } from '../tavern-plugin/packages/dsh-profile-bridge/lib/helper.mjs'
import { copyTreeSync, removeTreeSync } from '../bin/portable-fs.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const bridgePath = 'tavern-plugin/packages/dsh-profile-bridge'
const targets = ['vendor/dsh-profile-bridge', 'node_modules/dsh-profile-bridge']
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
const json = (file, value) => put(file, JSON.stringify(value))
const text = file => fs.readFileSync(file, 'utf8')
const link = (target, destination) => fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
function fixture(t, { legacy = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bridge-refresh-中文 ')))
  t.after(() => removeTreeSync(root))
  const home = path.join(root, 'home'), profiles = path.join(home, 'profiles')
  const desktop = path.join(profiles, 'desktop'), tavern = path.join(profiles, 'tavern')
  const sourceRoot = path.join(home, 'apps/dsh-tavern')
  copyTreeSync(path.join(repo, bridgePath), path.join(sourceRoot, bridgePath))
  put(path.join(sourceRoot, bridgePath, 'revision.mjs'), 'export default "old"\n')
  json(path.join(desktop, 'package.json'), { name: 'dsh-profile-desktop', dependencies: { 'user-plugin': '1.0.0' }, dsh: { profile: { bundles: ['official', 'user-plugin'] } } })
  put(path.join(desktop, 'cordis.patch.yml'), '# user configuration\n[]\n')
  put(path.join(desktop, 'node_modules/user-plugin/index.js'), 'user plugin stays')
  put(path.join(home, 'profile-data/tavern/data/story'), 'saved story')
  const f = { root, home, profiles, desktop, tavern, sourceRoot, checkStopped() {} }
  if (legacy) {
    for (const file of ['package.json', 'cordis.patch.yml']) put(path.join(desktop, file + '.backup.1'), text(path.join(desktop, file)))
    json(path.join(desktop, 'package.json'), { name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin'] } } })
    put(path.join(desktop, 'cordis.patch.yml'), '# legacy Tavern configuration\n[]\n')
  }
  const tx = beginDesktopProfileInstallation(f)
  json(path.join(tavern, 'package.json'), { name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin', 'dsh-profile-bridge'] } } })
  tx.finish(); tx.commit()
  f.original = fs.readdirSync(profiles).filter(n => n.startsWith('desktop.fresh-')).map(n => path.join(profiles, n))[0]
  f.manifest = text(path.join(f.original, 'package.json'))
  f.newSource = () => put(path.join(f.sourceRoot, bridgePath, 'revision.mjs'), 'export default "new"\n')
  return f
}
const revisions = dir => targets.map(target => text(path.join(dir, target, 'revision.mjs')))
const assertOld = dir => assert.deepEqual(revisions(dir), ['export default "old"\n', 'export default "old"\n'])
const assertNew = dir => assert.deepEqual(revisions(dir), ['export default "new"\n', 'export default "new"\n'])
function assertPreserved(f, dir) {
  assert.equal(text(path.join(dir, 'package.json')), f.manifest)
  assert.equal(text(path.join(dir, 'cordis.patch.yml')), '# user configuration\n[]\n')
  assert.equal(text(path.join(dir, 'node_modules/user-plugin/index.js')), 'user plugin stays')
  assert.equal(text(path.join(f.home, 'profile-data/tavern/data/story')), 'saved story')
}

test('Tavern update stages new independent bridge, restores new executable code, leaves historical backups and user files alone', async t => {
  const f = fixture(t)
  const historical = path.join(f.profiles, 'desktop.fresh-0000-historical')
  copyTreeSync(f.original, historical)
  f.newSource()
  const tx = beginDesktopProfileInstallation({ ...f, checkStopped() { throw Error('Tavern update must not require desktop exit') } })
  assert.ok(tx, 'already-linked install must refresh original bridge rather than early-return null')
  assertOld(f.original)
  tx.finish(); tx.commit()
  assertNew(f.original); assertOld(historical); assertPreserved(f, f.original)
  assert.equal(fs.realpathSync(f.desktop), fs.realpathSync(f.tavern))
  await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'verify-new-original' })
  assertPreserved(f, f.desktop)
  const loaded = await import(pathToFileURL(path.join(f.desktop, 'node_modules/dsh-profile-bridge/revision.mjs')).href)
  assert.equal(loaded.default, 'new')
  for (const target of targets) assert.equal(fs.lstatSync(path.join(f.desktop, target)).isSymbolicLink(), false)
  // Updating/removing the app must never invalidate the independent original copy.
  removeTreeSync(f.sourceRoot)
  assertNew(f.desktop)
})

test('original-mode update refreshes only owned packages without switching profiles or rewriting configuration', async t => {
  const f = fixture(t)
  await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'original' })
  f.newSource(); let stopped = 0
  const tx = beginDesktopProfileInstallation({ ...f, checkStopped() { stopped++ } })
  tx.finish(); tx.commit()
  assert.ok(stopped > 0)
  assert.equal(fs.lstatSync(f.desktop).isSymbolicLink(), false)
  assertNew(f.desktop); assertPreserved(f, f.desktop)
})

for (const finish of [false, true]) test(`rollback ${finish ? 'after' : 'before'} publication restores both old copies and permits retry`, t => {
  const f = fixture(t); f.newSource()
  const tx = beginOriginalBridgeUpdate(f)
  if (finish) { tx.finish(); assertNew(f.original) }
  tx.rollback(); assertOld(f.original); assertPreserved(f, f.original)
  const retry = beginOriginalBridgeUpdate(f); retry.finish(); retry.commit(); assertNew(f.original)
})

test('a partial staging copy cannot damage either installed bridge copy', t => {
  const f = fixture(t); f.newSource(); let count = 0
  assert.throws(() => beginOriginalBridgeUpdate({ ...f, copy(from, to) {
    copyTreeSync(from, to)
    if (++count === 2) throw Error('injected partial copy failure')
  } }), /injected partial copy failure/)
  assertOld(f.original); assertPreserved(f, f.original)
  const retry = beginOriginalBridgeUpdate(f); retry.finish(); retry.commit(); assertNew(f.original)
})

test('failure publishing the second bridge copy rolls both locations back, retry succeeds', t => {
  const f = fixture(t); f.newSource(); let injected = false
  const tx = beginOriginalBridgeUpdate({ ...f, rename(from, to) {
    if (!injected && to === path.join(f.original, 'node_modules/dsh-profile-bridge')) {
      injected = true; throw Object.assign(Error('injected publish failure'), { code: 'EIO' })
    }
    fs.renameSync(from, to)
  } })
  assert.throws(() => tx.finish(), /injected publish failure/)
  tx.rollback()
  assertOld(f.original); assertPreserved(f, f.original)
  const retry = beginOriginalBridgeUpdate(f); retry.finish(); retry.commit(); assertNew(f.original)
})

test('refresh owns the pending slot until commit, fences concurrent refresh/switch and releases on rollback', t => {
  const f = fixture(t); f.newSource()
  const tx = beginOriginalBridgeUpdate(f)
  assert.throws(() => beginOriginalBridgeUpdate(f))
  assert.throws(() => acquirePendingLock(path.join(f.home, 'profile-bridge')))
  tx.rollback()
  const again = beginOriginalBridgeUpdate(f); again.finish(); again.commit()
  const { lock } = acquirePendingLock(path.join(f.home, 'profile-bridge')); removeTreeSync(lock)
})

for (const phase of ['preparing', 'unknown', 'malformed']) test(`pending management ${phase} journal blocks update even without relocation registry`, t => {
  const f = fixture(t); f.newSource()
  put(path.join(f.home, 'profile-bridge/installation-operation.json'), phase === 'malformed' ? '{' : JSON.stringify({ schemaVersion: 1, phase }))
  assert.throws(() => beginDesktopProfileInstallation(f))
  assertOld(f.original)
})

test('a symlinked owned-package parent is rejected without touching its external target', t => {
  const f = fixture(t); f.newSource()
  const outside = path.join(f.root, 'external-vendor')
  fs.renameSync(path.join(f.original, 'vendor'), outside)
  link(outside, path.join(f.original, 'vendor'))
  assert.throws(() => beginDesktopProfileInstallation(f))
  assert.equal(text(path.join(outside, 'dsh-profile-bridge/revision.mjs')), 'export default "old"\n')
})

for (const originalMode of [false, true]) test(`relocated app/profile update in ${originalMode ? 'original' : 'Tavern'} mode uses new app source, preserves aliases`, async t => {
  const f = fixture(t)
  if (originalMode) await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'before-relocation' })
  const destination = path.join(f.root, 'other volume 中文')
  fs.mkdirSync(destination)
  const appDir = f.sourceRoot
  const entries = ['app', 'profile', 'data'].map(kind => ({ kind, from: kind === 'app' ? appDir : kind === 'profile' ? f.tavern : path.join(f.home, 'profile-data/tavern'), to: path.join(destination, kind) }))
  for (const entry of entries) { fs.renameSync(entry.from, entry.to); link(entry.to, entry.from) }
  json(path.join(f.home, 'profile-bridge/installation.json'), { schemaVersion: 1, phase: 'completed', appDir, destination, entries })
  f.sourceRoot = path.join(destination, 'app'); f.newSource()
  const tx = beginDesktopProfileInstallation(f); tx.finish(); tx.commit()
  assertNew(originalMode ? f.desktop : f.original)
  assertPreserved(f, originalMode ? f.desktop : f.original)
  assert.equal(fs.lstatSync(f.tavern).isSymbolicLink(), true)
  assert.equal(fs.realpathSync(f.tavern), path.join(destination, 'profile'))
  assert.equal(fs.lstatSync(f.desktop).isSymbolicLink(), !originalMode)
})

test('untrusted relocation registry cannot redirect a bridge update', t => {
  const f = fixture(t); f.newSource()
  json(path.join(f.home, 'profile-bridge/installation.json'), { schemaVersion: 1, phase: 'completed', destination: f.root, entries: [] })
  assert.throws(() => beginDesktopProfileInstallation(f))
  assertOld(f.original); assertPreserved(f, f.original)
})

test('updating active original fails closed while desktop is still running', async t => {
  const f = fixture(t)
  await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'active-original' })
  f.newSource()
  assert.throws(() => beginDesktopProfileInstallation({ ...f, checkStopped() { throw Error('desktop is running') } }), /desktop is running/)
  assertOld(f.desktop); assertPreserved(f, f.desktop)
})

test('old desktop backup-file install can subsequently update original bridge without losing restored configuration', async t => {
  const f = fixture(t, { legacy: true })
  f.newSource()
  const update = beginDesktopProfileInstallation(f); update.finish(); update.commit()
  await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'legacy-updated' })
  assertNew(f.desktop); assertPreserved(f, f.desktop)
})

test('a symlink inside source bridge is rejected rather than copied into the independent original', t => {
  const f = fixture(t); f.newSource()
  const external = path.join(f.root, 'external-code.mjs')
  put(external, 'export default "external"\n')
  const revision = path.join(f.sourceRoot, bridgePath, 'revision.mjs')
  fs.unlinkSync(revision); fs.symlinkSync(external, revision)
  assert.throws(() => beginDesktopProfileInstallation(f))
  assertOld(f.original)
  assert.equal(text(external), 'export default "external"\n')
})

test('existing package links are replaced, never followed or used as an update destination', t => {
  const f = fixture(t); f.newSource()
  const external = path.join(f.root, 'external-bridge')
  copyTreeSync(path.join(f.original, targets[0]), external)
  for (const target of targets) { removeTreeSync(path.join(f.original, target)); link(external, path.join(f.original, target)) }
  const tx = beginDesktopProfileInstallation(f); tx.finish(); tx.commit()
  assertNew(f.original)
  assert.equal(text(path.join(external, 'revision.mjs')), 'export default "old"\n')
  for (const target of targets) assert.equal(fs.lstatSync(path.join(f.original, target)).isSymbolicLink(), false)
})

for (const phase of ['preparing', 'unknown']) test(`unfinished bridge-update ${phase} journal prevents switch lock reclamation and reinstall`, t => {
  const f = fixture(t); f.newSource()
  json(path.join(f.home, 'profile-bridge/bridge-update.json'), { phase, actions: [] })
  assert.throws(() => beginDesktopProfileInstallation(f))
  assert.throws(() => acquirePendingLock(path.join(f.home, 'profile-bridge')), error => error.recoveryRequired === true)
  assertOld(f.original)
})

test('rollback failure retains recovery fence instead of claiming success or permitting another switch', t => {
  const f = fixture(t); f.newSource()
  const target = path.join(f.original, 'node_modules/dsh-profile-bridge')
  const tx = beginOriginalBridgeUpdate({ ...f, rename(from, to) {
    if (to === target) throw Object.assign(Error('persistent destination failure'), { code: 'EIO' })
    fs.renameSync(from, to)
  } })
  assert.throws(() => tx.finish(), error => error.unsafeToRetry === true)
  assert.equal(fs.existsSync(path.join(f.home, 'profile-bridge/pending')), true)
  assert.throws(() => beginDesktopProfileInstallation(f), error => error.unsafeToRetry === true)
  assert.throws(() => acquirePendingLock(path.join(f.home, 'profile-bridge')), error => error.recoveryRequired === true)
  const journal = JSON.parse(text(path.join(f.home, 'profile-bridge/bridge-update.json')))
  assert.equal(journal.phase, 'preparing')
  const management = JSON.parse(text(path.join(f.home, 'profile-bridge/installation-operation.json')))
  assert.equal(management.phase, 'preparing')
  assert.equal(management.mode, 'bridge-update')
  assert.equal(management.bridgeUpdateId, tx.bridgeUpdateId)
  assert.throws(() => scheduleSwitch({ mode: 'unlink', stateDir: path.join(f.home, 'profile-bridge') }), error => error.recoveryRequired === true)
  assert.equal(text(path.join(journal.backup, 'previous-1/revision.mjs')), 'export default "old"\n')
})

for (const rollback of [false, true]) test(`node_modules-only legacy bridge ${rollback ? 'rolls back newly created vendor parent' : 'gains an independent vendor copy'}`, t => {
  const f = fixture(t); f.newSource()
  removeTreeSync(path.join(f.original, 'vendor'))
  const tx = beginDesktopProfileInstallation(f)
  tx.finish()
  assertNew(f.original); assertPreserved(f, f.original)
  if (rollback) {
    tx.rollback()
    assert.equal(fs.existsSync(path.join(f.original, 'vendor')), false)
    assert.equal(text(path.join(f.original, 'node_modules/dsh-profile-bridge/revision.mjs')), 'export default "old"\n')
    assertPreserved(f, f.original)
    const retry = beginDesktopProfileInstallation(f); retry.finish(); retry.commit(); assertNew(f.original)
  } else { tx.commit(); assertNew(f.original) }
})

test('unregistered external Tavern alias cannot qualify as an already bridged installation', t => {
  const f = fixture(t); f.newSource()
  const external = path.join(f.root, 'external-tavern')
  fs.renameSync(f.tavern, external); link(external, f.tavern)
  assert.throws(() => beginDesktopProfileInstallation(f))
  assertOld(f.original); assertPreserved(f, f.original)
  assert.equal(fs.realpathSync(f.tavern), external)
})

for (const sourceFault of ['missing', 'malformed']) test(`${sourceFault} bridge source leaves installed copies intact and releases staging lock`, t => {
  const f = fixture(t); f.newSource()
  const source = path.join(f.sourceRoot, bridgePath)
  if (sourceFault === 'missing') removeTreeSync(source)
  else put(path.join(source, 'package.json'), '{')
  assert.throws(() => beginDesktopProfileInstallation(f))
  assertOld(f.original); assertPreserved(f, f.original)
  assert.equal(fs.existsSync(path.join(f.home, 'profile-bridge/pending')), false)
  removeTreeSync(source); copyTreeSync(path.join(repo, bridgePath), source); f.newSource()
  const retry = beginDesktopProfileInstallation(f); retry.finish(); retry.commit(); assertNew(f.original)
})

function receiptFixture(t) {
  const f = fixture(t); f.newSource()
  json(path.join(f.sourceRoot, 'package.json'), { name: 'dsh-profile-tavern' })
  put(path.join(f.sourceRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  json(path.join(f.sourceRoot, '.dsh-tavern-local.json'), { host: 'desktop', dshHome: f.home })
  put(path.join(f.tavern, 'cordis.patch.yml'), '[]\n')
  put(path.join(f.tavern, 'pnpm-workspace.yaml'), 'packages: []\n')
  f.receiptOptions = { sourceRoot: f.sourceRoot, dshHome: f.home, host: 'desktop', attemptId: 'test-attempt' }
  return f
}

test('desktop success receipt is unusable until its staged and published bridge transaction commits', async t => {
  const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
  assert.equal(typeof tx.bridgeUpdateId, 'string')
  const saved = await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  tx.finish()
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  tx.commit()
  assert.deepEqual(await readInstallationReceipt(f.receiptOptions), saved)
})

test('rolled-back refresh receipt cannot validate a retry with a different bridge transaction identity', async t => {
  const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
  tx.finish()
  await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  tx.rollback()
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  const retry = beginDesktopProfileInstallation(f)
  assert.notEqual(retry.bridgeUpdateId, tx.bridgeUpdateId)
  retry.finish(); retry.commit()
  assert.equal(await readInstallationReceipt(f.receiptOptions), null, 'a later completed transaction cannot validate an earlier failed receipt')
  const saved = await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: retry.bridgeUpdateId })
  assert.deepEqual(await readInstallationReceipt(f.receiptOptions), saved)
})

test('a later first-install receipt without bridge identity can supersede an old rolled-back refresh', async t => {
  const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
  tx.finish()
  await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  tx.rollback()
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  const saved = await recordInstallationReceipt(f.receiptOptions)
  assert.deepEqual(await readInstallationReceipt(f.receiptOptions), saved)
  assert.equal(JSON.parse(text(path.join(f.home, 'profile-bridge/bridge-update.json'))).phase, 'rolled-back')
})

for (const journalName of ['install.json', 'bridge-update.json']) {
  for (const fault of ['preparing', 'malformed', 'symlink']) test(`${journalName} ${fault} evidence invalidates a desktop success receipt`, async t => {
    const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
    tx.finish(); tx.commit()
    await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
    assert.ok(await readInstallationReceipt(f.receiptOptions))
    const journal = path.join(f.home, 'profile-bridge', journalName)
    if (fault === 'preparing') {
      const doc = JSON.parse(text(journal)); doc.phase = 'preparing'; json(journal, doc)
    } else if (fault === 'malformed') put(journal, '{')
    else { fs.renameSync(journal, journal + '.saved'); fs.symlinkSync(journal + '.saved', journal) }
    assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  })
}

test('missing bridge journal cannot validate a receipt bound to that bridge transaction', async t => {
  const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
  tx.finish(); tx.commit()
  await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  fs.unlinkSync(path.join(f.home, 'profile-bridge/bridge-update.json'))
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
})

for (const terminal of ['commit', 'rollback']) {
  for (const prior of [false, true]) test(`${terminal} ${prior ? 'restores exact previous management evidence' : 'removes temporary management fence'} after publication`, t => {
    const f = fixture(t); f.newSource()
    const state = path.join(f.home, 'profile-bridge'), file = path.join(state, 'installation-operation.json')
    const priorBytes = '{\n  "schemaVersion": 1,\n  "phase": "completed",\n  "mode": "relocate",\n  "retained": ["keep exact bytes"]\n}\n'
    if (prior) put(file, priorBytes)
    const tx = beginDesktopProfileInstallation(f)
    if (prior) assert.equal(text(file), priorBytes)
    else assert.equal(fs.existsSync(file), false)
    tx.finish()
    const fence = JSON.parse(text(file))
    assert.equal(fence.phase, 'preparing')
    assert.equal(fence.mode, 'bridge-update')
    assert.equal(fence.bridgeUpdateId, tx.bridgeUpdateId)
    assert.throws(() => scheduleSwitch({ mode: 'unlink', stateDir: state }), error => error.recoveryRequired === true)
    tx[terminal]()
    if (prior) assert.equal(text(file), priorBytes)
    else assert.equal(fs.existsSync(file), false)
    assert.equal(fs.existsSync(path.join(state, 'pending')), false)
    if (terminal === 'commit') assertNew(f.original)
    else assertOld(f.original)
  })
}

test('commit cleanup failure followed by failed rollback restores both recovery barriers and invalidates receipt', async t => {
  const f = receiptFixture(t)
  let failRollback = false
  const tx = beginOriginalBridgeUpdate({ ...f, rename(from, to) {
    if (failRollback && to === path.join(f.original, 'node_modules/dsh-profile-bridge')) {
      throw Object.assign(Error('injected rollback after commit failure'), { code: 'EIO' })
    }
    fs.renameSync(from, to)
  } })
  tx.finish()
  await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  const state = path.join(f.home, 'profile-bridge')
  put(path.join(state, 'pending/unexpected-file'), 'prevent lock directory removal')
  assert.throws(() => tx.commit(), error => error.code === 'ENOTEMPTY' || error.code === 'EEXIST')
  failRollback = true
  assert.throws(() => tx.rollback(), error => error.unsafeToRetry === true)
  assert.equal(JSON.parse(text(path.join(state, 'bridge-update.json'))).phase, 'preparing')
  const barrier = JSON.parse(text(path.join(state, 'installation-operation.json')))
  assert.equal(barrier.phase, 'preparing')
  assert.equal(barrier.bridgeUpdateId, tx.bridgeUpdateId)
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  assert.throws(() => scheduleSwitch({ mode: 'unlink', stateDir: state }), error => error.recoveryRequired === true)
})

for (const journalName of ['bridge-update.json', 'installation-operation.json']) test(`receipt rejects ${journalName} without recognized schemaVersion`, async t => {
  const f = receiptFixture(t), tx = beginDesktopProfileInstallation(f)
  tx.finish(); tx.commit()
  await recordInstallationReceipt({ ...f.receiptOptions, bridgeUpdateId: tx.bridgeUpdateId })
  const journal = path.join(f.home, 'profile-bridge', journalName)
  const doc = journalName === 'bridge-update.json' ? JSON.parse(text(journal)) : { phase: 'completed' }
  delete doc.schemaVersion
  json(journal, doc)
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
  doc.schemaVersion = 999; json(journal, doc)
  assert.equal(await readInstallationReceipt(f.receiptOptions), null)
})

// Windows runs these fixtures with actual directory junctions; POSIX uses links.
for (const mode of ['original', 'tavern']) test(`redirected user-home ancestor permits ${mode} bridge update without changing profiles`, async t => {
  const f = fixture(t)
  if (mode === 'original') await switchProfile({ mode: 'unlink', profilesRoot: f.profiles, liveDir: f.desktop, stamp: 'redirected-original' })
  f.newSource()
  const aliasRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bridge-user-alias-')))
  t.after(() => removeTreeSync(aliasRoot))
  const userHome = path.join(aliasRoot, 'redirected-user')
  link(f.root, userHome)
  const home = path.join(userHome, 'home')
  const sourceRoot = path.join(home, 'apps/dsh-tavern')
  const tx = beginDesktopProfileInstallation({ home, sourceRoot, checkStopped() {} })
  tx.finish(); tx.commit()
  const original = mode === 'original' ? f.desktop : f.original
  assertNew(original); assertPreserved(f, original)
  assert.equal(fs.lstatSync(f.desktop).isSymbolicLink(), mode === 'tavern')
})

test('bridge transaction pins trusted user-home identity before ancestor is redirected', t => {
  const f = fixture(t); f.newSource()
  const aliases = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bridge-home-pin-')))
  t.after(() => removeTreeSync(aliases))
  const user = path.join(aliases, 'user'), replacement = path.join(aliases, 'replacement')
  fs.mkdirSync(replacement); link(f.root, user)
  const tx = beginOriginalBridgeUpdate({ ...f, home: path.join(user, 'home') })
  fs.unlinkSync(user); link(replacement, user)
  tx.finish(); tx.commit()
  assertNew(f.original); assertPreserved(f, f.original)
  assert.deepEqual(fs.readdirSync(replacement), [])
})

for (const managed of ['home', 'profile-bridge', 'profiles']) test(`redirected user ancestor does not permit linked managed ${managed}`, t => {
  const f = fixture(t); f.newSource()
  const aliases = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bridge-home-guard-')))
  t.after(() => removeTreeSync(aliases))
  const user = path.join(aliases, 'user'); link(f.root, user)
  const source = managed === 'home' ? f.home : path.join(f.home, managed)
  const moved = path.join(f.root, 'moved-managed')
  fs.renameSync(source, moved); link(moved, source)
  assert.throws(() => beginOriginalBridgeUpdate({ ...f, home: path.join(user, 'home') }))
  assertOld(f.original); assertPreserved(f, f.original)
  assert.equal(fs.existsSync(path.join(f.home, 'profile-bridge/pending')), false)
})

for (const stored of ['logical', 'physical']) test(`redirected user home refreshes migrated bridge with ${stored} registry paths`, t => {
  const f = fixture(t); f.newSource()
  const aliases = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bridge-relocated-home-')))
  t.after(() => removeTreeSync(aliases))
  const user = path.join(aliases, 'user'); link(f.root, user)
  const home = path.join(user, 'home'), registryHome = stored === 'logical' ? home : f.home
  const destination = path.join(f.root, 'relocated'); fs.mkdirSync(destination)
  const entries = ['app', 'profile', 'data'].map(kind => ({ kind,
    from: path.join(registryHome, kind === 'app' ? 'apps/dsh-tavern' : kind === 'profile' ? 'profiles/tavern' : 'profile-data/tavern'),
    to: path.join(destination, kind),
  }))
  for (const entry of entries) { fs.renameSync(entry.from, entry.to); link(entry.to, entry.from) }
  json(path.join(home, 'profile-bridge/installation.json'), { schemaVersion: 1, phase: 'completed', appDir: entries[0].from, destination, entries })
  const before = text(path.join(home, 'profile-bridge/installation.json'))
  const tx = beginDesktopProfileInstallation({ home, sourceRoot: path.join(home, 'apps/dsh-tavern'), checkStopped() {} })
  tx.finish(); tx.commit()
  assertNew(f.original); assertPreserved(f, f.original)
  assert.equal(text(path.join(home, 'profile-bridge/installation.json')), before)
  for (const entry of entries) assert.equal(fs.realpathSync(entry.from), entry.to)
})
