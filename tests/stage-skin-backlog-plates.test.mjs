import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const fixture=JSON.parse(readFileSync(new URL('./fixtures/stage-skins/backlog-plates.json',import.meta.url),'utf8'))

const speech=extra=>({speech:{images:[{image:'art/p.webp',ground:'#ffffff',ink:'#111111'}],slice:[8,8,8,8],...extra}})

for (const file of ['backlog-plates.json','backlog-plates-paper.json']) test(file + ': plate scale uses the shared art contract on desktop and mobile',()=>{
  const doc=JSON.parse(readFileSync(new URL('./fixtures/stage-skins/'+file,import.meta.url),'utf8'))
  for(const scale of [.5,[.5,.75]]) {
    doc.art.backlog.plates.speech.scale=scale
    assert.deepEqual(contract.validateStageSkin(doc).art.backlog.plates.speech.scale,scale)
    doc.devices={mobile:{art:{backlog:{plates:{speech:{...doc.art.backlog.plates.speech,scale}}}}}}
    assert.deepEqual(contract.stageSkinForDevice(contract.validateStageSkin(doc),'mobile').art.backlog.plates.speech.scale,scale)
  }
  for(const scale of [0,9,[.5],[-1,.5]]) {
    doc.art.backlog.plates.speech.scale=scale
    assert.throws(()=>contract.validateStageSkin(doc),{code:'INVALID_SKIN'})
  }
})
