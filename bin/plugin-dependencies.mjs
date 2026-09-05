import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'

const REQUIRED_HOST_EXPORTS = {
  '@deepseek-ai/dsh-tools': 'defineTool',
  '@deepseek-ai/dsh-subagent': 'snapshotSubagentDescriptor',
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

function resolveHostAnchor({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform }) {
  let anchor
  if (host === 'desktop') {
    // Desktop's terminal supplies this on Windows. On macOS its node shim
    // runs the app executable directly, so execPath identifies the same host.
    if (env.DSH_DESKTOP_DSH_BOOTSTRAP) {
      anchor = env.DSH_DESKTOP_DSH_BOOTSTRAP.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    } else {
      const executable = env.DSH_DESKTOP_APP_EXECUTABLE || execPath
      const resources = platform === 'darwin'
        ? path.resolve(path.dirname(executable), '../Resources')
        : path.join(path.dirname(executable), 'resources')
      anchor = path.join(resources, 'app.asar.unpacked', 'host-dependencies.cjs')
    }
  } else {
    const commandFile = resolveCommandFile(dsh, env, platform)
    // npm/pnpm .cmd wrappers live outside the actual DSH package. Resolving
    // from the real package also works for nested and pnpm-symlinked installs.
    const cliPackage = findPackage('@deepseek-ai/dsh', commandFile, false)
    anchor = cliPackage ? path.join(cliPackage.directory, 'host-dependencies.cjs') : commandFile
  }
  return anchor
}

export function resolveHostDependencies({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform, requiredExports = REQUIRED_HOST_EXPORTS }) {
  const anchor = resolveHostAnchor({ dsh, host, env, execPath, platform })

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

export function resolveDshBootModule({ dsh, host = 'cli', env = process.env, execPath = process.execPath, platform = process.platform }) {
  const anchor = resolveHostAnchor({ dsh, host, env, execPath, platform })
  const dependency = findPackage('@deepseek-ai/dsh-app-boot', anchor)
  if (!dependency) throw new Error(`当前 DSH 缺少 @deepseek-ai/dsh-app-boot（查找位置：${path.dirname(anchor)}）`)
  return dependency.entry
}

export function installPluginDependencies({ pluginDirectory, run, ...hostOptions }) {
  // Validate everything before changing the plugin's existing installation.
  const dependencies = resolveHostDependencies(hostOptions)
  const workspacePath = path.join(pluginDirectory, 'pnpm-workspace.yaml')
  const original = readFileSync(workspacePath, 'utf8')
  const workspace = parseDocument(original)
  if (workspace.errors.length > 0) throw new Error(`无法读取插件 workspace：${workspace.errors[0].message}`)
  for (const dependency of dependencies) {
    workspace.setIn(['overrides', dependency.name], `link:${dependency.directory.replaceAll('\\', '/')}`)
  }
  const temporary = `${workspacePath}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, workspace.toString(), 'utf8')
    renameSync(temporary, workspacePath)
    run('pnpm', ['install', '--lockfile=false'], { cwd: pluginDirectory })
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
    writeFileSync(workspacePath, original, 'utf8')
  }
  return dependencies
}
