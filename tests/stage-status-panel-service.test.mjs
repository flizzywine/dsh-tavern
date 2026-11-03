import test from 'node:test'
import assert from 'node:assert/strict'
import {createStatusPanelService, projectStatusPanelLedger} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/status-panel-service.js'

const card = panel => ({spec:'chara_card_v3', data:{name:'辉夜', extensions:panel ? {dsh_tavern:{statusPanel:panel}} : {}}})
const panel = {version:1, title:'辉夜的状态', html:'<p>状态</p>', figures:[{name:'辉夜', emotion:'平静'}],
  variables:{reads:{affinity:{source:'mvu', path:'/好感/辉夜'}}}, ledger:['items']}
const ledger = {version:1, location:'', locationPath:[], items:[{name:'钥匙', qty:1, carried:true}], npcs:[{name:'辉夜'}], scenes:[{path:['校舍'], desc:'教室'}], itemLog:[], updatedTurn:3}
const messages = [{role:'assistant', turn:1, swipeId:0, variables:[{stat_data:{好感:{辉夜:3, 其他:9}, 密语:'secret'}}]}]
const indexed = {id:'chat', cardPath:'card', _storageRevision:7, variables:{}, messages}
const readWindow = async (_id, request) => ({revision:7, from:request.before-1, chat:{messages:[messages[request.before-1]], variables:{}}})

function service({workspace = {raw:card(panel)}, chat = {}} = {}) {
  const current = {id:'chat', cardPath:'card', mode:'story', ledger, ...chat}
  return createStatusPanelService({
    readWorkspace: async () => workspace,
    chatForSession: async sessionId => sessionId === 'chat' ? current : null,
    index: async () => indexed,
    readWindow
  })
}

test('a card without a panel, or a card-mode chat, returns null', async () => {
  assert.equal(await service({workspace:{raw:card(null)}}).read({sessionId:'chat', withHtml:true}), null)
  assert.equal(await service({chat:{mode:'card'}}).read({sessionId:'chat', withHtml:true}), null)
  assert.equal(await service({workspace:null}).read({sessionId:'chat', withHtml:true}), null)
})

test('returns only declared paths and omits an undeclared sibling', async () => {
  const result = await service().read({sessionId:'chat', withHtml:false})
  assert.deepEqual(result.data.variables.affinity, {status:'ready', value:3})
  assert.equal(JSON.stringify(result).includes('其他'), false)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('returns only declared ledger sections', async () => {
  const result = await service().read({sessionId:'chat', withHtml:false})
  assert.deepEqual(Object.keys(result.data.ledger), ['items'])
  assert.deepEqual(result.data.ledger.items, ledger.items)
  assert.deepEqual(projectStatusPanelLedger(ledger, ['items', 'nope']), {items:ledger.items})
  const big = {...ledger, items:Array.from({length:80}, (_, i) => ({name:'物'.repeat(900) + i, qty:i, carried:true}))}
  assert.ok(Buffer.byteLength(JSON.stringify(projectStatusPanelLedger(big, ['items']))) <= 12288)
})

test('withHtml:false omits html; withHtml:true includes it', async () => {
  const without = await service().read({sessionId:'chat', withHtml:false})
  assert.equal('html' in without, false)
  assert.equal(without.title, '辉夜的状态')
  assert.deepEqual(without.figures, panel.figures)
  assert.equal((await service().read({sessionId:'chat', withHtml:true})).html, '<p>状态</p>')
})

test('the definition comes from the library card even when the chat snapshot is older', async () => {
  const stale = card({...panel, title:'旧标题', html:'<p>旧</p>'})
  const result = await service({workspace:{raw:card({...panel, title:'新标题', html:'<p>新</p>'})}, chat:{snapshot:{raw:stale}}})
    .read({sessionId:'chat', withHtml:true})
  assert.equal(result.title, '新标题')
  assert.equal(result.html, '<p>新</p>')
})
