import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageSwitch} from '../tavern-plugin/lib/stage-switch.js'
import {createOptionalStage} from '../tavern-plugin/lib/optional-stage.js'

test('安装舞台只注册加载器，首次使用时合并并发加载', async () => {
  let starts = 0
  const runtime = await createOptionalStage({}, {enabled:false})
  runtime.requests({}, {})
  const control = createStageSwitch(runtime)
  assert.deepEqual(control.read(), {status:'disabled',installed:false})
  await control.install(async () => {
    starts++
    return {createStageRuntime:() => ({requests(){},dispose(){}})}
  })
  assert.deepEqual(control.read(), {status:'disabled',installed:true})
  assert.equal(starts, 0)
  const results = await Promise.all([control.ensure(), control.ensure()])
  assert.deepEqual(results.map(result => result.status), ['ready','ready'])
  assert.equal(starts, 1)
  await control.disable()
  assert.equal((await control.ensure()).status, 'disabled')
  await control.enable()
  assert.equal(control.read().status, 'ready')
  await control.uninstall()
  assert.deepEqual(control.read(), {status:'disabled',installed:false})
})

test('先打开舞台卡时，安装完成后补上已请求的舞台加载', async () => {
  let state = 'disabled'
  const control = createStageSwitch({status:() => state,enable:async () => {state = 'ready'}})
  assert.deepEqual(await control.ensure(), {status:'disabled',installed:false})
  await control.install(async () => {})
  assert.equal(control.read().status, 'ready')
})
