#!/usr/bin/env node
// Replay what the conversation page shows for one game, outside the app:
//   node bin/replay-transcript.mjs <酒馆诊断-xxxx.json>        a player's 「导出诊断文件」
//   node bin/replay-transcript.mjs --chat <chatId> [--home ~/.dsh-tavern]   a local save
// Prints every row the host draws, whether Tavern's hiding leaves it visible, and each
// break of the page's invariant (one input and one reply per saved round).
// See Wiki「设计：transcript-row-plan」.
import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Session } from '../tests/fixtures/dsh-session-host.mjs'
import { replayTranscript, storyTurnOf, closeReplay } from '../tests/fixtures/transcript-replay.mjs'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'
import { findSessionDirectory } from '../tavern-plugin/lib/domain/session-log-repair.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const generation = name => Number(/^session(?:\.v(\d+))?\.jsonl/.exec(name)?.[1] || 1)

async function fromDiagnostics(file) {
  const report = JSON.parse(await readFile(file, 'utf8'))
  if (report.kind !== 'dsh-tavern-session-diagnostics') throw new Error('不是酒馆诊断文件')
  if (!report.chat) throw new Error('这份诊断文件没有存档结构（3.0.1 之前导出的），只能看日志，无法对照页面')
  const entry = report.sessions.find(session => session.id === report.chat.sessionId) || report.sessions[0]
  const latest = entry.generations.filter(item => item.events).sort((left, right) => generation(right.file) - generation(left.file))[0]
  if (!latest) throw new Error('诊断文件里没有可读的会话日志')
  return { chat: report.chat, sessionId: entry.id, header: latest.header, events: latest.events }
}

async function fromLocal(chatId, home) {
  const root = path.join(home, 'profile-data', 'tavern')
  const chat = await createChatPersistence({ store: createChatJournalStore({ dataRoot: path.join(root, 'data') }) }).read(chatId)
  if (!chat) throw new Error('找不到存档 ' + chatId)
  const found = await findSessionDirectory(path.join(root, 'sessions'), chat.sessionId)
  if (!found.ok) throw new Error('找不到会话日志：' + found.reason)
  const name = (await readdir(found.path)).filter(item => /^session(?:\.v\d+)?\.jsonl(\.zstd)?$/.test(item)).sort((left, right) => generation(right) - generation(left))[0]
  const { header, events } = parseSessionLog(await readFile(path.join(found.path, name)))
  return { chat, sessionId: chat.sessionId, header, events }
}

const chatId = option('--chat')
const input = chatId ? await fromLocal(chatId, option('--home') || path.join(os.homedir(), '.dsh-tavern')) : args[0] ? await fromDiagnostics(args[0]) : null
if (!input) {
  console.error('用法：node bin/replay-transcript.mjs <酒馆诊断.json>\n      node bin/replay-transcript.mjs --chat <chatId> [--home ~/.dsh-tavern]')
  process.exit(1)
}
const session = Session.fromRestore(input.sessionId, input.events, input.header, 0, 'detached')
try {
  const { view, rows, problems, stale, plan } = await replayTranscript(input.chat, session)
  const preview = text => (text.length > 24 ? text.slice(0, 24) + '…' : text).replace(/\s+/g, ' ')
  const shown = visible => (visible ? '显示' : '隐藏')
  if (!args.includes('--quiet')) {
    console.log('现行  计划')
    for (const [index, row] of rows.entries()) {
      if (row.kind === 'context') continue
      const story = row.kind === 'assistant-step' ? ` → 第 ${storyTurnOf(view, row.turn)} 轮` : ''
      const differs = row.visible !== plan.rows[index].visible ? ' ←' : ''
      console.log(`${shown(row.visible)}  ${shown(plan.rows[index].visible)}  原生轮 ${String(row.turn ?? '-').padStart(3)}  ${row.kind.padEnd(14)} seq ${String(row.seq).padStart(5)}${story}  ${preview(row.text)}${differs}`)
    }
    console.log('\n名单', JSON.stringify({ suppressed: view.suppressedDshTurns, replacing: view.replacingDshTurns, superseded: view.supersededDshTurns, regenerated: view.regeneratedDshTurns }))
    console.log('计划（例外）', JSON.stringify(Object.fromEntries(Object.keys(plan.plan).map(key => [key, plan.plan[key]]))), '进行中', plan.open)
  }
  const differs = rows.filter((row, index) => row.kind !== 'context' && row.visible !== plan.rows[index].visible).length
  const list = items => items.length ? items.map(item => '\n- ' + item).join('') : ' 无'
  console.log(`\n现行逻辑的问题：${list(problems)}${stale.length ? '\n  （显示旧版本：' + stale.length + ' 处）' : ''}`)
  console.log(`行计划的问题：${list(plan.problems)}${plan.stale.length ? '\n  （显示旧版本：' + plan.stale.length + ' 处）' : ''}`)
  console.log(`两者显示不同的行：${differs} 行`)
  process.exitCode = problems.length || plan.problems.length ? 2 : 0
} finally { await closeReplay() }
