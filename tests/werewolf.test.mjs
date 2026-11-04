import test from 'node:test'
import assert from 'node:assert/strict'
import { createState, actionFor, perspective, project, accept, resolve, gameMode } from '../examples/werewolf/plugin/rules.mjs'

function state() {
  const s = createState({ seat: 6 })
  s.players.forEach((p, i) => { p.role = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'][i] })
  s.queue = [1, 2]; return s
}
test('hidden roles, wolf chat and inspection never enter a villager view', () => {
  const s = state()
  accept(s, { text: '秘密狼队标记' }); accept(s, { text: '袭击3号' })
  accept(s, { target: 3 }); accept(s, { target: 3 }); accept(s, { target: 1 })
  assert.match(JSON.stringify(perspective(s, 1)), /秘密狼队标记/)
  const villager = JSON.stringify(perspective(s, 4))
  assert.doesNotMatch(villager, /秘密狼队标记|查验结果|袭击3号/)
  assert.match(JSON.stringify(perspective(s, 3)), /查验结果/)
  assert.equal(project(s).action.actor, 'auto')
  resolve(s)
  assert.equal(s.players[2].alive, false)
  assert.equal(s.phase, 'speech')
  assert.equal(actionFor(s).actor, 1)
})
test('illegal target does not advance; tie vote exiles nobody; votes remain private until resolution', () => {
  const s = state(); s.phase = 'vote'; s.queue = [1, 2, 3, 4, 5, 6]; s.index = 0
  assert.throws(() => accept(s, { target: 1 }), /合法/)
  assert.equal(s.index, 0)
  for (const target of [2, 1, 2, 1, 0, 0]) accept(s, { target })
  assert.doesNotMatch(JSON.stringify(perspective(s, 6)), /投票结果/)
  resolve(s)
  assert.equal(s.players.filter(p => p.alive).length, 6)
  assert.equal(s.day, 2)
})
test('a complete six-player game runs through isolated NPC and DM calls', async () => {
  const s = state(), requests = []
  const agent = async request => {
    requests.push(request)
    if (request.id === 'dm') return { text: '请继续下一阶段。' }
    const input = JSON.parse(request.prompt), action = input.action
    return { text: JSON.stringify(action.kind === 'speak' ? { text: '我会仔细观察投票。', memory: '关注公开信息' } : { target: action.targets[0] }) }
  }
  for (let steps = 0; steps < 100 && s.phase !== 'ended'; steps++) {
    const a = actionFor(s)
    const input = a.actor === s.human ? a.kind === 'speak' ? { text: '我是好人。' } : { target: a.targets[0] } : null
    await gameMode.advance({ state: s, input, agent })
  }
  assert.ok(s.winner)
  assert.ok(requests.some(r => r.id === 'dm'))
  assert.ok(requests.some(r => r.id.startsWith('npc-')))
  for (const r of requests.filter(r => r.id === 'dm')) assert.doesNotMatch(r.prompt, /查验结果|狼队标记/)
  assert.equal(project(s).revealed.length, 6)
})
