import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
function harness(){
 const context=vm.createContext({})
 const files=['../tavern-plugin/lib/domain/indexed-array.js','../tavern-plugin/lib/domain/ordered-numeric-index.js','../tavern-plugin/src/client/modules/session-view-sync.js','../tavern-plugin/src/client/modules/live-tavern-view.js']
 vm.runInContext(files.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^export .*$/gm,'')).join('\n'),context)
 return context
}
for(const count of [20,400,10000])test(`turn field point merge avoids copying ${count} historical values`,()=>{
 const h=harness(),begin=h.createSessionViewReader()
 let reads=0,visits=0
 const source={}
 for(let i=0;i<count;i++)Object.defineProperty(source,String(i),{enumerable:true,get(){reads++;return `floor-${i}`}})
 const old=begin('s').accept({viewCursor:'a',view:{inputSources:source,inputTemplateDisplays:{'0':'template'}}}).view
 reads=0;h.createSessionViewReader.onTurnFieldVisit=()=>visits++
 const next=begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['inputSources',String(count-1)],'edited']],remove:[]}}).view
 assert.equal(reads,0);assert.ok(visits<100,`index visits: ${visits}`)
 assert.equal(next.inputSources[count-1],'edited');assert.equal(old.inputSources[count-1],`floor-${count-1}`)
 assert.equal(next.inputTemplateDisplays,old.inputTemplateDisplays)
 assert.equal(Object.keys(next.inputSources).length,count)
 assert.equal(JSON.parse(JSON.stringify(next.inputSources))[count-1],'edited')
 const removed=begin('s').accept({viewCursor:'c',viewDelta:{baseCursor:'b',set:[[['inputSources','0'],undefined]],remove:[['inputSources',String(count-1)]]}}).view
 assert.equal(Object.hasOwn(removed.inputSources,'0'),true)
 assert.equal(removed.inputSources[0],undefined)
 assert.equal(Object.hasOwn(removed.inputSources,String(count-1)),false)
 assert.equal(next.inputSources[count-1],'edited')
})

test('turn field replacement and legacy noncanonical keys retain normal object behavior',()=>{
 const h=harness(),begin=h.createSessionViewReader()
 begin('s').accept({viewCursor:'a',view:{inputSources:{'0':'zero'}}})
 let view=begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['inputSources','01'],'legacy']],remove:[]}}).view
 assert.equal(view.inputSources['01'],'legacy');assert.equal(view.inputSources[0],'zero')
 view=begin('s').accept({viewCursor:'c',viewDelta:{baseCursor:'b',set:[[['inputSources'],{'2':null}]],remove:[['inputSources','01'],['inputSources','0']]}}).view
 assert.equal(view.inputSources[2],null);assert.deepEqual(Object.keys(view.inputSources),['2'])
 view=begin('s').accept({viewCursor:'d',viewDelta:{baseCursor:'c',set:[],remove:[['inputSources']]}}).view
 assert.equal(Object.hasOwn(view,'inputSources'),false)
})
