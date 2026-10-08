import { createHash } from 'node:crypto'
import { pluginAnchorInsertion } from './plugin-text-segments.js'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const personFields = ['appearance', 'clothing', 'action', 'expression', 'position']
const sceneFields = ['environment', 'composition']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
// A new person's id is their name, readable in plans and Agent logs; a second
// same-named person in the game gets 名字#2. Older ids (person-…) stay as they are.
function readableId(name, taken) {
  const base = name.replace(/[\s#]+/g, '').slice(0, 40) || '人物'
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(base + '#' + n)) return base + '#' + n
}
function text(value, label, max = 600) {
  assert(typeof value === 'string' && value.length <= max, label + ' 必须是长度不超过 ' + max + ' 的文本')
  return value.trim()
}
function keys(value, allowed, label) {
  assert(object(value), label + ' 必须是对象')
  assert(Object.keys(value).every(key => allowed.includes(key)), label + ' 包含未知字段')
}

export { SCENE_PLAN_TOOL } from './scene-plan-draft.js'

function appearanceOnly(person) {
  return { ...person, fields: person.fields.appearance ? { appearance: person.fields.appearance } : {} }
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
    // One person, one id per game. Earlier story positions give the full
    // state; later turns and other branches give identity and appearance only,
    // so their clothing or posture never leaks backwards. A name met again in
    // another picture is the same person; two same-named people inside one
    // picture stay distinct.
    const known = Object.create(null)
    const elsewhere = Object.values(data.frames).flatMap(item => Object.values(item))
      .filter(frame => !applicable.includes(frame)).sort((a, b) => a.turn - b.turn)
    function remember(frame, person) {
      const names = frame.characterRefs.map(ref => data.characters[ref].name)
      if (names.filter(name => name === person.name).length === 1) {
        for (const other of Object.values(known)) if (other.name === person.name) delete known[other.id]
      }
      known[person.id] = person
    }
    for (const frame of elsewhere) for (const ref of frame.characterRefs) remember(frame, appearanceOnly(data.characters[ref]))
    for (const frame of applicable) for (const ref of frame.characterRefs) remember(frame, data.characters[ref])
    const identities = Object.create(null)
    for (const person of Object.values(known)) identities[person.name] = Object.hasOwn(identities, person.name) ? null : appearanceOnly(person)
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
    const input = { targetKey: target.key, turn: target.turn, profile, gapComplete, sources, characters: candidates.map(person => ({ id: person.id, name: person.name, fields: Object.fromEntries(Object.entries(person.fields).map(([field, value]) => [field, value.text])) })), previousScene: Object.fromEntries(Object.entries(previousScene).map(([field, value]) => [field, { text: value.text }])), missingBlocks }
    const takenIds = new Set(Object.values(data.characters).map(person => person.id))
    return { chatId, target, profile, generation: data.generation, sources, people, identities, takenIds, previousScene, previousTurn: previous?.turn, previousMoment: previous?.moment || 'end', gapComplete, input, saved, block }
  }
  async function commit(prepared, submission) {
    keys(submission, ['description', 'characters', 'subjects', 'scene', 'continuity', 'expressions', 'moment', 'orientation', 'negative', 'anchor'], 'plan')
    const moment = submission.moment ?? 'end', orientation = submission.orientation ?? ''
    assert(['end', 'earlier'].includes(moment), 'moment 必须是 end 或 earlier')
    assert(['', 'portrait', 'landscape', 'square'].includes(orientation), 'orientation 必须是 portrait、landscape 或 square')
    const negative = text(submission.negative ?? '', 'negative', 600)
    // Where the picture sits in the story. A sentence not found in the target
    // text is dropped silently; the picture then stays after the text.
    const anchorText = text(submission.anchor ?? '', 'anchor', 200)
    const anchor = anchorText && pluginAnchorInsertion(prepared.sources.find(item => item.id === 'target')?.text || '', anchorText) >= 0 ? anchorText : ''
    assert(['continued', 'changed', 'uncertain'].includes(submission.continuity), 'continuity 必须是 continued、changed 或 uncertain')
    assert(submission.continuity !== 'continued' || prepared.gapComplete, '期间剧情有裁剪，不能确认 continued；请使用 uncertain 并按当前依据重建动态状态')
    assert(Array.isArray(submission.characters) && submission.characters.length <= 8, 'characters 必须是最多 8 项的数组')
    assert(Array.isArray(submission.subjects) && submission.subjects.length <= 8 && submission.subjects.every(id => typeof id === 'string') && new Set(submission.subjects).size === submission.subjects.length, 'subjects 必须是无重复人物 id 的数组（最多 8 项）')
    keys(submission.scene, sceneFields, 'scene')
    const description = text(submission.description, 'description', 1000)
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
    function change(owner, field, raw, previous, path) {
      // Tolerate legacy session output, but do not validate or persist its citations.
      keys(raw, ['text', 'tags', 'evidence'], path)
      const value = text(raw.text, path + '.text'), tags = text(raw.tags, path + '.tags', 1200)
      assert(Boolean(value) === Boolean(tags), path + ' 的 text 和 tags 须同时为空或非空')
      // Same source meaning preserves the existing expression version, rather
      // than accepting pointless full retranslation as a meaningful update.
      const existing = prepared.block(owner, field, value)
      const blockId = existing?.id || makeBlock(owner, field, value, tags)
      const result = { text: value, blockId }
      return previous?.text === value ? { ...previous, blockId } : result
    }
    for (const [index, update] of submission.characters.entries()) {
      const path = 'characters[' + index + ']'
      keys(update, ['id', 'name', 'identity', 'fields'], path)
      const localId = text(update.id, path + '.id', 100)
      assert(localId && !touched.has(localId), path + '.id：同一人物只能更新一次')
      touched.add(localId)
      let person = people[localId]
      if (!person) {
        assert(!localId.startsWith('person-'), path + '.id (' + localId + ')：人物 id 不属于本任务已知人物')
        const name = text(update.name, path + '.name', 100)
        // An id from elsewhere in the game is accepted only together with that person's name.
        assert(!prepared.takenIds?.has(localId) || prepared.identities?.[name]?.id === localId, path + '.id (' + localId + ')：人物 id 不属于本任务已知人物')
        assert(name, path + '.name：新人物必须有 name')
        // A name already drawn elsewhere in this game keeps that person's id,
        // unless that name is ambiguous.
        const existing = prepared.identities?.[name]
        const id = existing?.id || readableId(name, candidate => prepared.takenIds?.has(candidate) || Object.hasOwn(people, candidate) || touched.has(candidate))
        assert(!touched.has(id), path + '：' + name + ' 已在本方案中，同一人物不能重复创建；请引用已提供的 id')
        person = people[id] ||= existing ? structuredClone(existing) : { id, name, identity: { kind: 'scene-person', targetKey: prepared.target.key }, fields: {} }
        aliases[localId] = id
        touched.add(id)
      } else {
        // Ignore legacy identity payloads; identity is assigned only by the host.
        assert(update.name === undefined || update.name === person.name, path + '.name：不能通过绘图修改已知人物姓名')
      }
      keys(update.fields, personFields, path + '.fields')
      for (const [field, value] of Object.entries(update.fields)) person.fields[field] = change(person.id, field, value, person.fields[field], path + '.fields.' + field)
    }
    const subjects = submission.subjects.map(id => aliases[id] || id)
    subjects.forEach((id, index) => assert(Object.hasOwn(people, id) && subjects.indexOf(id) === index,
      'subjects[' + index + '] (' + submission.subjects[index] + ')：subjects 包含未知或重复人物，请先提交对应人物或修正 id'))
    for (const [field, value] of Object.entries(submission.scene)) scene[field] = change('scene', field, value, scene[field], 'scene.' + field)
    const expressions = submission.expressions || []
    assert(Array.isArray(expressions) && expressions.length <= 50, 'expressions 必须是数组')
    const expressionKeys = new Set()
    for (const [index, item] of expressions.entries()) {
      const path = 'expressions[' + index + ']'
      keys(item, ['owner', 'field', 'tags'], path)
      const owner = aliases[item.owner] || item.owner
      const record = owner === 'scene' ? scene : people[owner]?.fields
      assert(record && Object.hasOwn(record, item.field), path + ' (' + item.owner + '.' + item.field + ')：expression 未对应有效事实字段')
      const value = record[item.field]
      assert(!expressionKeys.has(owner + '/' + item.field), path + '：expression 重复')
      expressionKeys.add(owner + '/' + item.field)
      const tags = text(item.tags, path + '.tags', 1200)
      assert(Boolean(tags) === Boolean(value.text), path + '.tags：expression 不能省略非空事实或为已清除事实增加标签')
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
      const facts = { ...person, fields: Object.fromEntries(Object.entries(person.fields).map(([field, value]) => [field,
        value.evidence === undefined ? { text: value.text } : { text: value.text, evidence: value.evidence }
      ])) }
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
    // An earlier moment of the turn is drawn from its own text; the next image
    // re-reads the rest of that turn instead of continuing from this frame.
    const frame = { targetKey: prepared.target.key, turn: prepared.target.turn, profile: prepared.profile, description, subjects, scene, characterRefs: Object.keys(characterVersions), blockIds, prompt,
      ...(moment === 'earlier' ? { moment } : {}), ...(orientation ? { orientation } : {}), ...(negative ? { negative } : {}), ...(anchor ? { anchor } : {}) }
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
