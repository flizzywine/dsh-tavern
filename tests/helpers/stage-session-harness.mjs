import {withVoiceCues} from './voice-cues-source.mjs'
import {stagePageSource} from './stage-page-source.mjs'
import {stageHelpersSource} from './stage-helpers-source.mjs'
// real input adapters and reducer, no React/transcript tree.
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {createControllableBinding} from './stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
// text-index.cjs is a stage factory module now: the core hands it its page cards (stage-page-index.cjs) and speaker resolution (bubble-line.cjs).
const {createStageTextIndexModule} = require('../../tavern-plugin/packages/dsh-tavern-stage/src/client/text-index.cjs')
const {stagePageCards} = require('../../tavern-plugin/src/client/stage-page-index.cjs')
const {bubbleCharacter} = require('../../tavern-plugin/src/client/bubble-line.cjs')
const {createIndex:clientTextIndex, voiceDescriptor:stageVoiceDescriptor} = createStageTextIndexModule({pageCards:stagePageCards, character:bubbleCharacter})
export {stageVoiceDescriptor}
import {roundBody} from '../../tavern-plugin/lib/domain/round-body.js'
import {assistantResultForTurn} from '../../tavern-plugin/lib/domain/session-turn-result.js'
// Simulate the host publication using the production body authority, never client helpers.
export function createStageTextIndex(helpers) {
  const index = clientTextIndex(helpers), reconcile = index.reconcile, cache = new Map()
  index.reconcile = ({chat,view,branchId}) => {
    const projections = new Map((view?.replyProjections || []).map(p => [p.turn,p]))
    const groups = new Map()
    for (const node of [...(chat?.nodes?.values() || [])].sort((a,b)=>a.anchorSeq-b.anchorSeq)) {
      if(node.kind !== 'assistant-step')continue
      const nativeTurn=Number(node.location?.turn?.turn)||0,turn=helpers.storyTurn(view,nativeTurn)
      if(helpers.superseded(view,nativeTurn,turn))continue
      if(!groups.has(turn))groups.set(turn,[])
      groups.get(turn).push(node)
    }
    for(const [turn,nodes] of groups) {
      const streaming=nodes.some(node=>node.data.status==='running')
      if(!streaming && (projections.has(turn) || view?.historyWindow && turn<view.latestAssistantTurn))continue
      const events=nodes.map(node=>({type:'assistant/message',data:{turn,message:{source:{kind:'model'},content:node.data.blocks.filter(b=>b.kind==='text'||b.kind==='reasoning').map(b=>({type:b.kind,text:b.text}))}}}))
      const text=streaming ? nodes.map(node=>node.data.blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\n')).filter(Boolean).join('\n\n')
        : assistantResultForTurn({events:[{type:'turn/start',data:{turn}},...events]},turn)?.text || ''
      projections.set(turn,{version:2,turn,parts:[{kind:'markdown',text}],streaming})
    }
    const rows=[...projections.values()].map(p=>{
      const key=JSON.stringify([branchId,p]),hit=cache.get(p.turn)
      if(hit?.key===key)return hit.value
      const value={...p,body:p.body || roundBody(p.parts || [{kind:p.mode==='html'?'html':'markdown',text:p.text}],{branchId,turn:p.turn,streaming:!!p.streaming})}
      cache.set(p.turn,{key,value});return value
    })
    return reconcile({chat,view:{mode:'story',...view,replyProjections:rows},branchId})
  }
  const ingest=index.ingest
  index.ingest=(turn,body)=>ingest(turn,Array.isArray(body)?roundBody(body.map(unit=>({kind:'markdown',text:unit.text})),{branchId:'history',turn}):body)
  return index
}
const {createStageSessionOwner} = require('../../tavern-plugin/src/client/stage-session.cjs')
const {createStagePosition} = require('../../tavern-plugin/packages/dsh-tavern-stage/src/client/position.cjs')
const read = file => readFileSync(new URL('../../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
const slice = (code, start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)))
export function textHelpers(metrics = {}) {
  const stage = read('gal-stage.js'), bubbles = readFileSync(new URL('../../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8'), frame = read('ui/message-frame.js')
  const api = {createSessionViewReader: {}, isPlayMode: mode => mode === 'story', htmlPartHasPresentation: text => !!text.trim()}
  vm.runInNewContext([
    withVoiceCues(read('bubble-line.cjs')),
    slice(bubbles, 'const BUBBLE_LINE', '// Custom emotions'),
    slice(bubbles, 'function bubbleSegment', '// Per-session bubble settings'),
    // the publication hook is deleted at the F cutover.
    stagePageSource,
    stageHelpersSource,
    slice(frame, 'function tavernProjectionForTurn', 'function tavernMvuReceiptForTurn'),
    slice(frame, 'function projectionPartsOf', '// @include inline-fragment.js')
  ].join('\n'), api)
  return {parse(text, streaming) {metrics.parsed = (metrics.parsed || 0) + text.length; return api.parseBubbles(text, streaming)},
    paragraphs: api.galParagraphs, paginate(text) {metrics.paginated = (metrics.paginated || 0) + 1; return api.stageBlockPages(text)},
    // the stage's turn grouping (position.cjs, a stage factory now; galTurnIndex is pure)
    turnIndex: createStagePosition({}).turnIndex, projectionForTurn: api.tavernProjectionForTurn, projectionParts: api.projectionPartsOf,
    storyTurn: api.tavernStoryTurnForDshTurn, superseded: api.galIsSuperseded, api}
}
export function nativeNode(turn, text, {id = turn + ':1', order = turn * 10, status = 'closed', blocks, kind = 'assistant-step'} = {}) {
  return {id, kind, anchorSeq: order, location: {kind: 'step', turn: {turn}}, data: {status, blocks: blocks || [{kind: 'text', text}]}}
}
export function nativeBinding(nodes = [], running = false) {
  let values = new Map(nodes.map(node => [node.id, node]))
  const sources = new Map(nodes.map(node => [node.id, createControllableBinding(node)]))
  const snapshot = () => ({order: [...values.keys()], nodes: {values: () => values.values(), get: id => values.get(id), source: id => sources.get(id)}})
  const chat = createControllableBinding(snapshot()), session = createControllableBinding({running})
  return {session, chat,
    set(nodes) {values = new Map(nodes.map(node => [node.id, node])); for (const node of nodes) if (!sources.has(node.id)) sources.set(node.id, createControllableBinding(node)); chat.publish(snapshot())},
    chunk(node) {values.set(node.id, node); sources.get(node.id).publish(node)},
    run(running) {session.publish({running})},
    listeners() {return session.subscribers + chat.subscribers + [...sources.values()].reduce((sum, source) => sum + source.subscribers, 0)}
  }
}
export function sessionHarness({nodes = [], view = {}, running = false, readHistory, ownerOptions = {}} = {}) {
  const helpers = textHelpers(), effects = [], binding = nativeBinding(nodes, running)
  const bindings = new Map([['s', binding]])
  const list = createControllableBinding({current: 's', byId: {s: {id: 's'}}})
  const views = createControllableBinding({view: {mode: 'story', chatId: 'chat', card: {path: 'card'}, ...view}})
  const coordination = createControllableBinding({view: {cardPath: 'card', runtimeGeneration: 'host-1'}})
  const settings = createControllableBinding({cardPath: 'card', config: {enabled: true, characters: [{alias: 'alice'}]}, engineSettings: {revision: 1}})
  const prefs = createControllableBinding({reading: {textSpeed: 28}, film: false, audio: {master: .8, muted: {}}})
  let invalidations = 0, loads = 0
  const owner = createStageSessionOwner({...ownerOptions,readHistory, sessions: {list, binding: id => bindings.get(id)}, resolveChat: binding => binding.chat,
    views: {select: () => views, invalidate() {invalidations++}}, viewPaths: [[]], coordination: {getSnapshot: () => coordination.getSnapshot(), subscribe: (_id, fn) => coordination.subscribe(fn)},
    settings: {get: () => settings.getSnapshot(), subscribe: settings.subscribe, load() {loads++}},
    preferences: {get: prefs.getSnapshot, subscribe: prefs.subscribe}, createIndex: () => createStageTextIndex(helpers), storyTurn: helpers.storyTurn,
    runEffect(id, intent, dispatch, getSnapshot) {effects.push({id, ...intent}); ownerOptions.runEffect?.(id,intent,dispatch,getSnapshot)}})
  owner.start()
  return {owner, binding, bindings, list, views, coordination, settings, prefs, effects, helpers,
    state: () => owner.get('s').getSnapshot(), invalidateCount: () => invalidations, loadCount: () => loads,
    view(patch) {views.publish({view: {...views.getSnapshot().view, ...patch}})},
    close() {list.publish({current: '', byId: {}})}, dispose: () => owner.dispose()}
}
