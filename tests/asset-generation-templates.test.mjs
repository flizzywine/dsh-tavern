import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {productionPrompt} from '../tavern-plugin/lib/domain/asset-production-contract.js'

test('installed generation templates fill every slot', async () => {
  for(const kind of ['sprite','avatar','avatar-sheet','settei','identity-settei','background']) {
    assert.ok((await readFile(new URL('../tavern-plugin/presets/asset-gen/templates/'+kind+'.md',import.meta.url),'utf8')).trim())
    const prompt=await productionPrompt({kind,figure:{name:'Test',emotions:[]},outfit:{label:'Default'},userPrompt:'test scene'})
    assert.ok(prompt.trim());assert.doesNotMatch(prompt,/\{\{\w+\}\}/)
  }
  const sprite=await productionPrompt({kind:'sprite',framing:{headTop:100,feet:1400}})
  assert.match(sprite,/y≈100/)
  assert.match(await readFile(new URL('../tavern-plugin/presets/asset-gen/templates/redraw-note.md',import.meta.url),'utf8'),/<note>/)
})
