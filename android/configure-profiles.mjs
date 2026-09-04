#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function linkSpec(source) {
  return `link:${path.resolve(source).replaceAll(path.sep, '/')}`
}

const LEGACY_ANDROID_PLUGINS = Object.freeze(['dsh-client-ui-mobile-adapt'])

function ensurePluginLink(directory, plugin) {
  const sourceManifest = path.join(plugin.source, 'package.json')
  if (!existsSync(sourceManifest)) throw new Error(`Android 插件源码不存在：${sourceManifest}`)
  const target = path.join(directory, 'node_modules', ...plugin.name.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  const relativeSource = path.relative(realpathSync(path.dirname(target)), realpathSync(plugin.source)) || '.'
  try {
    const current = lstatSync(target)
    if (current.isSymbolicLink()) {
      if (readlinkSync(target) === relativeSource && existsSync(path.join(target, 'package.json'))) return
      unlinkSync(target)
    }
    else if (existsSync(path.join(target, 'package.json'))) return
    else throw new Error(`Android 插件位置已被未知文件占用：${target}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  // DSHA v1.1.x 会在 Android 宿主侧检查 Profile bundle。绝对的 proot
  // 路径在那里不可见；相对链接则能同时在宿主 rootfs 与 proot 内解析。
  symlinkSync(relativeSource, target, 'dir')
  if (!existsSync(path.join(target, 'package.json'))) throw new Error(`Android 插件链接创建后仍无法读取：${target}`)
}

export function updateAndroidProfile(directory, plugins) {
  const manifest = path.join(directory, 'package.json')
  if (!existsSync(manifest)) throw new Error(`Profile 配置不存在：${manifest}`)
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  for (const name of LEGACY_ANDROID_PLUGINS) delete pkg.dependencies[name]
  const bundles = (Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []).filter(function (name) {
    return !LEGACY_ANDROID_PLUGINS.includes(name)
  })
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
  const entry = path.join(repoRoot, 'android', 'dsh-tavern-entry')
  updateAndroidProfile(tavernProfile, [])
  const webPlugins = [
    { name: 'dsh-tavern-entry', source: entry },
  ]
  updateAndroidProfile(webProfile, webPlugins)
  for (const plugin of webPlugins) ensurePluginLink(webProfile, plugin)
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
