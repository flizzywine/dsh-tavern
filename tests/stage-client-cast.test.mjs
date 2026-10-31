import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageCast}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast.cjs')
function fixture(){
 const released=[],owner=createStageCast();let cast
 cast=owner.create({build:(figure,pending)=>({key:figure.key,kind:figure.kind,identity:figure.identity,figure,pending}),release(entry){if(entry.dead)return;entry.dead=true;released.push(entry);cast.forget(entry)}})
 return {owner,cast,released}
}
test('cast keeps the last good figure until its newest replacement is ready',()=>{
 const e=fixture(),figure={key:'a',kind:'spine',identity:'old'},[{entry:old}]=e.cast.update([figure],0)
 const [{entry:first}]=e.cast.update([{...figure,identity:'first'}],1)
 assert.equal(e.cast.entries.get('a'),old);assert.equal(old.dead,undefined)
 const [{entry:next}]=e.cast.update([{...figure,identity:'next'}],2)
 assert.equal(first.dead,true);assert.equal(e.cast.commit(first),false);assert.equal(e.cast.entries.get('a'),old)
 assert.equal(e.cast.commit(next),true);assert.equal(e.cast.entries.get('a'),next);assert.equal(old.dead,true)
 e.owner.dispose();assert.equal(next.dead,true);assert.equal(e.cast.entries.size,0)
})
test('cast retires and revives in place and keeps leased URLs for unchanged loaded figures',()=>{
 const e=fixture(),figure={key:'a',kind:'static',identity:'same',src:'old-url',spriteBundle:{revision:1},blinkBundle:{key:'blink'},visible:true,speaking:true}
 const [{entry}]=e.cast.update([figure],0);entry.sprite={}
 e.cast.update([],10);assert.equal(entry.leaving,true);assert.equal(entry.leavingSince,10);assert.equal(entry.figure.speaking,false);assert.equal(entry.figure.exit,'soft')
 e.cast.update([{...figure,src:'new-lease'}],20);assert.equal(e.cast.entries.get('a'),entry);assert.equal(entry.leaving,false);assert.equal(entry.figure.src,'old-url');assert.equal(e.released.length,0)
 e.owner.dispose()
})
test('cast disposal releases pending replacements and blocks subsequent updates and commits',()=>{
 const e=fixture(),figure={key:'a',kind:'spine',identity:'old'};e.cast.update([figure],0)
 const [{entry:pending}]=e.cast.update([{...figure,identity:'new'}],1)
 e.owner.dispose();assert.equal(e.released.length,2);assert.equal(pending.dead,true)
 assert.deepEqual(e.cast.update([figure],2),[]);assert.equal(e.cast.commit(pending),false);assert.equal(e.released.length,2)
 assert.throws(()=>e.owner.create({}),/disposed/)
})
