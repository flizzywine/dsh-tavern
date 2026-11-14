import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {execFileSync, spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {readUpdateDiagnostics} from '../bin/update-diagnostics.mjs'
import {updateApplication} from '../bin/application-update.mjs'
const source=await readFile(new URL('../install.sh',import.meta.url),'utf8')
test('独立安装的 Git 失败在回退前落盘，记录步骤、退出码和脱敏错误',{ skip: process.platform === 'win32' },async()=>{
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
  await writeFile(path.join(root,'install.ps1'),"[Console]::Write(@'\n"+text+"'@)\n")
  await assert.rejects(updateApplication({host:'cli',sourceRoot:root,dshHome:root,statusFile:path.join(root,'status.json'),keepCwd:true,delay:0,log(){}}), /未确认配置验证和安装完成/)
  const output=readUpdateDiagnostics(root).records.find(r=>r.event==='installer.output')
  assert.match(output.outputHead,/EARLY_GIT_ERROR/);assert.match(output.output,/FINAL_RESULT/)
  assert.ok(output.omittedCharacters>0);assert.doesNotMatch(JSON.stringify(output),/secret/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('终端更新失败时同时输出到终端和脱敏诊断日志', async t => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'cli-update-log-'))
 t.after(() => rm(root, { recursive: true, force: true }))
 await writeFile(path.join(root, 'install.sh'), "#!/bin/sh\necho 'fixture stdout'\necho 'dependencies.install: password=fixture-secret' >&2\nexit 23\n")
 await writeFile(path.join(root, 'install.ps1'), "[Console]::WriteLine('fixture stdout')\n[Console]::Error.WriteLine('dependencies.install: password=fixture-secret')\nexit 23\n")
 const updateModule = new URL('../bin/application-update.mjs', import.meta.url).href
 const runner = `
  import { updateApplication } from ${JSON.stringify(updateModule)}
  await updateApplication({ host: 'cli', sourceRoot: process.argv[1], dshHome: process.argv[1], log() {} })
 `
 const env = { ...process.env }
 delete env.DSH_TAVERN_UPDATE_LOG_ROOT
 const result = spawnSync(process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath, ['--input-type=module', '-e', runner, root], { env, encoding: 'utf8' })
 assert.ifError(result.error)
 assert.equal(result.status, 1, result.stderr)
 assert.match(result.stdout, /fixture stdout/)
 assert.match(result.stderr, /dependencies\.install: password=fixture-secret/)
 const { records } = readUpdateDiagnostics(path.join(root, 'profile-data', 'tavern', 'data'))
 const output = records.find(record => record.event === 'installer.output')
 assert.equal(output.exitCode, 23)
 assert.match(output.output, /fixture stdout/)
 assert.match(output.output, /dependencies\.install: password=\[redacted\]/)
 assert.doesNotMatch(JSON.stringify(records), /fixture-secret/)
})
test('PowerShell 引导日志使用同样的脱敏与持久格式',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ps-update-log-'))
 try{
  const ps=await readFile(new URL('../install.ps1',import.meta.url),'utf8')
  const logger=ps.match(/WriteAllText\(\$UpdateLogger, @'\r?\n([\s\S]*?)\r?\n'@/)[1]
  await writeFile(path.join(root,'logger.cjs'),logger);await writeFile(path.join(root,'error.txt'),'https://u:secret@example.com/repo?token=secret')
  execFileSync(process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath,[path.join(root,'logger.cjs'),root,'installer.stage.failed','git.fetch','128','-',path.join(root,'error.txt')])
  const [record]=readUpdateDiagnostics(root).records
  assert.equal(record.exitCode,128);assert.equal(record.step,'git.fetch');assert.doesNotMatch(record.output,/secret/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('独立安装清理临时目录时不会吞掉未定义变量的失败退出码', { skip: process.platform === 'win32' }, async () => {
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
