import test from 'node:test'
import assert from 'node:assert/strict'
import {createCardPagesService, projectStatusPanelLedger} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/status-panel-service.js'

const page = {id:'status',label:'状态',html:'<p>状态</p>',shortcut:'s',menu:true,figures:[{name:'辉夜',emotion:'平静'}],ledger:['items']}
const card = (pages = [page], name = '辉夜') => ({spec:'chara_card_v3',data:{name,extensions:{dsh_tavern:{pages,assetBindings:{boundPackIds:['bound']}}}}})
const ledger = {version:1,items:[{name:'钥匙',qty:1,carried:true}],npcs:[],scenes:[],itemLog:[]}
function service({raw=card(),chat={},messages=[{role:'assistant',greeting:true}]}={}) {
  return createCardPagesService({
    readWorkspace:async()=>({raw}),chatForSession:async()=>({cardPath:'card',ledger,...chat}),
    index:async()=>({messages}),packSnapshot:async packId=>({manifest:{assets:[{kind:'backgrounds',id:packId,media:'image',enabled:true}]}})
  })
}

test('declarations omit HTML and fresh follows player messages, not greeting',async()=>{
  const result=await service().list({sessionId:'s'})
  assert.deepEqual(result,{pages:[{id:'status',label:'状态',size:'window',shortcut:'s',menu:true}],fresh:true})
  assert.equal((await service({messages:[{role:'assistant'},{role:'user'}]}).list({sessionId:'s'})).fresh,false)
  for(const options of [{raw:card([])},{chat:{mode:'card'}}]) {
    assert.deepEqual(await service(options).list({sessionId:'s'}),{pages:[],fresh:false})
    assert.equal(await service(options).read({sessionId:'s',page:'status'}),null)
  }
})

test('live library page supplies figures and only declared ledger',async()=>{
  const result=await service().read({sessionId:'s',page:'status'})
  assert.equal('html' in result,false)
  assert.deepEqual(result.figures,page.figures)
  assert.deepEqual(result.data,{ledger:{items:ledger.items}})
  const raw=card([{id:'map',label:'航海图',html:'<p>港口</p>',size:'full',preload:[{kind:'backgrounds',id:'bound'}]}],'船长')
  const reader=service({raw,chat:{snapshot:{raw:card()}}})
  assert.equal(await reader.read({sessionId:'s',page:'status'}),null)
  const map=await reader.read({sessionId:'s',page:'map',withHtml:true})
  assert.equal(map.card.name,'船长')
  assert.equal(map.html,'<p>港口</p>')
  assert.equal(map.size,'full')
  assert.deepEqual(map.preload,[{ref:{kind:'backgrounds',id:'bound'},place:{packId:'bound',hash:'image'}}])
  raw.data.extensions.dsh_tavern.pages[0].html='<p>新港口</p>'
  assert.equal((await reader.read({sessionId:'s',page:'map',withHtml:true})).html,'<p>新港口</p>')
})

test('asset lookups require a declared page and use only bound packs',async()=>{
  const reader=service()
  assert.equal(await reader.locate({sessionId:'s',page:'status',ref:{kind:'backgrounds',id:'unbound'}}),null)
  assert.equal(await reader.locate({sessionId:'s',page:'missing',ref:{kind:'backgrounds',id:'bound'}}),null)
  assert.deepEqual(await reader.assets({sessionId:'s',page:'status',kind:'backgrounds'}),[{id:'bound',name:'bound'}])
  assert.deepEqual(await reader.assets({sessionId:'s',page:'missing',kind:'backgrounds'}),[])
})

test('ledger projection retains its size budget',()=>{
  const big={...ledger,items:Array.from({length:80},(_,i)=>({name:'物'.repeat(900)+i,qty:i,carried:true}))}
  assert.ok(Buffer.byteLength(JSON.stringify(projectStatusPanelLedger(big,['items'])))<=12288)
})
