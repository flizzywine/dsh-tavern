#!/usr/bin/env node
// Build and copy this working tree into the installed desktop Tavern.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installBundledTavernPlugins } from './bundled-tavern-plugins.mjs'
import installationLocation from './installation-location.cjs'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATHS = ['bin', 'config', 'presets', 'patches', 'tavern-plugin', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh']
const MEDAL_PLUGIN = 'dsh-tavern-adventure-medal'
const MEDAL_PACKAGE = 'tavern-plugin/packages/' + MEDAL_PLUGIN
const ACHIEVEMENT_FILES = ['tavern-plugin/packages/dsh-tavern/client.js',
  ...['package.json', 'lib/index.js', 'client.js', 'LICENSE', 'README.md'].map(file => MEDAL_PACKAGE + '/' + file)]
function run(command, args, options) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} 退出码 ${result.status}`)
  return result.stdout || ''
}

export function syncDesktop({ sourceRoot = ROOT, home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), build = true, achievementsOnly = false } = {}) {
  sourceRoot = realpathSync(sourceRoot)
  const profileDir = path.join(home, 'profiles', 'tavern')
  const profile = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
  if (profile.dshTavern?.host !== 'desktop' || !profile.dshTavern.source) throw new Error('找不到已安装的桌面版酒馆。')
  const target = realpathSync(installationLocation.resolveInstallationApp({ dshHome: home, appDir: profile.dshTavern.source }))
  if (JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).name !== 'dsh-profile-tavern') throw new Error('目标不是酒馆安装目录。')
  if (build && !achievementsOnly) {
    const disk = statfsSync(sourceRoot)
    if (Number(disk.bavail) * Number(disk.bsize) < 32 * 1024 * 1024) throw new Error('开发目录磁盘空间不足。')
    const temporary = path.join(sourceRoot, 'output')
    mkdirSync(temporary, { recursive: true })
    run(process.execPath, [path.join(sourceRoot, 'bin', 'build-tavern-client.mjs')], { cwd: sourceRoot, stdio: 'inherit',
      env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } })
  }
  const sameDirectory = sourceRoot.toLowerCase() === target.toLowerCase()
  if (sameDirectory && !achievementsOnly) return { target, copied: 0 }
  const files = achievementsOnly ? ACHIEVEMENT_FILES
    : run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...PATHS], { cwd: sourceRoot }).split('\0').filter(Boolean)
  if (achievementsOnly) {
    for (const file of files) {
      if (!lstatSync(path.join(sourceRoot, file), { throwIfNoEntry: false })?.isFile()) throw new Error('缺少成就组件文件：' + file)
    }
  }
  const checked = new Set()
  let copied = 0
  for (const relative of sameDirectory ? [] : new Set(files)) {
    const parts = relative.split('/')
    if (parts.some(part => ['node_modules', '.git', 'data'].includes(part))) continue
    const source = path.join(sourceRoot, ...parts)
    if (!existsSync(source) || !lstatSync(source).isFile()) continue
    let destination = target
    for (const part of parts) {
      destination = path.join(destination, part)
      if (checked.has(destination)) continue
      if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`目标文件是链接，停止同步：${destination}`)
      checked.add(destination)
    }
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    copied++
  }
  if (achievementsOnly) {
    const dataRoot = resolveTavernDataRoot({ dshHome: home })
    const [plugin] = installBundledTavernPlugins({ sourceRoot: target, dataRoot, profileDir, packageName: MEDAL_PLUGIN })
    const entry = path.join('lib', 'index.js')
    const activeEntry = path.join(dataRoot, 'plugins', MEDAL_PLUGIN, entry)
    if (!['installed', 'upgraded', 'skipped'].includes(plugin.action)
      || !existsSync(activeEntry) || !readFileSync(activeEntry).equals(readFileSync(path.join(target, MEDAL_PACKAGE, entry)))) {
      throw new Error('成就插件同步失败：' + plugin.reason)
    }
    return { target, copied, medalPlugin: plugin.target }
  }
  return { target, copied }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 1 || args[0] !== '--achievements')) throw new Error('用法：npm run sync:desktop -- [--achievements]')
    const result = syncDesktop({ achievementsOnly: args.length === 1 })
    console.log(`已同步 ${result.copied} 个程序文件到 ${result.target}。`)
    if (result.medalPlugin) console.log('成就插件已同步到 ' + result.medalPlugin)
    console.log('请完全退出并重新打开桌面版酒馆。')
  } catch (error) { console.error('同步失败：' + error.message); process.exitCode = 1 }
}
