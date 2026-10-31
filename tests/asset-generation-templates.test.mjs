import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createAssetGeneration, ASSET_PROMPT_KINDS} from '../tavern-plugin/lib/domain/asset-generation.js'
import {productionPrompt} from '../tavern-plugin/lib/domain/asset-production-contract.js'

test('installed generation settings load real default templates and preserve overrides', async () => {
  const files=new Map(), store={readJson:async key=>files.get(key),updateJson:async(key,fn)=>{const value=await fn(files.get(key));files.set(key,value);return value}}
  const service=createAssetGeneration({store})
  const initial=await service.prompts()
  assert.deepEqual(initial.kinds.map(row=>row.kind),ASSET_PROMPT_KINDS)
  for(const row of initial.kinds) {
    assert.ok(row.text.trim())
    const prompt=await productionPrompt({kind:row.kind,figure:{name:'Test',emotions:[]},outfit:{label:'Default'},userPrompt:'test scene'})
    assert.ok(prompt.trim());assert.doesNotMatch(prompt,/\{\{\w+\}\}/)
  }
  const edited=initial.kinds[0].text+'\nKeep the approved palette.\n'
  await service.setPrompt({kind:'sprite',text:edited,expectedRevision:initial.revision})
  assert.equal((await service.prompts()).kinds[0].text,edited)
  const sprite=await productionPrompt({kind:'sprite',framing:{headTop:100,feet:1400}})
  assert.match(sprite,/y≈100/)
  assert.match(await readFile(new URL('../tavern-plugin/presets/asset-gen/templates/redraw-note.md',import.meta.url),'utf8'),/<note>/)
})
