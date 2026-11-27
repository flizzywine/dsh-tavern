import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {channel} from 'node:diagnostics_channel'
import {createAssetPackService} from '../src/pack-v2/service.js'

const figure={schemaVersion:1,name:'Identity fixture',enabled:false,appearance:'sprite',recall:{mode:'keyword'},emotions:[{id:'calm'}],outfits:[]}
test('a new figure checks identities against the other packs\' manifests only, read again only after they change',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pack-create-budget-'))
  let service=createAssetPackService({assetRoot:root})
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
  const target=await service.createPack({name:'Target',expectedRevision:null})
  const other=await service.createPack({name:'Other',expectedRevision:null})
  const otherId=other.snapshot.manifest.id
  let otherFigure=await service.createFigure({packId:otherId,expectedRevision:other.snapshot.revision,figure})
  await service.dispose()
  service=createAssetPackService({assetRoot:root})
  const events=[],timing=channel('dsh.asset.read'),record=event=>events.push(event)
  timing.subscribe(record)
  t.after(()=>timing.unsubscribe(record))
  const otherReads=()=>events.splice(0).filter(e=>e.packId===otherId&&e.name.startsWith('pack.read.')).map(e=>e.name)
  let current=await service.createFigure({packId:target.snapshot.manifest.id,expectedRevision:target.snapshot.revision,figure})
  assert.deepEqual(otherReads(),['pack.read.manifest'],'only the other pack\'s manifest, not its figure documents')
  current=await service.createFigure({packId:target.snapshot.manifest.id,expectedRevision:current.snapshot.revision,figure})
  assert.deepEqual(otherReads(),[],'an unchanged pack is not read again')
  otherFigure=await service.createFigure({packId:otherId,expectedRevision:otherFigure.snapshot.revision,figure})
  events.length=0
  await assert.rejects(service.createFigure({packId:target.snapshot.manifest.id,expectedRevision:current.snapshot.revision,id:otherFigure.figureId,figure}),{code:'DUPLICATE_ID'})
  assert.deepEqual(otherReads(),['pack.read.manifest'],'a changed pack is read again, so its new figure still collides')
})
