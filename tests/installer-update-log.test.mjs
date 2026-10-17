import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {execFileSync, spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {readUpdateDiagnostics} from '../bin/update-diagnostics.mjs'
import {updateApplication} from '../bin/application-update.mjs'
const source=await readFile(new URL('../install.sh',import.meta.url),'utf8')
test('独立安装的 Git 失败在回退前落盘，记录步骤、退出码和脱敏错误',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'installer-log-'))
 try{
  await mkdir(path.join(root,'bin'))
  await writeFile(path.join(root,'bin/git'),'#!/bin/sh\nprintf "fatal: https://user:secret@example.com/repo?token=secret password=secret\\n" >&2\nexit 42\n',{mode:0o755})
  const block=source.slice(source.indexOf('# Standalone bootstrap'),source.indexOf('echo "正在增量同步'))
  await writeFile(path.join(root,'probe.sh'),'set -eu\n'+block+'\nrun_git git.archive archive || true\n')
  execFileSync('sh',[path.join(root,'probe.sh')],{env:{...process.env,DSH_ROOT:root,TEMP_DIR:root,DSH_TAVERN_UPDATE_LOG_ROOT:path.join(root,'logs'),PATH:path.join(root,'bin')+':'+process.env.PATH},stdio:'pipe'})
  const logs=readUpdateDiagnostics(path.join(root,'logs')).records
  const failure=logs.find(r=>r.event==='installer.stage.failed')
  assert.equal(failure.step,'git.archive');assert.equal(failure.exitCode,42)
  assert.ok(failure.durationMs>=0);assert.match(failure.output,/fatal:/)
  assert.doesNotMatch(JSON.stringify(logs),/secret/)
  assert.ok(failure.at);assert.ok(failure.attemptId)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('安装长输出保留最早错误和末尾结果，先脱敏再截取',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'update-output-'))
 try{
  const text='EARLY_GIT_ERROR\n'+('noise\n'.repeat(3000))+'password='+('secret'.repeat(3000))+'\nFINAL_RESULT\n'
  await writeFile(path.join(root,'install.sh'),"#!/bin/sh\ncat <<'OUTPUT'\n"+text+'OUTPUT\n')
  await assert.rejects(updateApplication({host:'cli',sourceRoot:root,dshHome:root,statusFile:path.join(root,'status.json'),delay:0,log(){}}), /未确认配置验证和安装完成/)
  const output=readUpdateDiagnostics(root).records.find(r=>r.event==='installer.output')
  assert.match(output.outputHead,/EARLY_GIT_ERROR/);assert.match(output.output,/FINAL_RESULT/)
  assert.ok(output.omittedCharacters>0);assert.doesNotMatch(JSON.stringify(output),/secret/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('PowerShell 引导日志使用同样的脱敏与持久格式',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ps-update-log-'))
 try{
  const ps=await readFile(new URL('../install.ps1',import.meta.url),'utf8')
  const logger=ps.match(/WriteAllText\(\$UpdateLogger, @'\n([\s\S]*?)\n'@/)[1]
  await writeFile(path.join(root,'logger.cjs'),logger);await writeFile(path.join(root,'error.txt'),'https://u:secret@example.com/repo?token=secret')
  execFileSync(process.execPath,[path.join(root,'logger.cjs'),root,'installer.stage.failed','git.fetch','128','-',path.join(root,'error.txt')])
  const [record]=readUpdateDiagnostics(root).records
  assert.equal(record.exitCode,128);assert.equal(record.step,'git.fetch');assert.doesNotMatch(record.output,/secret/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('独立安装清理临时目录时不会吞掉未定义变量的失败退出码', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'installer-exit-'))
 try {
  const temporary = path.join(root, 'dsh-tavern-install.fixture')
  await mkdir(temporary)
  const cleanup = source.slice(source.indexOf('cleanup()'), source.indexOf('fail()'))
  const probe = path.join(root, 'probe.sh')
  await writeFile(probe, 'set -eu\n' + cleanup + '\nunset DSH_TEST_UNSET_VALUE\nfail_expansion() { echo "$DSH_TEST_UNSET_VALUE"; }\nif fail_expansion; then :; fi\n')
  const result = spawnSync('sh', [probe], { env: { ...process.env, TEMP_DIR: temporary, TMP_BASE: root }, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.notEqual(result.status, 0, result.stderr)
  assert.match(result.stderr, /DSH_TEST_UNSET_VALUE/)
  await assert.rejects(readFile(temporary), { code: 'ENOENT' })
 } finally { await rm(root, { recursive: true, force: true }) }
})

test('更新失败摘要取输出末尾的真实错误，跳过下载进度和 PowerShell 错误记录模板', async () => {
  const { installerFailureTail } = await import('../bin/application-update.mjs')
  const progress = Array.from({ length: 900 }, (_, i) => `DSH_STATUS 下载代码（cdn.jsdelivr.net）：${i}/949 文件，复用 ${i}，已下载 0.2 MB`).join('\n')
  const output = progress + '\nDone in 2.1s using pnpm v11.25.0\nDSH_STATUS 本地处理：正在切换到新版本，保留用户数据…\n' +
    "EBUSY: resource busy or locked, rename 'E:\\DSH\\apps\\dsh-tavern' -> 'E:\\DSH\\apps\\dsh-tavern.previous'\n安装未完成，正在恢复原版本……\n安装失败：切换新版本失败，已恢复原版本。\n" +
    '所在位置 C:\\Temp\\dsh-tavern-update.ps1:1185 字符:\n 3\n+   throw ("安装失败：" + $InstallFailure.Exception.Message)\n+   ~~~~~\n    + CategoryInfo          : OperationStopped: (x:String) [], RuntimeException\n    + FullyQualifiedErrorId : x\n'
  const tail = installerFailureTail(output)
  assert.match(tail, /EBUSY: resource busy or locked/)
  assert.doesNotMatch(tail, /DSH_STATUS|CategoryInfo|所在位置|~~~~/)
  assert.equal(tail.split('\n').at(-1), '安装失败：切换新版本失败，已恢复原版本。')
})
