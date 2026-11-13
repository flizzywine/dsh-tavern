import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The 预设 tab: pick the preset, system prompt set and preference in one place,
// export the checked ones as one file and import it back as new entries.
export async function presetHubChecks({ page, step, output, report }) {
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (value.ok === false) throw new Error(value.error)
    return value
  }, [method, args])
  const hub = page.locator('.dsh-tavern-preset-hub').filter({ visible: true })
  // The hub is ready when its summary has arrived and the preset row shows its value; a restored but inactive tab keeps
  // the panel in its loading state, so visibility alone is not enough.
  async function openHub() {
    const ready = () => hub.getByRole('button', { name: /^新游戏默认预设：/ }).filter({ visible: true })
    if (await ready().count()) return
    const reachTab = async () => {
      const tab = page.getByRole('tab', { name: '预设', exact: true }).filter({ visible: true })
      if (await tab.count()) await tab.first().click()
      else await page.getByRole('button', { name: '预设', exact: true }).filter({ visible: true }).first().click()
    }
    const openFromStart = async () => {
      await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
      await page.locator('.dsh-tavern-start-card').filter({ hasText: /^预设$/ }).filter({ visible: true }).first().click()
    }
    for (const reach of [reachTab, openFromStart]) {
      await reach().catch(() => {})
      if (await ready().waitFor({ timeout: 15000 }).then(() => true, () => false)) return
    }
    await ready().waitFor()
  }
  async function confirmDialog() {
    const dialog = page.getByRole('dialog', { name: '确认操作' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
  }
  // The hub rows pick their value in an inline menu: a trigger reading 「标签：值」 and a menuitemradio list.
  const inlineMenu = (scope, label) => scope.getByRole('button', { name: new RegExp('^' + label + '：') })
  async function pickInlineMenu(scope, label, option) {
    await inlineMenu(scope, label).click()
    const item = page.getByRole('menuitemradio', { name: option, exact: true }).filter({ visible: true })
    await item.first().click()
  }
  const inlineMenuValue = async (scope, label) => String(await inlineMenu(scope, label).getAttribute('aria-label')).replace(new RegExp('^' + label + '：'), '')
  await step('预设标签页取代系统提示词和长期偏好两个标签页', async () => {
    await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
    const start = page.locator('.dsh-tavern-start').filter({ visible: true })
    await start.waitFor()
    const labels = await start.locator('.dsh-tavern-start-card').allInnerTexts()
    assert.ok(labels.includes('预设'), '开始页应有“预设”')
    assert.ok(!labels.includes('系统提示词') && !labels.includes('长期偏好') && !labels.includes('预设库'), '旧标签页不再单独出现：' + labels.join('、'))
    await start.locator('.dsh-tavern-start-card').filter({ hasText: /^预设$/ }).first().click()
    await hub.waitFor()
    for (const name of ['酒馆预设', '系统提示词', '长期偏好']) await hub.getByRole('region', { name, exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'preset-hub.png'), fullPage: true })
  })
  await step('在预设页选择三项，导出成一个文件', async () => {
    await call('manageSystemPromptSet', { action: 'create', name: '快节奏' })
    await call('updateSystemPrompt', { name: 'story', text: 'E2E_FAST_STORY' })
    await call('manageUserPreferenceProfile', { action: 'create', name: '验收偏好', content: 'E2E 偏好正文' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openHub()
    await pickInlineMenu(hub, '新游戏默认预设', 'E2E-A')
    await hub.getByRole('status').filter({ hasText: '新游戏默认预设已更新' }).waitFor()
    await pickInlineMenu(hub, '新游戏默认长期偏好', '验收偏好')
    await hub.getByRole('status').filter({ hasText: '新游戏默认长期偏好已更新' }).waitFor()
    assert.equal(await inlineMenuValue(hub, '系统提示词方案'), '快节奏')
    // Unchecking an item leaves it out of the file.
    await hub.getByRole('button', { name: '导出…', exact: true }).click()
    const panel = hub.getByRole('region', { name: '选择导出内容' })
    // The shared switch paints its track over the input, so the pointer lands on the track.
    await panel.getByRole('switch', { name: '导出长期偏好' }).uncheck({ force: true })
    await page.screenshot({ path: join(output, 'preset-hub-export.png'), fullPage: true })
    const [partial] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '导出所选' }).click()])
    const some = JSON.parse(await readFile(await partial.path(), 'utf8'))
    assert.deepEqual(['preset', 'systemPrompts', 'userProfile'].filter(key => key in some), ['preset', 'systemPrompts'])
    await hub.getByRole('button', { name: '导出…', exact: true }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), hub.getByRole('region', { name: '选择导出内容' }).getByRole('button', { name: '导出所选' }).click()])
    const file = join(output, download.suggestedFilename())
    await download.saveAs(file)
    const bundle = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(bundle.spec, 'dsh-tavern.bundle')
    assert.match(bundle.preset.text, /E2E_PRESET_A_ACTIVE/)
    assert.equal(bundle.systemPrompts.name, '快节奏')
    assert.equal(bundle.systemPrompts.prompts.story, 'E2E_FAST_STORY')
    assert.equal(bundle.userProfile.injectionText, 'E2E 偏好正文')
    report.presetHubExport = { file: download.suggestedFilename(), parts: Object.keys(bundle).filter(key => ['preset', 'systemPrompts', 'userProfile'].includes(key)) }
  })
  await step('导入同一个文件：三项都作为新方案加入并设为使用中，不覆盖原有内容', async () => {
    const file = join(output, report.presetHubExport.file)
    await hub.locator('input[type=file]').setInputFiles(file)
    await confirmDialog()
    await hub.getByRole('status').filter({ hasText: '已导入' }).waitFor()
    const presets = await call('listPresets')
    assert.equal(presets.activePresetPath, 'presets/E2E-A (2).json')
    assert.ok(presets.presets.some(item => item.path === 'presets/E2E-A.json'), '原预设保留')
    const prompts = (await call('getSystemPrompts')).systemPrompts
    assert.deepEqual(prompts.promptSets.sets.map(set => set.name), ['默认方案', '快节奏', '快节奏 (2)'])
    assert.equal(prompts.promptSets.sets.find(set => set.active).name, '快节奏 (2)')
    const profile = (await call('getUserPreferenceProfile')).userProfile
    const imported = profile.profiles.find(item => item.name === '验收偏好 (2)')
    assert.ok(imported, '长期偏好作为新条目加入')
    assert.equal(profile.defaultProfileId, imported.id)
    assert.equal(await inlineMenuValue(hub, '系统提示词方案'), '快节奏 (2)')
    await page.screenshot({ path: join(output, 'preset-hub-imported.png'), fullPage: true })
  })
  await step('详情可进入原有编辑页、单独导出、删除方案并返回', async () => {
    await hub.getByRole('region', { name: '系统提示词', exact: true }).getByRole('button', { name: /详情/ }).click()
    const detail = page.locator('.dsh-tavern-preset-hub-detail').filter({ visible: true })
    await inlineMenu(detail, '系统提示词方案').waitFor()
    // Exporting one item lives in its own detail page.
    const [single] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: '导出', exact: true }).click()])
    const one = JSON.parse(await readFile(await single.path(), 'utf8'))
    assert.deepEqual(['preset', 'systemPrompts', 'userProfile'].filter(key => key in one), ['systemPrompts'])
    assert.equal(one.systemPrompts.name, '快节奏 (2)')
    // Deleting the set in use switches to another one.
    await detail.getByRole('button', { name: '删除', exact: true }).click()
    await confirmDialog()
    await detail.getByRole('status').filter({ hasText: '方案已删除' }).waitFor()
    const left = (await call('getSystemPrompts')).systemPrompts.promptSets
    assert.deepEqual(left.sets.map(set => set.name), ['默认方案', '快节奏'])
    assert.equal(left.sets.find(set => set.active).name, '快节奏')
    await detail.getByRole('button', { name: '← 返回预设' }).click()
    await hub.waitFor()
  })
  await step('预设库里能一键打开当前预设的编辑页', async () => {
    await hub.getByRole('region', { name: '酒馆预设', exact: true }).getByRole('button', { name: /详情/ }).click()
    const library = page.locator('.dsh-tavern-preset-hub-detail').filter({ visible: true })
    const edit = library.getByRole('button', { name: '编辑当前预设', exact: true })
    await edit.waitFor()
    await library.getByRole('combobox', { name: '新游戏默认预设' }).waitFor()
    assert.equal(await edit.isEnabled(), true, '已选预设时按钮可点')
    await page.screenshot({ path: join(output, 'preset-library-selector.png'), fullPage: true })
    await edit.click()
    const backToLibrary = library.getByRole('button', { name: '← 返回酒馆预设库', exact: true })
    await backToLibrary.waitFor()
    await library.getByText('编辑前／中／后三段预设').waitFor()
    await backToLibrary.click()
    await edit.waitFor()
    await page.getByRole('button', { name: '← 返回预设', exact: true }).click()
    await hub.waitFor()
  })
}
