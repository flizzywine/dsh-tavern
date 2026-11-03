import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fixture} from './helpers/mod-system-production-host.mjs'
import {firstPartyDistributions,modPackageIdentity} from '../tavern-plugin/lib/mod-system-distributions.js'

// A profile that ran the danmaku built-in before #456 still has its release installed and active.
async function removedBuiltin() {
  const dice=(await firstPartyDistributions()).find(row=>row.manifest.id==='dsh.dice')
  const manifest={...structuredClone(dice.manifest),id:'dsh.danmaku',name:'Danmaku',packageName:'dsh-tavern-mod-danmaku'}
  const entries=dice.entries.map(({path:member,data})=>{
    const relative=member.slice('plugins/dice/'.length)
    if(relative==='mod.json')data=Buffer.from(JSON.stringify(manifest))
    if(relative==='package.json')data=Buffer.from(JSON.stringify({...JSON.parse(data),name:manifest.packageName}))
    return {path:'plugins/danmaku/'+relative,data}
  })
  const files=entries.map(({path:member,data})=>({path:member.slice('plugins/danmaku/'.length),sha256:createHash('sha256').update(data).digest('hex'),size:data.length}))
  return {manifest,files,sha256:modPackageIdentity(files),entries,folder:'danmaku'}
}
const published=async root=>(await fs.readdir(path.join(root,'plugins'))).filter(name=>name.includes('danmaku'))

test('a removed built-in leaves the mod list and the plugin folder at the next start',async t=>{
  const legacy=await removedBuiltin(),before=await fixture(t,{distributions:async()=>[...await firstPartyDistributions(),legacy]})
  await before.production.installBuiltins()
  assert.equal((await published(before.root)).length,1)
  const after=await fixture(t,{root:before.root})
  await after.production.installBuiltins()
  assert.deepEqual(await published(after.root),[])
  assert.equal((await after.rpc('managedModsList',{})).mods.some(row=>row.id==='dsh.danmaku'),false)
  assert.ok((await after.rpc('managedModsList',{})).mods.some(row=>row.id==='dsh.dice'))
})
