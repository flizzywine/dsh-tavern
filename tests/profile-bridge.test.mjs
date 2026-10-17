import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, existsSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { switchProfile, waitForExit } from '../tavern-plugin/packages/dsh-profile-bridge/lib/helper.mjs'
function fixture(t) {
 const root = mkdtempSync(join(tmpdir(), 'tavern-profile-bridge-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 for(const name of ['desktop','tavern','other']) {mkdirSync(join(root,name));writeFileSync(join(root,name,'package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base']}}}));writeFileSync(join(root,name,'cordis.patch.yml'),'[]\n')}
 return {profilesRoot:root,liveDir:join(root,'desktop'),targetDir:join(root,'tavern'),stamp:'1'}
}
test('目录切换、改选与还原保留目标配置字节及原版目录',t=>{
 const r=fixture(t);const original=readFileSync(join(r.targetDir,'cordis.patch.yml'))
 switchProfile({...r,mode:'link'});assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))
 assert.deepEqual(readFileSync(join(r.targetDir,'cordis.patch.yml')),original)
 switchProfile({...r,mode:'link',targetDir:join(r.profilesRoot,'other'),stamp:'2'})
 switchProfile({...r,mode:'unlink',stamp:'3'});assert.equal(realpathSync(r.liveDir),join(realpathSync(r.profilesRoot),'desktop'))
})
test('缺少备份时保留原链接',t=>{const r=fixture(t);rmSync(r.liveDir,{recursive:true});symlinkSync(r.targetDir,r.liveDir);assert.throws(()=>switchProfile({...r,mode:'unlink'}),/备份/);assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))})
test('发布失败恢复原目录或原链接',t=>{const r=fixture(t);const rename=(a,b)=>{if(a.includes('switch-stage'))throw Error('模拟发布失败');renameSync(a,b)};assert.throws(()=>switchProfile({...r,mode:'link'},{rename}),/发布失败/);assert.equal(realpathSync(r.liveDir),join(realpathSync(r.profilesRoot),'desktop'));switchProfile({...r,mode:'link'});assert.throws(()=>switchProfile({...r,mode:'link',targetDir:join(r.profilesRoot,'other'),stamp:'2'},{rename}),/发布失败/);assert.equal(realpathSync(r.liveDir),realpathSync(r.targetDir))})
test('目标配置无效时不改入口；不允许越出 profiles 目录',t=>{const r=fixture(t);writeFileSync(join(r.targetDir,'package.json'),'{}');assert.throws(()=>switchProfile({...r,mode:'link'}),/bundle/);assert.throws(()=>switchProfile({...r,mode:'link',targetDir:tmpdir()}),/独立 profile/);assert.ok(existsSync(join(r.liveDir,'package.json')))})
test('仍有进程时超时退出，不发送结束进程信号',async()=>{await assert.rejects(waitForExit([22],{timeout:0,alive:()=>true}),/超时/);await waitForExit([22],{alive:()=>false})})


test('桥接安装更新始终写 tavern，不取决于 desktop 当前是否是链接', async t => {
 const { installedProfile } = await import('../bin/launcher-environment.mjs')
 const r=fixture(t);const home=join(r.profilesRoot,'home');mkdirSync(join(home,'profiles/tavern'),{recursive:true})
 assert.equal(installedProfile('desktop',home),'tavern')
 writeFileSync(join(home,'profiles/tavern/package.json'),JSON.stringify({dshTavern:{profileBridge:true}}))
 assert.equal(installedProfile('desktop',home),'tavern')
 assert.equal(installedProfile('cli',home),'tavern')
})
