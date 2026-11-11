import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { copyTreeSync, removeTreeSync } from './portable-fs.mjs'
import { stagedPaths } from './staged-app-install.mjs'
import { trustedHome } from '../tavern-plugin/packages/dsh-tavern/lib/trusted-home.mjs'

const CONFIG_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']
const VALIDATION_FILES = ['cordis.yml', '.npmrc', 'desktop-next.cordis.patch.json', 'desktop-next.runtime.patch.json']
const readOptional = file => existsSync(file) ? readFileSync(file, 'utf8') : null
const childOf = (target, root) => {
  const relative = path.relative(root, target)
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
}

export function nextUpdatePreparation({ app, sourceRoot, home, profileDir, gate }) {
  app = path.resolve(app)
  const lock = path.join(home, 'profile-bridge', 'install-pending')
  const requestFile = path.join(lock, 'request.json')
  const trusted = trustedHome(home)
  trusted.ordinary(requestFile)
  const request = JSON.parse(readFileSync(requestFile, 'utf8'))
  const profiles = path.dirname(profileDir)
  if (!gate || path.relative(path.join(lock, 'runtime', 'publish'), gate) !== ''
      || request.mode !== 'install' || request.host !== 'next' || path.relative(request.appDir || '.', app) !== ''
      || ![profileDir, path.join(profiles, 'desktop')].some(dir => path.relative(request.liveDir || '.', dir) === '')
      || path.relative(stagedPaths(app).staging, sourceRoot) !== ''
      || !Number.isSafeInteger(request.pids?.[1]) || request.pids[1] <= 1 || existsSync(gate)) {
    throw Error('无法确认 NEXT 更新的准备任务，当前版本未切换。')
  }
  const stageHome = path.join(home, 'profile-bridge', 'next-profile-staging')
  const directory = path.join(stageHome, 'profiles', 'tavern')
  const snapshot = new Map()
  function initialize() {
    trusted.ordinary(stageHome)
    removeTreeSync(stageHome)
    mkdirSync(directory, { recursive: true })
    for (const name of [...CONFIG_FILES, ...VALIDATION_FILES]) snapshot.set(name, readOptional(path.join(profileDir, name)))
    for (const name of ['pnpm-lock.yaml', ...VALIDATION_FILES]) {
      const source = path.join(profileDir, name)
      if (existsSync(source)) copyTreeSync(source, path.join(directory, name))
    }
    const homePatch = path.join(home, 'cordis.patch.yml')
    if (existsSync(homePatch)) copyTreeSync(homePatch, path.join(stageHome, 'cordis.patch.yml'))
  }
  const mapPath = target => {
    if (childOf(target, directory)) return path.join(profileDir, path.relative(directory, target))
    if (childOf(target, sourceRoot)) return path.join(app, path.relative(sourceRoot, target))
    return target
  }
  const originalSpecs = new Map()
  function prepareManifest(manifest) {
    for (const [name, value] of Object.entries(manifest.dependencies || {})) {
      if (typeof value !== 'string') continue
      const local = /^(link:|file:)(.+)$/.exec(value)
      if (!local || path.isAbsolute(local[2])) continue
      originalSpecs.set(name, value)
      manifest.dependencies[name] = local[1] + path.resolve(profileDir, local[2]).split(path.sep).join('/')
    }
  }
  function assertUnchanged() {
    for (const [name, before] of snapshot) {
      if (readOptional(path.join(profileDir, name)) !== before) throw Error('准备更新期间 Tavern 配置发生变化，请重新准备更新。')
    }
  }
  function finalize(patches) {
    assertUnchanged()
    for (const name of VALIDATION_FILES) removeTreeSync(path.join(directory, name))
    removeTreeSync(path.join(stageHome, 'cordis.patch.yml'))
    rebaseDirectoryLinks([sourceRoot, directory], mapPath)
    const manifestPath = path.join(directory, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const local = value => {
      const parts = typeof value === 'string' && /^(link:|file:)(.+)$/.exec(value)
      return parts ? parts[1] + mapPath(path.resolve(directory, parts[2])).split(path.sep).join('/') : value
    }
    for (const [name, specifier] of Object.entries(manifest.dependencies)) {
      manifest.dependencies[name] = originalSpecs.get(name) ?? local(specifier)
    }
    manifest.dshTavern.source = app
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    for (const name of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml']) {
      const lockfile = path.join(directory, name)
      if (!existsSync(lockfile)) continue
      const parsed = parseDocument(readFileSync(lockfile, 'utf8'))
      if (parsed.errors.length) throw parsed.errors[0]
      for (const [dependency, specifier] of Object.entries(manifest.dependencies)) {
        const entry = ['importers', '.', 'dependencies', dependency]
        const version = parsed.getIn([...entry, 'version'])
        if (typeof version !== 'string') continue
        parsed.setIn([...entry, 'specifier'], specifier)
        if (version.startsWith('link:')) {
          const target = mapPath(path.resolve(directory, version.slice('link:'.length)))
          parsed.setIn([...entry, 'version'], 'link:' + path.relative(profileDir, target).split(path.sep).join('/'))
        }
      }
      writeFileSync(lockfile, String(parsed))
    }
    for (const root of [sourceRoot, directory]) {
      for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json']) {
        const file = path.join(root, 'node_modules', name)
        if (!existsSync(file)) continue
        const before = readFileSync(file, 'utf8')
        let after = before
        for (const stage of [directory, sourceRoot]) {
          const final = mapPath(stage)
          after = after.replaceAll(stage, final)
            .replaceAll(stage.split(path.sep).join('/'), final.split(path.sep).join('/'))
            .replaceAll(JSON.stringify(stage).slice(1, -1), JSON.stringify(final).slice(1, -1))
        }
        if (after !== before) writeFileSync(file, after)
      }
    }
    return { directory, files: [...new Set([...CONFIG_FILES, 'node_modules', ...patches])].filter(name => existsSync(path.join(directory, name))) }
  }
  return { app, gate, desktopPid: request.pids[1], directory, stageHome, initialize, prepareManifest, finalize, assertUnchanged }
}

// Recreate only links whose meaning changes when the two prepared trees move.
// Windows pnpm uses absolute junctions even for dependencies within one tree.
function rebaseDirectoryLinks(roots, mapPath) {
  const links = []
  function visit(file) {
    const stat = lstatSync(file)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(file)) visit(path.join(file, entry))
      return
    }
    if (!stat.isSymbolicLink()) return
    const target = readlinkSync(file)
    const absolute = path.resolve(path.dirname(file), target)
    const final = mapPath(absolute)
    const parent = path.dirname(mapPath(file))
    if (path.resolve(parent, target) === final) return
    links.push({ file, target, final, parent, isDirectory: statSync(absolute).isDirectory() })
  }
  for (const root of roots) visit(root)
  for (const { file, target, final, parent, isDirectory } of links) {
    removeTreeSync(file)
    if (process.platform === 'win32' && isDirectory) symlinkSync(final, file, 'junction')
    else symlinkSync(path.isAbsolute(target) ? final : path.relative(parent, final), file, isDirectory ? 'dir' : 'file')
  }
}
