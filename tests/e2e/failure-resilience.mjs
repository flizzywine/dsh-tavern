import assert from 'node:assert/strict'
import { cp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

// The save must survive every way a turn can go wrong (Wiki「设计：native-session-repair」).
// After each failure the player must still be able to continue, roll back,
// regenerate, and the model must read exactly what the save says.
export async function failureResilienceChecks({ page, step, savedChat, output, report, root, restartServer }) {
  const composer = () => page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  // Settlement runs in the background; wait on the save, not on a panel that may be closed.
  const settled = async () => {
    for (let i = 0; i < 120; i++) {
      const chat = await savedChat()
      if (!['pending', 'running'].includes(chat.settleStatus) && !chat.regenInProgress) return
      await pause(500)
    }
  }
  const rounds = async () => (await savedChat()).messages.filter(row => row.role === 'assistant' && !row.greeting)
  const rpcErrors = []
  page.on('response', async response => {
    if (!response.url().includes('/api/dsh-tavern/')) return
    try { const body = await response.json(); if (body && body.ok === false) rpcErrors.push(new URL(response.url()).pathname.split('/').pop() + ': ' + String(body.error || '').slice(0, 200)) } catch {}
  })
  const results = []
  report.failureResilience = results

  async function waitRounds(count, seconds = 60) {
    for (let i = 0; i < seconds * 2 && (await rounds()).length !== count; i++) await pause(500)
    return (await rounds()).length
  }
  async function send(text) {
    const before = (await rounds()).length
    await composer().fill(text); await composer().press('Enter')
    assert.equal(await waitRounds(before + 1), before + 1, '发送“' + text + '”应新增一轮')
    await settled()
  }
  async function stopGeneration() {
    const stop = page.locator('button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="Interrupt" i], button[aria-label*="中断"], button[title*="停止"]').filter({ visible: true }).last()
    if (await stop.count()) { await stop.click(); return true }
    return false
  }
  async function menu(name) {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    const item = page.getByRole('menuitem', { name })
    await item.waitFor({ timeout: 10000 })
    assert.equal(await item.isDisabled(), false, name + ' 不应被禁用')
    await item.click()
  }
  // Finished, not stuck; whether the text changed depends on the fixed model output.
  async function regenerate(guidance) {
    const last = (await rounds()).at(-1)?.text
    // The panel can re-render while a view refresh lands; reopen it rather than fail on a detached node.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
        await page.getByPlaceholder('指导意见（可选）').fill(guidance, { timeout: 5000 })
        await page.getByRole('button', { name: '生成并替换正文', exact: true }).click({ timeout: 5000 })
        break
      } catch (error) { if (attempt >= 2) throw error; await pause(1000) }
    }
    for (let i = 0; i < 120; i++) {
      await pause(500)
      const chat = await savedChat()
      if (!chat.regenInProgress && i > 4) return chat.messages.findLast(row => row.role === 'assistant')?.text !== last ? 'replaced' : 'unchanged'
    }
    return 'stuck'
  }
  async function alignment() {
    const chat = await savedChat()
    return (await page.evaluate(async sessionId => (await fetch('/api/dsh-tavern/storyAlignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json(), chat.sessionId)).alignment
  }
  async function lastRequest() {
    const lines = (await readFile(join(output, 'context-requests.jsonl'), 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1)).messages.map(message => message.text).join('\n')
  }

  // After a failure: continue, roll that round back, regenerate the last round, continue again.
  // Every step must work and the save must agree with what the model reads.
  async function survive(name, inflict, { forbidden = [] } = {}) {
    await step('故障后存档仍可用：' + name, async () => {
      const entry = { name }
      const errorStart = rpcErrors.length
      entry.inflicted = (await inflict()) || ''
      const expected = rpcErrors.slice(errorStart)
      entry.expectedErrors = expected
      const base = (await rounds()).length
      await send('故障后继续 ' + results.length)
      const request = await lastRequest()
      entry.leaked = forbidden.filter(text => request.includes(text))
      assert.deepEqual(entry.leaked, [], '下一轮请求不应再带上故障残留')
      await menu(/回退第.*轮|回退本轮/)
      assert.equal(await waitRounds(base), base, '回退应去掉刚才那一轮')
      await settled()
      if (base > 0) {
        const errors = rpcErrors.length
        entry.regenerated = await regenerate('故障后重写')
        assert.notEqual(entry.regenerated, 'stuck', '故障后重新生成应完成')
        assert.deepEqual(rpcErrors.slice(errors), [], '故障后重新生成不应报错')
        await settled()
      }
      await send('故障后再继续 ' + results.length)
      entry.alignment = await alignment()
      assert.ok(entry.alignment?.aligned, '存档与模型上下文应一致：' + JSON.stringify(entry.alignment))
      entry.errors = rpcErrors.slice(errorStart + expected.length)
      assert.deepEqual(entry.errors, [], '故障之后的操作不应报错')
      results.push(entry)
      console.log('   ' + JSON.stringify(entry))
    })
  }

  await step('正常玩一轮', async () => { await send('领取任务奖励') })

  await survive('正文因长度上限截断', async () => {
    const before = (await rounds()).length
    await composer().fill('E2E_TRUNCATE_TEXT 继续'); await composer().press('Enter')
    await waitRounds(before + 1, 20); await settled()
  })

  await survive('内容被服务商拦截（一个字都没写）', async () => {
    await composer().fill('E2E_CONTENT_FILTER 继续'); await composer().press('Enter')
    await pause(6000)
  }, { forbidden: ['E2E_CONTENT_FILTER'] })

  await survive('正文写到一半被拦截掐断', async () => {
    await composer().fill('E2E_FILTER_MIDSTREAM 继续'); await composer().press('Enter')
    await pause(8000)
  }, { forbidden: ['E2E_FILTER_MIDSTREAM', '你推开酒馆的门，她抬起头，'] })

  await survive('正文生成中手动停止', async () => {
    await composer().fill('E2E_SLOW 继续'); await composer().press('Enter')
    await pause(3000)
    const stopped = await stopGeneration()
    await pause(4000)
    return stopped ? 'stopped' : 'stop button not found'
  }, { forbidden: ['E2E_SLOW'] })

  await survive('正文生成中服务崩溃重启', async () => {
    await composer().fill('E2E_SLOW 崩溃'); await composer().press('Enter')
    await pause(3000)
    await restartServer()
    await pause(3000)
  }, { forbidden: ['E2E_SLOW 崩溃'] })

  await survive('重新生成被拦截', async () => {
    const before = (await rounds()).map(row => row.text)
    const result = await regenerate('E2E_CONTENT_FILTER')
    await pause(2000)
    const after = (await rounds()).map(row => row.text)
    assert.deepEqual(after, before, '重新生成失败应保留原正文：' + result)
    return result
  })

  let rolledBackText = ''
  await survive('回退只写进了存档，模型上下文没跟上（中途崩溃）', async () => {
    const sessions = join(root, 'profile-data/tavern/sessions'), backup = join(output, 'sessions-before-rollback')
    await send('即将被回退的一轮')
    rolledBackText = (await rounds()).at(-1).text
    // The model context as it was before the rollback, saved while nothing writes.
    await restartServer(async () => { await rm(backup, { recursive: true, force: true }); await cp(sessions, backup, { recursive: true }) })
    const before = (await rounds()).length
    await menu(/回退第.*轮|回退本轮/)
    assert.equal(await waitRounds(before - 1), before - 1)
    await settled()
    // Crash after the save committed: the native session never saw the rollback.
    await restartServer(async () => { await rm(sessions, { recursive: true, force: true }); await cp(backup, sessions, { recursive: true }) })
    return 'native restored to before the rollback'
  }, { forbidden: ['即将被回退的一轮'] })

  await survive('模型拒答（正文是拒绝语）', async () => {
    await send('E2E_REFUSE_TEXT 继续')
  })

  report.failureResilience = results
  assert.ok(rolledBackText, '回退故障用例应已执行')
}
