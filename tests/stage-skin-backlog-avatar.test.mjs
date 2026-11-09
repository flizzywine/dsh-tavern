// art.backlog.avatar (C3): the face column of the art layer's spoken rows. The validator names the field to fix (wide and on a
// devices side) and collects the mask, frame and placeholder images for install.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const fixture=JSON.parse(readFileSync(new URL('./fixtures/stage-skins/backlog-avatar.json',import.meta.url),'utf8'))

const edit=(change,side)=>{const doc=structuredClone(fixture);change(side ? doc.devices.mobile.art.backlog.avatar : doc.art.backlog.avatar,doc);return doc}
const refused=(doc,pattern)=>assert.throws(()=>contract.validateStageSkin(doc),error=>error.code==='INVALID_SKIN' && pattern.test(error.message),pattern.source)

test('an unknown tone or a negative size is refused naming the field and its fix',()=>{
  refused(edit(a=>{a.tone='sepia'}),/^art\.backlog\.avatar\.tone "sepia" is invalid - tone: "mono"/)
  refused(edit(a=>{a.size=[-4,61]},'mobile'),/^devices\.mobile\.art\.backlog\.avatar\.size \[-4,61\] is invalid - size \[w, h\]: the face box in design px, each 1\.\.1024/)
  refused(edit(a=>{delete a.at}),/^art\.backlog\.avatar needs at \[x, y\]/)
  refused(edit(a=>{a.shape='circle'}),/^art\.backlog\.avatar\.shape is not an avatar field - use at, size, mask/)
  refused(edit(a=>{a.cutout={color:'white',width:3}},'mobile'),/devices\.mobile\.art\.backlog\.avatar\.cutout .* - cutout \{color, width\}/)
  refused(edit(a=>{a.placeholder='blank'}),/avatar\.placeholder "blank" is invalid/)
  refused(edit(a=>{a.player='yes'}),/avatar\.player "yes" is invalid - player: true or false/)
})
