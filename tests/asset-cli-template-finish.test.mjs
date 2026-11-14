import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir} from 'node:fs/promises'
import { productionPrompt, assetStyleUse } from '../tavern-plugin/lib/domain/asset-production-contract.js'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'
import {validatePackManifest,packGenStyle} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'

const templates=new URL('../tavern-plugin/presets/asset-gen/templates/',import.meta.url)
const sample=(kind,style)=>productionPrompt({kind,style,...(kind==='edit'?{outputKind:'sprite'}:{}),figure:{name:'Fixture',identityAppearance:'Silver hair',emotions:[{id:'state-01',label:'平静',guidance:'Relaxed face'}]},outfit:{label:'Daily'},emotionId:'state-01',frame:kind==='mouth'?'small':'',userPrompt:'Keep the reference design',references:[{role:'Source artwork'}]})
const CLEAN='large simple colour masses',ADDITIONS={figure:/in the style of the character reference sheet/,sheet:/reference artwork's line style/,background:/composition and colour very clean/}

test('画风: the CLI prompt ends with the 配图 preset text for its use; old ids read as the plugin presets; 不加画风 adds nothing',async()=>{
  const kinds=(await readdir(templates)).filter(file=>file.endsWith('.md')&&file!=='redraw-note.md').map(file=>file.slice(0,-3))
  for(const kind of kinds) {
    const use=assetStyleUse(kind==='edit'?'sprite':kind),bare=await sample(kind,'no-style')
    assert.doesNotMatch(bare,/Finish:|\{\{|cel-shaded|TV anime|key-visual/,kind+' carries no style text of its own')
    for(const style of [undefined,'clean','galgame-clean']) {
      const prompt=await sample(kind,style)
      assert.ok(prompt.startsWith(bare)&&prompt.includes(CLEAN),kind+' '+style+' adds the 干净低细节 text')
      for(const [other,text] of Object.entries(ADDITIONS)) assert.equal(text.test(prompt),other===use,kind+': the '+other+' addition only for that use')
    }
    assert.match(await sample(kind,'anime'),/original TV anime/)
    assert.match(await sample(kind,'polished'),/key-visual or gacha-card quality/)
    assert.equal(await sample(kind,'none'),bare,kind+' 不指定 is 不加画风')
  }
  await assert.rejects(()=>sample('sprite','watercolour'),/找不到画风预设/)
})

test('a pack stores its default 画风 (genStyle) as a 配图 preset id; the four former ids still validate and read as presets',async()=>{
  const manifest=(await syntheticPack()).manifest
  validatePackManifest(manifest)
  for(const genStyle of ['clean','anime','polished','none','galgame-clean']) validatePackManifest({...manifest,genStyle})
  for(const genStyle of ['','Water Colour','a..b']) assert.throws(()=>validatePackManifest({...manifest,genStyle}))
  assert.deepEqual(['clean','anime','polished','none',undefined].map(packGenStyle),['galgame-clean','galgame-anime','galgame-polished','no-style','galgame-clean'])
})
