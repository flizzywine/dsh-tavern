/**
 * Profile state for dsh-tavern-ui-switch.
 *
 * The switch is a pure bundle-list edit on the DSH profile manifest:
 * DSH Tavern is enabled purely by the bundles its installer adds, so removing
 * those bundle names from `dsh.profile.bundles` restores the original DSH UI,
 * and putting them back restores the Tavern UI. Nothing else in the profile
 * (dependencies, user patch layer, settings, sessions, data) is touched.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Bundles DSH Tavern adds when the profile carries no `dshTavern` metadata. */
export const TAVERN_BUNDLE_FALLBACK = [
  'dsh-pocket',
  'dsh-better-sidebar',
  'dsh-dream-skin',
  'dsh-tavern-plugin',
  'dsh-tavern-remote',
]

/** Bundles every profile keeps in both modes. */
export const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

export const SELF_BUNDLE = 'dsh-tavern-ui-switch'
export const BACKUP_LIMIT = 20

export function resolveHome(env = process.env) {
  return path.resolve(env.DSH_HOME || path.join(os.homedir(), '.dsh'))
}

/** The desktop host always uses `profiles/desktop`; pick the only profile otherwise. */
export function resolveProfileName(env = process.env, home = resolveHome(env)) {
  if (env.DSH_PROFILE) return env.DSH_PROFILE
  const dir = path.join(home, 'profiles')
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    if (names.includes('desktop')) return 'desktop'
    if (names.length === 1) return names[0]
  } catch {}
  return 'desktop'
}

export function resolvePaths(env = process.env) {
  const home = resolveHome(env)
  const profile = resolveProfileName(env, home)
  const profileDir = path.join(home, 'profiles', profile)
  return {
    home,
    profile,
    profileDir,
    manifest: path.join(profileDir, 'package.json'),
    backupDir: path.join(home, 'backups', 'ui-switch'),
    logFile: path.join(home, 'logs', 'ui-switch.log'),
  }
}

export function readManifest(paths) {
  if (!existsSync(paths.manifest)) {
    throw new Error(`找不到 DSH profile 清单：${paths.manifest}`)
  }
  try {
    const parsed = JSON.parse(readFileSync(paths.manifest, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('清单不是 JSON 对象')
    return parsed
  } catch (error) {
    throw new Error(`无法读取 ${paths.manifest}：${error.message}`)
  }
}

function backupManifest(paths) {
  try {
    mkdirSync(paths.backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(paths.manifest, path.join(paths.backupDir, `package-${stamp}.json`))
    const files = readdirSync(paths.backupDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, at: statSync(path.join(paths.backupDir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const stale of files.slice(BACKUP_LIMIT)) {
      try { unlinkSync(path.join(paths.backupDir, stale.name)) } catch {}
    }
  } catch {}
}

/** Atomic manifest write: temp file in the same directory, then rename. */
export function writeManifest(paths, manifest) {
  backupManifest(paths)
  const body = `${JSON.stringify(manifest, null, 2)}\n`
  const temp = `${paths.manifest}.tmp-${process.pid}`
  writeFileSync(temp, body, 'utf8')
  try {
    renameSync(temp, paths.manifest)
  } catch (error) {
    try { unlinkSync(temp) } catch {}
    throw new Error(`无法写入 ${paths.manifest}：${error.message}`)
  }
}

export function readBundles(manifest) {
  const list = manifest?.dsh?.profile?.bundles
  return Array.isArray(list) ? list.filter((name) => typeof name === 'string') : []
}

/** Bundle names that belong to DSH Tavern, in the order the installer wrote them. */
export function tavernBundles(manifest) {
  const managed = manifest?.dshTavern?.managedBundles
  const list = Array.isArray(managed) && managed.length > 0
    ? managed.filter((name) => typeof name === 'string')
    : TAVERN_BUNDLE_FALLBACK.filter((name) => readBundles(manifest).includes(name))
  // Tavern also lists the base/web-app bundles as managed, and the switch bundle
  // is managed too — neither marks the profile as Tavern.
  return list.filter((name) => !BASE_BUNDLES.includes(name) && name !== SELF_BUNDLE)
}

export function detectMode(manifest) {
  const bundles = readBundles(manifest)
  const managed = tavernBundles(manifest)
  if (managed.length === 0) return 'official'
  return managed.some((name) => bundles.includes(name)) ? 'tavern' : 'official'
}

export function hasTavern(manifest) {
  const managed = tavernBundles(manifest)
  return managed.length > 0
}

/**
 * Compute the bundle list for a target mode.
 * `tavern` puts the managed bundles right after base/web-app and keeps every
 * unrelated user bundle; `official` only drops the managed bundles.
 */
export function planBundles(manifest, mode) {
  const current = readBundles(manifest)
  const managed = tavernBundles(manifest)
  const managedSet = new Set(managed)

  if (mode === 'official') {
    // A Tavern installer may record the exact official list; prefer it.
    const recorded = Array.isArray(manifest?.dshTavern?.officialBundles)
      ? manifest.dshTavern.officialBundles.filter((name) => typeof name === 'string')
      : null
    if (recorded && recorded.length > 0) {
      const extra = current.filter((name) => !managedSet.has(name) && !BASE_BUNDLES.includes(name) && !recorded.includes(name))
      const result = [...recorded]
      for (const name of extra) if (!result.includes(name)) result.push(name)
      return result
    }
    const kept = current.filter((name) => !managedSet.has(name))
    const missing = BASE_BUNDLES.filter((name) => !kept.includes(name))
    return [...missing, ...kept]
  }

  if (mode !== 'tavern') throw new Error(`未知界面模式：${mode}`)

  // Both base layers must be present or the profile has no UI at all; keep them
  // first and in canonical order regardless of what the current list says.
  const tail = current.filter((name) => !BASE_BUNDLES.includes(name) && !managedSet.has(name))
  return [...BASE_BUNDLES, ...managed, ...tail]
}

/** Apply a mode to the profile manifest. Returns the applied mode and whether anything changed. */
export function applyMode(mode, env = process.env) {
  const paths = resolvePaths(env)
  const manifest = readManifest(paths)
  const before = readBundles(manifest)
  const after = planBundles(manifest, mode)
  const changed = before.length !== after.length || before.some((name, index) => name !== after[index])
  if (changed) {
    manifest.dsh = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : {}
    manifest.dsh.profile = manifest.dsh.profile && typeof manifest.dsh.profile === 'object' ? manifest.dsh.profile : {}
    manifest.dsh.profile.bundles = after
    writeManifest(paths, manifest)
  }
  return { mode, changed, bundles: after, paths }
}

export function status(env = process.env) {
  const paths = resolvePaths(env)
  let manifest = null
  let error = ''
  try { manifest = readManifest(paths) } catch (cause) { error = cause.message }
  const bundles = manifest ? readBundles(manifest) : []
  return {
    home: paths.home,
    profile: paths.profile,
    profileDir: paths.profileDir,
    manifestPath: paths.manifest,
    mode: manifest ? detectMode(manifest) : 'unknown',
    tavernInstalled: manifest ? hasTavern(manifest) : false,
    switchInstalled: bundles.includes(SELF_BUNDLE),
    bundles,
    error,
  }
}


/** Append a line to the switch log; never throws. */
export function log(message, env = process.env) {
  try {
    const { logFile } = resolvePaths(env)
    mkdirSync(path.dirname(logFile), { recursive: true })
    writeFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, { flag: 'a' })
  } catch {}
}
