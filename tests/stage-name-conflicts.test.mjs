// 「人物重名」 (owner 11-12): a figure name that several figures of the card's packs carry names none of them on the
// stage (resolveFigureName → 'ambiguous'). figureNameConflicts lists exactly those names - not shared aliases (触发词),
// which a family may share on purpose - the host serves them to the stage (getStageNameConflicts) and the top-right
// notice lists each name's figures, each opening its page in 素材库.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createStageHandlers} from '../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js'
const require = createRequire(import.meta.url)
const resolution = require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')
const libraryCopy = require('../tavern-plugin/packages/dsh-asset-library/lib/shared/figure-resolution.cjs')
const {createStageNotices} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/notices.cjs')

// ids differ from names and aliases on purpose
const row = (packId, figureId, name, aliases = [], extra = {}) => ({actorKey:'k-' + packId + '-' + figureId, ref:{packId, figureId}, name, aliases, enabled:true, packName:'包' + packId, ...extra})

test('figureNameConflicts lists the figure names the resolver cannot settle, and only those', () => {
  const rows = [row('p1', 'f1', '小林', ['Chinatsu']), row('p2', 'f9', '小林'), row('p2', 'f3', '晴子', ['ハル'])]
  const conflicts = resolution.figureNameConflicts(rows)
  assert.deepEqual(conflicts.map(conflict => [conflict.name, conflict.rows.map(r => r.ref.figureId)]), [['小林', ['f1', 'f9']]])
  assert.equal(resolution.resolveFigureName(rows, '小林').status, 'ambiguous')
  // the library's generated copy is the same implementation
  assert.deepEqual(libraryCopy.figureNameConflicts(rows).map(conflict => conflict.name), ['小林'])
  // a family sharing a 触发词 (田中) is no conflict
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'm', '田中一', ['田中']), row('p1', 'j', '田中二', ['田中']), row('p2', 't', '田中三', ['田中'])]), [])
  // two figures with the same name, normalized (full-width / traditional / case)
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'a', 'Ｈａｎａ'), row('p2', 'b', 'hana')]).map(conflict => [conflict.name, conflict.rows.length]), [['Ｈａｎａ', 2]])
  // a disabled figure names no one
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'f1', '小林'), row('p2', 'f9', '小林', [], {enabled:false})]), [])
  // renaming one away settles it: the stage finds the other
  const fixed = [row('p1', 'f1', '小林千夏'), row('p2', 'f9', '小林')]
  assert.deepEqual(resolution.figureNameConflicts(fixed), [])
  assert.equal(resolution.resolveFigureName(fixed, '小林').ref.figureId, 'f9')
})

test('getStageNameConflicts serves the card scope\'s conflicts with each figure\'s pack', async () => {
  const rows = [row('p1', 'f1', '小林'), row('p2', 'f9', '小林')]
  const handlers = createStageHandlers({ctx:{},
    readStageChat:{view:async (sessionId, options) => { assert.equal(sessionId, 's1'); assert.deepEqual(options, {configOnly:true}); return {cardPath:'card.png'} }},
    assetRuntime:{consumer:async (chat, origin) => { assert.equal(origin, 'http://x'); return {presentation:{figureRows:async () => rows}} }}})
  assert.deepEqual(await handlers.getStageNameConflicts({sessionId:'s1'}, 'getStageNameConflicts', null, {origin:'http://x'}),
    {conflicts:[{name:'小林', figures:[{packId:'p1', figureId:'f1', name:'小林', packName:'包p1'}, {packId:'p2', figureId:'f9', name:'小林', packName:'包p2'}]}]})
  const none = createStageHandlers({ctx:{}, readStageChat:{view:async () => ({})}, assetRuntime:{consumer:async () => { throw new Error('no card, no consumer') }}})
  assert.deepEqual(await none.getStageNameConflicts({sessionId:'s2'}, 'getStageNameConflicts', null, {}), {conflicts:[]})
})
const h = (type, props, ...children) => ({type, props:props || {}, children:children.flat()})
const walk = (node, out = []) => { if (node && typeof node === 'object') { out.push(node); for (const child of node.children || []) walk(child, out) } return out }
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children || []).map(text).join('') : ''

test('the stage notice lists each name\'s figures; a figure opens its page in 素材库', () => {
  const React = {createElement:h, Fragment:'fragment', useState:value => [value, () => {}], useEffect:() => {}, useRef:value => ({current:value})}
  const views = createStageNotices({React, Spinner:'spinner', Icon:'icon', nameConflicts:{read:() => null, openLibrary:() => {}}})
  const opened = []
  const conflicts = [{name:'小林', figures:[{packId:'p1', figureId:'f1', name:'小林千夏', packName:'夏日'}, {packId:'p2', figureId:'f9', name:'林小夜', packName:'夜曲'}]}]
  const tree = views.Status({nameConflicts:conflicts, onOpenFigure:figure => opened.push(figure.figureId), scope:'s1'})
  const notice = walk(tree).find(node => node.props?.['data-tone'] === 'error')
  assert.ok(notice, 'an error-tone notice in the top-right stack')
  assert.match(text(notice), /人物重名/)
  assert.match(text(notice), /「小林」/)
  const buttons = walk(notice).filter(node => node.props?.['data-action'] === 'open-figure')
  assert.deepEqual(buttons.map(text), ['小林千夏 · 夏日', '林小夜 · 夜曲'])
  const event = {preventDefault() {}, stopPropagation() {}}
  buttons[1].props.onClick(event)
  assert.deepEqual(opened, ['f9'])
  // no conflicts: no notice
  assert.equal(walk(views.Status({nameConflicts:[], scope:'s1'})).some(node => node.props?.['data-tone'] === 'error'), false)
  assert.equal(typeof views.openLibrary, 'function')
})

test('useNameConflicts reads per session and key and drops a read that outlived its session', async () => {
  let state = {sessionId:null, conflicts:[]}, effects = []
  const React = {useState:() => [state, next => { state = next }], useEffect:fn => effects.push(fn)}
  const reads = []
  const views = createStageNotices({React, nameConflicts:{read:id => { reads.push(id); return Promise.resolve({conflicts:[{name:id, figures:[]}]}) }}})
  const render = (id, key) => { effects = []; const value = views.useNameConflicts(id, key); const stops = effects.map(fn => fn()); return {value, stops} }
  assert.deepEqual(render('a', '1').value, [])
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(render('a', '1').value.map(row => row.name), ['a'])
  // another session's list is never shown for this one
  assert.deepEqual(render('b', '1').value, [])
  const {stops} = render('c', '1'); stops.forEach(stop => stop())
  await Promise.resolve(); await Promise.resolve()
  assert.notEqual(state.sessionId, 'c')
  assert.deepEqual(reads, ['a', 'a', 'b', 'c'])
})
