#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { migrateLegacyTavernData, resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import {
  beginProfileConfigurationUpdate,
  loadProfileManifest,
  mergeProfileManifest,
  prepareProfilePatch,
} from './profile-configuration.mjs'

const PROFILE = 'tavern'
const INSTALL_HOSTS = new Set(['cli', 'desktop', 'android'])
const CLI_HOST = '127.0.0.1'
const CLI_PORT = resolveServicePort(process.env.DSH_TAVERN_PORT)
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const DSH_ROOT = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(DSH_ROOT, 'profiles', PROFILE)
const LOG_DIR = path.join(DSH_ROOT, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'tavern.log')
const PID_FILE = path.join(LOG_DIR, 'tavern.pid.json')
const FRONTEND_BOOTSTRAP_FILE = path.join(LOG_DIR, 'tavern.frontend-bootstrap.json')
const FRONTEND_BOOTSTRAP_VERSION = 1
const SETTINGS_FILE = path.join(DSH_ROOT, 'settings.yaml')
const SIDEBAR_DEFAULTS_VERSION = 8
const TAVERN_SIDEBAR_DEFAULTS = {
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
const REQUIRED_SOURCE_FILES = [
  'package.json',
  'cordis.patch.yml',
  path.join('config', 'legacy-profile-patch-v0.6.yml'),
  'pnpm-workspace.yaml',
  path.join('tavern-plugin', 'package.json'),
  path.join('tavern-plugin', 'cordis.patch.yml'),
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

export function restartBrowserTarget(port, runtimeGeneration) {
  return `http://127.0.0.1:${port}/?tavern-boot=${encodeURIComponent(String(runtimeGeneration))}`
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

function openBrowserTarget(url) {
  const target = browserOpenCommand(url)
  const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', function () {})
  child.unref()
}

export function needsFrontendBootstrap(record, requiredVersion = FRONTEND_BOOTSTRAP_VERSION) {
  return !record || Number(record.version) < requiredVersion
}

function bootstrapFrontendOnce(state) {
  let record = null
  try { record = JSON.parse(readFileSync(FRONTEND_BOOTSTRAP_FILE, 'utf8')) } catch {}
  if (!needsFrontendBootstrap(record)) return false
  const target = restartBrowserTarget(state.port, state.runtimeGeneration)
  openBrowserTarget(target)
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(FRONTEND_BOOTSTRAP_FILE, `${JSON.stringify({ version: FRONTEND_BOOTSTRAP_VERSION, target, completedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`已一次性打开新版前端：${target}`)
  return true
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function applySidebarDefaults(settings = {}) {
  const document = record(settings)
  const current = record(document['dsh-better-sidebar'])
  const tavernSettings = record(document['dsh-tavern'])
  const currentDefaultsVersion = Number(tavernSettings.sidebarDefaultsVersion)
  const migrateResourcesTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 3
  const migrateCardLibraryTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 4
  const migrateNativeFiles = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 5
  const migratePresetsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 7
  const removeBoundaryPromptsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 8
  const tabsEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.tabsEnabled,
    ...record(current.tabsEnabled),
  }
  if (migrateResourcesTab) {
    tabsEnabled['dsh-tavern:resources'] = true
  }
  if (migrateCardLibraryTab) {
    tabsEnabled['dsh-tavern:cards'] = true
  }
  if (migratePresetsTab) {
    tabsEnabled['dsh-tavern:presets'] = true
  }
  if (removeBoundaryPromptsTab) delete tabsEnabled['dsh-tavern:boundary-prompts']
  const viewersEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.viewersEnabled,
    ...record(current.viewersEnabled),
  }
  if (migrateNativeFiles) {
    tabsEnabled.editor = true
    viewersEnabled.markdown = true
    viewersEnabled.code = true
  }
  return {
    ...document,
    'dsh-tavern': {
      ...tavernSettings,
      sidebarDefaultsVersion: SIDEBAR_DEFAULTS_VERSION,
    },
    'dsh-better-sidebar': {
      ...TAVERN_SIDEBAR_DEFAULTS,
      ...current,
      tabsEnabled,
      viewersEnabled,
    },
  }
}

export function ensureSidebarDefaults(settingsPath = SETTINGS_FILE) {
  const source = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : ''
  const yaml = parseDocument(source)
  if (yaml.errors.length > 0) {
    throw new Error(`无法读取 DSH 设置：${yaml.errors[0].message}`)
  }
  const current = record(yaml.toJS())
  const next = applySidebarDefaults(current)
  if (JSON.stringify(next) === JSON.stringify(current)) return false

  yaml.set('dsh-tavern', next['dsh-tavern'])
  yaml.set('dsh-better-sidebar', next['dsh-better-sidebar'])
  mkdirSync(path.dirname(settingsPath), { recursive: true })
  const temporary = `${settingsPath}.tmp-${process.pid}`
  writeFileSync(temporary, yaml.toString(), 'utf8')
  renameSync(temporary, settingsPath)
  return true
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function commandName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.cmd` : name
}

function run(command, args, options = {}) {
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

export function extractDshVersion(output) {
  const match = String(output || '').match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  if (!match) throw new Error('无法识别当前 DSH 版本。')
  return match[1]
}

export function parseInstallHost(args = []) {
  let host = 'cli'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--host') {
      host = args[index + 1]
      index += 1
    } else if (argument.startsWith('--host=')) {
      host = argument.slice('--host='.length)
    } else {
      throw new Error(`无法识别的安装参数：${argument}`)
    }
  }
  if (!INSTALL_HOSTS.has(host)) throw new Error(`不支持的安装宿主：${host || '空值'}`)
  return host
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? ['where', [command]] : ['sh', ['-c', `command -v ${command}`]]
  return spawnSync(probe[0], probe[1], { stdio: 'ignore' }).status === 0
}

function findDshCommand() {
  if (commandExists('dsh')) return 'dsh'

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

function requireCommand(command, installHint = '') {
  if (!commandExists(command)) {
    throw new Error(`缺少命令：${command}${installHint ? `。${installHint}` : ''}`)
  }
}

function verifySource() {
  for (const relativePath of REQUIRED_SOURCE_FILES) {
    const absolutePath = path.join(SOURCE_ROOT, relativePath)
    if (!existsSync(absolutePath)) {
      throw new Error(`安装源不完整，缺少：${absolutePath}`)
    }
  }
}

function prepareProfileConfiguration(host, dshVersion) {
  const source = JSON.parse(readFileSync(path.join(SOURCE_ROOT, 'package.json'), 'utf8'))
  const current = loadProfileManifest({ profileDir: PROFILE_DIR })
  if (current.name && current.name !== 'dsh-profile-tavern') {
    throw new Error(`目标 profile 已属于其他项目：${current.name}`)
  }

  const pluginPath = path.join(SOURCE_ROOT, 'tavern-plugin')
  const manifest = mergeProfileManifest({
    source,
    current,
    pluginPath,
    dataRoot: resolveTavernDataRoot({ dshHome: DSH_ROOT }),
    host,
    dshVersion,
  })
  const patchText = prepareProfilePatch({
    profileDir: PROFILE_DIR,
    templateText: readFileSync(path.join(SOURCE_ROOT, 'cordis.patch.yml'), 'utf8'),
    legacyManagedText: readFileSync(path.join(SOURCE_ROOT, 'config', 'legacy-profile-patch-v0.6.yml'), 'utf8'),
    profileConfigurationVersion: current.dshTavern && current.dshTavern.profileConfigurationVersion,
  })
  return { manifest, patchText }
}

function installPluginDependencies(dshVersion) {
  const pluginDirectory = path.join(SOURCE_ROOT, 'tavern-plugin')
  const workspacePath = path.join(pluginDirectory, 'pnpm-workspace.yaml')
  const original = readFileSync(workspacePath, 'utf8')
  const workspace = parseDocument(original)
  if (workspace.errors.length > 0) throw new Error(`无法读取插件 workspace：${workspace.errors[0].message}`)
  workspace.setIn(['overrides', '@deepseek-ai/dsh-subagent'], dshVersion)
  workspace.setIn(['overrides', '@deepseek-ai/dsh-tools'], dshVersion)
  const temporary = `${workspacePath}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, workspace.toString(), 'utf8')
    renameSync(temporary, workspacePath)
    run('pnpm', ['--dir', pluginDirectory, 'install', '--lockfile=false'])
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
    writeFileSync(workspacePath, original, 'utf8')
  }
}

export function renderWindowsLauncher(scriptPath) {
  return `@echo off\r\nnode "${scriptPath.replaceAll('"', '""')}" %*\r\n`
}

export function encodeWindowsPowerShellScript(source) {
  return `\uFEFF${source.replace(/^\uFEFF/, '')}`
}

export function parseUpdateOptions(args) {
  let host = 'cli'
  let statusFile = ''
  let delay = 0
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--host') host = args[++index]
    else if (value.startsWith('--host=')) host = value.slice('--host='.length)
    else if (value === '--status-file') statusFile = args[++index]
    else if (value.startsWith('--status-file=')) statusFile = value.slice('--status-file='.length)
    else if (value === '--delay') delay = Number(args[++index])
    else if (value.startsWith('--delay=')) delay = Number(value.slice('--delay='.length))
    else throw new Error(`无法识别的更新参数：${value}`)
  }
  if (!INSTALL_HOSTS.has(host)) throw new Error(`不支持的安装宿主：${host}`)
  if (statusFile !== '' && !path.isAbsolute(statusFile)) throw new Error('更新状态文件必须使用绝对路径')
  if (!Number.isInteger(delay) || delay < 0 || delay > 5000) throw new Error('更新延迟必须是 0 到 5000 毫秒的整数')
  return { host, statusFile, delay }
}

function writeUpdateStatus(file, value) {
  if (file === '') return
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

function pathEntries() {
  return (process.env.PATH || '').split(path.delimiter).map((entry) => path.resolve(entry).toLowerCase())
}

function pathExistsNoFollow(targetPath) {
  try {
    lstatSync(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function installCommand() {
  if (process.platform === 'win32') {
    let binDir = process.env.DSH_TAVERN_BIN_DIR || process.env.PNPM_HOME
    if (!binDir) {
      try {
        binDir = run('pnpm', ['bin', '--global'], { capture: true })
      } catch {
        binDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'pnpm')
      }
    }
    mkdirSync(binDir, { recursive: true })
    const commandPath = path.join(binDir, 'dsh-tavern.cmd')
    if (pathExistsNoFollow(commandPath)) {
      if (readFileSync(commandPath, 'utf8') === renderWindowsLauncher(SCRIPT_PATH)) return
      const backupPath = `${commandPath}.backup.${timestamp()}`
      renameSync(commandPath, backupPath)
      console.log(`已备份原命令：${backupPath}`)
    }
    writeFileSync(commandPath, renderWindowsLauncher(SCRIPT_PATH), 'utf8')
    console.log(`已安装命令：${commandPath}`)
    if (!pathEntries().includes(path.resolve(binDir).toLowerCase())) {
      console.log(`提示：请把 ${binDir} 加入 PATH，然后重新打开 PowerShell。`)
    }
    return
  }

  const binDir = process.env.DSH_TAVERN_BIN_DIR || path.join(os.homedir(), '.local', 'bin')
  const commandPath = path.join(binDir, 'dsh-tavern')
  mkdirSync(binDir, { recursive: true })

  if (pathExistsNoFollow(commandPath)) {
    try {
      if (readlinkSync(commandPath) === SCRIPT_PATH) return
    } catch {
      // Existing regular file, handled by the backup below.
    }
    const backupPath = `${commandPath}.backup.${timestamp()}`
    renameSync(commandPath, backupPath)
    console.log(`已备份原命令：${backupPath}`)
  }
  symlinkSync(SCRIPT_PATH, commandPath)
  console.log(`已安装命令：${commandPath}`)
  if (!pathEntries().includes(path.resolve(binDir).toLowerCase())) {
    console.log(`提示：请把 ${binDir} 加入 PATH，然后重新打开终端。`)
  }
}

function timestamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function installedCommandSource() {
  if (process.platform === 'win32') return null
  const commandPath = path.join(process.env.DSH_TAVERN_BIN_DIR || path.join(os.homedir(), '.local', 'bin'), 'dsh-tavern')
  try {
    const target = readlinkSync(commandPath)
    const script = path.resolve(path.dirname(commandPath), target)
    return path.resolve(path.dirname(script), '..')
  } catch {
    return null
  }
}

function existingProfileSource() {
  const manifest = path.join(PROFILE_DIR, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    const source = JSON.parse(readFileSync(manifest, 'utf8'))?.dshTavern?.source
    return typeof source === 'string' && source !== '' ? path.resolve(source) : null
  } catch {
    return null
  }
}

function legacyDataRoots() {
  const roots = []
  const seen = new Set()
  function add(candidate, explicitData = false) {
    if (typeof candidate !== 'string' || candidate === '') return
    const data = path.resolve(explicitData ? candidate : path.join(candidate, 'data'))
    if (seen.has(data) || !existsSync(data)) return
    seen.add(data)
    roots.push({ path: data, label: path.basename(path.dirname(data)) })
  }
  add(installedCommandSource())
  add(existingProfileSource())
  add(SOURCE_ROOT)
  for (const candidate of (process.env.DSH_TAVERN_LEGACY_DATA || '').split(path.delimiter)) add(candidate, true)
  return roots
}

async function installProfile(host = 'cli') {
  const dsh = findDshCommand()
  requireCommand('node', '请安装 Node.js 22.19 或更高版本')
  requireCommand('pnpm', '请运行 npm install -g pnpm')
  verifySource()
  const dshVersion = extractDshVersion(runDsh(dsh, ['--version'], { capture: true }))

  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
  const dataRoot = resolveTavernDataRoot({ dshHome: DSH_ROOT })
  const migration = await migrateLegacyTavernData({
    targetRoot: dataRoot,
    backupRoot: path.join(DSH_ROOT, 'backups', 'dsh-tavern-data-upgrade'),
    legacyRoots: legacyDataRoots(),
  })
  for (const directory of ['cards', 'chats', 'scripts', 'sources', 'skills', 'diffs']) {
    mkdirSync(path.join(dataRoot, directory), { recursive: true })
  }
  if (migration.migratedSources > 0) console.log(`已迁移 ${migration.migratedSources} 处旧数据；冲突保留 ${migration.conflicts} 个。`)

  installPluginDependencies(dshVersion)
  const configuration = prepareProfileConfiguration(host, dshVersion)
  const transaction = beginProfileConfigurationUpdate({
    profileDir: PROFILE_DIR,
    manifest: configuration.manifest,
    patchText: configuration.patchText,
  })
  for (const backup of Object.values(transaction.backups)) {
    if (backup !== null) console.log(`已备份原配置：${backup}`)
  }
  try {
    copyFileSync(path.join(SOURCE_ROOT, 'pnpm-workspace.yaml'), path.join(PROFILE_DIR, 'pnpm-workspace.yaml'))
    run('pnpm', ['--dir', PROFILE_DIR, 'install'])
    runDsh(dsh, ['--profile', PROFILE, '--dump-config'], { stdio: 'ignore' })
    ensureSidebarDefaults()
    transaction.commit()
  } catch (error) {
    transaction.rollback()
    throw error
  }
  if (host === 'cli') installCommand()

  console.log('DSH Tavern 已安装。')
  console.log(`已与当前 DSH ${dshVersion} 对齐依赖。`)
  if (host === 'desktop') {
    console.log('请重启 DSH Desktop，然后从托盘的 Profile 菜单切换到 tavern。')
  } else if (host === 'android') {
    console.log('Android Tavern Profile 已配置。')
  } else {
    console.log('启动：dsh-tavern start')
  }
  if (host === 'cli' && process.platform === 'win32') {
    console.log('如果当前 PowerShell 尚未识别新命令，也可以在仓库目录运行：pnpm run start:tavern')
  }
}

function verifyProfile() {
  if (!existsSync(path.join(PROFILE_DIR, 'package.json')) || !existsSync(path.join(PROFILE_DIR, 'cordis.patch.yml'))) {
    throw new Error(`DSH Tavern 尚未安装，请先在仓库目录运行：pnpm run install:tavern`)
  }
}

function readPidRecord() {
  if (!existsSync(PID_FILE)) return null
  try {
    const record = JSON.parse(readFileSync(PID_FILE, 'utf8'))
    return Number.isInteger(record.pid) && record.pid > 0 ? record : null
  } catch {
    return null
  }
}

function writePidRecord(pid, port) {
  writeFileSync(PID_FILE, `${JSON.stringify({ pid, port, profile: PROFILE, source: SOURCE_ROOT, startedAt: new Date().toISOString() }, null, 2)}\n`)
}

function removePidRecord() {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function isPortOpen(port, host = '127.0.0.1', timeout = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function serviceState() {
  const port = CLI_PORT
  const record = readPidRecord()
  const pidAlive = Boolean(record && isProcessAlive(record.pid))
  const portOpen = await isPortOpen(port)
  if (record && !pidAlive) removePidRecord()
  const legacyRecord = !pidAlive && portOpen ? findLegacyService(port) : null
  return { port, record: pidAlive ? record : legacyRecord, portOpen }
}

function findLegacyService(port) {
  if (process.platform === 'win32' || !commandExists('lsof')) return null
  const listeners = spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (listeners.status !== 0) return null
  const pids = listeners.stdout.split(/\s+/).map(Number).filter(Number.isInteger)
  for (const pid of pids) {
    const processInfo = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    if (processInfo.status === 0 && processInfo.stdout.includes(`dsh --profile ${PROFILE}`)) {
      return { pid, port, profile: PROFILE, source: SOURCE_ROOT, legacy: true }
    }
  }
  return null
}

async function statusService() {
  verifyProfile()
  const state = await serviceState()
  if (state.record && state.portOpen) {
    console.log(`DSH Tavern 正在运行：PID ${state.record.pid}，http://127.0.0.1:${state.port}`)
    return
  }
  if (state.portOpen) {
    throw new Error(`端口 ${state.port} 已被未识别的进程占用，DSH Tavern 不会操作该进程。`)
  }
  if (state.record) {
    console.log(`DSH Tavern 正在启动：PID ${state.record.pid}（端口 ${state.port} 尚未监听）。`)
    return
  }
  fail(`DSH Tavern 未运行（端口 ${state.port}）。`)
}

async function stopService() {
  verifyProfile()
  const state = await serviceState()
  if (!state.record) {
    if (state.portOpen) {
      throw new Error(`端口 ${state.port} 已被未识别的进程占用，拒绝停止。`)
    }
    console.log('DSH Tavern 已停止。')
    return
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(state.record.pid), '/T', '/F'], { stdio: 'ignore' })
    if (result.status !== 0 && isProcessAlive(state.record.pid)) {
      throw new Error(`无法停止 DSH Tavern 进程：PID ${state.record.pid}。`)
    }
  } else {
    try {
      process.kill(state.record.pid, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await isPortOpen(state.port)) && !isProcessAlive(state.record.pid)) {
      removePidRecord()
      console.log('DSH Tavern 已停止。')
      return
    }
    await sleep(100)
  }
  throw new Error(`服务未能在 10 秒内停止；没有强制结束进程，请手动检查 PID ${state.record.pid}。`)
}

function runDsh(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options })
  if (result.error) throw new Error(`无法运行 dsh：${result.error.message}`)
  if (result.status !== 0) throw new Error('dsh 配置验证失败。')
  return options.capture ? result.stdout.trim() : ''
}

async function startService() {
  verifyProfile()
  ensureSidebarDefaults()
  const state = await serviceState()
  if (state.record && state.portOpen) {
    console.log(`DSH Tavern 已经在运行：PID ${state.record.pid}。`)
    return
  }
  if (state.record) {
    throw new Error(`已有 DSH Tavern 进程正在启动：PID ${state.record.pid}。`)
  }
  if (state.portOpen) {
    throw new Error(`端口 ${state.port} 已被其他进程占用，拒绝启动。`)
  }

  const dsh = findDshCommand()
  mkdirSync(LOG_DIR, { recursive: true })
  const logDescriptor = openSync(LOG_FILE, 'a')
  let child
  try {
    child = spawn(dsh, ['--profile', PROFILE, '--host', CLI_HOST, '--port', String(CLI_PORT), '--no-open'], {
      cwd: SOURCE_ROOT,
      detached: true,
      env: { ...process.env, DSH_TAVERN_RUNTIME_HOST: process.env.DSH_TAVERN_RUNTIME_HOST || 'cli' },
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  } finally {
    closeSync(logDescriptor)
  }
  child.unref()
  writePidRecord(child.pid, state.port)

  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await isPortOpen(state.port)) {
      console.log(`DSH Tavern 已启动：PID ${child.pid}，http://127.0.0.1:${state.port}`)
      console.log(`日志：${LOG_FILE}`)
      return { port: state.port, runtimeGeneration: `${child.pid}-${Date.now()}` }
    }
    if (!isProcessAlive(child.pid)) {
      removePidRecord()
      const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-30).join('\n') : ''
      throw new Error(`DSH Tavern 启动失败。${log ? `\n最近日志：\n${log}` : ''}`)
    }
    await sleep(200)
  }

  throw new Error(`DSH Tavern 启动超时，日志：${LOG_FILE}`)
}

export async function updateApplication(options = { host: 'cli', statusFile: '', delay: 0 }) {
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT)
  const log = typeof options.log === 'function' ? options.log : console.log
  writeUpdateStatus(options.statusFile, { phase: 'running', host: options.host, startedAt: Date.now() })
  let temporary = ''
  try {
    if (options.delay > 0) await sleep(options.delay)
    log('正在更新 DSH Tavern……')
    const program = resolveUpdateProgram(options.host, process.platform, sourceRoot)
    const installer = program.script
    if (!existsSync(installer)) throw new Error(`当前安装缺少更新程序：${installer}`)
    const extension = path.extname(installer).slice(1) || 'sh'
    temporary = path.join(os.tmpdir(), `dsh-tavern-update-${process.pid}.${extension}`)
    if (path.extname(installer).toLowerCase() === '.ps1') {
      writeFileSync(temporary, encodeWindowsPowerShellScript(readFileSync(installer, 'utf8')), 'utf8')
    } else {
      copyFileSync(installer, temporary)
    }
    const command = program.command
    const args = program.args.map((argument) => argument === installer ? temporary : argument)
    const capture = options.statusFile !== ''
    const result = spawnSync(command, args, {
      encoding: capture ? 'utf8' : undefined,
      env: { ...process.env, DSH_TAVERN_HOST: options.host, DSH_TAVERN_SOURCE_ROOT: SOURCE_ROOT },
      stdio: capture ? 'pipe' : 'inherit',
    })
    if (result.error) throw new Error(`无法运行更新程序：${result.error.message}`)
    if (result.status !== 0) {
      const details = capture ? String(result.stderr || result.stdout || '').trim().split('\n').slice(-12).join('\n') : ''
      throw new Error(`更新失败${details ? `：${details}` : '，请查看上方错误信息。'}`)
    }
    if (temporary !== '' && existsSync(temporary)) unlinkSync(temporary)
    temporary = ''
    writeUpdateStatus(options.statusFile, { phase: 'completed', host: options.host, completedAt: Date.now(), requiresRestart: options.host === 'desktop' })
  } catch (error) {
    let failure = error
    if (temporary !== '' && existsSync(temporary)) {
      try { unlinkSync(temporary) } catch (cleanupError) {
        failure = new Error(`${String(error?.message || error)}；临时文件清理失败：${String(cleanupError?.message || cleanupError)}`)
      }
    }
    writeUpdateStatus(options.statusFile, { phase: 'failed', host: options.host, failedAt: Date.now(), error: String(failure?.message || failure) })
    throw failure
  }
}

function resolveWindowsPowerShell(options = {}) {
  const environment = options.env || process.env
  const fileExists = options.fileExists || existsSync
  const commandAvailable = options.commandAvailable || commandExists
  const windowsRoots = [
    environment.SystemRoot,
    environment.SYSTEMROOT,
    environment.WINDIR,
    environment.windir,
  ].filter(Boolean)

  for (const windowsRoot of new Set(windowsRoots)) {
    const candidate = path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fileExists(candidate)) return candidate
  }
  if (commandAvailable('powershell.exe')) return 'powershell.exe'
  if (commandAvailable('pwsh.exe')) return 'pwsh.exe'
  return ''
}

export function resolveUpdateProgram(host, platform = process.platform, sourceRoot = SOURCE_ROOT, options = {}) {
  if (host === 'android') {
    const script = path.join(sourceRoot, 'android', 'update.sh')
    return { script, command: 'bash', args: [script] }
  }
  if (platform === 'win32') {
    const script = path.join(sourceRoot, 'install.ps1')
    const command = resolveWindowsPowerShell(options)
    if (command === '') {
      const hostPrefix = host === 'desktop' ? "$env:DSH_TAVERN_HOST='desktop'; " : ''
      throw new Error(
        `找不到 Windows PowerShell 或 PowerShell 7。请在当前 PowerShell 中运行：${hostPrefix}irm https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1 | iex`,
      )
    }
    return { script, command, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] }
  }
  const script = path.join(sourceRoot, 'install.sh')
  return { script, command: 'sh', args: [script] }
}

function usage() {
  console.log('用法：dsh-tavern install [--host cli|desktop|android] | {update|start|stop|restart|status}')
}

async function main() {
  const action = process.argv[2] || 'status'
  switch (action) {
    case 'install':
      await installProfile(parseInstallHost(process.argv.slice(3)))
      break
    case 'update':
      await updateApplication(parseUpdateOptions(process.argv.slice(3)))
      break
    case 'start':
      await startService()
      break
    case 'stop':
      await stopService()
      break
    case 'restart':
      await stopService()
      {
        const state = await startService()
        if (!bootstrapFrontendOnce(state)) console.log('浏览器页面会自动识别本次后台重启并恢复连接。')
      }
      break
    case 'status':
      await statusService()
      break
    case '-h':
    case '--help':
    case 'help':
      usage()
      break
    default:
      usage()
      process.exitCode = 2
  }
}

const isEntrypoint = process.argv[1] && realpathSync(SCRIPT_PATH) === realpathSync(path.resolve(process.argv[1]))
if (isEntrypoint) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
}
