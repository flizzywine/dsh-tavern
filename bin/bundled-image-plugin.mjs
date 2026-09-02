import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { resolveHostDependencies } from './plugin-dependencies.mjs'

// Only these imports remain external in the prebuilt host bundle. Browser
// dependencies are supplied by DSH's client module loader, never npm peers.
export const IMAGE_PLUGIN_HOST_EXPORTS = Object.freeze({
  '@deepseek-ai/dsh-tools': 'defineTool',
  '@deepseek-ai/dsh-credentials': 'credentialRef',
  '@deepseek-ai/dsh-settings': null,
  '@deepseek-ai/schemastery': null,
})

export function installBundledImagePlugin({ sourceRoot, ...hostOptions }) {
  const directory = path.join(sourceRoot, 'tavern-plugin', 'packages', 'dsh-image-gen')
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
    if (!existsSync(path.join(directory, file))) throw new Error(`内置生图插件不完整，缺少 ${file}；请重新安装完整 Tavern 版本。`)
  }
  // Resolve and load every host module before touching an existing installation.
  const dependencies = resolveHostDependencies({ ...hostOptions, requiredExports: IMAGE_PLUGIN_HOST_EXPORTS })
  const links = dependencies.map(dependency => ({ ...dependency, target: path.join(directory, 'node_modules', dependency.name) }))
  for (const { target } of links) {
    let existing
    try { existing = lstatSync(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (existing && !existing.isSymbolicLink()) throw new Error(`内置生图插件存在开发依赖目录：${target}。请使用干净的发行目录安装；不会覆盖现有目录。`)
  }
  for (const { target, directory: hostDirectory } of links) {
    mkdirSync(path.dirname(target), { recursive: true })
    try {
      if (path.resolve(path.dirname(target), readlinkSync(target)) === hostDirectory) continue
      unlinkSync(target)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    symlinkSync(hostDirectory, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
  return dependencies
}
