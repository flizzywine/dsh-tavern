import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('production plugin initializes a fresh profile and serves stage and managed mod RPCs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-startup-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/plugin-startup.mjs', import.meta.url))], {
      env: { ...process.env, DSH_HOME: root },
      encoding: 'utf8', timeout: 60000
    })
    assert.equal(result.error, undefined, result.stderr + result.stdout)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /plugin apply completed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('production core starts without the stage runtime and imports ordinary cards',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tavern-no-stage-'))
  try {
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/plugin-without-stage.mjs',import.meta.url))],{
      env:{...process.env,DSH_HOME:root},encoding:'utf8',timeout:60000})
    assert.equal(result.error,undefined,result.stderr+result.stdout)
    assert.equal(result.status,0,result.stderr+result.stdout)
    assert.match(result.stdout,/core without stage completed/)
  } finally {await rm(root,{recursive:true,force:true})}
})


test('core initializes and imports cards when resolving the stage package is forbidden', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-stage-absent-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/stage-unavailable.mjs', import.meta.url))], {
      env:{...process.env, DSH_HOME:root}, encoding:'utf8', timeout:60000
    })
    assert.equal(result.error, undefined, result.stderr + result.stdout)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /core without stage completed/)
  } finally {await rm(root, {recursive:true, force:true})}
})
