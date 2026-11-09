import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const factory=name=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name+'.cjs')
for(const name of ['backlog-rows','backlog-history','backlog-paging','backlog-voice','backlog-view'])factory(name)
const base={schema:'dsh.skin/1',id:'wave-sample',label:'波',textbox:{paint:{bg:'#101418',fg:'#f2f2f2'}},nameplate:{shape:'plain',paint:{bg:'#101418',fg:'#f2f2f2'}},font:{},textFx:{reveal:'type'}}
const skin=voice=>({...base,art:{screen:1080,voice}})

test('art.voice.waves: one to three arc images beside the body image, packed with the skin',()=>{
 const document=skin({image:'art/speaker.svg',focus:'art/speaker-focus.svg',waves:['art/wave-1.svg','art/wave-2.svg']})
 contract.validateStageSkin(document)
 assert.deepEqual(contract.stageSkinFiles(document).filter(name=>name.startsWith('art/wave')),['art/wave-1.svg','art/wave-2.svg'])
 for(const voice of [{box:false,waves:['art/wave-1.svg']},{image:'art/speaker.svg',waves:[]},{image:'art/speaker.svg',waves:['a.svg','b.svg','c.svg','d.svg']}])
  assert.throws(()=>contract.validateStageSkin(skin(voice)),{code:'INVALID_SKIN'})
})
