import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire, syncBuiltinESMExports } from 'node:module'

// Physical traversal must not mount synthetic ASAR files as Electron directories.
const physical = process.versions.electron ? createRequire(import.meta.url)('original-fs') : fs
const roots = new Set()
// Registered roots reach child processes (real workers, CLIs) through the environment they inherit.
const ROOTS_ENV = 'DSH_TEST_FIXTURE_ROOTS'
const inherited = (process.env[ROOTS_ENV] || '').split(path.delimiter).filter(Boolean)
const registered = () => [...inherited, ...roots]
const publish = () => {
  if (registered().length) process.env[ROOTS_ENV] = registered().join(path.delimiter)
  else delete process.env[ROOTS_ENV]
}
const key = value => {
  const normalized = path.resolve(value).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
const within = (root, file) => key(file).startsWith(key(root) + '/')
const inside = (root, file) => key(file) === key(root) || within(root, file)
// The checkout running the tests and, for a worktree under <live>/.wt/, the live checkout itself.
const checkout = fileURLToPath(new URL('../../', import.meta.url))
const protectedRoots = [checkout, ...(path.basename(path.dirname(checkout)) === '.wt' ? [path.dirname(path.dirname(checkout))] : [])]
const forbidden = file => protectedRoots.some(root => inside(root, file))
const denied = () => new Error('Test safety: links require the same registered synthetic fixture; targets outside it or in the checkout are prohibited')

// Inside a registered fixture any layout is allowed (production names such as data/ or node_modules/ included);
// the link and its resolved target must both stay inside that one fixture.
export function assertFixtureLink(target, link) {
  const destination = path.resolve(link)
  const source = path.resolve(path.dirname(destination), target)
  const root = registered().find(root => !forbidden(root) && within(root, destination) && inside(root, source))
  if (!root || forbidden(destination) || forbidden(source)) throw denied()
  const parent = physical.realpathSync(path.dirname(destination))
  const actual = physical.realpathSync(source)
  if (!inside(root, parent) || !inside(root, actual) || forbidden(actual)) throw denied()
  return source
}

export function auditFixtureLinks(root) {
  if (!roots.has(root) || key(physical.realpathSync(root)) !== key(root)) throw denied()
  const links = [], files = new Map()
  function visit(dir) {
    for (const entry of physical.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (physical.lstatSync(file).isSymbolicLink()) {
        const target = path.resolve(path.dirname(file), physical.readlinkSync(file))
        if (!inside(root, target) || forbidden(target) || forbidden(file)) throw denied()
        // Interrupted directory transactions can leave an internal dangling link.
        // Resolve its nearest existing ancestor rather than following it or assuming safety.
        let ancestor = target
        while (!physical.existsSync(ancestor)) {
          if (key(ancestor) === key(root)) throw denied()
          ancestor = path.dirname(ancestor)
        }
        const actual = physical.realpathSync(ancestor)
        if (!inside(root, actual) || forbidden(actual)) throw denied()
        links.push(file)
      } else if (entry.isDirectory()) visit(file)
      else {
        const stat = physical.lstatSync(file, { bigint: true }), id = `${stat.dev}:${stat.ino}`
        const row = files.get(id) || { count: 0n, nlink: stat.nlink }
        row.count++; files.set(id, row)
      }
    }
  }
  visit(root)
  if ([...files.values()].some(row => row.nlink !== row.count)) throw denied()
  return links
}

export function syntheticFixture(t, prefix = 'fixture-') {
  // Native realpath also expands 8.3 short names (C:\Users\ABCDEF~1), as production path checks do.
  const base = physical.realpathSync.native(tmpdir())
  const root = physical.realpathSync.native(physical.mkdtempSync(path.join(base, prefix)))
  if (!within(base, root) || forbidden(root)) throw denied()
  const handoff = process.env.DSH_TEST_FIXTURE_HANDOFF || path.resolve('.preview/synthetic-fixtures/HANDOFF.md')
  physical.mkdirSync(path.dirname(handoff), { recursive: true })
  physical.appendFileSync(handoff, `\n- Synthetic fixture ${new Date().toISOString()}: ${root}; pid=${process.pid}; same-root links only; audited cleanup required.\n`)
  roots.add(root)
  publish()
  t.after(() => {
    // Validate the entire tree before unlinking anything; an unsafe fixture stays intact.
    const links = auditFixtureLinks(root)
    for (const link of links) physical.unlinkSync(link)
    // Native attachments publish read-only files. All inode names were proven internal first.
    // Removed entry by entry: recursive rmSync aborts the process on non-ASCII Windows paths
    // in Node 24.11 (see bin/portable-fs.mjs), and fixtures use such names on purpose.
    const remove = directory => {
      for (const entry of physical.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name), stat = physical.lstatSync(file)
        if (stat.isSymbolicLink()) throw denied()
        if (stat.isDirectory()) remove(file)
        else { physical.chmodSync(file, 0o600); physical.unlinkSync(file) }
      }
      physical.rmdirSync(directory)
    }
    remove(root)
    roots.delete(root)
    publish()
    physical.appendFileSync(handoff, `- Fixture cleaned after full link audit: ${root}\n`)
  })
  return root
}

let installed = false
export function installFixtureLinkGuard() {
  if (installed) return
  installed = true
  const sync = fs.symlinkSync.bind(fs), callback = fs.symlink.bind(fs), promise = fsp.symlink.bind(fsp)
  const typeFor = (source, type) => type || (process.platform === 'win32' && physical.statSync(source).isDirectory() ? 'junction' : type)
  fs.symlinkSync = (target, link, type) => { const source = assertFixtureLink(target, link); return sync(source, link, typeFor(source, type)) }
  fs.symlink = (target, link, type, done) => {
    if (typeof type === 'function') { done = type; type = undefined }
    try { const source = assertFixtureLink(target, link); return callback(source, link, typeFor(source, type), done) }
    catch (error) { queueMicrotask(() => done(error)) }
  }
  fsp.symlink = async (target, link, type) => { const source = assertFixtureLink(target, link); return promise(source, link, typeFor(source, type)) }
  const linkSync = fs.linkSync.bind(fs), linkCallback = fs.link.bind(fs), linkPromise = fsp.link.bind(fsp)
  const hardlinkTarget = (target, link) => {
    try { return assertFixtureLink(path.resolve(target), link) }
    catch (error) {
      // Match an OS permission denial so production storage can use its real copy fallback.
      if (error.message.startsWith('Test safety:')) error.code = 'EPERM'
      throw error
    }
  }
  fs.linkSync = (target, link) => linkSync(hardlinkTarget(target, link), link)
  fs.link = (target, link, done) => {
    try { return linkCallback(hardlinkTarget(target, link), link, done) }
    catch (error) { queueMicrotask(() => done(error)) }
  }
  fsp.link = async (target, link) => linkPromise(hardlinkTarget(target, link), link)
  syncBuiltinESMExports()
}
