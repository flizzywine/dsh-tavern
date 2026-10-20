import { readFileSync } from 'node:fs'
import path from 'node:path'

// Tavern's own bundles; everything else Tavern installs is listed in
// dshTavern.managedBundles.
const TAVERN_OWN = new Set(['dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-profile-bridge'])

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

// Same lookup as Node: the nearest node_modules up from the Profile.
function installedPackage(profileDir, name) {
  for (let dir = path.resolve(profileDir); ; dir = path.dirname(dir)) {
    const pkg = readJson(path.join(dir, 'node_modules', name, 'package.json'))
    if (pkg || path.dirname(dir) === dir) return pkg
  }
}

/**
 * Read-only view of the old Profile-level plugins: every entry of
 * dsh.profile.bundles, plus installed dependencies that declare a `dsh` field.
 * Plain libraries, DSH itself and Tavern-managed bundles are left out. It never
 * installs, loads, enables, removes or writes anything.
 */
export function listLegacyPlugins(profileDir) {
  const manifest = profileDir ? readJson(path.join(profileDir, 'package.json')) : null
  if (!manifest) return { profile: profileDir, plugins: [] }

  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
  const bundles = new Set((Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []).filter(name => typeof name === 'string'))
  const managed = new Set(Array.isArray(manifest.dshTavern?.managedBundles) ? manifest.dshTavern.managedBundles : [])
  const plugins = []

  for (const name of new Set([...bundles, ...Object.keys(dependencies)])) {
    if (name.startsWith('@deepseek-ai/') || TAVERN_OWN.has(name) || managed.has(name)) continue
    const pkg = installedPackage(profileDir, name)
    const bundle = bundles.has(name)
    if (!bundle && !(pkg && pkg.dsh)) continue
    const spec = name in dependencies ? String(dependencies[name]) : null
    const lower = spec?.toLowerCase() || ''
    plugins.push({
      name,
      version: typeof pkg?.version === 'string' ? pkg.version : null,
      spec,
      kind: spec === null ? null : lower.startsWith('link:') ? 'link' : lower.startsWith('file:') ? 'file' : 'registry',
      bundle,
      status: !pkg ? 'missing' : bundle ? 'bundle' : 'dependency',
      description: typeof pkg?.description === 'string' ? pkg.description : '',
    })
  }

  plugins.sort((left, right) => left.name.localeCompare(right.name))
  return { profile: profileDir, plugins }
}
