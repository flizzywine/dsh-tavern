import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Exercise the actual conversation preset UI; only the model output is fixed.
export async function presetSwitch({ page, step, savedChat, inspectRound, output, report }) {
  const identity = await savedChat()
  let rounds = identity.messages.filter(message => message.role === 'user').length
  for (const [key, gold, edit] of [['A', 50], ['A', 55, true], ['B', 60], ['', 70]]) {
    await step(edit ? '游玩中关闭当前预设的条目，下一轮立即生效' : `本局预设切换至 ${key || '内置'}，继续游玩并刷新`, async () => {
      // A preset applies only when no reply or background task runs; plugin tasks may still be finishing.
      for (let attempt = 0; attempt < 60; attempt++) {
        const state = await page.evaluate(async sessionId => (await (await fetch('/api/dsh-tavern/pluginTurnState', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json()).state, identity.sessionId)
        if (state && !state.busy) break
        await page.waitForTimeout(500)
      }
      const before = await savedChat()
      // A restarted/mobile layout may retain only the active status tab.
      if (!await page.locator('[data-dockkit-tab-title]').filter({ hasText: /^本局设置$/ }).count()) {
        await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
        await page.getByText('本局设置', { exact: true }).filter({ visible: true }).first().click()
      }
      await page.locator('[data-dockkit-tab-title]').filter({ hasText: /^本局设置$/ }).filter({ visible: true }).first().click()
      const selector = page.getByRole('combobox', { name: '本局预设', exact: true })
      const path = key ? `presets/E2E-${key}.json` : ''
      if (edit) {
        // The preset editor's own call: turn the entry off without re-applying the preset.
        await page.evaluate(async path => {
          const call = async (method, args) => (await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json())
          const preset = (await call('getPreset', { path })).preset
          const entry = preset.entries.find(item => item.content === 'E2E_PRESET_A_ACTIVE')
          const result = await call('updatePresetEntry', { path, entryKey: entry.entryKey, patch: { enabled: false } })
          if (!result.ok) throw new Error(result.error)
        }, path)
      } else {
        for (let attempt = 0; attempt < 3; attempt++) {
          await selector.selectOption(path)
          const field = page.getByRole('complementary', { name: '本局设置', exact: true })
            .locator('.dsh-local-field').filter({ has: selector })
          const saved = field.getByRole('status').filter({ hasText: /^已保存$/ })
          const conflict = field.getByRole('alert').filter({ hasText: '当前游戏已变化，请刷新后重试' })
          await saved.or(conflict).waitFor()
          if (await saved.isVisible()) break
          assert.ok(attempt < 2, '本局预设在刷新重试后必须保存成功')
          // Background display derivation can advance the optimistic revision.
          // Follow the UI's explicit recovery action; other errors still fail.
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.locator('[data-dockkit-tab-title]').filter({ hasText: /^本局设置$/ }).filter({ visible: true }).first().click()
          await selector.waitFor()
        }
      }
      const switched = await savedChat()
      assert.equal(switched.id, identity.id)
      assert.equal(switched.sessionId, identity.sessionId)
      // The status frame records its display receipt whenever it renders; that is not story state.
      const story = messages => messages.map(({ displayRuntime: _shown, ...message }) => message)
      assert.deepEqual(story(switched.messages), story(before.messages), '切换预设不能改动历史正文、变量或结算回执')
      assert.equal(switched.runtimePresetSnapshot?.presetPath || '', path)
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      await composer.fill(`E2E 预设验收 ${gold}`)
      await composer.press('Enter')
      const body = `预设切换后继续游玩，金币 ${gold}。`
      await page.getByText(body, { exact: true }).filter({ visible: true }).first().waitFor()
      await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
      const status = page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold')
      await status.filter({ hasText: new RegExp(`^金币：${gold}$`) }).waitFor()
      await inspectRound(`preset-${key || 'builtin'}${edit ? '-edited' : ''}`, gold, body, ++rounds)
      const requests = (await readFile(join(output, 'preset-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
        .filter(request => request.gold === gold && !request.settlement)
      assert.ok(requests.length, '必须记录真实正文模型请求')
      for (const request of requests) {
        assert.equal(request.presetA, key === 'A' && !edit, edit ? '关闭的预设条目不得再进入正文请求' : '模型请求中 A 预设必须与本局选择一致')
        assert.equal(request.presetB, key === 'B', '切换后不得残留旧预设')
      }
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByText(body, { exact: true }).filter({ visible: true }).first().waitFor()
      await status.filter({ hasText: new RegExp(`^金币：${gold}$`) }).waitFor()
      await page.locator('[data-dockkit-tab-title]').filter({ hasText: /^本局设置$/ }).filter({ visible: true }).first().click()
      await selector.locator(`option[value="${path}"]`).waitFor({ state: 'attached' })
      assert.equal(await selector.inputValue(), path, '刷新后保留本局预设')
      const restored = await savedChat()
      assert.equal(restored.id, identity.id)
      assert.equal(restored.sessionId, identity.sessionId)
      assert.equal(restored.runtimePresetSnapshot?.presetPath || '', path)
      await inspectRound(`preset-${key || 'builtin'}${edit ? '-edited' : ''}-reloaded`, gold, body, rounds)
      report[`preset-request-${key || 'builtin'}${edit ? '-edited' : ''}`] = requests
    })
  }
}
