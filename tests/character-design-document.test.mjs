import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHARACTER_DESIGN_READ_TOOL_NAME,
  CHARACTER_DESIGN_SAVE_TOOL_NAME,
  createCharacterDesignDocumentSession
} from '../tavern-plugin/lib/domain/character-design-document.js'

const variableSchema = {
  type: 'object',
  properties: {
    在场女生: {
      type: 'object', extensible: true,
      template: { 姓名: '', 性格: '未明确', 袜子: '未明确', 鞋子: '未明确', 内衣裤: '未明确', 在场: false }
    }
  }
}

const mvuFields = {
  姓名: '鹿野栞', 性格: '温柔随和、分寸感强', 袜子: '黑色及膝袜',
  鞋子: '棕色低跟乐福鞋', 内衣裤: '素色贴身衣物', 在场: false
}

const completeDesign = Object.freeze({
  name: '鹿野栞',
  mvuPath: '/在场女生/鹿野栞',
  mvuFields,
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
  const session = createCharacterDesignDocumentSession({ variableSchema, now: () => 100 })
  const empty = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
  assert.deepEqual(empty.characters, [])

  const saved = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_SAVE_TOOL_NAME, arguments: completeDesign }))
  assert.equal(saved.ok, true)
  assert.equal(saved.created, true)
  assert.equal(saved.name, '鹿野栞')

  const index = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
  assert.deepEqual(index.characters, [{
    name: '鹿野栞', identity: completeDesign.identity,
    narrativeRole: completeDesign.narrativeRole, mvuCoverage: { status: 'not-projected', path: '/在场女生/鹿野栞' }, updatedAt: 100
  }])
  const full = JSON.parse(await session.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: { name: '鹿野栞' } }))
  assert.equal(full.character.design.behaviorStyle, completeDesign.behaviorStyle)
  assert.equal(full.character.design.defaultPresentation, completeDesign.defaultPresentation)
  assert.throws(function () {
    session.validateSubmission([{ op: 'insert', path: '/在场女生/鹿野栞/袜子', value: '黑色及膝袜' }])
  }, /完整对象/)

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
  const session = createCharacterDesignDocumentSession({ document: source, variableSchema, now: () => 100 })

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
  assert.deepEqual(saveTool.parameters.required.slice(0, 3), ['name', 'mvuPath', 'mvuFields'])
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
