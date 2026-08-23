#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function linkSpec(source) {
  return `link:${path.resolve(source).replaceAll(path.sep, '/')}`
}

export function updateAndroidProfile(directory, plugins) {
  const manifest = path.join(directory, 'package.json')
  if (!existsSync(manifest)) throw new Error(`Profile 配置不存在：${manifest}`)
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  for (const plugin of plugins) {
    pkg.dependencies[plugin.name] = linkSpec(plugin.source)
    if (!bundles.includes(plugin.name)) bundles.push(plugin.name)
  }
  pkg.dsh.profile.bundles = bundles
  const temporary = `${manifest}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  renameSync(temporary, manifest)
  return pkg
}

export function configureAndroidProfiles({ repoRoot, tavernProfile, webProfile }) {
  const mobile = path.join(repoRoot, 'android', 'dsh-client-ui-mobile-adapt')
  const entry = path.join(repoRoot, 'android', 'dsh-tavern-entry')
  updateAndroidProfile(tavernProfile, [
    { name: 'dsh-client-ui-mobile-adapt', source: mobile },
  ])
  updateAndroidProfile(webProfile, [
    { name: 'dsh-tavern-entry', source: entry },
    { name: 'dsh-client-ui-mobile-adapt', source: mobile },
  ])
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const [repoRoot, tavernProfile, webProfile] = process.argv.slice(2)
  if (!repoRoot || !tavernProfile || !webProfile) {
    console.error('用法：configure-profiles.mjs <repo-root> <tavern-profile-dir> <web-profile-dir>')
    process.exitCode = 2
  } else {
    configureAndroidProfiles({ repoRoot, tavernProfile, webProfile })
  }
}
