#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import installationLocation from './installation-location.cjs'
import { resolveServiceWebUrl } from './service-lifecycle.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME_PATHS = ['bin', 'config', 'presets', 'patches', 'tavern-plugin', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh']
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const redact = value => String(value || '').replace(/([?&]token=)[^\s&]+/gi, '$1[已隐藏]')

function git(cwd, args) {
  return execFileSync('git', args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
}

function sameBytes(left, right) {
  if (left.equals(right)) return true
  const a = left.toString('utf8'), b = right.toString('utf8')
  return !a.includes('\uFFFD') && !b.includes('\uFFFD') && a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n')
}

function run(file, args, options) {
  const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', windowsHide: true, ...options })
  if (result.stdout) process.stdout.write(redact(result.stdout))
  if (result.stderr) process.stderr.write(redact(result.stderr))
  if (result.error || result.status !== 0) throw new Error(`${path.basename(file)} ${args.join(' ')} 失败`, { cause: result.error })
}

function checkedFile(root, relative) {
  if (relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('安装文件路径无效：' + relative)
  }
  let current = root
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('安装路径包含链接：' + current)
  }
  return current
}

async function idlePort(home) {
  const pidFile = path.join(home, 'logs/tavern.pid.json')
  if (!existsSync(pidFile)) return null
  const record = readJson(pidFile)
  const web = await resolveServiceWebUrl({ port: record.port, record, log: readFileSync(path.join(home, 'logs/tavern.log')) })
  if (!web) throw new Error('CLI 当前不可访问，请先用 CLI 启动器检查服务状态')
  const auth = await fetch(web, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = auth.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  await auth.body?.cancel()
  const state = await fetch(new URL('/api/dsh-tavern/getDeploymentActivity', web), {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}', signal: AbortSignal.timeout(5000)
  })
  const { work } = await state.json()
  if (!state.ok || typeof work?.busy !== 'boolean') throw new Error('CLI 部署状态检查失败')
  if (work.busy) throw new Error('CLI 有任务在运行：' + work.reasons.join('、'))
  return record.port
}

function copyAtomically(source, target) {
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = target + '.dev-sync-' + process.pid
  try {
    copyFileSync(source, temporary)
    renameSync(temporary, target)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

async function main() {
  const { values } = parseArgs({ options: { home: { type: 'string' }, source: { type: 'string' }, since: { type: 'string' }, help: { type: 'boolean', short: 'h' } } })
  if (values.help) {
    console.log('node bin/dev-sync-cli.mjs [--home CLI目录] [--source 源码目录] [--since Git基准]')
    return
  }
  const local = path.join(ROOT, '.dsh-tavern-local.json')
  const config = existsSync(local) ? readJson(local) : {}
  const source = realpathSync(values.source || ROOT)
  const home = realpathSync(values.home || process.env.DSH_TAVERN_CLI_HOME || config.cliHome || (config.host === 'cli' && config.dshHome) || path.join(homedir(), '.dsh-tavern'))
  const profile = path.join(home, 'profiles/tavern')
  const { dshTavern } = readJson(path.join(profile, 'package.json'))
  if (dshTavern?.host !== 'cli') throw new Error('目标不是 CLI 版酒馆：' + home)
  const app = realpathSync(installationLocation.resolveInstallationApp({ dshHome: home, appDir: dshTavern.source }))
  if (source === app) throw new Error('源码目录与安装目录相同')
  if (realpathSync(path.join(profile, 'node_modules/dsh-tavern-plugin')) !== realpathSync(path.join(app, 'tavern-plugin'))) {
    throw new Error('CLI 的 Tavern 插件链接未指向安装目录，请先修复 CLI 安装')
  }

  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    if (!sameBytes(readFileSync(path.join(source, file)), readFileSync(path.join(app, file)))) {
      throw new Error('CLI 依赖清单与源码不同，请先用 CLI 安装流程同步依赖：' + file)
    }
  }
  const temp = path.join(source, 'output')
  mkdirSync(temp, { recursive: true })
  run(path.join(source, 'bin/build-tavern-client.mjs'), [], { cwd: source, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } })

  const base = values.since ? git(source, ['rev-parse', '--verify', values.since + '^{commit}']).toString().trim() : ''
  const list = args => git(source, [...args, '-z', '--', ...RUNTIME_PATHS]).toString('utf8').split('\0').filter(Boolean)
  const files = new Set(base ? [
    ...list(['diff', '--name-only', '--no-renames', base]), ...list(['ls-files', '--others', '--exclude-standard'])
  ] : list(['ls-files', '--cached', '--others', '--exclude-standard']))
  const changes = []
  for (const relative of files) {
    const from = checkedFile(source, relative), to = checkedFile(app, relative)
    const incoming = existsSync(from), previous = existsSync(to)
    if (!incoming && (!base || !previous)) continue
    if (incoming && previous && sameBytes(readFileSync(from), readFileSync(to))) continue
    if (base && previous) {
      let original
      try { original = git(source, ['show', base + ':' + relative]) } catch {}
      if (!original || !sameBytes(readFileSync(to), original)) throw new Error('安装文件与指定基准不同：' + relative)
    }
    changes.push({ relative, from, to, incoming, previous })
  }

  const port = await idlePort(home)
  if (!changes.length && port) {
    console.log('CLI 副本已是最新，服务端口 ' + port)
    return
  }
  const launcher = path.join(app, 'bin/dsh-tavern.mjs')
  const env = { ...process.env, DSH_TAVERN_CLI_HOME: home, DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_NO_OPEN: '1', TEMP: temp, TMP: temp, TMPDIR: temp }
  if (port) env.DSH_TAVERN_PORT = String(port)
  const launch = command => run(launcher, [command], { cwd: app, env, timeout: 90000 })

  if (changes.length) {
    mkdirSync(path.join(home, 'backups'), { recursive: true })
    const backup = mkdtempSync(path.join(home, 'backups/dev-sync-'))
    for (const change of changes.filter(item => item.previous)) copyAtomically(change.to, path.join(backup, change.relative))
    if (port) launch('stop')
    try {
      for (const change of changes) {
        if (change.incoming) copyAtomically(change.from, change.to)
        else unlinkSync(change.to)
      }
      console.log(`已同步 ${changes.length} 个文件。旧文件备份：${backup}`)
    } catch (error) {
      for (const change of changes) {
        if (change.previous) copyAtomically(path.join(backup, change.relative), change.to)
        else if (existsSync(change.to)) unlinkSync(change.to)
      }
      if (port) launch('start')
      throw error
    }
  }
  launch('start')
}

main().catch(error => {
  console.error(redact(error.message))
  process.exitCode = 1
})
