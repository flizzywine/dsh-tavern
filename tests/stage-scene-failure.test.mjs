import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../tavern-plugin/src/client/gal-scene.js',import.meta.url),'utf8')
test('scene frame failure stops ticker, foreground and pump once even when one stop fails',()=>{
 const calls=[],state={pump:{off(){calls.push('pump')}}}
 const start=source.indexOf('    let releaseForeground ='),end=source.indexOf('    // Be deliberately conservative:',start)
 const frame=vm.runInNewContext(source.slice(start,end)+"\nreleaseForeground=()=>{calls.push('foreground');throw Error('cleanup')};frame",{
  state,calls,app:{ticker:{stop(){calls.push('ticker')}}},tick(){calls.push('tick');throw Error('render')},onError:message=>calls.push(message),console:{warn(){},error(){}}
 })
 frame();frame();assert.deepEqual(calls,['tick','ticker','foreground','pump','render']);assert.equal(state.pump,null);assert.match(state.tickError,/render/)
})
test('scene destruction attempts every owner and is idempotent after cleanup errors',()=>{
 const calls=[],state={offstage:new Map([['a',{next:{id:'next'},id:'current'}]])}
 const owner=name=>({dispose(){calls.push(name)},destroy(){calls.push(name)}})
 const start=source.lastIndexOf('        destroy() {'),end=source.indexOf('\n    };\n}',start)
 const destroy=vm.runInNewContext('('+source.slice(start,end).replace('destroy()','function destroy()')+')',{
  state,app:{ticker:{stop(){calls.push('ticker')},remove(){calls.push('remove')}},destroy(){calls.push('app')}},
  releaseForeground(){calls.push('foreground');throw Error('foreground')},releaseResolution(){calls.push('resolution')},
  faceBoxObserver:{disconnect(){calls.push('face')}},emptyThemeObserver:{disconnect(){calls.push('theme')}},stageHost:null,
  frame(){},effects:{destroy(){calls.push('effects');throw Error('effects')}},cast:owner('cast'),sceneLayout:owner('layout'),destroyFigure:entry=>calls.push(entry.id),
  call:owner('call'),offstageBox:owner('offstage'),backgrounds:owner('backgrounds'),figureAssets:owner('assets'),textures:owner('textures'),bust:owner('bust'),thinking:owner('thinking'),generated:{a:{destroy(){calls.push('generated')}}}
 })
 assert.throws(destroy,error=>error.errors.length===2)
 assert.deepEqual(calls,['ticker','foreground','resolution','face','theme','remove','effects','cast','layout','next','current','call','offstage','backgrounds','assets','textures','bust','thinking','app','generated'])
 destroy();assert.equal(calls.length,20)
})
