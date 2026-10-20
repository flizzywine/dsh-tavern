import { readFileSync } from 'node:fs'
import path from 'node:path'

// These are Tavern itself, the new user-plugin manager, and bundles Tavern
// manages on its own. They are not third-party Profile plugins.
const HIDDEN = new Set([
  'dsh-tavern-plugin',
  'dsh-tavern-remote',
  'dsh-profile-bridge',
  'dsh-plugin',
  'dsh-pocket',
  'dsh-better-sidebar',
  'dsh-dream-skin',
])

/**
 * Read-only view of the old Profile-level plugins. It only reports what
 * profiles/<profile>/package.json and the installed package.json files say;
 * it never installs, loads, enables, removes or writes anything.
 */
export function listLegacyPlugins(profileDir) {
  if (!profileDir) return { profile: profileDir, plugins: [] }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return { profile: profileDir, plugins: [] }
  }

  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
  const bundles = new Set(Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [])
  const managed = new Set(Array.isArray(manifest.dshTavern?.managedBundles) ? manifest.dshTavern.managedBundles : [])
  const plugins = []

  for (const [name, spec] of Object.entries(dependencies)) {
    if (name.startsWith('@deepseek-ai/') || HIDDEN.has(name) || managed.has(name)) continue
    let pkg = null
    try {
      pkg = JSON.parse(readFileSync(path.join(profileDir, 'node_modules', name, 'package.json'), 'utf8'))
    } catch {}
    const value = String(spec)
    const kind = value.toLowerCase().startsWith('link:') ? 'link' : value.toLowerCase().startsWith('file:') ? 'file' : 'registry'
    plugins.push({
      name,
      version: pkg && typeof pkg.version === 'string' ? pkg.version : null,
      spec: value,
      kind,
      bundle: bundles.has(name),
      status: !pkg ? 'missing' : bundles.has(name) ? 'bundle' : 'dependency',
      description: pkg && typeof pkg.description === 'string' ? pkg.description : '',
    })
  }

  plugins.sort((left, right) => left.name.localeCompare(right.name))
  return { profile: profileDir, plugins }
}
