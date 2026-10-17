import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { applyCharacterDesignWorldbook } from '../tavern-plugin/lib/domain/character-design-worldbook.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
const design = name => ({ name, aliases: [], design: { identity: name + '的身份', personality: '沉稳', appearance: '高瘦', speechStyle: '简短', narrativeRole: '引路人' } })

function setup(names) {
  const holder = { openingWorldbookSnapshot: { version: 1, document: { name: '本局世界书', entries: {}, extensions: {} } } }
  for (const name of names) applyCharacterDesignWorldbook(holder, design(name))
  const worldBook = { document: holder.openingWorldbookSnapshot.document, view: inspectWorldBookDocument(holder.openingWorldbookSnapshot.document) }
  const chat = { messages: [{ role: 'assistant', turn: 1, text: '雨夜，客栈里没有别人。' }], characterDesignDocument: { characters: names.map(name => ({ name })) } }
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}) })
  return { worldBook, chat, project }
}

test('本局刚设计的人物，未被点名也注入一次，之后回到关键词召回', async () => {
  const { chat, project, worldBook } = setup(['林婉', '周默'])
  const first = await project({ chat, card: {}, userText: '用我设计的人物继续' })
  assert.equal(first.error, null)
  assert.equal(first.refs.length, 2)
  assert.match(first.context, /林婉的身份/)
  chat.worldBookReads = first.reads
  chat.messages.push({ role: 'assistant', turn: 2, text: '雨停了。' })
  const later = await project({ chat, card: {}, userText: '继续' })
  assert.deepEqual(later.refs, [])
  // A revised design is a new version and is injected once again.
  const ref = worldBook.view.entries.find(entry => entry.title.includes('周默')).ref
  worldBook.view.entries.find(entry => entry.ref === ref).content += '\n补充：左手有疤'
  const revised = await project({ chat, card: {}, userText: '继续' })
  assert.deepEqual(revised.refs, [ref])
})

test('其他局设计、写进同一世界书的人物不强制注入', async () => {
  const { chat, project } = setup(['林婉'])
  chat.characterDesignDocument = { characters: [] }
  const sent = await project({ chat, card: {}, userText: '继续' })
  assert.deepEqual(sent.refs, [])
})
