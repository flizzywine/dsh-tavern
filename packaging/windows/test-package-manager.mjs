// Usage: node packaging/windows/test-package-manager.mjs <extracted-runtime> <new-test-directory>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
const [runtimeInput, testInput] = process.argv.slice(2)
if (!runtimeInput || !testInput) throw Error('Provide extracted runtime and new test directory')
const runtime = path.resolve(runtimeInput), root = path.resolve(testInput)
assert.equal(fs.existsSync(root), false, 'Use a new test directory')
fs.mkdirSync(root, {recursive:true})
fs.writeFileSync(path.join(root,'package.json'),'{"name":"desktop-update-probe","private":true}')
const entry=['resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs']
  .map(item=>path.join(runtime,item)).find(fs.existsSync)
if(!entry)throw Error('Desktop pnpm entry not found')
const {prepare}=createRequire(import.meta.url)(path.join(runtime,'resources','official-desktop-runtime.cjs'))
const env={...process.env,...prepare({executable:path.join(runtime,'DeepSeek Harness.exe'),home:path.join(root,'home')})}
for(const invalid of [false,true]) {
 const args=['--expose-internals',entry,'install','--dir',root,'--lockfile=false',...(invalid?['--invalid-update-probe']:[])]
 const result=spawnSync(path.join(runtime,'DeepSeek Harness.exe'),args,{env:{...env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:path.join(root,'home'),CI:'true',TEMP:root,TMP:root},windowsHide:true,encoding:'utf8',timeout:180000})
 assert.ifError(result.error)
 if(invalid)assert.notEqual(result.status,0,'Installer errors must stay failures')
 else assert.equal(result.status,0,result.stdout+result.stderr)
 console.log(invalid?'PASS: package failures retain nonzero exit status':'PASS: Electron entry installs dependencies and exits normally')
}
