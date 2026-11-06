#!/usr/bin/env node
// Measure what a game's context compaction kept, without playing it:
//   node bin/eval-compaction-memory.mjs --chat 吞噬星空 --quiz 测验.json [--home ~/.dsh-tavern] [--compact]
//   node bin/eval-compaction-memory.mjs --import 聊天记录.jsonl --card 吞噬星空 --compact --quiz 测验.json
// --grow 聊天记录.jsonl --rounds 61-120 appends those rounds of the file to the game first, as if
// played (no model), so a long run can be compacted again and again: import 60, compact, grow to
// 120, compact, grow to 180, compact…
// --ask then puts every quiz question to the game's model as a player input, one turn each,
// and scores its reply by the same keywords, noting each history recall it made.
// --import first imports a SillyTavern chat file (see novel-to-chat.mjs) as a new game under
// the named card, through the running CLI Tavern; the evaluation then uses that game.
// Reads the game's own session log: every compaction checkpoint, the volumes of its
// summary (and whether earlier volumes survived later compactions word for word), and for
// each quiz question whether its answer is still in the model's context — in a summary
// volume, in the rounds kept verbatim, or in rounds after the checkpoint — or lost.
// --compact first compacts the game through the running CLI Tavern, as 「压缩上下文」 does.
// Quiz file: [{ "id": 1, "turn": 9, "question": "…", "keywords": [["809"], ["杨武", "杨哥"]] }]
// (every group must match; any keyword within a group counts). No model is called.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'
import { storySummaryVolumes } from '../tavern-plugin/lib/domain/story-compaction.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const home = path.resolve((option('home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')).replace(/^~(?=$|\/)/, os.homedir()))
let query = option('chat')
const quizFile = option('quiz'), importFile = option('import'), cardName = option('card')
if (!query && !(importFile && cardName)) {
  console.error('用法：node bin/eval-compaction-memory.mjs (--chat <对话标题或卡名> | --import 聊天记录.jsonl --card <人物卡名>) [--quiz 测验.json] [--home DSH 主目录，默认 ~/.dsh] [--compact]')
  process.exit(1)
}
const tavern = path.join(home, 'profile-data', 'tavern')
const json = file => JSON.parse(readFileSync(file, 'utf8'))

// Calls the running CLI Tavern on this machine, as the page does.
function rpc(method, payload) {
  const { port } = json(path.join(home, 'logs', 'tavern.pid.json'))
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/dsh-tavern/' + method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk }).on('end', () => {
        let value
        try { value = JSON.parse(text) } catch { return reject(new Error(method + ' 返回：' + text.slice(0, 300))) }
        value.ok === false ? reject(new Error(method + ' 失败：' + (value.error || text.slice(0, 300)))) : resolve(value)
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

if (importFile) {
  const card = (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
  if (!card) throw new Error('找不到人物卡：' + cardName)
  console.log(`正在导入 ${path.basename(importFile)}（人物卡 ${card.name}）……`)
  const imported = await rpc('importChatHistoryText', { cardPath: card.path, text: readFileSync(importFile, 'utf8'), fileName: path.basename(importFile) })
  const linked = json(path.join(tavern, 'data', 'sessions.json'))[imported.sessionId]
  if (!linked) throw new Error('导入完成但找不到新对话：' + imported.sessionId)
  query = linked
}

const chat = (json(path.join(tavern, 'data', 'index.json')).chats || [])
  .filter(row => [row.title, row.cardName, row.id].some(value => String(value || '').includes(query)))
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
if (!chat) throw new Error(`在 ${home} 里找不到名字含「${query}」的对话`)
const sessionId = Object.entries(json(path.join(tavern, 'data', 'sessions.json'))).find(([, id]) => id === chat.id)?.[0]
if (!sessionId) throw new Error('找不到这局对话的会话')
console.log(`对话：${chat.title || chat.cardName}（${chat.id}），会话 ${sessionId}`)

const growFile = option('grow')
if (growFile) {
  const [from, to] = String(option('rounds') || '').split('-').map(Number)
  if (!(from >= 1 && to >= from)) throw new Error('--grow 需要 --rounds 起-止，例如 --rounds 61-120')
  const rows = readFileSync(growFile, 'utf8').split('\n').filter(Boolean).slice(1).map(line => JSON.parse(line))
  const rounds = []
  rows.forEach((row, index) => { if (!row.is_user) rounds.push({ user: rows[index - 1]?.is_user ? rows[index - 1].mes : '继续', assistant: row.mes }) })
  const wanted = rounds.slice(from - 1, to)
  if (wanted.length < to - from + 1) throw new Error(`文件只有 ${rounds.length} 轮`)
  for (let index = 0; index < wanted.length; index += 20) {
    const result = await rpc('appendStoryRounds', { sessionId, rounds: wanted.slice(index, index + 20) })
    console.log(`已追加第 ${from + index}–${from + index + result.appended - 1} 轮（游戏内到第 ${result.lastTurn} 轮）`)
  }
}

if (args.includes('--compact')) {
  console.log('正在压缩上下文（会调用模型，可能需要几分钟）……')
  const operation = (await rpc('runCompaction', { sessionId })).result
  if (!operation) throw new Error('当前对话不支持剧情压缩')
  console.log(`压缩${operation.status === 'completed' ? '完成' : '未完成'}。前台：${operation.foreground?.message}；后台：${operation.background?.message || '无'}`)
}

function sessionLog(id) {
  for (const project of readdirSync(path.join(tavern, 'sessions'))) {
    const directory = path.join(tavern, 'sessions', project, id)
    if (!existsSync(directory)) continue
    const generations = readdirSync(directory).filter(name => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name)).sort()
    return parseSessionLog(readFileSync(path.join(directory, generations.at(-1))))
  }
  throw new Error('找不到会话日志：' + id)
}
const { events } = sessionLog(sessionId)
const textOf = message => (Array.isArray(message?.content) ? message.content : []).map(block => block?.text || '').join('\n')
const checkpoints = events.filter(event => event.type === 'user/message' && event.data?.source?.compactionId)
if (!checkpoints.length) { console.log('这局还没有压缩过。'); process.exit(0) }

// Every compaction: its volumes, and whether each earlier volume was carried word for word.
const seen = new Map()
checkpoints.forEach((checkpoint, index) => {
  const volumes = storySummaryVolumes([checkpoint.data])
  console.log(`\n第 ${index + 1} 次压缩（${new Date(checkpoint.time).toLocaleString('zh-CN')}），摘要 ${volumes.length} 卷：`)
  for (const volume of volumes) {
    const title = volume.text.split('\n')[0], before = seen.get(title)
    const fate = before === undefined ? '新写' : before === volume.text ? '原样保留' : '被改写'
    console.log(`  ${title}  ${volume.text.length} 字  ${fate}`)
    seen.set(title, volume.text)
  }
})

// What the model sees now: the latest summary (volumes + kept rounds) and the rounds after it.
const latest = checkpoints.at(-1)
const volumes = storySummaryVolumes([latest.data])
const kept = textOf(latest.data).split(/【最近 \d+ 轮原文（未压缩，按时间顺序）】/)[1] || ''
const after = events.filter(event => event.seq > latest.seq && ['user/message', 'assistant/message'].includes(event.type))
  .map(event => textOf(event.type === 'user/message' ? event.data : event.data.message)).join('\n')
console.log(`\n当前上下文：摘要 ${volumes.reduce((sum, volume) => sum + volume.text.length, 0)} 字，保留原文 ${kept.length} 字，压缩点之后 ${after.length} 字`)

if (quizFile) {
  const quiz = json(quizFile)
  const has = (text, item) => item.keywords.every(group => group.some(word => text.includes(word)))
  const counts = { 摘要: 0, 保留原文: 0, 压缩点之后: 0, 丢失: 0 }
  console.log('\n题目覆盖：')
  for (const item of quiz) {
    const volume = volumes.find(candidate => has(candidate.text, item))
    const where = volume ? '摘要' : has(kept, item) ? '保留原文' : has(after, item) ? '压缩点之后' : '丢失'
    counts[where]++
    const missing = where === '丢失' ? '  缺：' + item.keywords.filter(group => !volumes.some(candidate => group.some(word => candidate.text.includes(word)))).map(group => group.join('/')).join('、') : ''
    console.log(`  ${String(item.id).padStart(2)}. 第 ${item.turn} 轮  ${where === '摘要' ? '摘要 · ' + volume.text.split('\n')[0] : where}${missing}  —— ${item.question}`)
  }
  console.log(`\n合计 ${quiz.length} 题：` + Object.entries(counts).map(([key, value]) => `${key} ${value}`).join('，'))
}

if (args.includes('--ask') && quizFile) {
  const quiz = json(quizFile)
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const has = (text, item) => item.keywords.every(group => group.some(word => text.includes(word)))
  let right = 0, recalled = 0
  console.log('\n模型作答（每题一轮，可使用历史检索）：')
  for (const item of quiz) {
    const start = sessionLog(sessionId).events.length
    await rpc('sendPlayerInput', { sessionId, text: `（场外提问，不要续写剧情）请直接简短回答：${item.question}？答完另起一行说明你是从上下文里记得的，还是用历史检索查了原文。` })
    let turn
    for (let waited = 0; !turn; waited += 3000) {
      if (waited > 600000) throw new Error('等待模型回答超时')
      await sleep(3000)
      const all = sessionLog(sessionId).events
      const end = all.findIndex((event, index) => index >= start && event.type === 'turn/end')
      if (end >= 0) turn = all.slice(start, end + 1)
    }
    // Score the reply only, not the model's reasoning.
    const answer = turn.filter(event => event.type === 'assistant/message').flatMap(event => event.data.message.content || [])
      .filter(block => block?.type === 'text').map(block => block.text).join('\n').trim()
    const recalls = turn.filter(event => event.type === 'tool/call' && event.data?.name === 'tavern_recall_history')
      .map(event => { try { const a = JSON.parse(event.data.arguments); return a.query ? '「' + a.query + '」' : '第 ' + a.turn + ' 轮' } catch { return '?' } })
    const ok = has(answer, item)
    right += ok ? 1 : 0
    recalled += recalls.length ? 1 : 0
    console.log(`  ${String(item.id).padStart(2)}. ${ok ? '答对' : '答错'}  ${recalls.length ? '检索 ' + recalls.join('、') : '未检索'}  —— ${item.question}`)
    console.log('      ' + answer.replace(/\s+/g, ' ').slice(0, 160))
  }
  console.log(`\n作答 ${quiz.length} 题：答对 ${right}，用了历史检索 ${recalled} 题`)
}
