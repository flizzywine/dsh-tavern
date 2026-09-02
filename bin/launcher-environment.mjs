import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared installation paths and process invocation; no install/start/update effects on import.
export const PROFILE = 'tavern'
export const INSTALL_HOSTS = new Set(['cli', 'desktop', 'android'])
export const CLI_HOST = '127.0.0.1'
export const CLI_PORT = resolveServicePort(process.env.DSH_TAVERN_PORT)
export const SCRIPT_PATH = fileURLToPath(new URL('./dsh-tavern.mjs', import.meta.url))
export const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
export const DSH_ROOT = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const PROFILE_DIR = path.join(DSH_ROOT, 'profiles', PROFILE)
export const LOG_DIR = path.join(DSH_ROOT, 'logs')
export const LOG_FILE = path.join(LOG_DIR, 'tavern.log')
export const PID_FILE = path.join(LOG_DIR, 'tavern.pid.json')
export const FRONTEND_BOOTSTRAP_FILE = path.join(LOG_DIR, 'tavern.frontend-bootstrap.json')
export const FRONTEND_BOOTSTRAP_VERSION = 2
export const RELEASE_FILE = '.dsh-tavern-release.json'
export const DEFAULT_COMMIT_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/commits/main'
export const SETTINGS_FILE = path.join(DSH_ROOT, 'settings.yaml')
export const SIDEBAR_DEFAULTS_VERSION = 8
export const TAVERN_SIDEBAR_DEFAULTS = {
  openByDefault: true,
  defaultWidthPercent: 30,
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
  path.join('tavern-plugin', 'packages', 'dsh-image-gen', 'lib', 'index.js'),
  path.join('tavern-plugin', 'packages', 'dsh-image-gen', 'lib', 'client.js'),
  path.join('presets', 'tavern', 'preset.yml'),
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
  const result = spawnSync(commandName(command), args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
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

export function findDshCommand() {
  if (commandExists('dsh')) {
    if (process.platform === 'win32') return 'dsh'
    return run('sh', ['-c', 'command -v dsh'], { capture: true })
  }

  const bundledDsh = process.platform === 'win32'
    ? path.join(DSH_ROOT, 'runtime', 'dsh.cmd')
    : path.join(DSH_ROOT, 'runtime', 'bin', 'dsh')
  if (existsSync(bundledDsh)) return bundledDsh

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

export function resolveDshInvocation(command, args, host = 'cli', nodePath = process.execPath) {
  if (host !== 'android') return { command, args }
  return { command: nodePath, args: ['--expose-internals', command, ...args] }
}

export function requireCommand(command, installHint = '') {
  if (!commandExists(command)) {
    throw new Error(`缺少命令：${command}${installHint ? `。${installHint}` : ''}`)
  }
}

export function runDsh(command, args, options = {}) {
  const invocation = resolveDshInvocation(command, args, options.host)
  const spawnOptions = { ...options }
  delete spawnOptions.host
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8', shell: process.platform === 'win32', ...spawnOptions,
  })
  if (result.error) throw new Error(`无法运行 dsh：${result.error.message}`)
  if (result.status !== 0) throw new Error('dsh 配置验证失败。')
  return options.capture ? result.stdout.trim() : ''
}
