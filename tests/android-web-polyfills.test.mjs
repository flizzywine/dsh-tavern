import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
for (const path of ['tavern-plugin/src/client/android-web-polyfills.js','android/dsh-tavern-entry/client.js']) {
 test(path+' supports DSH history findLast on WebView 95',async()=>{
  const context=vm.createContext({window:{__ModuleLoader__:{load(){}}},AbortSignal,AbortController})
  vm.runInContext('delete Array.prototype.findLast; delete Array.prototype.findLastIndex',context)
  vm.runInContext(await readFile(new URL('../'+path,import.meta.url),'utf8'),context)
  assert.equal(vm.runInContext('[{seq:1},{seq:3},{seq:2}].sort((a,b)=>a.seq-b.seq).findLast(x=>x.seq<3).seq',context),2)
  assert.equal(vm.runInContext('[1,2,1].findLastIndex(x=>x===1)',context),2)
  assert.equal(vm.runInContext('[,].findLastIndex(x=>x===undefined)',context),0)
  assert.equal(vm.runInContext('Array.prototype.findLast.call({0:7,length:1},function(x){return x===this.value},{value:7})',context),7)
  assert.equal(vm.runInContext('Object.getOwnPropertyDescriptor(Array.prototype,"findLast").enumerable',context),false)
 })
}
