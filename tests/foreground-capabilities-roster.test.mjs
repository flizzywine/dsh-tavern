// A figure written to the card while a session runs (an automatic figure writer, a pack added mid-game) must not change the
// session's frozen system prompt: a changed prefix breaks providers that sign thinking blocks (400 "Invalid signature in
// thinking block" on the next turn). It reaches the per-turn roster addendum; the next roster rebuild (compaction) takes it in.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createForegroundCapabilities} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import {normalizeBubbleConfig} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {projectWorldBookTemplates} from '../tavern-plugin/lib/domain/worldbook-recall.js'

const character = {alias:'actor_guest', name:'Guest', ref:{packId:'pack_figure', figureId:'figure_guest'}, recall:{mode:'constant'}, emotions:[{id:'calm', label:'Calm'}]}
const late = {...character, alias:'f_late', name:'Late Arrival', ref:{packId:'auto-pack', figureId:'late'}}
const book = () => ({view:{displayName:'Book', entries:[{ref:'normal', enabled:true, constant:true, content:'World', primaryKeys:[], secondaryKeys:[]}]}})
const runtime = {render:async text => ({ok:true, text})}
const project = (chat, worldBook) => projectWorldBookTemplates({chat, worldBook, runtime, includeConstants:true, card:{name:'Card'}})
const start = turn => ({type:'turn/start', data:{turn}})
const compact = id => [{type:'compaction/summary', data:{compactionId:id}}, {type:'user/message', surfaceOp:{op:'replace'}, data:{source:{compactionId:id}}}, {type:'compaction/end', data:{compactionId:id}}]

function session() {
  const live = normalizeBubbleConfig({enabled:true, characters:[character]})
  const native = {events:[start(1)]}, chat = {id:'late-figure', sessionId:'late-figure-session', mode:'story', messages:[]}
  let writes = 0
  const owner = createForegroundCapabilities({session:() => native, readConfig:async () => live, render:project,
    save:async (_chat, snapshot) => { writes++; chat.foregroundCapabilities = structuredClone(snapshot) }})
  return {live, native, chat, owner, writes:() => writes}
}

test('a figure added to the card mid-session leaves the frozen roster byte-identical and reaches only the turn tail', async () => {
  const s = session()
  await s.owner.project(s.chat, book())
  const frozen = JSON.stringify(s.chat.foregroundCapabilities)
  s.live.characters.push(late)
  s.chat.messages.push({role:'assistant', text:'Late Arrival looks up.'})
  s.native.events.push(start(2))
  await s.owner.project(s.chat, book())
  assert.equal(JSON.stringify(s.chat.foregroundCapabilities), frozen, 'the system prompt part does not change between rounds')
  assert.equal(s.writes(), 1)
  assert.match(await s.owner.rosterAddendum(s.chat), /\|Late Arrival/)
})

test('after compaction the roster is rebuilt with the late figure in its place, and the tail no longer lists it', async () => {
  const s = session()
  await s.owner.project(s.chat, book())
  s.live.characters.push(late)
  s.chat.messages.push({role:'assistant', text:'Late Arrival looks up.'})
  s.native.events.push(start(2))
  await s.owner.project(s.chat, book())
  assert.deepEqual(s.chat.foregroundCapabilities.figures, ['actor_guest'])
  s.native.events.push(...compact('c1'), start(3))
  await s.owner.project(s.chat, book())
  assert.deepEqual([...s.chat.foregroundCapabilities.figures].sort(), ['actor_guest', 'f_late'], 'the rebuilt roster has it')
  assert.match(JSON.stringify(s.chat.foregroundCapabilities.entries), /Late Arrival/)
  assert.equal(await s.owner.rosterAddendum(s.chat), '', 'not listed twice')
})

test('a frozen figure that leaves the card mid-session also leaves the system prompt byte-identical; an edit of a frozen figure still renews it', async () => {
  const s = session()
  s.live.characters.push(late)
  await s.owner.project(s.chat, book())
  const frozen = JSON.stringify(s.chat.foregroundCapabilities)
  s.live.characters = s.live.characters.filter(row => row.alias !== 'f_late')
  s.native.events.push(start(2))
  await s.owner.project(s.chat, book())
  assert.equal(JSON.stringify(s.chat.foregroundCapabilities), frozen, 'a figure that leaves stays in this session until the next recompute')
  assert.equal(s.writes(), 1)
  s.live.characters = s.live.characters.map(row => row.alias === 'actor_guest' ? {...row, name:'Guest Renamed'} : row)
  s.native.events.push(start(3))
  await s.owner.project(s.chat, book())
  assert.match(JSON.stringify(s.chat.foregroundCapabilities.entries), /Guest Renamed/)
  assert.equal(s.writes(), 2, 'an edit of a frozen figure renews the roster')
  s.native.events.push(...compact('c2'), start(4))
  await s.owner.project(s.chat, book())
  assert.deepEqual(s.chat.foregroundCapabilities.figures, ['actor_guest'], 'the recompute drops the figure that left')
})