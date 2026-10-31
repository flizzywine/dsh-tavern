import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const create=()=>createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const fonts={resolve:()=>({family:'serif'})}
test('skin scope restores every applied surface on unload and rejects late applications',()=>{
 const dom=new JSDOM('<div></div><div></div>'),skin=create(),roots=[...dom.window.document.querySelectorAll('div')]
 roots[0].style.setProperty('--gal-skin-bg','original');roots[0].setAttribute('data-fk-skin','previous')
 const restore=skin.applyStageSkin(roots[0],contract.BUILTIN_STAGE_SKINS.classic,fonts)
 skin.applyStageSkin(roots[1],contract.BUILTIN_STAGE_SKINS.gothic,fonts)
 assert.equal(roots[0].getAttribute('data-fk-skin'),'classic')
 skin.applyStageSkinMode(roots[0],{marks:{'data-fk-skin-mode':'debate'},tokens:{'--mode-font':'20'}})
 skin.dispose();restore();skin.dispose()
 assert.equal(roots[0].style.getPropertyValue('--gal-skin-bg'),'original');assert.equal(roots[0].getAttribute('data-fk-skin'),'previous')
 assert.equal(roots[0].hasAttribute('data-fk-skin-mode'),false);assert.equal(roots[1].hasAttribute('data-fk-skin'),false)
 skin.applyStageSkin(roots[1],contract.BUILTIN_STAGE_SKINS.classic,fonts)()
 assert.equal(roots[1].hasAttribute('data-fk-skin'),false);dom.window.close()
})
test('skin motion composes sprite frames and ordered enter/leave wipes without host state',()=>{
 const m=createStageSkinMotion(),skin={art:{textbox:{next:{frames:{columns:2,rows:1,fps:8}}}},transitions:{choices:{enter:{ms:200,wipe:{shape:'left'}},leave:{ms:120,delay:30,wipe:{shape:'circle'}}}}}
 const css=m.stageSkinMotionKeyframes(skin)
 assert.match(css,/@keyframes fork-skin-frames-next/);assert.match(css,/@keyframes fork-skin-tx-choices-enter/);assert.match(css,/circle\(0% at 50% 50%\)/)
 assert.equal(m.stageSkinTransitionTokens(skin)['--tx-choices-pick-ms'],'150')
 assert.equal(m.stageSkinTxEase([.1,.2,.3,1]),'cubic-bezier(0.1,0.2,0.3,1)')
})
test('all built-in skins project tokens and backlog geometry through plugin modules',()=>{
 const skin=create()
 for(const document of Object.values(contract.BUILTIN_STAGE_SKINS)){
  const tokens=skin.stageSkinTokens(document,fonts)
  assert.equal(tokens['--gal-skin-bg'],document.textbox.paint.bg)
  const backlog=skin.stageSkinBacklog({...document,backlog:{layout:'overlay'}})
  assert.equal(backlog.roles.speech.look,'bubble');assert.equal(backlog.roles.narration.look,'band')
  assert.ok(backlog.style['--bl-close'].startsWith('url('))
 }
 skin.dispose()
})
