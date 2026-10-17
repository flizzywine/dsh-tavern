import assert from 'node:assert/strict'
import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'
import { checkMvuCard, looksLikeMvuCard } from '../../tavern-plugin/lib/domain/mvu-card-check.js'

// Measures what one real card-workbench edit costs: steps and provider usage.
// TAVERN_E2E_CARD_EDIT_SOURCE names a local card file to copy (never committed).
export async function setupRealCardEdit({ root, profile, data, runtimeHome }) {
  const settings = parse(await readFile(join(runtimeHome, 'settings.yaml'), 'utf8'))
  const base = settings['agent-default-model']
  assert.ok(base?.provider && base?.model, '需要已配置的真实模型')
  const selection = { ...base, ...(process.env.TAVERN_E2E_CARD_EDIT_MODEL ? { model: process.env.TAVERN_E2E_CARD_EDIT_MODEL } : {}), reasoningEffort: process.env.TAVERN_E2E_CARD_EDIT_EFFORT || base.reasoningEffort || 'high' }
  await writeFile(join(root, 'settings.yaml'), stringify({ 'agent-default-model': selection, 'llm-pi-ai': settings['llm-pi-ai'] }), { mode: 0o600 })
  await copyFile(join(runtimeHome, '.credentials.yaml'), join(root, '.credentials.yaml'))
  await writeFile(join(profile, 'cordis.patch.yml'), stringify([{ id: 'agent-default-model', config: selection }]))
  await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ defaultForegroundModel: selection, defaultBackgroundModel: selection,
    backgroundModel: selection, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false } }))
  const sourceCard = process.env.TAVERN_E2E_CARD_EDIT_SOURCE
  assert.ok(sourceCard, '需要 TAVERN_E2E_CARD_EDIT_SOURCE 指向一张本地人物卡')
  await copyFile(sourceCard, join(data, 'resources/cards/edit-target.json'))
  return selection
}

export async function realCardEditChecks({ page, step, root, data, output, report }) {
  const task = process.env.TAVERN_E2E_CARD_EDIT_TASK || '把世界书「⚙️货币规则」里的物价锚点改一下：普通住宿一天改成约 2 基准，其他不变。'
  const store = createChatJournalStore({ dataRoot: data })
  async function cardChat() {
    const chats = await Promise.all((await readdir(join(data, 'chats'))).filter(id => !id.includes('.')).map(id => store.read(id)))
    return chats.find(chat => chat?.mode === 'card')
  }
  async function events(sessionId) {
    const dir = join(root, 'profile-data/tavern/sessions')
    for (const file of await readdir(dir, { recursive: true })) if (file.endsWith('session.v3.jsonl.zstd')) {
      const parsed = parseSessionLog(await readFile(join(dir, file)))
      if (parsed.header.id === sessionId) return parsed.events
    }
    return []
  }
  // TAVERN_E2E_CARD_EDIT_TASKS sends follow-up requests in the same session, separated by a line of ---.
  const tasks = process.env.TAVERN_E2E_CARD_EDIT_TASKS ? process.env.TAVERN_E2E_CARD_EDIT_TASKS.split(/\n---\n/).map(item => item.trim()).filter(Boolean) : [task]
  await step('真实模型完成改卡任务并记录消耗', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-adjust-card-style', { detail: { card: { path: 'cards/edit-target.json', name: 'edit-target' } } })))
    let chat
    for (const deadline = Date.now() + 60000; !(chat = await cardChat()) && Date.now() < deadline;) await page.waitForTimeout(500)
    assert.ok(chat, '卡片工作台对话未创建')
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.waitFor()
    // Same draft the "修改卡" task builds (src/client/main.js), so the edit-card skill loads.
    const editPrompt = (await readFile(new URL('../../tavern-plugin/prompts/card-task-edit.md', import.meta.url), 'utf8')).trim()
    // TAVERN_E2E_CARD_EDIT_MODE=mvu sends the same draft as the card library's "转成 MVU 版" (src/client/main.js).
    const mvuMode = process.env.TAVERN_E2E_CARD_EDIT_MODE === 'mvu'
    const mvuSource = await readFile(new URL('../../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
    const mvuTail = mvuMode ? JSON.parse(mvuSource.match(/"(先用 tavern_copy_card 建一份副本[^"]*)"/)[0]) : ''
    const first = mvuMode ? '/card-to-mvu\n\n【目标人物卡】\n@"cards/edit-target.json"\n\n' + mvuTail : null
    const started = Date.now()
    let list = []
    for (const [index, item] of tasks.entries()) {
      await composer.fill(index === 0 ? (first ?? editPrompt.replace('/edit-card', '/edit-card\n\n目标卡：@"cards/edit-target.json"') + '\n\n' + item) : item)
      await composer.press('Enter')
      let tick = Date.now()
      const ended = () => list.filter(event => event.type === 'turn/end').length > index
      while (Date.now() - started < 900000 * tasks.length) {
        list = await events(chat.sessionId)
        if (ended()) break
        if (Date.now() - tick > 30000) { console.log('等待真实模型改卡（第 ' + (index + 1) + ' 轮）… 已 ' + list.filter(event => event.type === 'step/end').length + ' 步'); tick = Date.now() }
        await page.waitForTimeout(2000)
      }
      assert.ok(ended(), '真实模型未在时限内完成第 ' + (index + 1) + ' 轮改卡')
      await composer.waitFor()
    }
    const steps = list.filter(event => event.type === 'assistant/message' && event.data?.usage).map(event => ({ turn: event.data.turn, step: event.data.step, ...event.data.usage }))
    const sum = (key, rows = steps) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
    const tools = list.filter(event => event.type === 'tool/call').map(event => event.data.name)
    const calls = list.filter(event => event.type === 'tool/call').map(event => ({ turn: event.data.turn, name: event.data.name, arguments: String(event.data.arguments || '').slice(0, 600) }))
    const finalText = list.filter(event => event.type === 'assistant/message').at(-1)?.data?.message?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n')
    const turns = [...new Set(steps.map(row => row.turn))].map(turn => {
      const rows = steps.filter(row => row.turn === turn)
      return { turn, steps: rows.length, firstStepPromptTokens: (rows[0].inputTokens || 0) + (rows[0].cacheReadTokens || 0), inputTokens: sum('inputTokens', rows), cacheReadTokens: sum('cacheReadTokens', rows), outputTokens: sum('outputTokens', rows), totalTokens: sum('totalTokens', rows) }
    })
    report.cardEdit = {
      tasks: mvuMode ? ['card-to-mvu'] : tasks, seconds: Math.round((Date.now() - started) / 1000), steps: steps.length,
      firstStepPromptTokens: steps[0] ? (steps[0].inputTokens || 0) + (steps[0].cacheReadTokens || 0) : 0,
      inputTokens: sum('inputTokens'), cacheReadTokens: sum('cacheReadTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'), totalTokens: sum('totalTokens'),
      turns, tools, finalText, perStep: steps, calls
    }
    if (mvuMode) {
      // The converted copy: any new card besides the source.
      const cards = (await readdir(join(data, 'resources/cards'))).filter(name => name.endsWith('.json') && name !== 'edit-target.json')
      report.cardEdit.mvuResult = await Promise.all(cards.map(async name => {
        const text = await readFile(join(data, 'resources/cards', name), 'utf8')
        await writeFile(join(output, 'result-' + name), text)
        const file = JSON.parse(text)
        const card = (file.raw || file).data || file.raw || file
        const checked = checkMvuCard(card)
        const regex = card.extensions?.regex_scripts || []
        return { name, mvu: looksLikeMvuCard(card), errors: checked.errors.length, warnings: checked.warnings.length, errorList: checked.errors.slice(0, 5),
          statusView: regex.some(rule => /mvu-status/.test(String(rule.findRegex))), greetings: 1 + (card.alternate_greetings || []).length,
          greetingsWithInit: [card.first_mes, ...(card.alternate_greetings || [])].filter(text => /<initvar>/.test(String(text))).length }
      }))
    }
    await writeFile(join(output, 'card-edit-usage.json'), JSON.stringify(report.cardEdit, null, 2))
    console.log(JSON.stringify({ ...report.cardEdit, perStep: undefined, calls: undefined, finalText: String(finalText).slice(0, 300) }, null, 2))
  })
}
