import { desktopElectronExecutable, desktopHostAnchors, desktopResourcesRoot, isAsarPath } from './desktop-host-paths.mjs'
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'

const REQUIRED_HOST_EXPORTS = {
  '@deepseek-ai/dsh-agent': 'agentEvents',
  '@deepseek-ai/dsh-tools': 'defineTool',
  '@deepseek-ai/dsh-skill-filesystem': 'FileSystemSkillProvider',
  '@deepseek-ai/dsh-subagent': 'snapshotSubagentDescriptor',
  '@deepseek-ai/dsh-typert-protocol': 'TypertRemoteService',
}

function findPackage(name, anchor, resolveEntry = true) {
  const require = createRequire(anchor)
  for (const searchPath of require.resolve.paths(name) || []) {
    const directory = path.join(searchPath, name)
    const manifestPath = path.join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== name) continue
    return { name, version: manifest.version, directory: realpathSync(directory), ...(resolveEntry ? { entry: require.resolve(name) } : {}) }
  }
  return null
}

// Version managers (pnpm env, fnm, nvm-windows…) put a script shim on PATH that is
// not inside the package's node_modules ancestry. Follow the script it launches.
function commandShimTargets(commandFile) {
  try { if (statSync(commandFile).size > 64 * 1024) return [] } catch { return [] }
  const text = readFileSync(commandFile, 'utf8')
  const targets = []
  for (const [, relative] of text.matchAll(/(?:%~dp0%?|%dp0%|\$basedir)[\\/]+([^"'%*\r\n]+?\.[cm]?js)\b/g)) {
    const target = path.join(path.dirname(commandFile), ...relative.split(/[\\/]+/))
    if (existsSync(target)) targets.push(realpathSync(target))
  }
  return targets
}

function findCommandPackage(name, commandFile) {
  for (const anchor of [commandFile, ...commandShimTargets(commandFile)]) {
    const found = findPackage(name, anchor, false)
    if (found) return found
  }
  return null
}

function resolveCommandFile(command, env, platform) {
  if (path.isAbsolute(command)) return realpathSync(command)
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  const extensions = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension)
      if (existsSync(candidate)) return realpathSync(candidate)
    }
  }
  throw new Error(`无法定位当前 DSH 命令：${command}`)
}

// 脱离态的更新由系统 Node 拉起（execPath 是 node.exe），DSH_DESKTOP_* 也没有，
// 此时 dsh shim 是唯一能指认当前 Desktop 安装位置的线索；定位失败只当"没有线索"，不抛错。
function desktopShimCommandFile(dsh, env, platform) {
  try { return resolveCommandFile(dsh, env, platform) } catch { return null }
}

function resolveHostAnchor({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform }) {
  let anchor
  if (host === 'desktop') {
    // UI updates outlive the current Host process. Preserve the already-loaded
    // plugin's module-resolution root instead of mistaking a system node.exe
    // for the Desktop executable after the update detaches.
    if (env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR) {
      anchor = env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR
    } else if (env.DSH_DESKTOP_DSH_BOOTSTRAP) {
      anchor = env.DSH_DESKTOP_DSH_BOOTSTRAP.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    } else {
      // 系统 Node 的 execPath 本身不是 Desktop 可执行文件（会算出 <node>\resources\app 这种假根），
      // 先按 环境变量 → execPath → dsh shim 的顺序找 Electron 可执行文件。
      const commandFile = desktopShimCommandFile(dsh, env, platform)
      const executable = desktopElectronExecutable({ env, execPath, platform, commandFile }) || env.DSH_DESKTOP_APP_EXECUTABLE || execPath
      const resources = platform === 'darwin'
        ? path.resolve(path.dirname(executable), '../Resources')
        : path.join(path.dirname(executable), 'resources')
      const unpacked = [
        path.join(resources, 'app', 'package.json'),
        path.join(resources, 'app.asar.unpacked', 'package.json'),
        path.join(resources, 'app.asar.unpacked', 'host-dependencies.cjs'),
      ].find(candidate => existsSync(candidate) || existsSync(path.join(path.dirname(candidate), 'node_modules')))
      anchor = unpacked || path.join(resources, 'app', 'package.json')
    }
  } else {
    const commandFile = resolveCommandFile(dsh, env, platform)
    // npm/pnpm .cmd wrappers live outside the actual DSH package. Resolving
    // from the real package also works for nested and pnpm-symlinked installs.
    const cliPackage = findCommandPackage('@deepseek-ai/dsh', commandFile)
    anchor = cliPackage ? path.join(cliPackage.directory, 'host-dependencies.cjs') : commandFile
  }
  return anchor
}

// 0.2.0-rc.2 适配：宿主 @deepseek-ai/* 只在 <resources>\app.asar\dsh\node_modules 内，
// 纯 Node 的 existsSync/require.resolve 对 asar 内路径恒为 false，findPackage 必然全部落空。
// 这时改用 Electron Node 模式（同一个可执行文件 + ELECTRON_RUN_AS_NODE=1）解析并回显：
// asar 感知的 fs 能在该模式下读到包，顺带在同一个进程里完成所需导出探测。
//
// 两点实现约束（都是实测踩出来的）：
//  • 解析必须显式锚定在 <asar>\dsh\package.json：`-e` 脚本的 import.meta.url 落在当前工作目录，
//    从那里 createRequire 只会在 CWD 的 node_modules 里找，永远找不到宿主包。
//  • 子进程输出走"临时文件 + fd"而不是管道：管道 stdio 在受限环境（含本仓的沙箱安装器）
//    会被直接拒绝，写文件则在任何环境都可用。
function desktopHostProbeSource(anchors, requiredExports) {
  return `import { createRequire } from 'node:module'
import { accessSync } from 'node:fs'
import path from 'node:path'
const wanted = ${JSON.stringify(requiredExports)}
let resolved = null
let lastError = ''
for (const anchor of ${JSON.stringify(anchors)}) {
  const require = createRequire(anchor)
  const trial = {}
  let complete = true
  for (const name of Object.keys(wanted)) {
    try {
      const entry = require.resolve(name)
      let directory = path.dirname(entry)
      let manifestPath = path.join(directory, 'package.json')
      for (let depth = 0; depth < 8; depth += 1) {
        try { accessSync(manifestPath); break } catch { directory = path.dirname(directory); manifestPath = path.join(directory, 'package.json') }
      }
      const manifest = require(manifestPath)
      if (manifest.name !== name) throw new Error('解析到的包名不符：' + manifest.name)
      trial[name] = { version: manifest.version, directory, entry }
    } catch (error) {
      trial[name] = { error: String(error?.message || error) }
      complete = false
    }
  }
  if (complete) { resolved = trial; break }
  lastError = Object.values(trial).map(value => value.error).filter(Boolean)[0] || lastError
}
process.stdout.write(JSON.stringify(resolved ?? { __error: lastError || '未找到可解析的宿主根' }))`
}

function resolveDesktopHostPackagesViaElectron({ env = process.env, execPath = process.execPath, platform = process.platform, requiredExports, commandFile = null }) {
  const electron = desktopElectronExecutable({ env, execPath, platform, commandFile })
  if (!electron) return null
  const resources = desktopResourcesRoot(electron, platform)
  const anchors = [
    path.join(resources, 'app.asar', 'dsh', 'package.json'),
    path.join(resources, 'app.asar.unpacked', 'dsh', 'package.json'),
    path.join(resources, 'app', 'package.json'),
  ].map(candidate => pathToFileURL(candidate).href)
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tavern-host-probe-'))
  const scriptFile = path.join(directory, 'probe.mjs')
  const outputFile = path.join(directory, 'probe.json')
  const errorFile = path.join(directory, 'probe.err')
  writeFileSync(scriptFile, desktopHostProbeSource(anchors, requiredExports))
  const outFd = openSync(outputFile, 'w')
  const errFd = openSync(errorFile, 'w')
  let probe
  let report = ''
  try {
    probe = spawnSync(electron, ['--expose-internals', scriptFile], {
      stdio: ['ignore', outFd, errFd], timeout: 60000, env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }
  try {
    report = readFileSync(errorFile, 'utf8').trim()
    const text = readFileSync(outputFile, 'utf8').trim()
    if (probe.error || probe.status !== 0 || !text) return null
    let parsed
    try { parsed = JSON.parse(text) } catch { return null }
    if (parsed?.__error) {
      throw new Error(`当前 DSH 缺少必需依赖（已通过 Electron Node 模式在 app.asar 内查找：${parsed.__error}）。请修复当前 Desktop 安装，并从该 Desktop 的 DSH Terminal 重试；不会自动下载或替换为其他 DSH 版本。`)
    }
    const dependencies = []
    for (const name of Object.keys(requiredExports)) {
      const found = parsed?.[name]
      if (!found || found.error) {
        throw new Error(`当前 DSH 缺少必需依赖 ${name}（已通过 Electron Node 模式在 app.asar 内查找${found?.error ? `：${found.error}` : ''}）。请修复当前 Desktop 安装，并从该 Desktop 的 DSH Terminal 重试；不会自动下载或替换为其他 DSH 版本。`)
      }
      dependencies.push({ name, version: found.version, directory: found.directory, ...(requiredExports[name] ? { entry: found.entry } : {}) })
    }
    return dependencies
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function resolveHostDependencies({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform, requiredExports = REQUIRED_HOST_EXPORTS }) {
  let anchor = resolveHostAnchor({ dsh, host, env, execPath, platform })
  if (host === 'desktop') {
    const candidates = desktopHostAnchors(anchor)
    // Existing links point into the selected Desktop even when the detached
    // updater runs under system Node without Desktop environment variables.
    for (const name of Object.keys(REQUIRED_HOST_EXPORTS)) {
      try {
        const dependency = findPackage(name, anchor, false)
        if (dependency) candidates.push(path.join(dependency.directory, 'host-dependencies.cjs'))
      } catch {}
    }
    if (env.DSH_DESKTOP_DSH_BOOTSTRAP) candidates.push(resolveHostAnchor({ host, env: { DSH_DESKTOP_DSH_BOOTSTRAP: env.DSH_DESKTOP_DSH_BOOTSTRAP }, execPath, platform }))
    if (env.DSH_DESKTOP_APP_EXECUTABLE) candidates.push(resolveHostAnchor({ host, env: { DSH_DESKTOP_APP_EXECUTABLE: env.DSH_DESKTOP_APP_EXECUTABLE }, execPath, platform }))
    // Choose one complete resolution root; never assemble mixed host versions.
    anchor = candidates.find(candidate => Object.keys(requiredExports).every(name => {
      try { return Boolean(findPackage(name, candidate)) } catch { return false }
    })) || anchor
    // 0.2.0-rc.2 适配：没有任何纯 Node 可解析的完整根（宿主包都在 asar 内）时，
    // 改走 Electron Node 模式；成功即返回（导出已在该模式下探测过）。
    const plainNodeRoot = Object.keys(requiredExports).every(name => {
      try { return Boolean(findPackage(name, anchor)) } catch { return false }
    })
    if (!plainNodeRoot) {
      const viaElectron = resolveDesktopHostPackagesViaElectron({ env, execPath, platform, requiredExports, commandFile: desktopShimCommandFile(dsh, env, platform) })
      if (viaElectron) return viaElectron
    }
  }

  const dependencies = []
  for (const [name, exportName] of Object.entries(requiredExports)) {
    let dependency
    try { dependency = findPackage(name, anchor) } catch (error) {
      throw new Error(`当前 DSH 依赖 ${name} 无法解析：${error.message}`)
    }
    if (!dependency) {
      throw new Error(`当前 DSH 缺少必需依赖 ${name}（查找位置：${path.dirname(anchor)}）。请修复当前 DSH 安装${host === 'desktop' ? '，并从该 Desktop 的 DSH Terminal 重试' : ''}；不会自动下载或替换为其他 DSH 版本。`)
    }
    // Probe in a fresh process so module caching cannot hide a changed host.
    // Absolute import keeps the host package's own transitive dependencies.
    const script = `const m = await import(${JSON.stringify(pathToFileURL(dependency.entry).href)});` + (exportName ? ` if (typeof m[${JSON.stringify(exportName)}] !== 'function') throw new Error(${JSON.stringify(`缺少接口 ${exportName}`)});` : '')
    const probe = spawnSync(execPath, ['--expose-internals', '--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 15000, env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    })
    if (probe.error || probe.status !== 0) {
      throw new Error(`当前 DSH 依赖 ${name}（${dependency.version}）无法加载所需接口 ${exportName}：${probe.error?.message || probe.stderr?.trim() || '加载失败'}。不会自动混装其他版本。`)
    }
    dependencies.push(dependency)
  }
  return dependencies
}

// Resolve the CLI declared by the selected installation, without executing its
// Windows command shim or assuming a fixed lib/bin.js package layout.
export function resolveDshCliEntry({ dsh, env = process.env, platform = process.platform }) {
  const commandFile = resolveCommandFile(dsh, env, platform)
  const cli = findCommandPackage('@deepseek-ai/dsh', commandFile)
  if (!cli) throw new Error(`无法定位当前 DSH CLI 包：${commandFile}`)
  const manifest = JSON.parse(readFileSync(path.join(cli.directory, 'package.json'), 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (!bin) throw new Error('当前 DSH 包没有声明 dsh 命令入口。')
  return realpathSync(path.resolve(cli.directory, bin))
}

// 0.2.0-rc.2 适配：桌面 0.2.0 的 dsh 是「Electron 可执行文件 + app.asar 内 CLI」的 shim，例如
//   @echo off
//   setlocal DisableDelayedExpansion
//   set "ELECTRON_RUN_AS_NODE=1"
//   "%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
// 这种形态下 shim 上方没有 @deepseek-ai/dsh npm 包（resolveDshCliEntry 会抛「无法定位当前 DSH CLI 包」），
// 而且 app.asar 内文件纯 Node 读不了 —— 启动必须用 Electron 可执行文件 + ELECTRON_RUN_AS_NODE=1。
// 返回 { command, entry, env }；null 表示不是这种形态，调用方按原路径（Node + 真实包布局）处理。
export function resolveDesktopAsarCommand({ dsh, env = process.env, execPath = process.execPath, platform = process.platform } = {}) {
  if (platform !== 'win32') return null
  let commandFile
  try { commandFile = resolveCommandFile(dsh, env, platform) } catch { return null }
  let text = ''
  try {
    if (statSync(commandFile).size > 64 * 1024) return null
    text = readFileSync(commandFile, 'utf8')
  } catch { return null }
  // 桌面 shim 里的路径写成 %~dp0..\..\..\..\DeepSeek Harness.exe（%~dp0 是该 shim 自身目录），
  // 不展开就既拿不到 Electron 可执行文件、也解析不出 asar 入口。%dp0%/$basedir 是同类写法。
  const shimDirectory = path.dirname(commandFile)
  const expanded = text
    .replace(/%~dp0%?/gi, shimDirectory + path.sep)
    .replace(/%dp0%/gi, shimDirectory + path.sep)
    .replace(/\$basedir/gi, shimDirectory + path.sep)
  const parsed = /"([^"]+\.exe)"\s+--expose-internals\s+"([^"]+\.(?:c|m)?js)"/i.exec(expanded)
  const shimExecutable = parsed?.[1]
  let entry = parsed?.[2]
  if (!entry) {
    // shim 确实指向 asar，但引号形态没被上面的正则吃到：退回 0.2.0 已知的宿主 CLI 位置。
    if (!isAsarPath(expanded)) return null
    const electron = desktopElectronExecutable({ env, execPath, platform })
    if (!electron) return null
    entry = path.join(desktopResourcesRoot(electron, platform), 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  } else if (!isAsarPath(entry)) {
    // shim 指向真实文件（0.1.5 的 `node <cli.js>` 等形态）：保持既有行为，不做 desktop 特殊处理。
    return null
  }
  // shim 里的 exe/entry 可能是带 .. 的相对路径（%~dp0 展开而来），统一归一化。
  entry = path.resolve(entry)
  const command = (shimExecutable && existsSync(path.resolve(shimExecutable)) ? path.resolve(shimExecutable) : null)
    || desktopElectronExecutable({ env, execPath, platform })
  if (!command) return null
  return { command, entry, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

// Invoke npm through Node on Windows so private prefixes containing spaces or
// shell metacharacters are passed as argv, never reparsed by cmd.exe.
export function resolveNpmCliEntry({ env = process.env, platform = process.platform } = {}) {
  const commandFile = resolveCommandFile('npm', env, platform)
  const cli = findCommandPackage('npm', commandFile)
  if (!cli) throw new Error(`无法定位 npm CLI 包：${commandFile}`)
  const manifest = JSON.parse(readFileSync(path.join(cli.directory, 'package.json'), 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.npm
  if (!bin) throw new Error('当前 npm 包没有声明 npm 命令入口。')
  return realpathSync(path.resolve(cli.directory, bin))
}

export function resolveDshBootModule({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform }) {
  const anchor = resolveHostAnchor({ dsh, host, env, execPath, platform })
  const dependency = findPackage('@deepseek-ai/dsh-app-boot', anchor)
  if (!dependency) throw new Error(`当前 DSH 缺少 @deepseek-ai/dsh-app-boot（查找位置：${path.dirname(anchor)}）`)
  return dependency.entry
}

export async function installPluginDependencies({ pluginDirectory, run, ...hostOptions }) {
  // Validate everything before changing the plugin's existing installation.
  const dependencies = resolveHostDependencies(hostOptions)
  // 0.2.0-rc.2 适配：宿主包在 app.asar 内时不能写 link: override —— pnpm 跑在纯 Node 下，
  // 既无法 stat asar 内路径，也无法把只读归档做成 junction。0.2.0 的宿主解析器本身就为
  // profile 条目提供这些 @deepseek-ai/* 包（证据：profiles/web 的 dependencies 为空、也没有
  // node_modules，但它的 bundle 行照常解析），所以这里只保留校验结果、不改 workspace。
  if (dependencies.some(dependency => isAsarPath(dependency.directory))) {
    for (const dependency of dependencies) console.log(`已确认宿主内置依赖（app.asar 内，无需链接）：${dependency.name} ${dependency.version}`)
    console.log('0.2.0 桌面把宿主依赖打进 app.asar，跳过 tavern-plugin 的 link 覆盖安装；运行时由宿主解析器提供这些包。')
    return dependencies
  }
  const workspacePath = path.join(pluginDirectory, 'pnpm-workspace.yaml')
  const original = readFileSync(workspacePath, 'utf8')
  const workspace = parseDocument(original)
  if (workspace.errors.length > 0) throw new Error(`无法读取插件 workspace：${workspace.errors[0].message}`)
  for (const dependency of dependencies) {
    workspace.setIn(['overrides', dependency.name], `link:${dependency.directory.replaceAll('\\', '/')}`)
  }
  const temporary = `${workspacePath}.tmp-${process.pid}`
  let safeToRestore = true
  try {
    writeFileSync(temporary, workspace.toString(), 'utf8')
    renameSync(temporary, workspacePath)
    await run('pnpm', ['install', '--lockfile=false'], { cwd: pluginDirectory })
  } catch (error) {
    safeToRestore = !error.unsafeToRetry
    throw error
  } finally {
    if (safeToRestore && existsSync(temporary)) unlinkSync(temporary)
    if (safeToRestore) writeFileSync(workspacePath, original, 'utf8')
  }
  return dependencies
}
