import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const personFields = ['appearance', 'clothing', 'action', 'expression', 'position']
const sceneFields = ['environment', 'composition']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
function text(value, label, max = 600) {
  assert(typeof value === 'string' && value.length <= max, label + ' 必须是长度不超过 ' + max + ' 的文本')
  return value.trim()
}
function keys(value, allowed, label) {
  assert(object(value), label + ' 必须是对象')
  assert(Object.keys(value).every(key => allowed.includes(key)), label + ' 包含未知字段')
}

export const SCENE_PLAN_TOOL = {
  name: 'submit_scene_plan', description: '提交画面、人物事实变化与标签块。仅校验和保存，不直接收费生图；无变化部分不要重发。',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { plan: { type: 'object', properties: {}, additionalProperties: true, description: '包含 description、subjects、characters、scene、continuity；可选 expressions。具体字段格式见任务指令。' } },
    required: ['plan']
  }
}

/** A per-game atomic document publishes character revisions, blocks and frames
 * together. Content-addressed revisions never overwrite another story position. */
export function createScenePlans({ store }) {
  const pathFor = chatId => 'scene-images/' + createHash('sha256').update(String(chatId)).digest('hex') + '/plans.json'
  const empty = () => ({ version: 1, generation: 0, characters: {}, blocks: {}, frames: {} })
  async function prepare({ chatId, target, lineage, sources, profile, gapComplete = true }) {
    const data = await store.readJson(pathFor(chatId)) || empty()
    const saved = data.frames[target.key]?.[profile]
    const applicable = lineage.flatMap(item => Object.values(data.frames[item.key] || {}))
    const known = Object.create(null)
    for (const frame of applicable) for (const ref of frame.characterRefs) known[data.characters[ref].id] = data.characters[ref]
    const previous = applicable.at(-1)
    const targetText = sources.find(item => item.id === 'target')?.text || ''
    // Relevant known identities: explicitly mentioned, or the preceding picture's
    // subjects for pronoun continuity. Never send the entire character archive.
    const candidates = Object.values(known).filter(person => targetText.includes(person.name) || previous?.subjects.includes(person.id)).slice(0, 8)
    const people = Object.fromEntries(candidates.map(person => [person.id, structuredClone(person)]))
    const missingBlocks = []
    function block(owner, field, value) {
      return Object.values(data.blocks).find(item => item.owner === owner && item.field === field && item.sourceDigest === digest(value) && item.profile === profile)
    }
    for (const person of candidates) for (const [field, value] of Object.entries(person.fields)) {
      if (value.text && !block(person.id, field, value.text)) missingBlocks.push({ owner: person.id, field })
    }
    const previousScene = previous?.scene?.environment ? { environment: previous.scene.environment } : {}
    if (previousScene.environment && !block('scene', 'environment', previousScene.environment.text)) missingBlocks.push({ owner: 'scene', field: 'environment' })
    const input = { targetKey: target.key, turn: target.turn, profile, gapComplete, sources, characters: candidates.map(person => ({ id: person.id, name: person.name, fields: Object.fromEntries(Object.entries(person.fields).map(([field, value]) => [field, value.text])) })), previousScene, missingBlocks }
    return { chatId, target, profile, generation: data.generation, sources, people, previousScene, previousTurn: previous?.turn, gapComplete, input, saved, block }
  }
  async function commit(prepared, submission) {
    keys(submission, ['description', 'characters', 'subjects', 'scene', 'continuity', 'expressions'], 'plan')
    assert(['continued', 'changed', 'uncertain'].includes(submission.continuity), 'continuity 必须是 continued、changed 或 uncertain')
    assert(submission.continuity !== 'continued' || prepared.gapComplete, '期间剧情有裁剪，不能确认 continued；请使用 uncertain 并按当前依据重建动态状态')
    assert(Array.isArray(submission.characters) && submission.characters.length <= 8, 'characters 必须是最多 8 项的数组')
    assert(Array.isArray(submission.subjects) && submission.subjects.length <= 8 && submission.subjects.every(id => typeof id === 'string') && new Set(submission.subjects).size === submission.subjects.length, 'subjects 必须是无重复人物 id 的数组（最多 8 项）')
    keys(submission.scene, sceneFields, 'scene')
    const description = text(submission.description, 'description', 1000)
    const sources = new Map(prepared.sources.map(item => [item.id, item]))
    function evidence(value, required) {
      assert(Array.isArray(value) && value.length <= 5 && (!required || value.length > 0), '事实必须提供 evidence 原文依据')
      return value.map(item => {
        keys(item, ['source', 'quote'], 'evidence')
        const source = sources.get(item.source)
        const quote = text(item.quote, 'quote', 600)
        assert(source && quote && source.text.includes(quote), 'evidence 原文不存在或未提供给本任务：' + String(item.source).slice(0, 80))
        return { source: item.source, quote, sourceDigest: digest(source.text), turn: source.turn,
          ...(source.origin ? { origin: structuredClone(source.origin) } : {}) }
      })
    }
    const people = Object.assign(Object.create(null), structuredClone(prepared.people)), aliases = Object.create(null), touched = new Set(), pendingBlocks = {}
    const continued = submission.continuity === 'continued'
    if (!continued) for (const person of Object.values(people)) for (const field of personFields.slice(1)) delete person.fields[field]
    const scene = continued ? structuredClone(prepared.previousScene) : {}
    function makeBlock(owner, field, value, tags) {
      const content = { owner, field, sourceDigest: digest(value), profile: prepared.profile, tags }
      const id = digest(content)
      pendingBlocks[id] = { id, ...content }
      return id
    }
    function change(owner, field, raw, previous) {
      keys(raw, ['text', 'tags', 'evidence'], owner + '.' + field)
      const value = text(raw.text, field), tags = text(raw.tags, field + '.tags', 1200)
      assert(Boolean(value) === Boolean(tags), field + ' 的 text 和 tags 须同时为空或非空')
      const refs = evidence(raw.evidence, owner !== 'scene' || field !== 'composition')
      assert(owner === 'scene' || field === 'appearance' || refs.some(ref => !['play-card-snapshot', 'worldbook-snapshot', 'character-design-snapshot'].includes(ref.origin?.kind)),
        '当轮衣着、动作、表情、站位不能只引用初始设定；请提供本轮或期间剧情依据')
      // Same source meaning preserves the existing expression version, rather
      // than accepting pointless full retranslation as a meaningful update.
      const existing = prepared.block(owner, field, value)
      const blockId = existing?.id || makeBlock(owner, field, value, tags)
      const result = { text: value, evidence: refs, blockId }
      return previous?.text === value ? { ...previous, blockId } : result
    }
    for (const update of submission.characters) {
      keys(update, ['id', 'name', 'identity', 'fields'], 'character')
      const localId = text(update.id, 'character.id', 100)
      assert(localId && !touched.has(localId), '同一人物只能更新一次')
      touched.add(localId)
      let person = people[localId]
      if (!person) {
        assert(!localId.startsWith('person-'), '人物 id 不属于本任务已知人物')
        const identity = evidence([update.identity], true)[0]
        const id = 'person-' + digest([prepared.chatId, identity.sourceDigest, identity.quote]).slice(0, 24)
        assert(!people[id], '相同身份依据不能创建两个人物；请引用同一个 id')
        person = { id, name: text(update.name, 'character.name', 100), identity, fields: {} }
        assert(person.name, '新人物必须有 name')
        people[id] = person
        aliases[localId] = id
      } else {
        assert(update.identity === undefined, '已知人物不能改写 identity')
        assert(update.name === undefined || update.name === person.name, '不能通过绘图修改已知人物姓名')
      }
      keys(update.fields, personFields, 'character.fields')
      for (const [field, value] of Object.entries(update.fields)) person.fields[field] = change(person.id, field, value, person.fields[field])
    }
    const subjects = submission.subjects.map(id => aliases[id] || id)
    assert(new Set(subjects).size === subjects.length && subjects.every(id => Object.hasOwn(people, id)), 'subjects 包含未知或重复人物')
    for (const [field, value] of Object.entries(submission.scene)) scene[field] = change('scene', field, value, scene[field])
    const expressions = submission.expressions || []
    assert(Array.isArray(expressions) && expressions.length <= 50, 'expressions 必须是数组')
    const expressionKeys = new Set()
    for (const item of expressions) {
      keys(item, ['owner', 'field', 'tags'], 'expression')
      const owner = aliases[item.owner] || item.owner
      const record = owner === 'scene' ? scene : people[owner]?.fields
      assert(record && Object.hasOwn(record, item.field), 'expression 未对应有效事实字段')
      const value = record[item.field]
      assert(!expressionKeys.has(owner + '/' + item.field), 'expression 重复')
      expressionKeys.add(owner + '/' + item.field)
      const tags = text(item.tags, 'expression.tags', 1200)
      assert(Boolean(tags) === Boolean(value.text), 'expression 不能省略非空事实或为已清除事实增加标签')
      if (!prepared.block(owner, item.field, value.text)) value.blockId = makeBlock(owner, item.field, value.text, tags)
    }
    const blockIds = [], characterVersions = {}
    function append(owner, field, value) {
      if (!value?.text) return
      let block = pendingBlocks[value.blockId] || prepared.block(owner, field, value.text)
      assert(block?.profile === prepared.profile, '缺少当前渠道标签，请在 expressions 提交：' + owner + '/' + field)
      value.blockId = block.id
      blockIds.push(block.id)
    }
    for (const id of subjects) {
      const person = people[id]
      for (const field of personFields) append(id, field, person.fields[field])
      // Character facts are channel-independent. Prompt block references belong
      // to the frame; switching expression profiles must not rewrite a person.
      const facts = { ...person, fields: Object.fromEntries(Object.entries(person.fields).map(([field, value]) => [field, { text: value.text, evidence: value.evidence }])) }
      const version = digest(facts)
      characterVersions[version] = facts
    }
    for (const field of sceneFields) append('scene', field, scene[field])
    const promptParts = []
    for (const id of subjects) {
      const person = people[id]
      const tags = personFields.filter(field => person.fields[field]?.text).map(field => { const value = person.fields[field]; return (pendingBlocks[value.blockId] || prepared.block(id, field, value.text)).tags })
      promptParts.push(person.name + ': ' + tags.join(', '))
    }
    for (const field of sceneFields) if (scene[field]?.text) promptParts.push((pendingBlocks[scene[field].blockId] || prepared.block('scene', field, scene[field].text)).tags)
    const prompt = promptParts.join('\n')
    assert(prompt.trim() && prompt.length <= 12000, '组合提示词为空或超过 12000 字符')
    const frame = { targetKey: prepared.target.key, turn: prepared.target.turn, profile: prepared.profile, description, subjects, scene, characterRefs: Object.keys(characterVersions), blockIds, prompt }
    frame.id = digest(frame)
    await store.updateJson(pathFor(prepared.chatId), previous => {
      const data = previous || empty()
      const existing = data.frames[prepared.target.key]?.[prepared.profile]
      if (existing) { assert(existing.id === frame.id, '当前正文方案已保存，旧任务不能覆盖；请重新读取'); return data }
      assert(data.generation === prepared.generation, '人物方案版本已变化，请重新读取后提交')
      return { ...data, generation: data.generation + 1, characters: { ...data.characters, ...characterVersions }, blocks: { ...data.blocks, ...pendingBlocks }, frames: { ...data.frames, [prepared.target.key]: { ...data.frames[prepared.target.key], [prepared.profile]: frame } } }
    })
    return frame
  }
  async function snapshot(chatId, frame) {
    const data = await store.readJson(pathFor(chatId)) || empty()
    const people = frame.characterRefs.map(id => data.characters[id])
    const blocks = frame.blockIds.map(id => {
      const block = data.blocks[id]
      const text = block.owner === 'scene' ? frame.scene[block.field]?.text : people.find(person => person.id === block.owner)?.fields[block.field]?.text
      return { ...block, text: text || '' }
    })
    return { ...frame, blocks, people }
  }
  return { prepare, commit, snapshot }
}
