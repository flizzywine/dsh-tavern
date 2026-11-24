// The foreground prefix (speaker roster, dialogue format, mod rules) keeps its bytes between compactions: a changed prefix
// breaks the prompt cache and providers that sign thinking blocks (400 "Invalid signature in thinking block" on the next
// turn). Every change reaches that turn's tail as an update stating what was removed, changed or added; the next compaction
// rebuilds the prefix by the roster rule plus everything the model was told, and the updates fold back into it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createForegroundCapabilities,foregroundCapabilityInjection} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import {normalizeBubbleConfig} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {projectWorldBookTemplates} from '../tavern-plugin/lib/domain/worldbook-recall.js'

const figure = (alias, name, recall = {mode:'keyword'}) => ({alias, name, ref:{packId:'pack_demo', figureId:alias}, recall, emotions:[{id:'calm', label:'平静'}]})
const book = () => ({view:{displayName:'Book', entries:[{ref:'normal', enabled:true, constant:true, content:'World', primaryKeys:[], secondaryKeys:[]}]}})
const runtime = {render:async text => ({ok:true, text})}
const project = (chat, worldBook) => projectWorldBookTemplates({chat, worldBook, runtime, includeConstants:true, card:{name:'Card'}})
const start = turn => ({type:'turn/start', data:{turn}})
const compact = id => [{type:'compaction/summary', data:{compactionId:id}}, {type:'user/message', surfaceOp:{op:'replace'}, data:{source:{compactionId:id}}}, {type:'compaction/end', data:{compactionId:id}}]
const DICE = {modId:'dsh.dice', fragmentId:'rules', name:'骰子规则', owner:'dsh.dice', model:'foreground', slot:'rules.after-core', text:'<dice_rules>\nCall tavern_roll for real uncertainty.\n</dice_rules>'}

// The session adapter's message for a turn's update (foreground-frame-session-adapter.js): content and trace record.
function tell(native, record) {
  const seq = native.events.length + 1
  native.events.push({seq, type:'user/message', data:{role:'user', content:[{type:'text', text:record.rendered}],
    source:{kind:'plugin:dsh-tavern', form:'foreground-capability-update', trace:{foregroundCapabilityUpdate:record}}}})
  native.surface.nodes.push(seq)
}

// A game whose card settings, mods and tools change between turns; turn(n) runs one foreground turn as prepare does.
function game(characters) {
  const g = {live:normalizeBubbleConfig({enabled:true, characters}), mods:[DICE], tools:['tavern_roll', 'skill'], writes:0}
  g.native = {events:[start(1)], surface:{nodes:[]}}
  g.chat = {id:'tail-game', sessionId:'tail-session', mode:'story', macroState:{userName:'玩家'}, messages:[]}
  g.owner = createForegroundCapabilities({session:() => g.native, readConfig:async () => g.live, render:project,
    save:async (_chat, snapshot) => { g.writes++; g.chat.foregroundCapabilities = structuredClone(snapshot) },
    modPrompts:async () => ({model:'foreground', sections:structuredClone(g.mods)}), tools:async () => [...g.tools]})
  g.turn = async (n, userText = '') => {
    if (n > 1 && g.native.events.findLast(event => event.type === 'turn/start').data.turn !== n) g.native.events.push(start(n))
    await g.owner.project(g.chat, book(), {userText})
    const update = await g.owner.update(g.chat, {userText})
    if (update.record) tell(g.native, update.record)
    g.chat.messages.push({role:'user', text:userText, turn:n}, {role:'assistant', text:userText, turn:n})
    return {prefix:JSON.stringify(foregroundCapabilityInjection(g.chat.foregroundCapabilities)), tail:update.text}
  }
  return g
}

test('the prefix keeps its bytes across rounds while each kind of change reaches that turn tail once', async () => {
  const g = game([figure('actor_aki', 'Aki')])
  const first = await g.turn(1, 'Aki 推门进来。')
  assert.match(first.prefix, /\|Aki/)
  assert.match(first.prefix, /dice_rules/)
  assert.equal(first.tail, '')
  // a speaker joins the card and the story
  g.live.characters.push(figure('actor_ben', 'Ben'))
  let round = await g.turn(2, 'Ben 也来了。')
  assert.equal(round.prefix, first.prefix)
  assert.match(round.tail, /^<foreground_capability_update>\n/)
  assert.match(round.tail, /<speaker_roster_addendum>[\s\S]*\|Ben/)
  assert.doesNotMatch(round.tail, /\|Aki/, 'only the change is sent')
  round = await g.turn(3, '两个人都走了。')
  assert.equal(round.prefix, first.prefix)
  assert.equal(round.tail, '', 'a change is told once; the history keeps it')
  // the dialogue format is edited
  g.live = normalizeBubbleConfig({...g.live, injection:{extra:'每句台词都不超过二十字。'}})
  round = await g.turn(4)
  assert.equal(round.prefix, first.prefix)
  assert.match(round.tail, /<dialogue_format_update>[\s\S]*每句台词都不超过二十字。/)
  assert.doesNotMatch(round.tail, /speaker_roster_addendum/)
  // a mod and its tool are switched off
  g.mods = []; g.tools = ['skill']
  round = await g.turn(5)
  assert.equal(round.prefix, first.prefix)
  assert.match(round.tail, /No longer in effect:\n- the mod rules "骰子规则"\n- the tool `tavern_roll`; calls to it are refused/)
  // and on again
  g.mods = [DICE]; g.tools = ['tavern_roll', 'skill']
  round = await g.turn(6)
  assert.match(round.tail, /<mod_rules_update>[\s\S]*Call tavern_roll/)
  assert.match(round.tail, /Tools now available: `tavern_roll`\./)
  // a speaker's settings change, then the speaker leaves the card
  g.live.characters[1] = {...g.live.characters[1], guidance:'说话很慢。', emotions:[{id:'calm', label:'平静'}, {id:'sad', label:'难过'}]}
  round = await g.turn(7)
  assert.match(round.tail, /\|Ben — 说话很慢。/)
  assert.match(round.tail, /Variants: 平静、难过/)
  g.live.characters = g.live.characters.filter(row => row.alias !== 'actor_ben')
  round = await g.turn(8)
  assert.match(round.tail, /- the speaker Ben/)
  assert.equal(round.prefix, first.prefix)
  assert.equal(g.writes, 1, 'the prefix was written once, at session start')
})

test('what the live context holds decides the update: a rewound update is sent again; the preview writes nothing', async () => {
  const g = game([figure('actor_aki', 'Aki')])
  await g.turn(1, 'Aki 推门进来。')
  g.live.characters.push(figure('actor_ben', 'Ben'))
  const preview = await g.owner.preview(g.chat, {userText:'Ben 来了。'})
  assert.equal(preview.at(-1).key, 'capability-update')
  const sent = await g.turn(2, 'Ben 来了。')
  assert.equal(preview.at(-1).text, sent.tail)
  assert.equal((await g.owner.update(g.chat, {userText:'Ben 来了。'})).text, '', 'told once')
  assert.equal((await g.owner.preview(g.chat)).some(row => row.key === 'capability-update'), false)
  g.native.surface.nodes.pop()
  assert.equal((await g.owner.update(g.chat, {userText:'Ben 来了。'})).text, sent.tail, 'a rewound update is no longer seen, so it is told again')
  assert.equal(g.writes, 1)
})

// owner 11-24: 正文1 / 名单（ABC）/ 正文2 / 正文3 / 追加名单（D）/ 正文4 / 正文5 / 追加名单（E）/ ---压缩--- / 名单（ABCDE）
test('compaction rebuilds the roster by the rule plus every speaker told this session, and the updates fold into it', async () => {
  const g = game(['A', 'B', 'C', 'D', 'E'].map(name => figure('actor_' + name.toLowerCase(), 'Hero' + name)))
  g.mods = []; g.tools = []
  const opening = await g.turn(1, 'HeroA、HeroB 和 HeroC 在门口。')
  const roster = text => ['A', 'B', 'C', 'D', 'E'].filter(name => text.includes('|Hero' + name)).join('')
  assert.equal(roster(opening.prefix), 'ABC')
  assert.equal((await g.turn(2, '他们继续走。')).tail, '')
  assert.equal(roster((await g.turn(3, 'HeroD 追了上来。')).tail), 'D')
  assert.equal((await g.turn(4, '天黑了。')).tail, '')
  assert.equal(roster((await g.turn(5, 'HeroE 在路边等着。')).tail), 'E')
  g.native.events.push(...compact('c1'))
  const rebuilt = await g.turn(6, '第二天早上。')
  assert.equal(roster(rebuilt.prefix), 'ABCDE')
  assert.equal(rebuilt.tail, '', 'nothing is pending after the rebuild')
  assert.equal(g.writes, 2)
  // A speaker that left the card before the compaction is not rebuilt into the roster.
  g.live.characters = g.live.characters.filter(row => row.alias !== 'actor_e')
  assert.match((await g.turn(7)).tail, /- the speaker HeroE/)
  g.native.events.push(...compact('c2'))
  assert.equal(roster((await g.turn(8)).prefix), 'ABCD')
})
