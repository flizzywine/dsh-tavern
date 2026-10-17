import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNativeSessionLog } from './native-session-log.mjs'
import { Session } from '../fixtures/dsh-session-host.mjs'

export async function surfaceRecoveryChecks({ page, step, savedChat, output, report, root, restartServer }) {
  const prose = chat => chat.messages.map(message => ({ role: message.role, text: message.sourceText ?? message.text }))
  const baseline = prose(await savedChat())
  const control = value => writeFile(join(output, 'recovery-control.json'), JSON.stringify(value))
  const composer = page.getByRole('textbox', { name: /发消息|Message/ })
  const visible = text => page.getByText(text, { exact: true }).filter({ visible: true }).first()
  async function closeStatus() {
    const collapse = page.getByRole('button', { name: 'Collapse right sidebar', exact: true })
    if (await collapse.isVisible()) await collapse.tap()
  }
  const more = async () => { await closeStatus(); await page.getByRole('button', { name: '更多 ▾', exact: true }).tap() }
  async function send(text) { await closeStatus(); await composer.fill(text); await composer.press('Enter') }
  async function native() {
    const chat = await savedChat()
    const directory = join(root, 'profile-data/tavern/sessions')
    for (const file of await readdir(directory, { recursive: true })) {
      if (!file.endsWith('session.v3.jsonl.zstd')) continue
      const parsed = parseNativeSessionLog(await readFile(join(directory, file)))
      if (parsed.header.id === chat.sessionId) return { ...parsed, session: Session.create(chat.sessionId, parsed.events, parsed.header) }
    }
    throw Error('本次游玩原生会话尚未落盘')
  }
  async function poll(check) {
    let error
    for (let i = 0; i < 200; i++) {
      try { return await check() } catch (failure) { error = failure }
      await page.waitForTimeout(100)
    }
    throw error
  }
  async function completed(text, rounds) {
    await visible(text).waitFor()
    await page.getByRole('button', { name: '重新生成正文', exact: true }).waitFor()
    await poll(async () => {
      const chat = await savedChat()
      const replies = chat.messages.filter(message => message.role === 'assistant' && !message.greeting)
      assert.equal(replies.length, rounds)
      assert.ok((replies.at(-1).sourceText ?? replies.at(-1).text).includes(text))
      // This scenario repeatedly keeps gold at 10; a settled no-op is valid.
      assert.ok(['updated', 'unchanged'].includes(replies.at(-1).mvu?.receipt?.status))
      assert.equal(replies.at(-1).variables[replies.at(-1).swipeId || 0].stat_data.gold, 10)
    })
  }
  async function failed(label) {
    await control({ mode: 'reasoning-only', label })
    await send(label)
    await page.getByRole('button', { name: '重新生成本轮', exact: true }).first().waitFor()
    const evidence = await poll(async () => {
      const state = await native()
      const error = state.events.findLast(event => event.type === 'turn/end')
      assert.equal(error.data.reason.kind, 'error')
      assert.match(JSON.stringify(error.data.reason), /只返回了思考过程/)
      return state
    })
    report[label] = { failedTurn: evidence.events.findLast(event => event.type === 'turn/end').data.turn }
    return evidence
  }

  await step('移动窄屏：首轮纯思考失败，同时覆盖历史系统槽位更新', async () => {
    await closeStatus()
    await page.setViewportSize({ width: 430, height: 932 })
    // Narrowing a desktop window turns the open left sidebar into a drawer over the story;
    // a player closes it before using the story (the right panel no longer closes it, #213).
    const drawer = page.locator('[data-mobile-nav="backdrop"]')
    if (await drawer.isVisible().catch(() => false)) await drawer.evaluate(element => element.click())
    const evidence = await failed('E2E 首轮失败')
    assert.deepEqual(prose(await savedChat()), baseline, '失败不能提交正文')
    assert.ok(evidence.events.some(event => event.type === 'system/message' && event.surfaceOp?.op === 'replace'), '必须覆盖历史系统提示词更新')
    await page.screenshot({ path: join(output, 'recovery-failed.png'), fullPage: true })
  })
  await step('清除未完成回复后继续聊天，历史开场白保留', async () => {
    await more()
    await page.getByRole('menuitem', { name: '清除未完成回复', exact: true }).tap()
    await poll(async () => assert.ok((await native()).events.some(event => event.data?.source?.plugin === 'dsh-tavern-failed-turn-cleanup'), '点击后真实清理流程应写入持久标记'))
    assert.deepEqual(prose(await savedChat()), baseline)
    await control({ mode: 'success', reply: '恢复后第一轮正文。' })
    await send('E2E 清理后继续')
    await completed('恢复后第一轮正文。', 1)
    await page.reload()
    await visible('恢复后第一轮正文。').waitFor()
    await page.screenshot({ path: join(output, 'recovery-continued.png'), fullPage: true })
  })
  await step('第二次失败原样重试，重启服务后正文与消息面一致', async () => {
    const before = prose(await savedChat())
    await failed('E2E 原样重试输入')
    assert.deepEqual(prose(await savedChat()), before)
    await control({ mode: 'success', reply: '重试后第二轮正文。' })
    await page.getByRole('button', { name: '重新生成本轮', exact: true }).first().tap()
    await completed('重试后第二轮正文。', 2)
    const chat = await savedChat()
    assert.equal(chat.messages.filter(message => message.role === 'user').at(-1).text, 'E2E 原样重试输入')
    // Restart gets a new origin and must reselect the saved game from the
    // desktop history navigator; recovery interactions remain touch/narrow.
    await page.setViewportSize({ width: 1440, height: 1000 })
    await restartServer()
    await page.setViewportSize({ width: 430, height: 932 })
    await closeStatus()
    await visible('重试后第二轮正文。').waitFor()
    assert.deepEqual(prose(await savedChat()), prose(chat))
    const state = await native()
    const modelView = JSON.stringify(state.session.deriveMessages())
    assert.ok(modelView.includes('恢复后第一轮正文。') && modelView.includes('重试后第二轮正文。'))
    assert.ok(!modelView.includes('E2E 模型故障：仅返回思考'))
    await page.screenshot({ path: join(output, 'recovery-restarted.png'), fullPage: true })
  })
  await step('重新生成失败保留旧正文，再成功替换且不增加剧情轮次', async () => {
    const before = prose(await savedChat())
    await control({ mode: 'reasoning-only', label: 'E2E 重生成失败' })
    await closeStatus()
    await page.getByRole('button', { name: '重新生成正文', exact: true }).tap()
    await page.getByPlaceholder('指导意见（可选）').fill('E2E 重生成失败')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).tap()
    await poll(async () => {
      const chat = await savedChat()
      assert.ok(!chat.regenInProgress)
      assert.deepEqual(prose(chat), before)
      const state = await native()
      assert.equal(state.events.findLast(event => event.type === 'turn/end').data.reason.kind, 'error')
    })
    await control({ mode: 'success', reply: '重新生成后的第二轮正文。' })
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).tap()
    await completed('重新生成后的第二轮正文。', 2)
    assert.equal(await visible('重试后第二轮正文。').count(), 0)
  })
  await step('回退、刷新、撤销回退保留正确历史与正文', async () => {
    await more()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).tap()
    await poll(async () => assert.equal((await savedChat()).messages.filter(message => message.role === 'user').length, 1))
    await page.reload()
    await visible('恢复后第一轮正文。').waitFor()
    assert.equal(await visible('重新生成后的第二轮正文。').count(), 0)
    await more()
    await page.getByRole('menuitem', { name: /撤销回退（恢复第/ }).tap()
    await completed('重新生成后的第二轮正文。', 2)
    await page.reload()
    await visible('重新生成后的第二轮正文。').waitFor()
    await page.screenshot({ path: join(output, 'recovery-undo.png'), fullPage: true })
  })
  await step('失败后直接发送下一条消息，自动清理残留且保留前两轮', async () => {
    const before = prose(await savedChat())
    await failed('E2E 不手动清理的失败输入')
    assert.deepEqual(prose(await savedChat()), before)
    await control({ mode: 'success', reply: '直接继续后的第三轮正文。' })
    await send('E2E 直接继续新输入')
    await completed('直接继续后的第三轮正文。', 3)
    assert.deepEqual(prose(await savedChat()).slice(0, before.length), before)
    const state = await native()
    const visibleMessages = JSON.stringify(state.session.deriveMessages())
    assert.ok(!visibleMessages.includes('E2E 不手动清理的失败输入'))
    assert.ok(!visibleMessages.includes('E2E 模型故障：仅返回思考'))
    await page.screenshot({ path: join(output, 'recovery-direct-continue.png'), fullPage: true })
  })
  report.recovery = { viewport: '430x932', restartNavigationViewport: '1440x1000', touch: true, realPhone: false, reasoningOnly: true, clearAndContinue: true, directContinue: true, replay: true, restarted: true, regeneration: true, rollbackAndUndo: true }
}
