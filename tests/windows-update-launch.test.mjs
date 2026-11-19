import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { quoteWindowsArgument } from '../bin/windows-update-launch.mjs'

test('Windows updater survives a restrictive kill-on-close Job with Unicode arguments and environment', {skip:process.platform !== 'win32'}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), '更新 job '))
  // The probe runs with cwd=root and exits just after writing its result; until it
  // exits Windows refuses to remove the directory (EBUSY), so let rm retry briefly.
  t.after(() => rm(root, {recursive:true, force:true, maxRetries:20, retryDelay:100}))
  const probe = path.join(root, 'probe.cjs')
  const parentDone = path.join(root, 'parent.json')
  const resultFile = path.join(root, 'result.json')
  const gate = path.join(root, 'gate')
  await writeFile(probe, `const fs=require('node:fs');
const deadline=Date.now()+15000;
const timer=setInterval(()=>{
 if(Date.now()>deadline){clearInterval(timer);process.exitCode=1;return}
 if(!fs.existsSync(process.env.TAVERN_TEST_GATE))return;
 clearInterval(timer);
 fs.writeFileSync(process.env.TAVERN_TEST_RESULT,JSON.stringify({args:process.argv.slice(2),home:process.env.DSH_HOME,sentinel:process.env.TAVERN_TEST_VALUE,cwd:process.cwd()}));
},50);`)
  const jobSource = await readFile(new URL('./fixtures/windows-update-job.cs', import.meta.url), 'utf8')
  const helper = fileURLToPath(new URL('../bin/dsh-tavern-update-helper.mjs', import.meta.url))
  const args = ['中文 空格', 'quote"and\\', '']
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${jobSource}
'@
[UpdateTestJob]::Enter()
$Start = New-Object Diagnostics.ProcessStartInfo
$Start.FileName = ${psQuote(process.execPath)}
$Start.Arguments = ${psQuote([helper, process.execPath, probe, ...args].map(quoteWindowsArgument).join(' '))}
$Start.UseShellExecute = $false
$Start.CreateNoWindow = $true
$Start.RedirectStandardError = $true
$Child = [Diagnostics.Process]::Start($Start)
$Failure = $Child.StandardError.ReadToEnd()
$Child.WaitForExit()
if ($Child.ExitCode -ne 0) { throw ('Updater helper failed inside Job: ' + $Failure) }
[IO.File]::WriteAllText(${psQuote(parentDone)}, 'done')
# Exiting closes the only Job handle and kills any remaining members.
`
  const scriptFile = path.join(root, 'job.ps1')
  await writeFile(scriptFile, '\ufeff' + script)
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  await promisify(execFile)(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
    cwd:root, timeout:30000, windowsHide:true,
    env:{...process.env, DSH_HOME:root, TAVERN_TEST_GATE:gate, TAVERN_TEST_RESULT:resultFile, TAVERN_TEST_VALUE:'中文 sentinel'},
  })
  assert.equal(await readFile(parentDone, 'utf8'), 'done')
  await writeFile(gate, 'parent has exited')
  let result
  for(let attempt=0; attempt<100; attempt++) {
    try { result=JSON.parse(await readFile(resultFile, 'utf8')); break } catch { await delay(50) }
  }
  // Windows may report the same directory by its 8.3 short name or its long name.
  assert.deepEqual({...result, cwd:realpathSync.native(result.cwd)}, {args, home:root, sentinel:'中文 sentinel', cwd:realpathSync.native(root)})
})
