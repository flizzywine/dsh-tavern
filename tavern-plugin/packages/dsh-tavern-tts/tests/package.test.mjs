import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import vm from 'node:vm'
const packages=fileURLToPath(new URL('../../',import.meta.url))
test('standalone packages have unique lifecycle-owned slots and no Tavern runtime imports',() => {
  const slots=new Map(),provided=new Map(),effects=[]
  for(const name of ['dsh-tavern-tts']) {
    const root=join(packages,name),manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
    assert.ok(manifest.dsh.bundle.patch);assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'),false)
    let module
    vm.runInNewContext(readFileSync(join(root,'lib/client.js'),'utf8'),{EventSource:class { close() {} },window:{__ModuleLoader__:{load(value){assert.equal(value.id,name);module=value.factory(() => ({}))}}}})
    const ctx={inject(){},provide(name,value){assert.equal(provided.has(name),false);provided.set(name,value)},effect(fn){effects.push(fn())},slots:{inject(name,fn){effects.push(fn())},register(opts,component){const key=opts.name+':'+opts.id;assert.equal(slots.has(key),false);slots.set(key,component);return () => slots.delete(key)}}}
    module.apply(ctx)
    function inspect(dir) {for(const entry of readdirSync(dir,{withFileTypes:true})) {const file=join(dir,entry.name);if(entry.isDirectory())inspect(file);else if(file.endsWith('.js')) {const text=readFileSync(file,'utf8');assert.equal(/(?:from|import\()\s*['"][^'"]*(?:tavern-plugin|dsh-tavern|fork-voice)/.test(text),false,file)}}}
    inspect(join(root,'src'))
  }
  assert.equal(slots.size,1);for(const stop of effects)stop();assert.equal(slots.size,0)
})
