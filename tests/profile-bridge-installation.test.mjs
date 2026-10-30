import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectInstallation, validateInstallationRequest, performInstallation } from '../tavern-plugin/packages/dsh-profile-bridge/lib/installation.mjs'
const put = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)) }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-management-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), app = path.join(home, 'apps/dsh-tavern')
  const paths = { home, stateDir: path.join(home, 'profile-bridge'), activeDir: path.join(home, 'profiles/desktop') }
  put(path.join(app, 'package.json'), { name: 'dsh-profile-tavern' })
  put(path.join(app, '.dsh-tavern-local.json'), { host: 'desktop', dshHome: home })
  put(path.join(home, 'profiles/tavern/package.json'), { name: 'dsh-profile-tavern' })
  put(path.join(paths.activeDir, 'package.json'), { name: 'dsh-profile-desktop' })
  put(path.join(home, 'logs/tavern-installation.json'), { host: 'desktop', dshHome: home, sourceRoot: app })
  put(path.join(home, 'profile-data/tavern/data/cards/card.json'), 'card')
  put(path.join(home, 'profile-data/tavern/data/cache/fonts/verified-face'), 'cached-font')
  put(path.join(home, 'profile-data/tavern/sessions/session.json'), 'session')
  put(path.join(home, 'credentials.json'), 'secret')
  return { root, home, app, paths, destination: path.join(root, 'new location 酒馆') }
}
const plan = f => validateInstallationRequest(f.paths, 'relocate', { confirmed: true, destination: f.destination })
test('relocates whole Tavern footprint, retains backups and leaves shared home unchanged', async t => {
  const f = fixture(t), request = plan(f)
  const result = await performInstallation(request)
  assert.equal(result.retained.length, 3)
  for (const kind of ['app', 'profile', 'data']) assert.ok(fs.statSync(path.join(f.destination, kind)).isDirectory())
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/sessions/session.json'), 'utf8'), 'session')
  assert.equal(fs.readFileSync(path.join(f.home, 'credentials.json'), 'utf8'), 'secret')
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/data/cache/fonts/verified-face'), 'utf8'), 'cached-font')
  assert.ok(result.retained.every(p => fs.existsSync(p)))
  assert.equal(inspectInstallation(f.paths).available, true)
  assert.equal(inspectInstallation(f.paths).relocated, true)
})
test('refuses nonempty/relative/overlapping/symlink targets without mutation', t => {
  const f = fixture(t)
  fs.mkdirSync(f.destination); put(path.join(f.destination, 'mine'), 'mine')
  for (const destination of [f.destination, 'relative', f.home, f.root, path.join(f.app, 'inside')]) assert.throws(() => validateInstallationRequest(f.paths, 'relocate', { confirmed: true, destination }))
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.destination, alias, 'dir')
  assert.throws(() => validateInstallationRequest(f.paths, 'relocate', { confirmed: true, destination: path.join(alias, 'new') }))
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
})
test('requires consent and matching ownership; refuses git source', t => {
  const f = fixture(t)
  assert.throws(() => validateInstallationRequest(f.paths, 'uninstall', {}))
  fs.mkdirSync(path.join(f.app, '.git'))
  assert.equal(inspectInstallation(f.paths).available, false)
})
test('rewrites internal dependency links; refuses user-data links escaping ownership', async t => {
  const f = fixture(t)
  put(path.join(f.app, 'node_modules/pkg/index.js'), 'export default 1')
  fs.symlinkSync(path.join(f.app, 'node_modules/pkg'), path.join(f.home, 'profiles/tavern/pkg'), 'dir')
  await performInstallation(plan(f))
  assert.equal(fs.realpathSync(path.join(f.destination, 'profile/pkg')), path.join(f.destination, 'app/node_modules/pkg'))
  const g = fixture(t)
  fs.symlinkSync(g.root, path.join(g.home, 'profile-data/tavern/escape'), 'dir')
  await assert.rejects(performInstallation(plan(g)), /外部链接/)
  assert.equal(fs.lstatSync(g.app).isSymbolicLink(), false)
})
test('activation failure restores all original paths and leaves copied data for diagnosis', async t => {
  const f = fixture(t)
  let links = 0
  await assert.rejects(performInstallation(plan(f), { link: (...args) => { if (++links === 2) throw new Error('injected failure'); return fs.symlinkSync(...args) } }), /injected failure/)
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
  assert.equal(fs.lstatSync(path.join(f.home, 'profiles/tavern')).isSymbolicLink(), false)
  assert.ok(fs.existsSync(path.join(f.destination, 'data/sessions/session.json')))
  assert.equal(inspectInstallation(f.paths).available, true)
})
test('failed rollback blocks retries with recovery required', async t => {
  const f = fixture(t)
  await assert.rejects(performInstallation(plan(f), { link: () => { throw new Error('link failed') }, rename: (from, to) => { if (from.includes('.switch-backup-')) throw new Error('restore blocked'); return fs.renameSync(from, to) } }), e => e.recoveryRequired === true)
  assert.equal(inspectInstallation(f.paths).recoveryRequired, true)
})
test('uninstall quarantines app/profile but preserves original DSH and all Tavern data', async t => {
  const f = fixture(t)
  const result = await performInstallation(validateInstallationRequest(f.paths, 'uninstall', { confirmed: true }))
  assert.equal(fs.existsSync(f.app), false)
  assert.equal(fs.existsSync(path.join(f.home, 'profiles/tavern')), false)
  assert.ok(result.retained.every(p => fs.existsSync(p)))
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/data/cards/card.json'), 'utf8'), 'card')
  assert.equal(fs.readFileSync(path.join(f.home, 'credentials.json'), 'utf8'), 'secret')
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/data/cache/fonts/verified-face'), 'utf8'), 'cached-font')
  assert.ok(fs.existsSync(path.join(f.paths.activeDir, 'package.json')))
})
test('second relocation and relocated uninstall preserve data without alias chains', async t => {
  const f = fixture(t)
  await performInstallation(plan(f))
  f.destination = path.join(f.root, 'second')
  await performInstallation(plan(f))
  assert.equal(fs.realpathSync(f.app), path.join(f.destination, 'app'))
  await performInstallation(validateInstallationRequest(f.paths, 'uninstall', { confirmed: true }))
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/sessions/session.json'), 'utf8'), 'session')
  assert.equal(fs.existsSync(f.app), false)
  assert.equal(fs.readFileSync(path.join(f.home, 'profile-data/tavern/data/cache/fonts/verified-face'), 'utf8'), 'cached-font')
})
test('source changes during copy abort before activating any aliases', async t => {
  const f = fixture(t)
  await assert.rejects(performInstallation(plan(f), { afterCopy: () => put(path.join(f.home, 'profile-data/tavern/sessions/new-session.json'), 'new') }), /源目录发生变化/)
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
  assert.equal(inspectInstallation(f.paths).available, true)
})
test('registered alias tampering and interrupted journals fail closed', async t => {
  const f = fixture(t)
  await performInstallation(plan(f))
  fs.unlinkSync(f.app); fs.symlinkSync(f.root, f.app, 'dir')
  assert.equal(inspectInstallation(f.paths).available, false)
  const g = fixture(t)
  put(path.join(g.paths.stateDir, 'installation-operation.json'), { phase: 'preparing' })
  assert.equal(inspectInstallation(g.paths).recoveryRequired, true)
})
test('malformed, unknown and unsupported journals block mutation and demand recovery', t => {
  for (const journal of ['{invalid', { phase: 'completed' }, { schemaVersion: 2, phase: 'completed' }, { schemaVersion: 1, phase: 'unknown' }, { schemaVersion: 1, phase: 'preparing' }]) {
    const f = fixture(t)
    put(path.join(f.paths.stateDir, 'installation-operation.json'), journal)
    assert.equal(inspectInstallation(f.paths).recoveryRequired, true)
    assert.throws(() => plan(f), error => error.recoveryRequired === true)
    assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
  }
  for (const phase of ['completed', 'rolled-back']) {
    const f = fixture(t)
    put(path.join(f.paths.stateDir, 'installation-operation.json'), { schemaVersion: 1, phase })
    assert.equal(inspectInstallation(f.paths).available, true)
  }
})
test('journal completion write failure restores previous registry and aliases', async t => {
  const f = fixture(t)
  await performInstallation(plan(f))
  const registry = path.join(f.paths.stateDir, 'installation.json')
  const before = fs.readFileSync(registry, 'utf8')
  f.destination = path.join(f.root, 'second-fails')
  let failed = false
  await assert.rejects(performInstallation(plan(f), { persist: (file, value) => {
    if (!failed && file.endsWith('installation-operation.json') && value.phase === 'completed') { failed = true; throw new Error('injected completion persistence failure') }
    fs.writeFileSync(file, JSON.stringify(value, null, 2))
  } }), /completion persistence failure/)
  assert.equal(fs.readFileSync(registry, 'utf8'), before)
  assert.equal(fs.realpathSync(f.app), path.join(f.root, 'new location 酒馆/app'))
  assert.equal(inspectInstallation(f.paths).available, true)
})
test('registry publication failure rolls back all aliases without removing copies', async t => {
  const f = fixture(t)
  await assert.rejects(performInstallation(plan(f), { persist: (file, value) => {
    if (file.endsWith('installation.json')) throw new Error('injected registry publication failure')
    fs.writeFileSync(file, JSON.stringify(value, null, 2))
  } }), /registry publication failure/)
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
  assert.equal(fs.existsSync(path.join(f.paths.stateDir, 'installation.json')), false)
  assert.ok(fs.existsSync(path.join(f.destination, 'data/sessions/session.json')))
  assert.equal(inspectInstallation(f.paths).available, true)
})
test('symlink journal is not trusted even when linked content says completed', t => {
  const f = fixture(t)
  const outside = path.join(f.root, 'journal.json')
  put(outside, { schemaVersion: 1, phase: 'completed' })
  fs.mkdirSync(f.paths.stateDir, { recursive: true })
  fs.symlinkSync(outside, path.join(f.paths.stateDir, 'installation-operation.json'))
  assert.equal(inspectInstallation(f.paths).recoveryRequired, true)
})
test('registered aliases cannot legitimize relocation inside shared DSH home', async t => {
  const f = fixture(t)
  await performInstallation(plan(f))
  const registry = path.join(f.paths.stateDir, 'installation.json')
  const record = JSON.parse(fs.readFileSync(registry))
  const forged = path.join(f.home, 'logs/shared-tree')
  fs.renameSync(f.destination, forged)
  record.destination = forged
  for (const e of record.entries) {
    fs.unlinkSync(e.from)
    e.to = path.join(forged, e.kind)
    fs.symlinkSync(e.to, e.from, 'dir')
  }
  put(registry, record)
  assert.equal(inspectInstallation(f.paths).available, false)
  assert.match(inspectInstallation(f.paths).reason, /重叠/)
  assert.throws(() => validateInstallationRequest(f.paths, 'uninstall', { confirmed: true }), /重叠/)
})
test('registered aliases must point directly to the registered target, not an alias chain', async t => {
  const f = fixture(t)
  await performInstallation(plan(f))
  const middle = path.join(f.root, 'intermediate-link')
  fs.symlinkSync(path.join(f.destination, 'app'), middle, 'dir')
  fs.unlinkSync(f.app); fs.symlinkSync(middle, f.app, 'dir')
  assert.equal(inspectInstallation(f.paths).available, false)
})
function fakeOwnership() {
  const state = { owned: true, gated: false, updates: 0 }
  const assertOwnership = () => { if (!state.owned) throw Object.assign(new Error('lease lost'), { code: 'INSTALLATION_OWNERSHIP_LOST' }) }
  const ownership = {
    assertOwnership,
    withOwnership(callback) { assertOwnership(); state.gated = true; try { return callback() } finally { state.gated = false } },
    update() { assertOwnership(); state.updates++ },
  }
  return { state, ownership }
}
test('copy and hash loops refresh lease and fence every publication mutation', async t => {
  const f = fixture(t), { state, ownership } = fakeOwnership()
  put(path.join(f.app, 'large.bin'), Buffer.alloc(3 * 1024 * 1024).toString('base64'))
  let time = 0
  await performInstallation(plan(f), {
    ownership, now: () => (time += 3000),
    persist(file, value) { assert.equal(state.gated, true); fs.writeFileSync(file, JSON.stringify(value)) },
    rename(from, to) { assert.equal(state.gated, true); fs.renameSync(from, to) },
    link(to, from, kind) { assert.equal(state.gated, true); fs.symlinkSync(to, from, kind) },
  })
  assert.ok(state.updates > 20, 'large files refresh lease during chunked copy and hashing')
})
test('lease lost before activation never changes source aliases or publishes unowned recovery', async t => {
  const f = fixture(t), { state, ownership } = fakeOwnership()
  await assert.rejects(performInstallation(plan(f), { ownership, afterCopy: () => { state.owned = false } }), e => e.recoveryRequired === true)
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.paths.stateDir, 'installation-operation.json'))).phase, 'preparing')
})
test('lease lost after mutation does not roll back under a successor owner', async t => {
  const f = fixture(t), { state, ownership } = fakeOwnership()
  await assert.rejects(performInstallation(plan(f), { ownership, link: (...args) => { fs.symlinkSync(...args); state.owned = false } }), e => e.recoveryRequired === true)
  assert.equal(fs.lstatSync(f.app).isSymbolicLink(), true)
  assert.equal(fs.lstatSync(path.join(f.home, 'profiles/tavern')).isSymbolicLink(), false)
  assert.equal(inspectInstallation(f.paths).recoveryRequired, true)
})
