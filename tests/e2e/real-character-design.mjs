import assert from 'node:assert/strict'
import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { inspectWorldBookDocument } from '../../tavern-plugin/lib/domain/worldbook-resource.js'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

export async function setupRealCharacterDesign({ root, profile, data, runtimeHome }) {
  const settings = parse(await readFile(join(runtimeHome, 'settings.yaml'), 'utf8'))
  const selection = settings['agent-default-model']
  assert.ok(selection?.provider && selection?.model, '需要已配置的真实模型')
  await writeFile(join(root, 'settings.yaml'), stringify({ 'agent-default-model': selection, 'llm-pi-ai': settings['llm-pi-ai'] }), { mode: 0o600 })
  await copyFile(join(runtimeHome, '.credentials.yaml'), join(root, '.credentials.yaml'))
  await writeFile(join(profile, 'cordis.patch.yml'), stringify([{ id: 'agent-default-model', config: selection }]))
  await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ defaultForegroundModel: selection, defaultBackgroundModel: selection,
    backgroundModel: selection, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false } }))
  const file = join(data, 'resources/cards/e2e.json'), doc = JSON.parse(await readFile(file, 'utf8'))
  doc.data.description = '中性的虚构城镇故事。按用户要求用简短中文回复；人物设定以本局世界书为准。'
  await writeFile(file, JSON.stringify(doc))
  return selection
}

export async function realCharacterDesignChecks({ page, step, savedChat, root, data, output, report }) {
  const sourceCard = await readFile(join(data, 'resources/cards/e2e.json'), 'utf8')
  const initial = await savedChat()
  const entries = chat => inspectWorldBookDocument(chat.openingWorldbookSnapshot.document).entries
  const generated = chat => entries(chat).filter(entry => entry.rawEntry.extensions?.dsh_tavern_helper_extra?.characterDesign)
  const names = ['陆栖云', '许闻笛', '唐照野', '沈砚舟']
  async function poll(label, check) {
    const deadline = Date.now() + 240000
    let update = Date.now()
    while (Date.now() < deadline) {
      const result = await check()
      if (result) return result
      if (Date.now() - update > 30000) { console.log('等待真实模型：' + label); update = Date.now() }
      await page.waitForTimeout(500)
    }
    throw Error(label + '超时')
  }
  async function design(guidance) {
    if (!await page.getByRole('button', { name: '设计人物', exact: true }).isVisible()) {
      await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
    }
    await page.getByRole('button', { name: '设计人物', exact: true }).click()
    await page.locator('dialog input').fill(guidance)
    await page.getByRole('button', { name: '开始设计', exact: true }).click()
    return poll('人物设计保存', async () => {
      const chat = await savedChat()
      if (chat.characterDesignTask?.status === 'failed') throw Error(chat.characterDesignTask.error)
      return chat.characterDesignTask?.status === 'done' && chat.characterDesignTask.guidance === guidance ? chat : null
    })
  }
  async function requests() {
    const dir = join(data, 'model-requests', initial.id)
    const files = await readdir(dir).catch(() => [])
    return (await Promise.all(files.filter(file => file.endsWith('.json') && file !== 'index.json' && !file.endsWith('.result.json')).map(async file => JSON.parse(await readFile(join(dir, file), 'utf8'))))).sort((a,b) => a.createdAt-b.createdAt)
  }
  async function say(input) {
    const before = new Set((await requests()).map(item => item.id))
    const old = (await savedChat()).messages.length
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill(input); await composer.press('Enter')
    await poll('正文生成', async () => {
      const chat = await savedChat()
      if (chat.foregroundError) throw Error(JSON.stringify(chat.foregroundError))
      return chat.messages.length > old && chat.messages.at(-1).role === 'assistant' && chat.settleStatus === 'done'
    })
    return (await requests()).filter(item => !before.has(item.id) && item.scope === 'foreground')
  }
  try {
    await step('真实模型通过界面创建四个人物并自动写入本局世界书', async () => {
      const chat = await design('请分别建立四位全新的重要人物完整档案：陆栖云（医师）、许闻笛（邮递员）、唐照野（书商）、沈砚舟（守灯人，别名青灯客，衣领佩戴铜叶徽章）。四人都是成年虚构人物，未来会持续登场。请逐人调用保存工具，五项内容具体简短，除此之外不要设计其他人。')
      assert.equal(chat.characterDesignDocument.characters.length, 4)
      assert.equal(generated(chat).length, 4)
      for (const name of names) {
        const entry = generated(chat).find(entry => entry.primaryKeys.includes(name))
        assert.ok(entry, '必须保存：' + name)
        assert.equal(entry.constant, false)
      }
      assert.ok(generated(chat).find(entry => entry.primaryKeys.includes('青灯客')))
      const story = messages => messages.map(({ role, text, sourceText, turn, variables }) => ({ role, text, sourceText, turn, variables }))
      assert.deepEqual(story(chat.messages), story(initial.messages))
      assert.equal(chat.cardContextSnapshot, initial.cardContextSnapshot)
      await page.screenshot({ path: join(output, 'character-design-created.png'), fullPage: true })
    })
    await step('真实前台请求未提及人物时不加载设计条目', async () => {
      const rows = await say('只用一句话描写清晨的天空，不引入人物。')
      assert.ok(rows.length)
      assert.doesNotMatch(JSON.stringify(rows.map(row => row.request)), /铜叶徽章|青灯客|沈砚舟/)
    })
    await step('真实前台请求以别名召回人物设计', async () => {
      const rows = await say('我走到青灯客面前，观察他的衣着。请依据设定简短描写。')
      assert.ok(rows.length)
      assert.match(JSON.stringify(rows.map(row => row.request)), /铜叶徽章/)
    })
    await step('真实模型修订同一人物并在下一轮加载新设定', async () => {
      const before = await savedChat(), prior = generated(before).find(entry => entry.primaryKeys.includes('沈砚舟'))
      const chat = await design('只修订已有沈砚舟（别名青灯客）的档案：现在将衣领佩戴物改为银羽徽章，删除旧徽章描述，保留其他身份、性格、说话方式和剧情作用。先读取已有档案，再保存完整修订，不创建其他人物。')
      assert.equal(generated(chat).length, 4)
      assert.equal(chat.characterDesignDocument.characters.length, 4)
      const current = generated(chat).find(entry => entry.primaryKeys.includes('沈砚舟'))
      assert.equal(current.ref, prior.ref)
      assert.match(current.content, /银羽徽章/)
      assert.doesNotMatch(current.content, /铜叶徽章/)
      const rows = await say('我再次观察青灯客衣领现在佩戴的物品，请按最新设定回答。')
      assert.match(JSON.stringify(rows.map(row => row.request)), /银羽徽章/)
      await page.screenshot({ path: join(output, 'character-design-updated.png'), fullPage: true })
    })
    assert.equal(await readFile(join(data, 'resources/cards/e2e.json'), 'utf8'), sourceCard)
    report.characterDesign = { realModel: true, characters: 4, nonConstant: true, aliasRecall: true, unrelatedRequestExcluded: true, updatedEntry: true, libraryUnchanged: true }
  } finally {
    const chat = await savedChat()
    await writeFile(join(output, 'character-design-state.json'), JSON.stringify({ characterDesignTask: chat.characterDesignTask, characterDesignDocument: chat.characterDesignDocument, openingWorldbookSnapshot: chat.openingWorldbookSnapshot }, null, 2))
    await writeFile(join(output, 'character-design-requests.json'), JSON.stringify(await requests(), null, 2))
    const dir = join(root, 'profile-data/tavern/sessions'), calls = []
    for (const file of await readdir(dir, { recursive: true })) if (file.endsWith('session.v3.jsonl.zstd')) {
      const parsed = parseSessionLog(await readFile(join(dir, file)))
      calls.push(...parsed.events.filter(event => event.type === 'tool/call' && ['character_design_read', 'character_design_save', 'character_design_finish', 'skill'].includes(event.data.name)).map(event => ({ sessionId: parsed.header.id, ...event })))
    }
    await writeFile(join(output, 'character-design-tools.json'), JSON.stringify(calls, null, 2))
    if (report.characterDesign) assert.ok(calls.filter(event => event.data.name === 'character_design_save').length >= 5)
  }
}
