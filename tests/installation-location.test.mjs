import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync, readFileSync, renameSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import location from '../bin/installation-location.cjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'tavern-location-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), destination = path.join(root, 'other volume 中文')
  const appDir = path.join(home, 'apps', 'dsh-tavern')
  mkdirSync(path.join(home, 'profile-bridge'), { recursive: true })
  mkdirSync(destination)
  const entries = ['app', 'profile', 'data'].map(kind => ({ kind,
    from: kind === 'app' ? appDir : path.join(home, kind === 'profile' ? 'profiles' : 'profile-data', 'tavern'),
    to: path.join(destination, kind) }))
  for (const entry of entries) {
    mkdirSync(entry.to); mkdirSync(path.dirname(entry.from), { recursive: true })
    symlinkSync(entry.to, entry.from, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const record = { schemaVersion: 1, phase: 'completed', appDir, destination, entries }
  const filename = path.join(home, 'profile-bridge', 'installation.json')
  const save = () => writeFileSync(filename, JSON.stringify(record))
  save()
  return { home, destination, appDir, record, filename, save }
}

test('unregistered installs retain default and explicitly configured paths', t => {
  const f = fixture(t); unlinkSync(f.filename)
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), f.appDir)
  assert.equal(location.resolveInstallationApp({ dshHome: f.home, appDir: f.destination }), f.destination)
})
test('completed relocation resolves physical app for default, logical and physical requests', t => {
  const f = fixture(t), target = path.join(f.destination, 'app')
  for (const appDir of [undefined, f.appDir, target]) assert.equal(location.resolveInstallationApp({ dshHome: f.home, appDir }), target)
  assert.equal(execFileSync(process.execPath, ['bin/installation-location.cjs', f.home], { encoding: 'utf8' }).trim(), target)
})
test('custom original app path is honored without an explicit override', t => {
  const f = fixture(t), prior = f.appDir
  f.record.appDir = path.join(f.home, 'custom-app'); f.record.entries[0].from = f.record.appDir
  unlinkSync(prior); symlinkSync(f.record.entries[0].to, f.record.appDir, process.platform === 'win32' ? 'junction' : 'dir'); f.save()
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), f.record.entries[0].to)
})
for (const mutation of ['phase', 'malformed', 'missing-entry', 'outside-target', 'wrong-alias', 'missing-target', 'conflicting-override']) {
  test(`reject ${mutation} without writing any source`, t => {
    const f = fixture(t); let appDir
    if (mutation === 'phase') f.record.phase = 'copying'
    if (mutation === 'missing-entry') f.record.entries.pop()
    if (mutation === 'outside-target') f.record.entries[0].to = f.home
    if (mutation === 'wrong-alias') { unlinkSync(f.appDir); symlinkSync(f.destination, f.appDir, process.platform === 'win32' ? 'junction' : 'dir') }
    if (mutation === 'missing-target') rmSync(f.record.entries[0].to, { recursive: true })
    if (mutation === 'conflicting-override') appDir = f.destination
    f.save(); if (mutation === 'malformed') writeFileSync(f.filename, '{')
    const before = readFileSync(f.filename, 'utf8')
    assert.throws(() => location.resolveInstallationApp({ dshHome: f.home, appDir }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
    assert.equal(readFileSync(f.filename, 'utf8'), before)
  })
}
test('embedded standalone resolver stays synchronized', () => {
  execFileSync(process.execPath, ['bin/build-installer-scripts.mjs', '--check'])
  const sh = readFileSync('install.sh', 'utf8'), ps = readFileSync('install.ps1', 'utf8')
  assert.ok(sh.indexOf('APP_DIR=$(node "${TEMP_DIR}/installation-location.cjs"') > sh.indexOf('export DSH_TAVERN_INSTALL_ATTEMPT DSH_TAVERN_INSTALL_LOCK'))
  assert.ok(ps.indexOf('$ResolvedAppDir = & node') > ps.indexOf('$env:DSH_TAVERN_INSTALL_LOCK = $InstallationOwner.lockDir'))
})

for (const phase of ['preparing', 'unknown', 'malformed', 'missing-version']) {
  for (const registered of [false, true]) test(`installer blocks ${phase} management journal, registry ${registered}`, t => {
    const f = fixture(t)
    if (!registered) unlinkSync(f.filename)
    const operation = phase === 'missing-version' ? { phase: 'completed' } : { schemaVersion: 1, phase }
    writeFileSync(path.join(f.home, 'profile-bridge/installation-operation.json'), phase === 'malformed' ? '{' : JSON.stringify(operation))
    assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
  })
}
for (const phase of ['completed', 'rolled-back']) test(`installer allows terminal ${phase} management journal`, t => {
  const f = fixture(t)
  writeFileSync(path.join(f.home, 'profile-bridge/installation-operation.json'), JSON.stringify({ schemaVersion: 1, phase }))
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), path.join(f.destination, 'app'))
  unlinkSync(f.filename)
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), f.appDir)
})

test('forged fully linked destination inside shared home is refused', t => {
  const f = fixture(t), shared = path.join(f.home, 'logs/shared-tree')
  mkdirSync(path.dirname(shared), { recursive: true }); renameSync(f.destination, shared)
  f.record.destination = shared
  for (const entry of f.record.entries) {
    entry.to = path.join(shared, entry.kind)
    unlinkSync(entry.from); symlinkSync(entry.to, entry.from, process.platform === 'win32' ? 'junction' : 'dir')
  }
  f.save()
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})
test('destination cannot contain shared home or logical custom app', t => {
  const f = fixture(t)
  for (const destination of [path.dirname(f.home), f.home, f.appDir]) {
    f.record.destination = destination; f.save()
    assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
  }
})
for (const registered of [true, false]) test(`linked state ancestor rejected, registry ${registered}`, t => {
  const f = fixture(t), state = path.join(f.home, 'profile-bridge'), moved = path.join(f.destination, 'state')
  if (!registered) unlinkSync(f.filename)
  renameSync(state, moved); symlinkSync(moved, state, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})
test('linked terminal management journal is never trusted', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), target = path.join(f.destination, 'journal.json')
  writeFileSync(target, JSON.stringify({ schemaVersion: 1, phase: 'completed' }))
  symlinkSync(target, path.join(f.home, 'profile-bridge/installation-operation.json'), 'file')
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})

// Native Windows uses real directory junctions; POSIX uses directory symlinks.
// Fixtures never touch the current user's configured home.
function redirectedFixture(t, { nested = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'tavern-home-redirect-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const physicalUser = path.join(root, 'physical user 中文'), logicalUser = path.join(root, 'user-link')
  mkdirSync(physicalUser)
  symlinkSync(physicalUser, logicalUser, process.platform === 'win32' ? 'junction' : 'dir')
  const suffix = nested ? 'nested/user/.dsh' : '.dsh'
  const home = path.join(logicalUser, suffix), physical = path.join(physicalUser, suffix)
  return { root, home, physical, logicalUser, physicalUser }
}
for (const nested of [false, true]) test(`configured user-home ${nested ? 'ancestor' : 'itself'} redirect allows missing managed home`, t => {
  const f = redirectedFixture(t, { nested })
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), path.join(f.home, 'apps/dsh-tavern'))
  assert.equal(location.trustedHome(f.home).physical, f.physical)
  mkdirSync(path.join(f.physical, 'profile-bridge'), { recursive: true })
  assert.equal(location.resolveInstallationApp({ dshHome: f.home }), path.join(f.home, 'apps/dsh-tavern'))
})
for (const physicalRecord of [false, true]) test(`migrated install under redirected home accepts ${physicalRecord ? 'physical' : 'legacy logical'} registry`, t => {
  const f = redirectedFixture(t), home = physicalRecord ? f.physical : f.home
  mkdirSync(path.join(home, 'profile-bridge'), { recursive: true })
  const destination = path.join(f.root, 'relocated'), appDir = path.join(home, 'apps/dsh-tavern')
  const entries = ['app', 'profile', 'data'].map(kind => ({ kind, from: kind === 'app' ? appDir : path.join(home, kind === 'profile' ? 'profiles/tavern' : 'profile-data/tavern'), to: path.join(destination, kind) }))
  for (const entry of entries) {
    mkdirSync(entry.to, { recursive: true }); mkdirSync(path.dirname(entry.from), { recursive: true })
    symlinkSync(entry.to, entry.from, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const filename = path.join(home, 'profile-bridge/installation.json')
  writeFileSync(filename, JSON.stringify({ schemaVersion: 1, phase: 'completed', destination, appDir, entries }))
  const before = readFileSync(filename, 'utf8')
  for (const request of [undefined, path.join(f.home, 'apps/dsh-tavern'), path.join(f.physical, 'apps/dsh-tavern'), entries[0].to]) {
    assert.equal(location.resolveInstallationApp({ dshHome: f.home, appDir: request }), entries[0].to)
  }
  assert.equal(readFileSync(filename, 'utf8'), before)
  unlinkSync(entries[0].from); symlinkSync(f.root, entries[0].from, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})
for (const managed of ['', 'profile-bridge']) test(`user redirect does not authorize linked managed ${managed || 'home'}`, t => {
  const f = redirectedFixture(t), target = path.join(f.root, 'malicious')
  mkdirSync(target)
  if (managed) mkdirSync(f.physical)
  symlinkSync(target, path.join(f.physical, managed), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})
test('redirected home rejects linked registry and retains specific CLI failure on stderr', { skip: process.platform === 'win32' }, t => {
  const f = redirectedFixture(t)
  mkdirSync(path.join(f.physical, 'profile-bridge'), { recursive: true })
  const target = path.join(f.root, 'record.json')
  writeFileSync(target, '{}')
  symlinkSync(target, path.join(f.home, 'profile-bridge/installation.json'))
  assert.throws(() => execFileSync(process.execPath, ['bin/installation-location.cjs', f.home], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.equal(error.stdout, '')
    assert.match(error.stderr, /安装记录不能是链接/)
    return true
  })
})
test('a dangling user-home redirect is rejected, not treated as a missing prefix', t => {
  const f = redirectedFixture(t)
  rmSync(f.physicalUser, { recursive: true })
  assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), { code: 'INSTALLATION_LOCATION_UNSAFE' })
})

test('read-only redirected home can be resolved without writes', { skip: process.platform === 'win32' }, t => {
  const f = redirectedFixture(t)
  mkdirSync(path.join(f.physical, 'profile-bridge'), { recursive: true })
  chmodSync(f.physical, 0o500)
  try { assert.equal(location.resolveInstallationApp({ dshHome: f.home }), path.join(f.home, 'apps/dsh-tavern')) }
  finally { chmodSync(f.physical, 0o700) }
})
test('inaccessible user-home ancestry reports permissions, not migration', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const f = redirectedFixture(t, { nested: true })
  mkdirSync(path.dirname(f.physical), { recursive: true })
  chmodSync(f.physicalUser, 0)
  try { assert.throws(() => location.resolveInstallationApp({ dshHome: f.home }), /EACCES/) }
  finally { chmodSync(f.physicalUser, 0o700) }
})

test('trusted parent identity also supports a custom app sibling without trusting its links', t => {
  const f = redirectedFixture(t)
  mkdirSync(f.physical)
  const custom = path.join(f.logicalUser, 'custom-app')
  assert.equal(location.trustedHome(f.home).map(custom), path.join(f.physicalUser, 'custom-app'))
  assert.equal(location.resolveInstallationApp({ dshHome: f.home, appDir: custom }), custom)
  const untrusted = path.join(f.root, 'other-link')
  symlinkSync(f.physicalUser, untrusted, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(location.trustedHome(f.home).map(untrusted), untrusted)
})
