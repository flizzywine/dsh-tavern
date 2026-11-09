import assert from 'node:assert/strict'
import test from 'node:test'
import { startupTimeoutMs, waitForServiceStartup } from '../bin/service-startup.mjs'

test('冷启动超时配置按秒解析', async () => {
  assert.equal(startupTimeoutMs('cli', undefined),120000)
  assert.equal(startupTimeoutMs('cli','180'),180000)
  for (const value of ['0','-1','oops','Infinity']) assert.throws(()=>startupTimeoutMs('cli',value))
  let now=0, stopped=false
  await waitForServiceStartup({timeoutMs:startupTimeoutMs('cli'), now:()=>now, sleep:async ms=>{now+=ms}, alive:()=>true, ready:async()=>now>=32000, stop:async()=>{stopped=true}})
  assert.equal(now,32000);assert.equal(stopped,false)
})

test('超时清理真实子进程后才返回失败', async () => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const { stopStartupChild } = await import('../bin/service-startup.mjs')
  const child = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
  await once(child,'spawn')
  try {
    await assert.rejects(waitForServiceStartup({timeoutMs:30,alive:()=>child.exitCode===null && child.signalCode===null,ready:async()=>false,stop:()=>stopStartupChild(child)}),/启动超时/)
    assert.ok(child.exitCode!==null || child.signalCode!==null)
  } finally { if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL') }
})
