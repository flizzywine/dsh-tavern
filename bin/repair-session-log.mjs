#!/usr/bin/env node
// Repair one stored session log the host refuses to open, without starting DSH:
//   node bin/repair-session-log.mjs --boot /path/to/dsh-app-boot/lib/index.js <session.v4.jsonl.zstd>
//   node bin/repair-session-log.mjs --boot … --sessions <sessionsRoot> --id session-1a29d1d2
// DSH_BOOT_MODULE may stand in for --boot. The catalog that judges a log is the one
// installed with DSH, so the boot module (not this checkout) supplies it.
import { createRequire } from 'node:module'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { repairCurrentSessionFile } from '../tavern-plugin/lib/domain/session-log-repair.js'

function usage() {
  console.error([
    '用法：',
    '  node bin/repair-session-log.mjs --boot <dsh-app-boot/lib/index.js> <session.v4.jsonl.zstd>',
    '  node bin/repair-session-log.mjs --boot … --sessions <会话根目录> --id <会话编号>',
    '也可用环境变量 DSH_BOOT_MODULE 代替 --boot。',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = { boot: process.env.DSH_BOOT_MODULE || '', sessions: '', id: '', file: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--boot') options.boot = argv[++index] || ''
    else if (arg === '--sessions') options.sessions = argv[++index] || ''
    else if (arg === '--id') options.id = argv[++index] || ''
    else if (arg === '--help' || arg === '-h') return null
    else if (!arg.startsWith('--')) options.file = arg
  }
  return options
}

async function loadCatalog(boot) {
  if (!boot) throw new Error('缺少 --boot：需要指向 DSH 的 dsh-app-boot/lib/index.js')
  const require = createRequire(pathToFileURL(boot))
  const url = pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href
  const loaded = await import(url)
  const catalog = loaded.sessionFormatCatalog
  if (!catalog?.createRestore) throw new Error('宿主会话格式目录不可用')
  return catalog
}

async function findSessionFile(sessionsRoot, id) {
  const wanted = `session.v`
  for (const project of await readdir(sessionsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const directory = path.join(sessionsRoot, project.name, id)
    let info
    try { info = await stat(directory) } catch { continue }
    if (!info.isDirectory()) continue
    const names = await readdir(directory)
    const log = names.find(name => name.startsWith(wanted) && name.endsWith('.jsonl.zstd'))
    if (log) return path.join(directory, log)
  }
  return null
}

const args = parseArgs(process.argv.slice(2))
if (!args) process.exit(0)
if (!args.file && !(args.sessions && args.id)) {
  usage()
  process.exit(2)
}

let catalog
try { catalog = await loadCatalog(args.boot) }
catch (error) { console.error('无法加载宿主会话格式目录：' + (error.message || error)); process.exit(1) }

const file = args.file || await findSessionFile(args.sessions, args.id)
if (!file) { console.error('找不到会话日志文件'); process.exit(1) }
const result = await repairCurrentSessionFile(file, catalog)
if (!result.ok) {
  console.error('会话日志仍然打不开：' + (result.reason || '未知原因'))
  console.error('日志：' + file)
  process.exit(1)
}
if (!result.written) {
  console.log('会话日志本来就能打开，没有改动：' + file)
  process.exit(0)
}
console.log('已修复：' + file)
console.log('原文件备份：' + result.backup)
console.log('修复原因：' + (result.reason || ''))
