/**
 * Profile discovery and validation for the Host half.
 *
 * The Desktop app resolves its profile directory as `<DSH_HOME>/profiles/desktop`
 * and offers no way to point it somewhere else, so the only supported way to make
 * it use an existing profile is to make that directory a link to the profile you
 * want. Everything in this module is read-only: it inspects the profiles tree and
 * reports what a switch would do. The actual file surgery happens in the generated
 * helper script, which runs after the app has exited.
 *
 * @module dsh-tavern/state
 */
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { inspectInstallation } from './installation.mjs'
import { readDefaultProfile } from './startup-profile.mjs'
import { readLastResult } from './helper.mjs'
export { readLastResult } from './helper.mjs'

/** Throw a coded bridge error the RPC layer turns into a structured failure. */
export function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

export function isDesktopApp() {
  return Boolean(process.versions.electron && typeof process.send === 'function' && process.ppid > 1)
}

export function isOfficialDesktopApp() {
  if (!isDesktopApp()) return false
  const resources = process.platform === 'darwin' ? resolve(dirname(process.execPath), '../Resources') : join(dirname(process.execPath), 'resources')
  return ['app', 'app.asar'].some(dir => readManifest(join(resources, dir))?.name === '@deepseek-ai/dsh-desktop')
}

export function launcherPaths(ctx, env = process.env) {
  const profile = ctx.get?.('profileContext') ?? ctx.profileContext
  const desktop = ctx.get?.('desktopProfiles')?.current
  if (!desktop || !profile || desktop.dir !== profile.dir) return resolvePaths(env)
  return { ...resolvePaths({ DSH_HOME: profile.home, DSH_PROFILE: profile.name, DSH_PROFILE_DIR: profile.dir }), host: 'next' }
}

export function isActiveTavern(paths, installation) {
  if (!installation.available) return false
  try { return relative(realpathSync(paths.activeDir), installation.profileDir) === '' } catch { return false }
}

export function isDesktopTavernWindow(paths, installation) {
  return process.env.DSH_TAVERN_RUNTIME_HOST === 'desktop' && isActiveTavern(paths, installation)
}

/**
 * Resolve every path this plugin works with.
 * @param {Record<string, string | undefined>} [env] - environment to read (defaults to process.env).
 * @returns {{ home: string, profilesDir: string, activeDir: string, activeName: string, stateDir: string }}
 */
export function resolvePaths(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  const home = configured !== undefined && configured !== '' ? resolve(configured) : join(homedir(), '.dsh')
  const profilesDir = join(home, 'profiles')
  const activeDir = env.DSH_PROFILE_DIR?.trim() ? resolve(env.DSH_PROFILE_DIR) : join(profilesDir, 'desktop')
  const activeName = env.DSH_PROFILE?.trim() || basename(activeDir)
  return { home, profilesDir, activeDir, activeName, stateDir: join(home, 'profile-bridge') }
}

/**
 * Read a directory's link target.
 *
 * A Windows junction and a POSIX symlink are both reported by `lstat` as symbolic
 * links, so one code path covers every platform. A stored relative target (POSIX
 * only) is resolved against the link's own directory.
 * @param {string} dir - directory to inspect.
 * @returns {string | undefined} absolute link target, or undefined for a real directory.
 */
export function readLinkTarget(dir) {
  try {
    if (!lstatSync(dir).isSymbolicLink()) return undefined
    return resolve(dirname(dir), readlinkSync(dir))
  } catch {
    return undefined
  }
}

/**
 * Parse a profile manifest.
 * @param {string} dir - profile directory.
 * @returns {Record<string, any> | undefined} parsed manifest, or undefined when unreadable.
 */
export function readManifest(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Inspect one profile directory without loading it.
 * @param {string} dir - profile directory.
 * @param {{ activeDir: string, activeName: string }} paths - resolved plugin paths.
 * @returns {object} a JSON-safe profile record.
 */
export function inspectProfile(dir, paths) {
  const name = basename(dir)
  const linkTarget = readLinkTarget(dir)
  const manifest = readManifest(dir)
  const dependencies = manifest?.dependencies ?? {}
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  let isActive = false
  try {
    isActive = realpathSync(dir) === realpathSync(paths.activeDir)
  } catch {
    isActive = resolve(dir) === resolve(paths.activeDir)
  }
  return {
    name,
    dir,
    exists: existsSync(join(dir, 'package.json')),
    isLink: linkTarget !== undefined,
    linkTarget,
    linkTargetName: linkTarget === undefined ? undefined : basename(linkTarget),
    isActive,
    packageName: typeof manifest?.name === 'string' ? manifest.name : undefined,
    dependencyCount: Object.keys(dependencies).length,
    dependencies: Object.keys(dependencies),
    bundleCount: bundles.length,
    bundles,
    hasBridge: hasBridge(manifest, dir),
    hasNodeModules: existsSync(join(dir, 'node_modules')),
    hasPatch: existsSync(join(dir, 'cordis.patch.yml')),
  }
}

/**
 * List every profile directory, newest first by name.
 * @param {{ profilesDir: string, activeDir: string, activeName: string }} paths - resolved plugin paths.
 * @returns {object[]} profile records.
 */
export function listProfiles(paths) {
  if (!existsSync(paths.profilesDir)) return []
  let entries = []
  try {
    entries = readdirSync(paths.profilesDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => inspectProfile(join(paths.profilesDir, entry.name), paths))
    .filter((profile) => profile.exists && !/\.fresh-|\.switch-/.test(profile.name))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * List the `desktop.fresh-*` backups a previous switch left behind.
 * @param {{ profilesDir: string, activeName: string }} paths - resolved plugin paths.
 * @returns {string[]} backup directory names.
 */
export function listBackups(paths) {
  if (!existsSync(paths.profilesDir)) return []
  try {
    return readdirSync(paths.profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${paths.activeName}.fresh-`))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Best-effort path of the running application, used to relaunch it after the switch.
 *
 * The Desktop Host process is spawned as `<app executable> --expose-internals …`,
 * so `process.execPath` is the application binary rather than node. A plain
 * `dsh web` CLI process reports node, which the name filter rejects.
 * @returns {string | undefined} absolute executable path, or undefined when unknown.
 */
export function detectAppExe() {
  const candidates = [process.env.DSH_DESKTOP_NODE_EXECUTABLE, process.execPath]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue
    const name = basename(candidate)
    if (/^node(\.exe)?$/iu.test(name)) continue
    if (/deepseek|harness|dsh/iu.test(name)) return candidate
  }
  const guesses = process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/DeepSeek Harness.app']
      : []
  for (const guess of guesses) if (guess !== '' && existsSync(guess)) return guess
  return undefined
}

/**
 * Read the tail of the helper log so the UI can show the last operation.
 * @param {string} logPath - log file written by the helper script.
 * @param {number} [maxChars] - maximum characters to keep.
 * @returns {string} the tail, or an empty string when there is no log.
 */
export function readLogTail(logPath, maxChars = 4000) {
  try {
    const text = readFileSync(logPath, 'utf8')
    return text.length > maxChars ? text.slice(text.length - maxChars) : text
  } catch {
    return ''
  }
}

/**
 * The complete status a UI needs to render the panel.
 * @param {ReturnType<typeof resolvePaths>} paths - resolved plugin paths.
 * @returns {object} JSON-safe status payload.
 */
export function statusPayload(paths) {
  const linkTarget = readLinkTarget(paths.activeDir)
  const profiles = listProfiles(paths)
  const appExe = detectAppExe()
  const lastResult = readLastResult(paths.stateDir)
  const gate = join(paths.stateDir, 'install-pending', 'runtime', 'publish')
  const installation = inspectInstallation(paths)
  const next = paths.host === 'next'
  return {
    installation,
    host: paths.host ?? 'desktop',
    defaultProfile: readDefaultProfile(paths.home),
    installAvailable: canInstallTavern(paths),
    replacesNext: hasNextTavern(paths.home),
    platform: process.platform,
    dshHome: paths.home,
    profilesDir: paths.profilesDir,
    stateDir: paths.stateDir,
    activeName: paths.activeName,
    activeDir: paths.activeDir,
    activeIsLink: linkTarget !== undefined,
    linkTarget,
    linkTargetName: linkTarget === undefined ? undefined : basename(linkTarget),
    appExe,
    appKind: next || basename(paths.activeDir) === 'desktop' ? 'desktop' : 'cli',
    // Only the Desktop app's own host can switch; a standalone `dsh --profile …` (e.g. the DSH 酒馆 shortcut) cannot.
    desktopApp: next || isDesktopApp(),
    desktopTavernWindow: isDesktopTavernWindow(paths, installation),
    profiles,
    backups: listBackups(paths),
    lastResult,
    installProgress: readLogTail(gate + '.progress', 400),
    logPath: join(paths.stateDir, 'last-run.log'),
    logTail: readLogTail(join(paths.stateDir, 'last-run.log')),
    transcriptPath: join(paths.stateDir, 'last-run.log.out'),
    transcriptTail: readLogTail(join(paths.stateDir, 'last-run.log.out')),
    helperPath: join(paths.stateDir, process.platform === 'win32' ? 'switch.ps1' : 'switch.sh'),
  }
}

export function hasNextTavern(home) {
  const profile = join(home, 'profiles', 'tavern')
  try {
    if (!lstatSync(profile).isDirectory()) return false
    const bundle = 'dsh-tavern-bundle'
    const manifest = readManifest(profile)
    if (!manifest?.dsh?.profile?.bundles?.includes(bundle)) return false
    const spec = manifest.dependencies?.[bundle]
    const installed = readManifest(join(profile, 'node_modules', bundle))
    if (installed?.name === bundle && installed.repository?.url === tavernRepository && typeof spec === 'string'
      && /^(?:(?:github:flizzywine\/dsh-tavern|git\+https:\/\/github\.com\/flizzywine\/dsh-tavern\.git)#(?:plugin-market-next|[a-f0-9]{40})|https:\/\/(?:raw\.githubusercontent\.com\/|cdn\.jsdelivr\.net\/gh\/)flizzywine\/dsh-tavern(?:\/|@)[a-f0-9]{40}\/dsh-tavern-bundle\.tgz)$/iu.test(spec)) return true
    const receipt = JSON.parse(readFileSync(join(home, 'logs', 'tavern-installation.json'), 'utf8'))
    return receipt.host === 'next'
  } catch {
    return false
  }
}

export function canInstallTavern(paths) {
  if (!['win32', 'darwin'].includes(process.platform) || !process.versions.electron || !process.send || process.ppid <= 1) return false
  if (paths.activeDir !== join(paths.profilesDir, 'desktop')) return false
  try {
    if (!lstatSync(paths.activeDir).isDirectory()) return false
    lstatSync(join(paths.profilesDir, 'tavern'))
    if (!hasNextTavern(paths.home)) return false
  } catch (error) {
    if (error.code !== 'ENOENT' || !existsSync(paths.activeDir)) return false
  }
  return paths.host === 'next' || isOfficialDesktopApp()
}

export const LAUNCHER_BUNDLE = 'dsh-tavern'

const tavernRepository = 'git+https://github.com/flizzywine/dsh-tavern.git'
const packageName = /^(?:@[\w.-]+\/)?[\w.-]+$/

function launcherHost(manifest) {
  const repository = manifest?.repository?.url
  if (repository === tavernRepository && manifest.dshTavern?.profileHandoff === true) return 'next'
  if (manifest?.dsh?.bundle?.patch !== './cordis.patch.yml' || manifest.license !== 'MIT') return undefined
  if (repository === tavernRepository) return 'desktop'
}

function managedLauncherLink(manifest, dir, name) {
  const source = manifest?.dshTavern?.source
  const spec = manifest?.dependencies?.[name]
  if (manifest?.dshTavern?.profileBridge !== true || typeof source !== 'string' || typeof spec !== 'string' || !spec.startsWith('link:')) return false
  const target = resolve(dir, spec.slice('link:'.length))
  return relative(join(resolve(source), 'tavern-plugin', 'packages'), dirname(target)) === ''
    && (basename(target) === LAUNCHER_BUNDLE || /-(?:bridge|launcher)$/.test(basename(target)))
}

export function launcherBundles(manifest, dir, host) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return []
  return bundles.filter(name => {
    if (typeof name !== 'string' || name === '.' || name === '..' || !packageName.test(name)) return false
    const installed = readManifest(join(dir, 'node_modules', name))
    return installed ? launcherHost(installed) === host : host === 'desktop' && managedLauncherLink(manifest, dir, name)
  })
}

export function assertLauncherSlotAvailable(manifest, dir, { replaceNext = false } = {}) {
  const occupied = Object.hasOwn(manifest?.dependencies ?? {}, LAUNCHER_BUNDLE)
    || manifest?.dsh?.profile?.bundles?.includes(LAUNCHER_BUNDLE)
    || existsSync(join(dir, 'node_modules', LAUNCHER_BUNDLE))
  const installed = readManifest(join(dir, 'node_modules', LAUNCHER_BUNDLE))
  const host = launcherHost(installed)
  if (occupied && !(host === 'desktop' || (replaceNext && host === 'next')
    || (!installed && managedLauncherLink(manifest, dir, LAUNCHER_BUNDLE)))) {
    throw Error('当前 Profile 已有同名的 dsh-tavern 插件，请检查其来源后再安装酒馆。')
  }
}

export function launcherBundle(manifest, dir) {
  if (manifest?.dsh?.profile?.bundles?.includes('dsh-tavern-bundle')) return undefined
  const enabled = launcherBundles(manifest, dir, 'desktop')
  return enabled.includes(LAUNCHER_BUNDLE) ? LAUNCHER_BUNDLE : enabled[0]
}

export function hasBridge(manifest, dir) {
  return launcherBundle(manifest, dir) !== undefined
}

/**
 * Validate one switch request before anything is written.
 * @param {ReturnType<typeof resolvePaths>} paths - resolved plugin paths.
 * @param {unknown} name - requested profile directory name.
 * @returns {{ name: string, dir: string, warnings: string[] }} the validated target.
 */
export function validateTarget(paths, name) {
  if (typeof name !== 'string' || name.trim() === '') fail('bad-target', 'A profile name is required.')
  const trimmed = name.trim()
  if (trimmed !== basename(trimmed) || trimmed === '.' || trimmed === '..') {
    fail('bad-target', `"${trimmed}" is not a plain profile directory name.`)
  }
  if (trimmed === paths.activeName) fail('bad-target', `"${trimmed}" is the profile the app is already using.`)
  const dir = join(paths.profilesDir, trimmed)
  if (!existsSync(join(dir, 'package.json'))) {
    fail('missing-profile', `No profile manifest at ${join(dir, 'package.json')}.`)
  }
  // A profile without this page has no way back from inside the app.
  if (!hasBridge(readManifest(dir), dir)) {
    fail('no-bridge', `"${trimmed}" does not enable the Tavern launcher, so the app could not switch back from it.`)
  }
  const warnings = []
  if (!existsSync(join(dir, 'node_modules'))) {
    warnings.push('That profile has no node_modules yet, so its plugins are not installed.')
  }
  const manifest = readManifest(dir)
  if ((manifest?.dsh?.profile?.bundles ?? []).length === 0) {
    warnings.push('That profile enables no bundles.')
  }
  const dependencyCount = Object.keys(manifest?.dependencies ?? {}).length
  if (dependencyCount === 0) {
    warnings.push('That profile installs no packages.')
  }
  const existing = readLinkTarget(paths.activeDir)
  if (existing !== undefined) {
    warnings.push(`The app profile is already a link to ${basename(existing)}; switching re-points it.`)
  }
  return { name: trimmed, dir, warnings }
}
