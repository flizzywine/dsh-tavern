// A phone portrait renders no text-box face by default: art.portrait.narrow places the phone side only with art.portrait.phone
// true, so a skin without the opt-in keeps no face column there (themes.css: its lines start at the box's left padding).
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const base={schema:'dsh.skin/1',id:'portrait-phone',label:'竖屏头像',textbox:{paint:{bg:'#101418',fg:'#f2f2f2'}},nameplate:{shape:'plain',paint:{bg:'#101418',fg:'#f2f2f2'}},font:{},textFx:{reveal:'type'}}
const skin=portrait=>({...base,art:{screen:1080,screenWidth:1920,portrait:{left:40,bottom:40,size:320,...portrait}}})
const narrow={width:72,x:8,y:8}

test('art.portrait.phone is true or absent and needs the narrow side',()=>{
  contract.validateStageSkin(skin({narrow}))
  contract.validateStageSkin(skin({narrow,phone:true}))
  for(const portrait of [{phone:true},{narrow,phone:false}])assert.throws(()=>contract.validateStageSkin(skin(portrait)),{code:'INVALID_SKIN'})
})

test('a phone side is placed only with art.portrait.phone true',()=>{
  const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
  assert.equal('data-fk-skin-portrait-narrow' in adapter.stageSkinArt(skin({narrow}),{}).marks,false)
  assert.ok('data-fk-skin-portrait-narrow' in adapter.stageSkinArt(skin({narrow,phone:true}),{}).marks)
})