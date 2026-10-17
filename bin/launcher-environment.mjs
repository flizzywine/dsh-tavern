import { runInstallationProcess } from './installation-process.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshCliEntry, resolveNpmCliEntry } from './plugin-dependencies.mjs'

// Shared installation paths and process invocation; no install/start/update effects on import.
export const INSTALL_HOSTS = new Set(['cli', 'desktop', 'android'])
export const CLI_HOST = '127.0.0.1'
export const CLI_PORT = resolveServicePort(process.env.DSH_TAVERN_PORT)
export const SCRIPT_PATH = fileURLToPath(new URL('./dsh-tavern.mjs', import.meta.url))
export const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const installationFile = path.join(SOURCE_ROOT, '.dsh-tavern-local.json')
const installation = existsSync(installationFile) ? JSON.parse(readFileSync(installationFile, 'utf8')) : {}
const hostArgument = process.argv.find((arg) => arg.startsWith('--host='))?.slice(7)
  || (process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : '')
export const RUNTIME_HOST = hostArgument || process.env.DSH_TAVERN_RUNTIME_HOST || process.env.DSH_TAVERN_HOST || installation.host || 'cli'
export const PROFILE = RUNTIME_HOST === 'desktop' ? 'desktop' : 'tavern'
export const LEGACY_DSH_ROOT = process.env.DSH_TAVERN_LEGACY_DSH_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const DSH_ROOT = path.resolve(RUNTIME_HOST === 'cli'
  ? (process.env.DSH_TAVERN_CLI_HOME || (installation.host === 'cli' && installation.dshHome) || path.join(os.homedir(), '.dsh-tavern'))
  : (process.env.DSH_HOME || path.join(os.homedir(), '.dsh')))
export const CLI_RUNTIME_ROOT = path.join(DSH_ROOT, 'runtime')
export function runtimeEnvironment({ installation = true } = {}) {
  const environment = { ...process.env }
  // Match both installer scripts, including direct `dsh-tavern install` calls.
  // Windows treats these names case-insensitively; do not leave conflicting keys.
  for (const key of Object.keys(environment)) {
    if (['npm_config_registry', 'pnpm_config_registry'].includes(key.toLowerCase())) delete environment[key]
    if (!installation && (/^DSH_TAVERN_INSTALL_/i.test(key) || key === 'DSH_TAVERN_UPDATE_ATTEMPT')) delete environment[key]
  }
  const registry = process.env.DSH_TAVERN_NPM_REGISTRY || 'https://registry.npmmirror.com'
  // pnpm's optional update check can keep Node alive after a completed install.
  return { ...environment, npm_config_registry: registry, pnpm_config_registry: registry,
    pnpm_config_update_notifier: 'false', DSH_HOME: DSH_ROOT, DSH_TAVERN_RUNTIME_HOST: RUNTIME_HOST,
    ...(RUNTIME_HOST === 'cli' ? { DSH_TAVERN_CLI_HOME: DSH_ROOT, DSH_TAVERN_LEGACY_DSH_HOME: LEGACY_DSH_ROOT } : {}) }
}
export const PROFILE_DIR = path.join(DSH_ROOT, 'profiles', PROFILE)
export const LOG_DIR = path.join(DSH_ROOT, 'logs')
export const LOG_FILE = path.join(LOG_DIR, 'tavern.log')
export const PID_FILE = path.join(LOG_DIR, 'tavern.pid.json')
export const FRONTEND_BOOTSTRAP_FILE = path.join(LOG_DIR, 'tavern.frontend-bootstrap.json')
export const FRONTEND_BOOTSTRAP_VERSION = 2
export const RELEASE_FILE = '.dsh-tavern-release.json'
export const DEFAULT_COMMIT_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/commits/0.2.1%E7%89%88%E6%9C%AC'
export const SETTINGS_FILE = path.join(DSH_ROOT, 'settings.yaml')
export const SIDEBAR_DEFAULTS_VERSION = 8
export const TAVERN_SIDEBAR_DEFAULTS = {
  tabsEnabled: {
    editor: true,
    git: false,
    subagent: false,
    terminal: false,
    browser: false,
    diff: false,
    'dsh-tavern:resources': true,
    'dsh-tavern:presets': true,
    'dsh-tavern:cards': true,
    'dsh-tavern:status': true,
  },
  viewersEnabled: {
    image: false,
    pdf: false,
    markdown: true,
    html: false,
    code: true,
    'binary-download': false,
  },
}
export const REQUIRED_SOURCE_FILES = [
  'package.json',
  'cordis.patch.yml',
  path.join('config', 'legacy-profile-patch-v0.6.yml'),
  'pnpm-workspace.yaml',
  path.join('tavern-plugin', 'package.json'),
  path.join('tavern-plugin', 'cordis.patch.yml'),
  path.join('tavern-plugin', 'packages', 'dsh-image-gen', 'src', 'module.js'),
  path.join('tavern-plugin', 'packages', 'dsh-image-gen', 'src', 'configuration.js'),
  // 0.2.0-rc.2 适配：presets/tavern/preset.yml 已随 preset 容器模型变更移除，
  // preset 定义改由 tavern-plugin/cordis.patch.yml 的声明行承载。
  path.join('tavern-plugin', 'lib', 'user-tools-bridge.js'),
]

export function resolveServicePort(value, fallback = 3081) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DSH_TAVERN_PORT 必须是 1 到 65535 之间的整数，当前值：${value}`)
  }
  return port
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function commandName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.cmd` : name
}

export function run(command, args, options = {}) {
  const nativeNpm = process.platform === 'win32' && command === 'npm'
  const result = spawnSync(nativeNpm ? process.execPath : commandName(command), nativeNpm ? [resolveNpmCliEntry(), ...args] : args, {
    cwd: options.cwd,
    env: runtimeEnvironment(),
    encoding: 'utf8',
    shell: process.platform === 'win32' && !nativeNpm,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) {
    throw new Error(`无法运行 ${command}：${result.error.message}`)
  }
  if (result.status !== 0) {
    const details = options.capture ? (result.stderr || result.stdout || '').trim() : ''
    throw new Error(`${command} 执行失败${details ? `：${details}` : ''}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

export function commandExists(command) {
  const probe = process.platform === 'win32' ? ['where', [command]] : ['sh', ['-c', `command -v ${command}`]]
  return spawnSync(probe[0], probe[1], { stdio: 'ignore' }).status === 0
}

export function findDshCommand(host = RUNTIME_HOST) {
  if (host === 'cli') {
    const command = process.platform === 'win32' ? path.join(CLI_RUNTIME_ROOT, 'dsh.cmd') : path.join(CLI_RUNTIME_ROOT, 'bin', 'dsh')
    if (!existsSync(command)) throw new Error('Tavern 独立 DSH 尚未安装，请重新运行 Tavern 安装器；不会回退到全局 DSH。')
    return command
  }
  if (host === 'desktop') {
    const pinned = pinnedDesktopDsh(host)
    if (pinned) return pinned.bootstrap
    throw new Error('请通过官方 DeepSeek Harness 的酒馆安装入口运行；未找到官方桌面运行环境。')
  }
  if (commandExists('dsh')) {
    if (process.platform === 'win32') return 'dsh'
    return run('sh', ['-c', 'command -v dsh'], { capture: true })
  }

  if (process.platform !== 'win32') {
    const versionsDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
    if (existsSync(versionsDir)) {
      const candidates = readdirSync(versionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(versionsDir, entry.name, 'bin', 'dsh'))
        .filter(existsSync)
        .sort()
        .reverse()
      if (candidates.length > 0) return candidates[0]
    }
  }

  throw new Error('找不到 dsh，请先安装 DeepSeek Harness，并重新打开终端。')
}

// Official Desktop on both platforms names its own bundled DSH. Looking up `dsh` by name can reach an unrelated DSH the user
// installed elsewhere, so installs run this exact bootstrap instead.
export function pinnedDesktopDsh(host, env = process.env, platform = process.platform) {
  if (host !== 'desktop') return null
  const executable = env.DSH_DESKTOP_NODE_EXECUTABLE || env.DSH_DESKTOP_APP_EXECUTABLE
  const bootstrap = env.DSH_DESKTOP_DSH_BOOTSTRAP
  if (!executable || !bootstrap || !existsSync(executable) || (!existsSync(bootstrap) && !bootstrap.includes('app.asar' + path.sep))) return null
  return { executable, bootstrap }
}

export function resolveDshInvocation(command, args, host = 'cli', nodePath = process.execPath, env = process.env, platform = process.platform) {
  const pinned = pinnedDesktopDsh(host, env, platform)
  if (pinned && command === pinned.bootstrap) {
    return { command: pinned.executable, args: ['--expose-internals', pinned.bootstrap, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  if (host !== 'android') return { command, args }
  return { command: nodePath, args: ['--expose-internals', command, ...args] }
}

export function requireCommand(command, installHint = '') {
  if (!commandExists(command)) {
    throw new Error(`缺少命令：${command}${installHint ? `。${installHint}` : ''}`)
  }
}

export function runDsh(command, args, options = {}) {
  const nativeCli = process.platform === 'win32' && (options.host || RUNTIME_HOST) === 'cli'
  const invocation = nativeCli
    ? { command: process.execPath, args: [resolveDshCliEntry({ dsh: command }), ...args] }
    : resolveDshInvocation(command, args, options.host)
  const spawnOptions = { ...options }
  delete spawnOptions.host
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8', shell: process.platform === 'win32' && !nativeCli && !invocation.env, env: { ...runtimeEnvironment(), ...invocation.env }, ...spawnOptions,
  })
  if (result.error) throw new Error(`无法运行 dsh：${result.error.message}`)
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter((value) => typeof value === 'string' && value.trim() !== '')
      .join('\n')
      .trim()
      .slice(-2000)
    throw new Error(`dsh 配置验证失败${detail ? `：\n${detail}` : '。'}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

// Installer-only async boundary: unlike spawnSync, the supervisor can cancel and
// terminate the entire owned process tree before callers restore configuration.
export async function runInstallCommand(command, args, options = {}) {
  const nativeNpm = process.platform === 'win32' && command === 'npm'
  const result = await runInstallationProcess(nativeNpm ? process.execPath : commandName(command), nativeNpm ? [resolveNpmCliEntry(), ...args] : args, {
    ...options, env: runtimeEnvironment(), shell: process.platform === 'win32' && !nativeNpm,
    stdio: options.capture ? 'pipe' : 'inherit', timeoutMs: options.timeoutMs || 10 * 60 * 1000,
    label: options.label || command,
  })
  return options.capture ? result.stdout.trim() : ''
}
export async function runInstallDsh(command, args, options = {}) {
  const nativeCli = process.platform === 'win32' && (options.host || RUNTIME_HOST) === 'cli'
  const invocation = nativeCli ? { command: process.execPath, args: [resolveDshCliEntry({ dsh: command }), ...args] } : resolveDshInvocation(command, args, options.host)
  try {
    const result = await runInstallationProcess(invocation.command, invocation.args, {
      ...options, env: { ...runtimeEnvironment(), ...invocation.env }, shell: process.platform === 'win32' && !nativeCli && !invocation.env,
      timeoutMs: options.timeoutMs || 60_000, label: options.label || 'DSH 配置验证',
    })
    return options.capture ? result.stdout.trim() : ''
  } catch (error) {
    const details = [error.stderr, error.stdout].filter(Boolean).join('\n').trim().slice(-2000)
    if (details) error.message += `：\n${details}`
    throw error
  }
}
