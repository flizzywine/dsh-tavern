import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function compactionChecks({ page, step, savedChat, output, report, restartServer, installLegacyFixture, scenario }) {
  // Browser template bookkeeping may finish asynchronously; compare durable
  // business facts, not renderer cache metadata.
  const history = chat => chat.messages.map(({ role, turn, text, sourceText, swipes, swipeId, variables, mvu }) => ({ role, turn, text, sourceText, swipes, swipeId, variables, receipt: mvu?.receipt }))
  const initial = await savedChat(), sessionId = initial.sessionId
  let round = 1
  const requests = async () => (await readFile(join(output, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  async function until(read, check, label) {
    const end = Date.now() + 30000
    while (Date.now() < end) { const value = await read(); if (check(value)) return value; await delay(100) }
    throw Error('Timed out: ' + label)
  }
  const control = values => writeFile(join(output, 'model-control.json'), JSON.stringify({ foregroundPadding: 650, backgroundPadding: 0, ...values }))
  async function play() {
    round++
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill(`E2E_C_ROUND_${round} 继续领取任务奖励。`)
    await composer.press('Enter')
    await page.getByText(`压缩验收第 ${round} 轮，金币 ${round * 10}。`, { exact: false }).filter({ visible: true }).first().waitFor()
    await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: new RegExp(`^金币：${round * 10}$`) }).waitFor()
    const chat = await until(savedChat, chat => chat.messages.at(-1)?.mvu?.receipt?.status === 'updated' && chat.posture === '站在柜台前，收下奖励。', 'settlement')
    assert.equal(chat.id, initial.id); assert.equal(chat.sessionId, sessionId)
    assert.equal(chat.messages.filter(m => m.role === 'user').length, round)
    assert.equal(chat.messages.filter(m => m.role === 'assistant' && !m.greeting).length, round)
    assert.equal(chat.messages.at(-1).variables[0].stat_data.gold, round * 10)
    return chat
  }
  async function compact(status = 'completed') {
    const previous = (await savedChat()).contextCompaction?.operation?.id
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /压缩上下文|前台和后台已压缩|前台已压缩/ }).click()
    return (await until(savedChat, chat => chat.contextCompaction?.operation?.id !== previous && chat.contextCompaction?.operation?.status === status, `compaction ${status}`)).contextCompaction.operation
  }
  // Same messages as the provider sees them (ids and request-only metadata aside).
  const visible = message => JSON.stringify({ role: message.role, content: message.content })
  const sharedPrefix = (a, b) => { let n = 0; while (n < a.length && n < b.length && visible(a[n]) === visible(b[n])) n++; return n }
  if (scenario === 'manual') {
    await step('选用本局预设 A，积累三轮真实剧情，为摘要及保留轮次留出空间', async () => {
      await page.getByText('本局设置', { exact: true }).filter({ visible: true }).first().click()
      const selector = page.getByRole('combobox', { name: '本局预设', exact: true })
      await selector.selectOption('presets/E2E-A.json')
      await page.getByRole('complementary', { name: '本局设置', exact: true })
        .locator('.dsh-local-field').filter({ has: selector }).getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
      await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
      await play(); await play()
    })
    let previous = await savedChat()
    for (let cycle = 1; cycle <= 2; cycle++) {
      await step(`第 ${cycle} 次手动联合压缩，随后继续游玩`, async () => {
        const before = await savedChat(), count = (await requests()).length
        const operation = await compact()
        assert.equal(operation.foreground.status, 'succeeded'); assert.equal(operation.background.status, 'succeeded')
        assert.equal(operation.backgroundSessionId, before.timeline.participants.background.sessionId)
        assert.deepEqual(history(await savedChat()), history(before), '压缩不能改变历史正文和变量')
        const compactions = (await requests()).slice(count).filter(row => row.purpose === 'compaction')
        assert.deepEqual(compactions.map(row => row.side).sort(), ['background', 'foreground'])
        // Prefix cache: the preset front lives in the recorded system message, so the
        // summary request replays the foreground request's opening byte for byte.
        const summarizer = compactions.find(row => row.side === 'foreground')
        const lastForeground = (await requests()).slice(0, count).findLast(row => row.purpose === 'generation' && row.side === 'foreground')
        assert.match(visible(lastForeground.messages[0]), /E2E_PRESET_A_ACTIVE/, '预设前段必须在系统消息中')
        const shared = sharedPrefix(summarizer.messages, lastForeground.messages)
        assert.ok(shared >= 3, `压缩请求必须与前台请求共享开头（系统消息与早期历史），实际共享 ${shared} 条`)
        // The latest two rounds stay verbatim: the summarizer must not see them.
        assert.ok(!summarizer.rawRounds.includes(round) && !summarizer.rawRounds.includes(round - 1), '最近两轮不交给总结模型')
        report[`manual-${cycle}-cache`] = { sharedMessages: shared, summarizerMessages: summarizer.messages.length, foregroundMessages: lastForeground.messages.length }
        const kept = [round - 1, round]
        if (cycle === 2) for (const row of compactions.filter(item => item.side === 'foreground')) {
          assert.ok(row.summaryPresent, '第二次压缩必须包含上一次摘要')
          assert.ok(!row.rawRounds.includes(1), '第二次压缩不能复活首轮旧正文')
        }
        const nextStart = (await requests()).length
        previous = await play()
        const next = (await requests()).slice(nextStart).filter(row => row.purpose === 'generation')
        for (const side of ['foreground', 'background']) {
          const row = next.find(item => item.side === side)
          assert.ok(row, '继续游玩必须调用 ' + side)
          // Settlement intentionally rewinds its previous task (rewindTo: -1)
          // and receives the current authoritative state, not past summaries.
          if (side === 'foreground') {
            assert.ok(row.summaryPresent, '前台下一轮必须携带摘要')
            assert.ok(kept.every(n => row.rawRounds.includes(n)), '最近两轮原文必须原样保留在上下文中')
          }
          assert.ok(!row.rawRounds.includes(1), '压缩后的请求不得重新包含首轮旧正文')
        }
        report[`manual-${cycle}`] = operation
        previous = await play()
      })
    }
    await step('后台总结失败：前台成功保留，重试只处理后台', async () => {
      await control({ failSide: 'background' })
      const failed = await compact('partial')
      assert.equal(failed.foreground.status, 'succeeded'); assert.equal(failed.background.status, 'failed')
      assert.deepEqual(history(await savedChat()), history(previous))
      await page.reload()
      await page.getByText(/上下文压缩未全部完成/).filter({ visible: true }).first().waitFor()
      await page.locator('.dsh-tavern-dock-actions [role="status"]').filter({ hasText: /上下文压缩未全部完成/ }).waitFor()
      await page.getByRole('button', { name: '关闭压缩提示' }).click()
      await page.locator('.dsh-tavern-dock-actions [role="status"]').filter({ hasText: /上下文压缩未全部完成/ }).waitFor({ state: 'detached' })
      assert.equal((await savedChat()).contextCompaction.warning, '', '关闭提示只清提示，不清失败记录')
      assert.equal((await savedChat()).contextCompaction.operation.status, 'partial')
      const start = (await requests()).length
      await control({})
      const recovered = await compact()
      assert.equal(recovered.foreground.after, failed.foreground.after, '成功侧不应重复压缩')
      assert.deepEqual((await requests()).slice(start).filter(row => row.purpose === 'compaction').map(row => row.side), ['background'])
      await play()
      report.partialRecovery = { failed, recovered }
    })
    await step('联合压缩期间提交下一轮，任务不丢失且不重复结算', async () => {
      await control({ delayMs: 1800 })
      const requestCount = (await requests()).length
      const pending = compact()
      // Attach rejection immediately while the UI submits another action.
      const completion = pending.then(value => ({ value }), error => ({ error }))
      // 'running' is persisted before native dispatch. Wait for the actual
      // summarizer request, so this tests an in-flight compaction rather than
      // a new message winning the pre-dispatch idle check.
      await until(requests, rows => rows.slice(requestCount).some(row => row.purpose === 'compaction' && row.side === 'foreground'), 'summarizer in progress')
      await play()
      const result = await completion
      if (result.error) throw result.error
      assert.equal(result.value.status, 'completed')
      await control({})
      report.queuedDuringCompaction = result.value
    })
  } else if (scenario === 'legacy') {
    await step('关闭宿主，放入已编辑且压缩的 v0 旧档，再通过启动迁移打开', async () => {
      const before = await savedChat()
      await installLegacyFixture()
      assert.deepEqual(history(await savedChat()), history(before))
    })
    await step('迁移后继续游玩，确认实际模型只读摘要、不复活已压缩原文', async () => {
      const start = (await requests()).length
      await play()
      const next = (await requests()).slice(start).find(row => row.purpose === 'generation' && row.side === 'foreground')
      assert.ok(next?.summaryPresent, '迁移后的真实请求必须携带旧摘要')
      assert.ok(!JSON.stringify(next.messages).includes('OLD_STORY_SHOULD_STAY_ARCHIVED'))
      report.legacyRecovery = { summaryPresent: next.summaryPresent, archivedTextInRequest: false }
    })
  } else if (scenario === 'provider-overflow') {
    await step('在较大窗口真实游玩三轮，渠道实际上限降到 32K', async () => {
      await play(); await play()
      await control({ window: 262144, providerLimit: 32768, overflowText: 'zhipu' })
    })
    await step('渠道以智谱 1261 报超窗口时，自动压缩后重试并完成本轮', async () => {
      const start = (await requests()).length
      await play()
      const rows = (await requests()).slice(start)
      assert.ok(rows.some(row => row.outcome === 'overflow' && row.side === 'foreground'), '必须先遇到一次超窗口')
      assert.ok(rows.some(row => row.purpose === 'compaction' && row.side === 'foreground' && row.outcome === 'success'), '超窗口后必须压缩')
      const resumed = rows.findLast(row => row.purpose === 'generation' && row.side === 'foreground')
      assert.equal(resumed.outcome, 'success'); assert.ok(resumed.summaryPresent)
      await control({ window: 32768 })
      report.providerOverflow = rows.map(({ messages, ...row }) => row)
    })
  } else if (scenario === 'overflow') {
    await step('在较大窗口真实游玩三轮，再切换到 32K 窗口', async () => {
      await play(); await play()
      await control({ window: 32768 })
    })
    await step('从游玩菜单恢复超窗口历史，核对分段预算及原始剧情', async () => {
      const before = await savedChat(), start = (await requests()).length
      const operation = await compact()
      assert.equal(operation.foreground.status, 'succeeded')
      assert.equal(operation.background.status, 'succeeded')
      assert.deepEqual(history(await savedChat()), history(before))
      const chunks = (await requests()).slice(start).filter(row => row.purpose === 'compaction' && row.side === 'foreground')
      assert.ok(chunks.length > 1, '必须分段调用，不能只更改成功提示')
      assert.ok(chunks.every(row => row.inputTokens + row.outputReserve <= 32768))
      const nextStart = (await requests()).length
      await play()
      const resumed = (await requests()).slice(nextStart).find(row => row.purpose === 'generation' && row.side === 'foreground')
      assert.ok(resumed?.summaryPresent)
      assert.ok(!resumed.rawRounds.includes(1))
      report.overflowRecovery = { operation, chunks: chunks.map(({ messages, ...row }) => row) }
    })
  } else {
    await step(`${scenario} 自动压缩，确认前后台仍能完成当前轮`, async () => {
      // The background scenario sits just under the window: its step size leaves room for the
      // fixed background tool list (which grew with the dialogue annotation tool, 8e88b4fc).
      await control({ foregroundPadding: scenario === 'background' ? 0 : 1700, backgroundPadding: ['foreground', 'rounds'].includes(scenario) ? 0 : scenario === 'background' ? 3900 : 4000 })
      const start = (await requests()).length
      for (let n = 0; n < 6; n++) {
        await play()
        if ((await requests()).slice(start).some(row => row.purpose === 'compaction')) break
      }
      const compacted = (await requests()).slice(start).filter(row => row.purpose === 'compaction')
      assert.ok(compacted.length, '达到阈值必须真正调用总结模型')
      if (scenario === 'background') {
        assert.ok(compacted.some(row => row.side === 'background'), '后台容量保护必须触发')
        assert.ok(!compacted.some(row => row.side === 'foreground'), '仅后台压力不应压缩前台')
      }
      if (scenario === 'foreground') assert.equal(compacted[0].side, 'foreground')
      if (scenario === 'rounds') {
        const chat = await until(savedChat, chat => chat.contextCompaction?.operation?.status === 'completed', 'round policy completion')
        assert.equal(chat.contextCompaction.operation.reason, 'rounds')
        assert.equal(chat.contextCompaction.operation.foreground.status, 'succeeded')
        assert.equal(chat.contextCompaction.operation.background.status, 'succeeded')
      }
      await play()
      // Foreground compaction runs at the next idle point once retention leaves history to summarize.
      if (scenario === 'both') await until(requests, rows => ['background', 'foreground'].every(side => rows.slice(start).some(row => row.purpose === 'compaction' && row.side === side)), 'both sides compacted')
      if (['foreground', 'both'].includes(scenario)) {
        const chat = await until(savedChat, chat => chat.contextCompaction?.operation?.status === 'completed', 'percent policy completion')
        assert.equal(chat.contextCompaction.operation.reason, 'percent')
        assert.equal(chat.contextCompaction.operation.foreground.status, 'succeeded')
        assert.equal(chat.contextCompaction.operation.background.status, 'succeeded')
        report.autoOperation = chat.contextCompaction.operation
      }
      report.automatic = compacted.map(({ messages, ...row }) => row)
    })
  }
  await step('重启真实宿主后检查剧情、金币和会话绑定', async () => {
    const before = await savedChat()
    await restartServer()
    await page.getByText(`压缩验收第 ${round} 轮，金币 ${round * 10}。`, { exact: false }).filter({ visible: true }).first().waitFor()
    await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: new RegExp(`^金币：${round * 10}$`) }).waitFor()
    const after = await savedChat()
    assert.deepEqual(history(after), history(before))
    assert.equal(after.timeline.participants.background.sessionId, before.timeline.participants.background.sessionId)
    const start = (await requests()).length
    await play()
    const resumed = (await requests()).slice(start).filter(row => row.purpose === 'generation')
    if (['manual', 'overflow', 'provider-overflow', 'legacy'].includes(scenario)) {
      const foreground = resumed.find(row => row.side === 'foreground')
      assert.ok(foreground?.summaryPresent, '重启后下一轮请求仍须携带摘要')
      assert.ok(!foreground.rawRounds.includes(1), '重启后不能复活已总结的首轮正文')
    }
    assert.equal((await savedChat()).timeline.participants.background.sessionId, before.timeline.participants.background.sessionId, '重启后继续使用原后台绑定')
    await page.screenshot({ path: join(output, 'compaction-after-reload.png'), fullPage: true })
    report.compaction = { scenario, window: 32768, rounds: round, foregroundSessionId: sessionId, backgroundSessionId: after.timeline.participants.background.sessionId }
  })
  const all = await requests()
  if (scenario !== 'provider-overflow') assert.ok(all.every(row => row.outcome !== 'overflow'), '正常验收不得发送超窗口请求')
  report.requestSummary = all.map(({ messages, ...row }) => row)
}
