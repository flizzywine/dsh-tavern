import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {productionPrompt,renderAssetTemplate,assetStyleValues,ASSET_STYLE_DEFAULT} from '../tavern-plugin/lib/domain/asset-production-contract.js'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'
import {validatePackManifest,PACK_GEN_STYLES} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'

const templates=new URL('../tavern-plugin/presets/asset-gen/templates/',import.meta.url)
const finish='large simple colour masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppressed micro-texture and micro-contrast, and no unnecessary specular highlights.'

// every image template takes its Finish from the style preset (default 干净低细节,
// the former fixed text); local edits (mouth, blink, edit) also follow 画风, and their
// edit-protection line stays under 不指定.
const LOCAL=['mouth','blink','edit']
const sample=(kind,style)=>productionPrompt({kind,style,figure:{name:'Fixture',identityAppearance:'Silver hair',emotions:[{id:'state-01',label:'平静',guidance:'Relaxed face'}]},outfit:{label:'Daily'},emotionId:'state-01',frame:kind==='mouth'?'small':'',userPrompt:'Keep the reference design',references:[{role:'Source artwork'}]})
test('every official image template renders the complete low-detail Finish, including local edits',async()=>{
  const kinds=(await readdir(templates)).filter(file=>file.endsWith('.md')&&file!=='redraw-note.md').map(file=>file.slice(0,-3))
  assert.ok(kinds.includes('mouth')&&kinds.includes('blink'))
  for(const kind of kinds) {
    const prompt=await sample(kind)
    const line=prompt.split('\n').find(line=>line.startsWith('Finish:'))
    assert.ok(line?.includes(finish),kind+' must retain the full official Finish text')
    assert.equal(prompt.split('\n').filter(line=>line.startsWith('Finish:')).length,1,kind+' has one Finish')
    const own=(await readFile(new URL(kind+'.md',templates),'utf8')).split('\n').find(line=>line.startsWith('Finish:'))
    assert.equal(renderAssetTemplate(own,assetStyleValues(kind,ASSET_STYLE_DEFAULT)),line,kind+' uses the official template and preset, not a caller rewrite')
    assert.ok(own.includes('{{style}}'),kind+' takes its Finish from the preset')
    assert.equal(await sample(kind,'clean'),prompt,kind+' default is 干净低细节')
    if(LOCAL.includes(kind)) {
      const body=prompt.split('\n').filter(l=>!l.startsWith('Finish:')).join('\n')
      assert.match(body,/Match the source's line weight, shadow shapes, highlights and colouring in the edited/)
      assert.match(body,/never add detail or restyle the source/)
      assert.match(body,/Preserve every pixel outside the requested edit\./)
    }
  }
})

test('画风 presets: 动画截图 and 精美 replace the Finish, 不指定 sends none, local edits follow the preset too',async()=>{
  assert.deepEqual([...PACK_GEN_STYLES],['clean','anime','polished','none'])
  const kinds=(await readdir(templates)).filter(file=>file.endsWith('.md')&&file!=='redraw-note.md').map(file=>file.slice(0,-3))
  for(const kind of kinds) {
    const clean=await sample(kind,'clean'),finishes=p=>p.split('\n').filter(line=>line.startsWith('Finish:'))
    const anime=finishes(await sample(kind,'anime')),polished=finishes(await sample(kind,'polished'))
    assert.equal(anime.length,1); assert.equal(polished.length,1)
    assert.match(anime[0],/original TV anime/); assert.ok(!anime[0].includes(finish),kind+' anime has no low-detail text')
    assert.match(polished[0],/key-visual or gacha-card quality/); assert.ok(!polished[0].includes(finish))
    const none=await sample(kind,'none')
    assert.deepEqual(finishes(none),[],kind+' 不指定 sends no Finish line')
    assert.doesNotMatch(none,/cel-shaded|TV anime|key-visual|this finish only/,kind+' 不指定 sends no style text')
    assert.equal(none.split('\n').length,clean.split('\n').length-1,kind+' only the Finish line goes')
    // The template's own sentence on which reference's line style leads stays with every preset.
    const own=(await readFile(new URL(kind+'.md',templates),'utf8')).split('\n').find(line=>line.startsWith('Finish:')).replace('Finish: {{style}}','').replace('{{styleScope}}','').trim()
    if(own) { assert.ok(anime[0].includes(own),kind+' keeps its own sentence'); assert.ok(polished[0].includes(own)) }
  }
  await assert.rejects(()=>sample('sprite','watercolour'),err=>err.code==='INVALID_ARGUMENT')
})

test('a 3D or 不指定 local edit has no cel-shaded finish and keeps its edit protection',async()=>{
  for(const kind of LOCAL) {
    const none=await sample(kind,'none')
    assert.doesNotMatch(none,/cel-shaded|TV anime|key-visual/,kind)
    assert.ok(!none.split('\n').some(line=>line.startsWith('Finish:')),kind+' sends no Finish line')
    assert.match(none,/Match the source's line weight, shadow shapes, highlights and colouring/,kind)
    assert.match(none,/Preserve every pixel outside the requested edit\./,kind)
    assert.match(await sample(kind,'clean'),/^Finish: clean cel-shaded anime character art/m,kind)
  }
})

test('a pack background style replaces the edit Finish and keeps its edit protection',async()=>{
  const prompt=await productionPrompt({kind:'edit',style:'clean',backgroundStyle:{prompt:'Quiet painted colour; no grime or cracks.'},figure:{name:'Fixture'},outfit:{label:'Daily'},userPrompt:'Keep the room.',references:[{role:'Original composition authority'}]})
  assert.match(prompt,/^Pack background style: Quiet painted colour; no grime or cracks\.$/m)
  assert.ok(!prompt.split('\n').some(line=>line.startsWith('Finish:')),'no preset Finish line')
  assert.doesNotMatch(prompt,/cel-shaded|this finish only/)
  assert.match(prompt,/Match the source's line weight, shadow shapes, highlights and colouring in the edited area/)
  assert.match(prompt,/Preserve every pixel outside the requested edit\./)
})

test('a pack stores its default 画风 (genStyle); only the four presets validate',async()=>{
  const manifest=(await syntheticPack()).manifest
  validatePackManifest(manifest)
  for(const genStyle of PACK_GEN_STYLES) validatePackManifest({...manifest,genStyle})
  assert.throws(()=>validatePackManifest({...manifest,genStyle:'watercolour'}))
  assert.throws(()=>validatePackManifest({...manifest,genStyle:''}))
})
