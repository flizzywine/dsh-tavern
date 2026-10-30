import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'
import { hostLinePackages } from './dsh-compatibility.mjs'

export const PROFILE_CONFIGURATION_VERSION = 1

const LEGACY_MANAGED_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@dsh-external/dsh-mobile-nav',
  'dsh-web-mobile',
  'dsh-better-sidebar',
  'dsh-tavern-plugin',
  'dsh-codex-connect',
]

const LEGACY_MANAGED_DEPENDENCIES = [
  '@dsh-external/dsh-mobile-nav',
  'dsh-web-mobile',
  'dsh-better-sidebar',
  'dsh-tavern-plugin',
  '@deepseek-ai/dsh-tools',
  'dsh-codex-connect',
]

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function uniqueStrings(values) {
  const result = []
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === 'string' && value !== '' && !result.includes(value)) result.push(value)
  }
  return result
}

export function mergeProfileManifest({ source, current = {}, pluginPath, dataRoot, host, dshVersion }) {
  const sourceDocument = object(source)
  const currentDocument = object(current)
  const sourceDsh = { ...object(sourceDocument.dsh) }
  // The source package is also an installable aggregate. A legacy Profile
  // still composes its individual bundles and must not advertise that patch.
  delete sourceDsh.bundle
  const currentDsh = object(currentDocument.dsh)
  const sourceProfile = object(sourceDsh.profile)
  const currentProfile = object(currentDsh.profile)
  const currentTavern = { ...object(currentDocument.dshTavern) }
  delete currentTavern.cliPocketEnabled
  // Pocket and web-mobile each include mobile-nav, so they cannot load together.
  // Desktop and Android ship one of them and drop whatever collides with it;
  // CLI ships none, so a layout the user installed there is left alone.
  const selectedLayout = host === 'android' ? 'dsh-web-mobile' : host === 'desktop' ? 'dsh-pocket' : null
  const excludedHostBundles = selectedLayout
    ? ['dsh-pocket', 'dsh-web-mobile', '@dsh-external/dsh-mobile-nav'].filter(name => name !== selectedLayout)
    : []
  // Official Desktop loads Tavern in its own process; the old launcher would
  // start a second server against the same save directory.
  if (host === 'desktop') excludedHostBundles.push('dsh-tavern-launcher')
  else excludedHostBundles.push('dsh-profile-bridge')
  const sourceBundles = uniqueStrings(sourceProfile.bundles)
    .map(name => name === 'dsh-web-mobile' ? selectedLayout : name)
    .filter(name => name && !excludedHostBundles.includes(name))
  const previousManagedBundles = uniqueStrings(currentTavern.managedBundles).length > 0
    ? uniqueStrings(currentTavern.managedBundles)
    : LEGACY_MANAGED_BUNDLES
  const previousManagedBundleSet = new Set([...previousManagedBundles, ...excludedHostBundles])
  const userBundles = uniqueStrings(currentProfile.bundles).filter((name) => !previousManagedBundleSet.has(name) && !excludedHostBundles.includes(name))
  const bundles = uniqueStrings(sourceBundles.concat(userBundles))

  // Local subpackages and host-specific layouts are development dependencies of
  // the installable aggregate, but remain explicit dependencies of legacy Profiles.
  const localDependencies = Object.fromEntries(
    ['dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-pocket', 'dsh-web-mobile', 'dsh-better-sidebar', 'dsh-dream-skin', 'dsh-asset-library']
      .filter(name => sourceDocument.devDependencies?.[name] !== undefined)
      .map(name => [name, sourceDocument.devDependencies[name]]),
  )
  const sourceDependencies = { ...localDependencies, ...object(sourceDocument.dependencies) }
  for (const [name, pinned] of Object.entries(hostLinePackages(dshVersion))) {
    if (sourceDependencies[name] !== undefined) sourceDependencies[name] = pinned.version
  }
  const currentDependencies = object(currentDocument.dependencies)
  const managedDependencies = sourceBundles.filter((name) => sourceDependencies[name] !== undefined)
  const previousManagedDependencies = uniqueStrings(currentTavern.managedDependencies).length > 0
    ? uniqueStrings(currentTavern.managedDependencies)
    : LEGACY_MANAGED_DEPENDENCIES
  const dependencies = { ...currentDependencies }
  for (const name of [...previousManagedDependencies, ...excludedHostBundles]) delete dependencies[name]
  for (const name of managedDependencies) {
    const sourceValue = sourceDependencies[name]
    if (typeof sourceValue === 'string' && sourceValue.startsWith('link:./tavern-plugin')) {
      const target = path.resolve(path.dirname(pluginPath), sourceValue.slice('link:'.length))
      dependencies[name] = `link:${target.replaceAll(path.sep, '/')}`
    } else dependencies[name] = sourceValue
  }

  return {
    ...currentDocument,
    name: 'dsh-profile-tavern',
    private: true,
    dependencies,
    dsh: {
      ...currentDsh,
      ...sourceDsh,
      profile: { ...currentProfile, ...sourceProfile, bundles },
    },
    dshTavern: {
      ...currentTavern,
      source: path.resolve(String(pluginPath), '..'),
      dataRoot,
      host,
      dshVersion,
      managedBundles: sourceBundles,
      managedDependencies,
      profileConfigurationVersion: PROFILE_CONFIGURATION_VERSION,
    },
  }
}

// Each host installs only one mobile layout package (see mergeProfileManifest).
// A patch for a layout this host does not install must be dropped, or pnpm fails
// with ERR_PNPM_UNUSED_PATCH. Patches of always-installed packages stay strict.
const HOST_OPTIONAL_PACKAGES = ['dsh-pocket', 'dsh-web-mobile', '@dsh-external/dsh-mobile-nav']

export function prepareProfileWorkspace(workspaceText, manifest) {
  const document = parseDocument(String(workspaceText || ''))
  if (document.errors.length > 0) throw new Error(`无法读取 pnpm workspace 配置：${document.errors[0].message}`)
  // A host-line version replaces the adapted one, so its patch replaces the adapted patch.
  const pinnedPackages = Object.entries(hostLinePackages(manifest.dshTavern?.dshVersion))
  const versionSensitive = [...HOST_OPTIONAL_PACKAGES, ...pinnedPackages.map(([name]) => name)]
  for (const key of Object.keys(object(document.toJS()?.patchedDependencies))) {
    const name = versionSensitive.find(item => key === item || key.startsWith(`${item}@`))
    if (!name) continue
    // A user-installed layout may pin another version than the one patched.
    const version = key.slice(name.length + 1)
    const installed = manifest.dependencies?.[name]
    if (!installed || (version && installed !== version)) document.deleteIn(['patchedDependencies', key])
  }
  for (const [name, pinned] of pinnedPackages) {
    if (pinned.patch && manifest.dependencies?.[name] === pinned.version) document.setIn(['patchedDependencies', `${name}@${pinned.version}`], pinned.patch)
  }
  return String(document)
}

export function syncProfileDependencyPatches({ sourceRoot, profileDir, workspaceText }) {
  const document = parseDocument(String(workspaceText || ''))
  if (document.errors.length > 0) throw new Error(`无法读取 pnpm workspace 配置：${document.errors[0].message}`)
  const patchedDependencies = object(document.toJS()?.patchedDependencies)
  const copied = []
  for (const relativePath of Object.values(patchedDependencies)) {
    if (typeof relativePath !== 'string' || relativePath === '') continue
    const normalized = path.normalize(relativePath)
    if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
      throw new Error(`依赖补丁路径必须位于 Tavern 源码内：${relativePath}`)
    }
    const sourcePath = path.join(sourceRoot, normalized)
    if (!existsSync(sourcePath)) throw new Error(`缺少依赖补丁文件：${relativePath}`)
    const targetPath = path.join(profileDir, normalized)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)
    copied.push(normalized)
  }
  return copied
}

function parsedSequence(source, label) {
  const document = parseDocument(String(source || ''))
  if (document.errors.length > 0) throw new Error(`无法读取${label}：${document.errors[0].message}`)
  if (document.contents === null) document.contents = document.createNode([])
  if (!isSeq(document.contents)) throw new Error(`${label}必须是 YAML 列表`)
  return document
}

function semanticNode(node) {
  if (isScalar(node)) return { scalar: node.value, tag: node.tag || '' }
  if (isSeq(node)) return { sequence: node.items.map(semanticNode), tag: node.tag || '' }
  if (isMap(node)) {
    const entries = node.items.map((pair) => [semanticNode(pair.key), semanticNode(pair.value)])
    entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])))
    return { mapping: entries, tag: node.tag || '' }
  }
  return node && typeof node.toJSON === 'function' ? node.toJSON() : null
}

function semanticKey(node) {
  return JSON.stringify(semanticNode(node))
}

function insertRows(node) {
  if (!isMap(node)) return null
  const value = node.get('insert', true)
  return isSeq(value) ? value : null
}

export function migrateLegacyProfilePatch(currentText, legacyManagedText) {
  const current = parsedSequence(currentText, '现有 Tavern Profile 配置')
  const legacy = parsedSequence(legacyManagedText, '旧版 Tavern 项目配置')
  const legacyRows = new Set()
  const legacyInsertRows = new Set()
  for (const item of legacy.contents.items) {
    const inserts = insertRows(item)
    if (inserts === null) legacyRows.add(semanticKey(item))
    else for (const row of inserts.items) legacyInsertRows.add(semanticKey(row))
  }

  const kept = []
  let removed = false
  for (const item of current.contents.items) {
    const inserts = insertRows(item)
    if (inserts === null) {
      if (!legacyRows.has(semanticKey(item))) kept.push(item)
      else removed = true
      continue
    }
    inserts.items = inserts.items.filter((row) => {
      const keep = !legacyInsertRows.has(semanticKey(row))
      if (!keep) removed = true
      return keep
    })
    if (inserts.items.length > 0) kept.push(item)
  }
  current.contents.items = kept
  return removed ? current.toString() : String(currentText)
}

function defaultTimestamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function backupFile(file, timestamp) {
  if (!existsSync(file)) return null
  const base = `${file}.backup.${timestamp}`
  let target = base
  let suffix = 1
  while (existsSync(target)) target = `${base}.${suffix++}`
  copyFileSync(file, target)
  return target
}

export function loadProfileManifest({ profileDir, timestamp = defaultTimestamp() }) {
  const manifestPath = path.join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return {}
  const source = readFileSync(manifestPath, 'utf8')
  try {
    return JSON.parse(source)
  } catch (cause) {
    const backup = backupFile(manifestPath, timestamp)
    const error = new Error(`无法读取现有 Tavern Profile package.json：${cause.message}`, { cause })
    if (backup !== null) error.backupPath = backup
    throw error
  }
}

export function prepareProfilePatch({ profileDir, templateText, legacyManagedText, profileConfigurationVersion, timestamp = defaultTimestamp() }) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return String(templateText)
  const currentText = readFileSync(patchPath, 'utf8')
  if (Number(profileConfigurationVersion) >= PROFILE_CONFIGURATION_VERSION) return undefined
  try {
    return migrateLegacyProfilePatch(currentText, legacyManagedText)
  } catch (error) {
    const backup = backupFile(patchPath, timestamp)
    if (backup !== null) error.backupPath = backup
    throw error
  }
}

async function restore(files, file, source) {
  if (source === null) {
    await files.remove(file)
    return
  }
  await files.write(file, source)
}

export async function beginProfileConfigurationUpdate({ profileDir, manifest, patchText, timestamp = defaultTimestamp(), files = createDurableFilePromotion() }) {
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = path.join(profileDir, 'package.json')
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  const originalPatch = patchText !== undefined && existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : null
  const backups = {
    manifest: backupFile(manifestPath, timestamp),
    patch: patchText === undefined ? null : backupFile(patchPath, timestamp),
  }
  let active = true
  try {
    await files.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    if (patchText !== undefined) await files.write(patchPath, patchText)
  } catch (error) {
    await restore(files, manifestPath, originalManifest)
    if (patchText !== undefined) await restore(files, patchPath, originalPatch)
    throw error
  }
  return Object.freeze({
    backups,
    commit() { active = false },
    async rollback() {
      if (!active) return false
      await restore(files, manifestPath, originalManifest)
      if (patchText !== undefined) await restore(files, patchPath, originalPatch)
      active = false
      return true
    },
  })
}
