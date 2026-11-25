#!/usr/bin/env node
import os from 'node:os'
import { readSourceCard } from './lib/card-source.mjs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { loadScenario } from './lib/scenario.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const name = args[0] && !args[0].startsWith('--') ? args.shift() : 'ordinary-tavern'
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('案例名称只能包含字母、数字、短横线与下划线')
const checkOnly = args.includes('--check')
const forwarded = args.filter(arg => arg !== '--check')
const folder = path.join(root, name)
const scenarioFile = path.join(folder, 'scenario.yaml')
try {
  const scenario = await loadScenario(scenarioFile)
  console.log(`案例：${scenario.name}`)
  console.log(`模型：${scenario.model.provider} / ${scenario.model.model} / ${scenario.model.reasoningEffort}`)
  const liveCards = scenario.steps.map(s => s.sourceCard).filter(Boolean)
  if (liveCards.length) {
    const homeFlag = forwarded.findIndex(arg => arg === '--runtime-home')
    const runtimeHome = forwarded.find(arg => arg.startsWith('--runtime-home='))?.slice('--runtime-home='.length) || (homeFlag >= 0 ? forwarded[homeFlag + 1] : path.join(os.homedir(), '.dsh-tavern'))
    for (const filename of new Set(liveCards)) {
      if (checkOnly) {
        const card = await readSourceCard(path.resolve(runtimeHome), filename)
        console.log(`正式人物卡：${filename} / SHA-256：${card.sha256}`)
      } else console.log(`正式人物卡：${filename}（正式游戏 API 直接读取）`)
    }
  } else {
    const source = JSON.parse(await readFile(path.join(folder, 'card.source.json'), 'utf8'))
    const card = await readFile(path.join(folder, 'card.json'))
    const digest = createHash('sha256').update(card).digest('hex')
    if (digest !== source.snapshotSha256) throw new Error('人物卡快照已变化，请核实并更新 card.source.json 中的快照哈希')
    console.log(`人物卡 SHA-256：${digest}`)
  }
  if (checkOnly) console.log('配置与来源检查通过；未同步卡片，未调用模型。')
  else {
    const hasOutput = forwarded.some(arg => arg === '--output' || arg.startsWith('--output='))
    const child = spawn(process.execPath, [path.join(root, 'test-play.mjs'), scenarioFile,
      ...(hasOutput ? [] : ['--output', path.join(root, 'results', name)]), ...forwarded], { windowsHide: true, stdio: 'inherit', shell: false })
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
    child.on('error', error => { console.error(error.message); process.exitCode = 1 })
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  }
} catch (error) {
  console.error(error.code === 'ENOENT' ? '案例或本地人物卡文件缺失；请检查 ' + folder : error.message)
  process.exitCode = 1
}
