import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHARACTER_DESIGN_READ_TOOL_NAME,
  CHARACTER_DESIGN_SAVE_TOOL_NAME,
  createCharacterDesignDocumentSession,
  createCharacterDesignDocumentTools
} from '../tavern-plugin/lib/domain/character-design-document.js'

const completeDesign = Object.freeze({
  name: '鹿野栞',
  identity: '高二 S 班风纪委员，负责午后校舍巡查',
  narrativeRole: '以秩序维护者身份介入主角的校园生活，并逐渐成为可靠但难以敷衍的盟友',
  coreMotivation: '维持可预测的校园秩序，同时证明温和与坚定并不冲突',
  innerConflict: '渴望与人亲近，却担心私人情感削弱自己的公正形象',
  personality: '温柔随和、分寸感强；面对原则问题会安静而执拗地追问到底',
  appearance: '身高约 164 厘米，纤细匀称，深棕长发束成低马尾，灰褐色眼睛，神情清醒柔和',
  behaviorStyle: '先观察环境和他人反应，再用很小的动作介入；习惯整理袖口和随身记录异常',
  speechStyle: '语速平稳，措辞礼貌精确；质疑时不用高声，而是连续追问具体事实',
  relationships: '与教师保持可靠的工作关系，对违纪学生既警惕又愿意给出解释机会',
  defaultPresentation: '白伊甸制服外套配银色风纪委员徽章，深灰百褶裙，黑色及膝袜和棕色低跟乐福鞋；内搭浅灰衬衣与素色贴身衣物',
  plotPotential: '可由一次看似普通的巡查发现异常，迫使她在制度责任、同伴信任与个人好奇之间作出选择'
})

test('人物档案先索引、后完整读取，并在同名保存时更新而非重复创建', async () => {
  const session = createCharacterDesignDocumentSession({ now: () => 100 })
  const empty = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
  assert.deepEqual(empty.characters, [])

  const saved = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_SAVE_TOOL_NAME, arguments: completeDesign }))
  assert.equal(saved.ok, true)
  assert.equal(saved.created, true)
  assert.equal(saved.name, '鹿野栞')

  const index = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
  assert.deepEqual(index.characters, [{
    name: '鹿野栞', identity: completeDesign.identity,
    narrativeRole: completeDesign.narrativeRole, updatedAt: 100
  }])
  const full = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: { name: '鹿野栞' } }))
  assert.equal(full.character.design.behaviorStyle, completeDesign.behaviorStyle)
  assert.equal(full.character.design.defaultPresentation, completeDesign.defaultPresentation)
  assert.equal(Object.hasOwn(full.character, 'mvuCoverage'), false)
  assert.equal(Object.hasOwn(full.character, 'mvuProjection'), false)

  const updated = JSON.parse(await session.execute({
    name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
    arguments: { ...completeDesign, personality: completeDesign.personality + '，熟悉后会显露干燥幽默感' }
  }))
  assert.equal(updated.created, false)
  assert.equal(session.document().characters.length, 1)
  assert.match(session.document().characters[0].design.personality, /干燥幽默感/)
  assert.equal(session.changed(), true)
})

test('人物档案拒绝不完整设计和未知占位值，且不修改输入文档', async () => {
  const source = { spec: 'dsh-tavern.character-design-document', version: 1, characters: [] }
  const session = createCharacterDesignDocumentSession({ document: source, now: () => 100 })

  const incomplete = JSON.parse(await session.execute({
    name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
    arguments: { ...completeDesign, speechStyle: '' }
  }))
  assert.equal(incomplete.ok, false)
  assert.equal(incomplete.retryable, true)
  assert.match(incomplete.error, /speechStyle/)

  const unknown = JSON.parse(await session.execute({
    name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
    arguments: { ...completeDesign, defaultPresentation: '下身着装未明确' }
  }))
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /未明确/)
  assert.deepEqual(source.characters, [])
  assert.equal(session.changed(), false)
})

test('人物档案只为已有重要人物提供复用索引，不设置每轮新增数量上限', () => {
  const session = createCharacterDesignDocumentSession()
  const saveTool = session.tools.find(tool => tool.name === CHARACTER_DESIGN_SAVE_TOOL_NAME)
  assert.match(saveTool.description, /完整.*方案/)
  assert.equal(saveTool.parameters.required[0], 'name')
  assert.equal(saveTool.parameters.required.includes('mvuPath'), false)
  assert.equal(saveTool.parameters.required.includes('mvuFields'), false)
  assert.doesNotMatch(JSON.stringify(session.tools), /characterId/)
  assert.doesNotMatch(JSON.stringify(saveTool), /最多|上限|每轮只能|一次只能/)
})

test('旧人物编号读取后自动退出文档协议', () => {
  const session = createCharacterDesignDocumentSession({
    document: {
      spec: 'dsh-tavern.character-design-document', version: 1,
      characters: [{ id: 'character-legacy', name: '鹿野栞', aliases: [], design: completeDesign }]
    }
  })
  assert.equal(Object.hasOwn(session.document().characters[0], 'id'), false)
})

test('旧档案的 MVU 投影可保留，但通用人物设计不读取、不校验也不改写它', async () => {
  const legacyProjection = { path: '/人物/鹿野栞', fields: { 姓名: '鹿野栞' } }
  const session = createCharacterDesignDocumentSession({
    document: {
      spec: 'dsh-tavern.character-design-document', version: 1,
      characters: [{ name: '鹿野栞', aliases: [], design: completeDesign, mvuProjection: legacyProjection }]
    },
    now: () => 100
  })
  const read = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: { name: '鹿野栞' } }))
  assert.equal(Object.hasOwn(read.character, 'mvuCoverage'), false)
  await session.execute({ name: CHARACTER_DESIGN_SAVE_TOOL_NAME, arguments: completeDesign })
  assert.deepEqual(session.document().characters[0].mvuProjection, legacyProjection)
})

test('当前后台 Agent 保存人物后立即独立落盘，无需人物设计任务或结算回执', async () => {
  let chat = { id: 'chat-1' }
  const tools = createCharacterDesignDocumentTools({
    now: () => 100,
    store: {
      async readChat() { return structuredClone(chat) },
      async updateChat(_chatId, mutate) {
        const next = await mutate(structuredClone(chat))
        if (next !== undefined) chat = structuredClone(next)
        return next
      }
    }
  })

  const saved = JSON.parse(await tools.execute('chat-1', { name: CHARACTER_DESIGN_SAVE_TOOL_NAME, arguments: completeDesign }))
  assert.equal(saved.ok, true)
  assert.equal(chat.characterDesignDocument.characters[0].name, '鹿野栞')
  assert.equal(Object.hasOwn(chat, 'characterDesignTaskReceipt'), false)
  assert.equal(Object.hasOwn(chat, 'settleStatus'), false)

  const read = JSON.parse(await tools.execute('chat-1', { name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: { name: '鹿野栞' } }))
  assert.equal(read.character.design.identity, completeDesign.identity)
})
