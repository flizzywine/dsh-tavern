import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, existsSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { switchProfile, waitForExit } from '../tavern-plugin/packages/dsh-tavern/lib/helper.mjs'
function fixture(t) {
 const root = mkdtempSync(join(tmpdir(), 'tavern-profile-bridge-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 for(const name of ['desktop','tavern','other']) {mkdirSync(join(root,name));writeFileSync(join(root,name,'package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base']}}}));writeFileSync(join(root,name,'cordis.patch.yml'),'[]\n')}
 return {profilesRoot:root,liveDir:join(root,'desktop'),targetDir:join(root,'tavern'),stamp:'1'}
}
test('目录切换、改选与还原保留目标配置字节及原版目录',async t=>{
 const r=fixture(t);const original=readFileSync(join(r.targetDir,'cordis.patch.yml'))
 await switchProfile({...r,mode:'link'});assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))
 assert.deepEqual(readFileSync(join(r.targetDir,'cordis.patch.yml')),original)
 await switchProfile({...r,mode:'link',targetDir:join(r.profilesRoot,'other'),stamp:'2'})
 await switchProfile({...r,mode:'unlink',stamp:'3'});assert.equal(realpathSync(r.liveDir),join(realpathSync(r.profilesRoot),'desktop'))
})
test('缺少备份时保留原链接',async t=>{const r=fixture(t);rmSync(r.liveDir,{recursive:true});symlinkSync(r.targetDir,r.liveDir,process.platform === 'win32' ? 'junction' : 'dir');await assert.rejects(()=>switchProfile({...r,mode:'unlink'}),/备份/);assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))})
test('发布失败恢复原目录或原链接',async t=>{const r=fixture(t);const rename=(a,b)=>{if(a.includes('switch-stage'))throw Error('模拟发布失败');renameSync(a,b)};await assert.rejects(()=>switchProfile({...r,mode:'link'},{rename}),/发布失败/);assert.equal(realpathSync(r.liveDir),join(realpathSync(r.profilesRoot),'desktop'));await switchProfile({...r,mode:'link'});await assert.rejects(()=>switchProfile({...r,mode:'link',targetDir:join(r.profilesRoot,'other'),stamp:'2'},{rename}),/发布失败/);assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))})
test('目标配置无效时不改入口；不允许越出 profiles 目录',async t=>{const r=fixture(t);writeFileSync(join(r.targetDir,'package.json'),'{}');await assert.rejects(()=>switchProfile({...r,mode:'link'}),/bundle/);await assert.rejects(()=>switchProfile({...r,mode:'link',targetDir:tmpdir()}),/独立 profile/);assert.ok(existsSync(join(r.liveDir,'package.json')))})
test('仍有进程时超时退出，不发送结束进程信号',async()=>{await assert.rejects(waitForExit([22],{timeout:0,alive:()=>true}),/超时/);await waitForExit([22],{alive:()=>false})})


test('桥接安装更新始终写 tavern，不取决于 desktop 当前是否是链接', async t => {
 const { installedProfile } = await import('../bin/launcher-environment.mjs')
 const r=fixture(t);const home=join(r.profilesRoot,'home');mkdirSync(join(home,'profiles/tavern'),{recursive:true})
 assert.equal(installedProfile('desktop',home),'tavern')
 writeFileSync(join(home,'profiles/tavern/package.json'),JSON.stringify({dshTavern:{profileBridge:true}}))
 assert.equal(installedProfile('desktop',home),'tavern')
 assert.equal(installedProfile('cli',home),'tavern')
})

test('只能切到同样启用桥接的 profile，否则切过去后无法在应用内切回', async t => {
 const { validateTarget, listProfiles } = await import('../tavern-plugin/packages/dsh-tavern/lib/state.mjs')
 const root=mkdtempSync(join(tmpdir(),'pb-target-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const profile=(name,bundles)=>{mkdirSync(join(root,name));writeFileSync(join(root,name,'package.json'),JSON.stringify({dependencies:{a:'1'},dsh:{profile:{bundles}}}))}
 profile('desktop',['dsh-tavern']);profile('tavern',['@deepseek-ai/dsh-base','dsh-tavern']);profile('web',['@deepseek-ai/dsh-base'])
 for (const name of ['desktop','tavern']) {
   const dir = join(root,name,'node_modules','dsh-tavern')
   mkdirSync(dir,{recursive:true})
   writeFileSync(join(dir,'package.json'),readFileSync(new URL('../tavern-plugin/packages/dsh-tavern/package.json',import.meta.url)))
 }
 const paths={profilesDir:root,activeDir:join(root,'desktop'),activeName:'desktop'}
 assert.equal(validateTarget(paths,'tavern').name,'tavern')
 assert.throws(()=>validateTarget(paths,'web'),/does not enable the Tavern launcher/)
 assert.deepEqual(listProfiles(paths).map(p=>[p.name,p.hasBridge]),[['desktop',true],['tavern',true],['web',false]])
})

test('切换后重新打开桌面：macOS 打开 .app，其他平台直接启动可执行文件', async () => {
 const { relaunchCommand } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
 assert.deepEqual(relaunchCommand('/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness','darwin'),['open',['/Applications/DeepSeek Harness.app']])
 assert.deepEqual(relaunchCommand('C:\\Apps\\DeepSeek Harness.exe','win32'),['C:\\Apps\\DeepSeek Harness.exe',[]])
 assert.deepEqual(relaunchCommand('/opt/dsh/deepseek-harness','linux'),['/opt/dsh/deepseek-harness',[]])
})

test('已有切换在排队时给出可读的 busy 错误', async t => {
 const { scheduleSwitch } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
 const stateDir=mkdtempSync(join(tmpdir(),'pb-lock-'));t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
 mkdirSync(join(stateDir,'pending'))
 assert.throws(()=>scheduleSwitch({stateDir}),e=>e.code==='busy'&&/等待桌面退出/.test(e.message))
})

test('陈旧 pending 自动归档并重试，仍在等待应用的锁保持 busy', async t => {
 const { acquirePendingLock } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
 const stateDir=mkdtempSync(join(tmpdir(),'pb-stale-'));t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
 const lock=join(stateDir,'pending');mkdirSync(lock)
 writeFileSync(join(lock,'request.json'),JSON.stringify({pids:[4242]}))
 assert.throws(()=>acquirePendingLock(stateDir,{alive:pid=>pid===4242,now:()=>Date.now()+3600000}),e=>e.code==='busy')
 const acquired=acquirePendingLock(stateDir,{alive:()=>false,now:()=>Date.now()+3600000})
 assert.equal(acquired.reclaimed,true)
 const archives=readdirSync(join(stateDir,'stale')).filter(name=>name.startsWith('pending-'))
 assert.equal(archives.length,1)
 assert.ok(existsSync(join(stateDir,'stale',archives[0],'request.json')))
 assert.ok(existsSync(join(stateDir,'pending')))
})

test('worker 仍在运行时保留 pending，worker 退出后立即回收', async t => {
 const { acquirePendingLock } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
 const stateDir=mkdtempSync(join(tmpdir(),'pb-worker-'));t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
 const lock=join(stateDir,'pending');mkdirSync(lock)
 writeFileSync(join(lock,'request.json'),'{}')
 writeFileSync(join(lock,'worker.json'),JSON.stringify({pid:5252,startedAt:0}))
 assert.throws(()=>acquirePendingLock(stateDir,{alive:pid=>pid===5252,now:()=>Date.now()+3600000}),e=>e.code==='busy')
 const acquired=acquirePendingLock(stateDir,{alive:()=>false,now:()=>Date.now()})
 assert.equal(acquired.reclaimed,true)
 assert.ok(readdirSync(join(stateDir,'stale')).some(name=>name.startsWith('pending-')))
})

test('陈旧锁归档只保留最近几份', async t => {
 const { acquirePendingLock } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
 const stateDir=mkdtempSync(join(tmpdir(),'pb-prune-'));t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
 const staleRoot=join(stateDir,'stale');mkdirSync(staleRoot,{recursive:true})
 for(let index=0;index<3;index+=1) mkdirSync(join(staleRoot,'pending-old-'+index))
 const lock=join(stateDir,'pending');mkdirSync(lock);writeFileSync(join(lock,'request.json'),'{}')
 const acquired=acquirePendingLock(stateDir,{alive:()=>false,now:()=>Date.now()+3600000,keep:2})
 assert.equal(acquired.reclaimed,true)
 assert.equal(readdirSync(staleRoot).filter(name=>name.startsWith('pending-')).length,2)
})

test('worker 结束后释放 pending：登记的 worker.json 不会让锁目录残留', async t => {
 const { execFileSync } = await import('node:child_process')
 const { fileURLToPath } = await import('node:url')
 const stateDir=mkdtempSync(join(tmpdir(),'pb-release-'));t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
 const lock=join(stateDir,'pending');mkdirSync(lock)
 writeFileSync(join(lock,'request.json'),JSON.stringify({stateDir,pids:[]}))
 writeFileSync(join(lock,'worker.json'),JSON.stringify({pid:1234,startedAt:0}))
 const worker=fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern/lib/worker.mjs',import.meta.url))
 try { execFileSync(process.execPath,[worker,join(lock,'request.json')],{stdio:'ignore'}) } catch {}
 assert.equal(existsSync(lock),false)
})
