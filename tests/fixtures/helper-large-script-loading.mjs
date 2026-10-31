import { helperLoaderSource } from './helper-loader-source.mjs'
import assert from 'node:assert/strict'
import vm from './client-vm.mjs'
import { readFile } from 'node:fs/promises'
let descriptor
vm.runInNewContext(await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window:{__ModuleLoader__:{load(value){descriptor=value}}}, console, btoa
})
const client=descriptor.factory(()=>({}))
const content='// 中文脚本😀\n'.repeat(400_000)
const html=client.buildTavernHelperScriptDocument({token:'large',scripts:[{id:'large',content}],context:{}})
const loader=helperLoaderSource(html)
const declaration=loader.match(/const scripts=(.*);\nconst token=/)[1]
assert.equal(JSON.parse(declaration)[0].content,content)
console.log('PASS large Unicode script roundtrip')
