import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createDiceTool } from '../tavern-plugin/mods/dice/tools.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'
import { registerGameplayTools } from '../tavern-plugin/lib/tools/gameplay.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
// dsh-tools is the plugin's dependency (tavern-plugin/node_modules), not resolvable from tests/.
const { defineTool } = await import(pathToFileURL(createRequire(new URL('../tavern-plugin/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-tools')).href)

const args = { check: '潜行', attempt: 'Get the ledger', difficulty: 'normal', reason: 'Patrol nearby', stakes: 'Get evidence or expose the entrance' }
const exec = { agent: { session: { id: 'front' }, phase: { kind: 'running', turn: 1 } } }
const activeTurnOf = e => e?.agent?.phase?.kind === 'running' ? e.agent.phase.turn : 0

test('registered tool returns full hidden record, gates execution and keeps schema stable', async () => {
  let mode = 'story'
  const deps = { activeTurnOf, chatForSession: async () => mode === null ? undefined : { mode }, isBackground: id => id === 'background' }
  const registered = []
  const authorized = []
  registerGameplayTools({ ...deps, modTools, authorizeMod: async (modId, chat) => authorized.push([modId, chat.mode]) > 0, markModToolUsed: async () => {}, tools: { register: tool => registered.push(tool) } })
  assert.deepEqual(modTools.map(tool => [tool.modId, tool.name]), [['dsh.dice', 'tavern_roll']], 'the dice mod declares its tool in its folder')
  assert.equal(JSON.stringify(registered.find(tool => tool.name === 'tavern_roll')), JSON.stringify(defineTool(createDiceTool(deps))), 'registered from the mod with the same schema')
  await registered.find(tool => tool.name === 'tavern_roll').execute(args, exec)
  assert.deepEqual(authorized, [['dsh.dice', 'story']], 'authorized under its own mod')
  const tool = createDiceTool(deps)
  const schema = JSON.stringify(defineTool(tool))
  assert.equal(tool.isConcurrencySafe(), false)
  for (mode of ['story', 'script']) {
    const value = await tool.execute({ ...args, hidden: true }, exec)
    assert.deepEqual(Object.keys(value), ['check', 'attempt', 'difficulty', 'target', 'roll', 'tier', 'hidden', 'reason', 'stakes'])
    assert.deepEqual(JSON.parse(tool.output.render(args, value)[0].text), value)
    assert.equal(value.hidden, true)
    assert.equal(JSON.stringify(defineTool(createDiceTool(deps))), schema)
  }
  for (mode of ['card', null]) await assert.rejects(tool.execute(args, exec))
  mode = 'story'
  await assert.rejects(tool.execute(args, { agent: { session: { id: 'background' }, phase: exec.agent.phase } }))
  await assert.rejects(tool.execute(args, { agent: { session: { id: 'front' }, phase: { kind: 'idle' } } }))
  await assert.rejects(tool.execute(args, { ...exec, signal: { aborted: true } }))
  // Offered where the card has the 骰子 mod on, or where this game's history already calls it.
  for (const [enabled, usedModTools] of [[true, undefined], [false, ['tavern_roll']], [false, undefined]]) {
    for (mode of ['story', 'script', 'card']) {
      const orchestrator = createTurnOrchestrator({ store: { chatForSession: async () => ({ mode, cardPath: 'cards/a.json', usedModTools }) },
        modTools, modEnabled: async modId => enabled && modId === 'dsh.dice', frameBuilder: { build() {} } })
      assert.equal((await orchestrator.visibleTools('front')).includes('tavern_roll'), mode !== 'card' && (enabled || Boolean(usedModTools)))
    }
  }
  mode = 'story'
  const marked = []
  await createDiceTool({ ...deps, markUsed: async chat => marked.push(chat) }).execute(args, exec)
  assert.equal(marked.length, 1, 'the first roll marks the game')
  await createDiceTool({ ...deps, chatForSession: async () => ({ mode: 'story', usedModTools: ['tavern_roll'] }), markUsed: async chat => marked.push(chat) }).execute(args, exec)
  assert.equal(marked.length, 1, 'a marked game is not written again')
  const diceRules = JSON.parse(await readFile(new URL('../tavern-plugin/mods/dice/mod.json', import.meta.url), 'utf8')).prompts.find(row => row.id === 'rules').markdown
  assert.ok(diceRules.includes('costly'))
  const { name, description, parameters } = defineTool(tool)
  console.log(JSON.stringify({ toolSchemaBytes: Buffer.byteLength(JSON.stringify([{ name, description, parameters }])), foregroundDiceBytes: Buffer.byteLength(diceRules), foregroundStoryAndDiceBytes: Buffer.byteLength(prompt('story') + '\n\n' + diceRules) }))
})
