import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('长期偏好页标记废弃，允许选看旧记录并导出已确认的内容', async t => {
  const records = [
    { id: 'a', name: '日常', hasConfirmed: true, confirmed: { injectionText: '旧日常正文' } },
    { id: 'b', name: '冒险', hasConfirmed: false, draft: { summary: '旧冒险草案', rawAnswers: [{ question: '节奏？', answer: '快节奏' }] } },
  ]
  const profiles = records.map(({ id, name, hasConfirmed }) => ({ id, name, hasConfirmed }))
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: preset library', respond(method, args) {
    if (method === 'getSystemPrompts' || method === 'getCardPersonas') return {}
    if (method === 'getUserPreferenceProfile') {
      const { id, ...record } = records.find(item => item.id === (args.profileId || 'a'))
      return { userProfile: { ...record, profiles, profileId: id, defaultProfileId: 'a' } }
    }
    if (method === 'exportSettingsBundle') return { name: 'preferences.json', text: JSON.stringify({ userProfile: records[0].confirmed }) }
  } })
  const region = page.getByRole('region', { name: '长期偏好', exact: true })
  await region.getByText(/功能已废弃/).waitFor()
  assert.equal(await region.getByRole('button', { name: /默认|启用/ }).count(), 0)
  await region.getByRole('button', { name: /详情/ }).click()
  const archive = page.locator('.dsh-tavern-user-profile')
  await archive.getByText(/功能已废弃/).waitFor()
  await archive.getByText('旧日常正文', { exact: true }).waitFor()
  assert.equal(await archive.getByRole('button', { name: /新建|修改|启用/ }).count(), 0)
  const choice = archive.getByRole('combobox', { name: '查看长期偏好' })
  await choice.selectOption('b')
  await archive.getByText('旧冒险草案', { exact: true }).waitFor()
  await archive.getByText('偏好维度和访谈记录', { exact: true }).click()
  await archive.getByText(/快节奏/).waitFor()
  const exportButton = archive.getByRole('button', { name: '导出', exact: true })
  assert.equal(await exportButton.isDisabled(), true)
  await choice.selectOption('a')
  await archive.getByText('旧日常正文', { exact: true }).waitFor()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  assert.equal(JSON.parse(await readFile(await download.path(), 'utf8')).userProfile.injectionText, '旧日常正文')
  assert.equal(calls.find(call => call.method === 'exportSettingsBundle').args.userProfileId, 'a')
  assert.ok(!calls.some(({ method }) => /^(manage|update|set).*PreferenceProfile/.test(method)))
})
