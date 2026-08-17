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

const PROFILE = 'tavern'
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const DSH_ROOT = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(DSH_ROOT, 'profiles', PROFILE)
const LOG_DIR = path.join(DSH_ROOT, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'tavern.log')
const PID_FILE = path.join(LOG_DIR, 'tavern.pid.json')
const REQUIRED_SOURCE_FILES = [
  'package.json',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
  path.join('tavern-plugin', 'package.json'),
  path.join('presets', 'tavern', 'preset.yml'),
]

function fail(message) {
  console.error(message)
  process.exitCode = 1
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

function readPort() {
  const patchPath = path.join(PROFILE_DIR, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return 3081
  const match = readFileSync(patchPath, 'utf8').match(/^\s*port:\s*(\d+)\s*$/m)
  return match ? Number(match[1]) : 3081
}

function writeProfileManifest() {
  const source = JSON.parse(readFileSync(path.join(SOURCE_ROOT, 'package.json'), 'utf8'))
  const targetPath = path.join(PROFILE_DIR, 'package.json')
  let current = {}

  if (existsSync(targetPath)) {
    current = JSON.parse(readFileSync(targetPath, 'utf8'))
    if (current.name && current.name !== 'dsh-profile-tavern') {
      throw new Error(`目标 profile 已属于其他项目：${current.name}`)
    }
  }

  const pluginPath = path.join(SOURCE_ROOT, 'tavern-plugin').replaceAll(path.sep, '/')
  const dependencies = {
    ...(current.dependencies || {}),
    'dsh-codex-connect': source.dependencies['dsh-codex-connect'],
    'dsh-tavern-plugin': `link:${pluginPath}`,
  }
  delete dependencies['@deepseek-ai/dsh-tools']

  const next = {
    ...current,
    name: 'dsh-profile-tavern',
    private: true,
    dependencies,
    dsh: source.dsh,
    dshTavern: { source: SOURCE_ROOT },
  }
  const temporary = `${targetPath}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(temporary, targetPath)
}

export function renderWindowsLauncher(scriptPath) {
  return `@echo off\r\nnode "${scriptPath.replaceAll('"', '""')}" %*\r\n`
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

async function installProfile() {
  const dsh = findDshCommand()
  requireCommand('node', '请安装 Node.js 22.19 或更高版本')
  requireCommand('pnpm', '请运行 npm install -g pnpm')
  verifySource()

  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
  for (const directory of ['cards', 'chats', 'scripts', 'sources', 'diffs']) {
    mkdirSync(path.join(SOURCE_ROOT, 'data', directory), { recursive: true })
  }

  run('pnpm', ['--dir', path.join(SOURCE_ROOT, 'tavern-plugin'), 'install', '--ignore-workspace'])
  writeProfileManifest()
  copyFileSync(path.join(SOURCE_ROOT, 'cordis.patch.yml'), path.join(PROFILE_DIR, 'cordis.patch.yml'))
  copyFileSync(path.join(SOURCE_ROOT, 'pnpm-workspace.yaml'), path.join(PROFILE_DIR, 'pnpm-workspace.yaml'))
  run('pnpm', ['--dir', PROFILE_DIR, 'install'])
  runDsh(dsh, ['--profile', PROFILE, '--dump-config'], { stdio: 'ignore' })
  installCommand()

  console.log('DSH Tavern 已安装。')
  console.log('启动：dsh-tavern start')
  if (process.platform === 'win32') {
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
  const port = readPort()
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
}

async function startService() {
  verifyProfile()
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
    child = spawn(dsh, ['--profile', PROFILE], {
      cwd: SOURCE_ROOT,
      detached: true,
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
      return
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

async function updateApplication() {
  console.log('正在更新 DSH Tavern……')
  const extension = process.platform === 'win32' ? 'ps1' : 'sh'
  const installer = path.join(SOURCE_ROOT, `install.${extension}`)
  if (!existsSync(installer)) throw new Error(`当前安装缺少更新程序：${installer}`)
  const temporary = path.join(os.tmpdir(), `dsh-tavern-update-${process.pid}.${extension}`)
  copyFileSync(installer, temporary)
  try {
    const command = process.platform === 'win32' ? 'powershell.exe' : 'sh'
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', temporary]
      : [temporary]
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.error) throw new Error(`无法运行更新程序：${result.error.message}`)
    if (result.status !== 0) throw new Error('更新失败，请查看上方错误信息。')
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function usage() {
  console.log('用法：dsh-tavern {install|update|start|stop|restart|status}')
}

async function main() {
  const action = process.argv[2] || 'status'
  switch (action) {
    case 'install':
      await installProfile()
      break
    case 'update':
      await updateApplication()
      break
    case 'start':
      await startService()
      break
    case 'stop':
      await stopService()
      break
    case 'restart':
      await stopService()
      await startService()
      console.log(`浏览器旧页面仍会保留旧版前端；代码更新后请按 ${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'} + Shift + R 强制刷新。`)
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
