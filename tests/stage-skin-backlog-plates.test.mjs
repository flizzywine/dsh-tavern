import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const fixture=JSON.parse(readFileSync(new URL('./fixtures/stage-skins/backlog-plates.json',import.meta.url),'utf8'))

const withPlates=(plates,side)=>{
  const doc=structuredClone(fixture)
  if(side)doc.devices.mobile.art.backlog.plates=plates
  else doc.art.backlog.plates=plates
  return doc
}
const speech=extra=>({speech:{images:[{image:'art/p.webp',ground:'#ffffff',ink:'#111111'}],slice:[8,8,8,8],...extra}})

test('the sample skin validates and its plate images, wide and phone, are collected for install',()=>{
  const doc=contract.validateStageSkin(structuredClone(fixture))
  const files=contract.stageSkinFiles(doc)
  for(const name of ['art/plate-dialog.webp','art/plate-dialog-alt.webp','art/plate-player.webp','art/plate-narration.webp','art/plate-notice.webp','art/plate-divider.webp','art/sticker-a.webp','art/sticker-b.webp','art/sticker-c.webp'])
    assert.ok(files.includes(name),name)
  const phone=contract.stageSkinForDevice(doc,'mobile').art.backlog.plates
  assert.deepEqual(Object.keys(phone).sort(),['narration','notice','player','speech'])
  assert.equal(phone.speech.poses.length,3)
})

test('a plate ink below 4.5:1 on its ground is refused naming the role and the image',()=>{
  const low={image:'art/low.webp',ground:'#808080',ink:'#777777'}
  const wide=speech({images:[{image:'art/p.webp',ground:'#ffffff',ink:'#111111'},low]})
  assert.throws(()=>contract.validateStageSkin(withPlates(wide)),error=>error.code==='SKIN_CONTRAST'
    && /art\.backlog\.plates\.speech\.images\[1\]/.test(error.message) && /#777777/.test(error.message) && /#808080/.test(error.message) && /4\.5:1/.test(error.message))
  assert.throws(()=>contract.validateStageSkin(withPlates({notice:{images:[low],slice:[8,8,8,8]}},'mobile')),error=>error.code==='SKIN_CONTRAST'
    && /devices\.mobile\.art\.backlog\.plates\.notice\.images\[0\]/.test(error.message))
})

test('unknown roles and bad slice, poses, out, slant or image lists are invalid',()=>{
  const bad=plates=>assert.throws(()=>contract.validateStageSkin(withPlates(plates)),{code:'INVALID_SKIN'})
  bad({bubble:speech().speech})
  bad({})
  bad(speech({slice:[8,8,8]}))
  bad(speech({slice:[8,8,8,-1]}))
  bad(speech({poses:[]}))
  bad(speech({poses:[{x:10}]}))
  bad(speech({poses:[{x:0,rot:30}]}))
  bad(speech({poses:Array.from({length:9},()=>({x:0,rot:0}))}))
  bad(speech({out:[1,2,3]}))
  bad(speech({slant:45}))
  bad(speech({images:[]}))
  bad(speech({images:[{image:'art/p.webp',ink:'#111111'}]}))
  bad({speech:{images:[{image:'art/p.webp',ground:'#ffffff',ink:'#111111'}]}})
  assert.throws(()=>contract.validateStageSkin(withPlates({bubble:speech().speech},'mobile')),{code:'INVALID_SKIN'})
})

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
