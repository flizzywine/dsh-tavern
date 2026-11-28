import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createScriptOrganization } from '../tavern-plugin/lib/domain/card-organization.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createScriptLibrary } from '../tavern-plugin/lib/domain/script-library.js'
import { createScriptReader } from '../tavern-plugin/lib/domain/script-reader.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('游玩对话可以导入、预览、检索和分组 TXT、Markdown 与 EPUB 小说', async t => {
  const sessionId = 'novel-import-game'
  const dataRoot = await mkdtemp(join(tmpdir(), 'tavern-script-library-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const fileResources = createFileResourceStore({ dataRoot })
  const card = { name: '旅人' }
  const cardPath = await fileResources.importCard({ name: 'traveller.json' }, card)
  const readScript = createScriptReader({ resources: fileResources, version: async path => (await fileResources.metadata(path)).updatedAt })
  const library = createScriptLibrary({ fileResources, readScript })
  const organization = createScriptOrganization(createProfileDataStore({ dataRoot }))
  const { getResource } = createResourceHandlers({ fileResources, readScript })
  const { page, calls } = await openTavernSettings(t, {
    section: 'dsh-tavern: Better Sidebar resources tab', sessionId,
    async respond(method, args) {
      if (method === 'getSession') return { view: { sessionId, mode: 'story' } }
      if (method === 'cardPluginScopes') return { scopes: {} }
      if (method === 'listResources') {
        const scriptPath = await fileResources.scriptForCard(cardPath)
        const binding = { path: cardPath, name: card.name }
        const resources = (await library.listSources()).map(item => ({ ...item, boundCards: item.path === scriptPath ? [binding] : [] }))
        return { resources: await organization.project(resources), cards: [{ ...binding, script: scriptPath ? { path: scriptPath } : null }] }
      }
      if (method === 'getScriptOrganization') return { tags: (await organization.read()).tags }
      if (method === 'organizeScripts') return { tags: (await organization.update(args, await fileResources.list('source'))).tags }
      if (method === 'importSource') return { source: await library.importSource(args.payload) }
      if (method === 'getResource') return getResource(args)
      if (method === 'bindScript') return { script: await library.bindScript(args.cardPath, args.path) }
      if (method === 'deleteScript') return library.deleteScript(args.cardPath)
      if (method === 'renameResource') return { resource: await fileResources.rename(args.path, args.name) }
      if (method === 'deleteResource') { await fileResources.remove(args.path); return { deleted: true } }
    }
  })
  const epubText = '夜雨落在屋檐。\n\n她关上了窗。'
  const epub = writeZipEntries([
    { path: 'mimetype', content: 'application/epub+zip' },
    { path: 'META-INF/container.xml', content: '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>' },
    { path: 'book.opf', content: '<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>' },
    { path: 'chapter.xhtml', content: '<html><head><title>章节标题</title></head><body><p>夜雨落在屋檐。</p><p>她关上了窗。</p></body></html>' },
  ])
  const novels = [
    { name: '夜雨.txt', mimeType: 'text/plain', text: '雨点从屋檐落下。\n她关上了窗。' },
    { name: '远山.md', mimeType: 'text/markdown', text: '# 第一章\n\n远山隐在雾里。' },
    { name: '屋檐.epub', mimeType: 'application/epub+zip', text: epubText, buffer: epub },
  ]
  for (const { name, mimeType, text, buffer = Buffer.from(text) } of novels) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入小说或剧本' }).click(),
    ])
    await chooser.setFiles({ name, mimeType, buffer })
    await page.getByRole('button', { name, exact: true }).click()
    const preview = page.locator('.dsh-tavern-script-preview')
    await preview.waitFor()
    assert.equal(await preview.textContent(), text)
    await page.getByRole('button', { name: '返回剧本库', exact: false }).click()
    const result = await library.searchSource({ path: 'materials/' + name, query: text, limit: 1, selection: 'best-match' })
    assert.deepEqual(result.chunks.map(chunk => chunk.text), [text])
  }
  assert.deepEqual(calls.filter(({ method }) => method === 'importSource').map(({ args }) => args.sessionId),
    [sessionId, sessionId, sessionId])
  assert.deepEqual((await library.listSourceTitles()).map(({ title }) => title).sort(), novels.map(({ name }) => name).sort())

  const rain = page.locator('.dsh-tavern-resource-row').filter({ has: page.getByRole('button', { name: '夜雨.txt', exact: true }) })
  await rain.getByRole('button', { name: '添加分组' }).click()
  const checklist = page.getByRole('menu', { name: '分组', exact: true })
  const newGroup = checklist.getByRole('textbox', { name: '新建分组' })
  await newGroup.fill('雨景')
  await newGroup.press('Enter')
  await rain.getByRole('button', { name: '分组：雨景，修改分组' }).waitFor()
  await checklist.getByRole('menuitemcheckbox', { name: '雨景', checked: true }).waitFor()
  await page.keyboard.press('Escape')

  const filter = page.getByRole('button', { name: /^按分组筛选/ })
  await filter.click()
  await page.getByRole('menuitemradio', { name: '雨景' }).click()
  assert.equal(await page.locator('.dsh-tavern-resource-row').count(), 1)
  await filter.click()
  await page.getByRole('menuitem', { name: '管理分组' }).click()
  const manager = page.getByRole('dialog', { name: '管理分组' })
  await manager.getByRole('button', { name: '重命名分组：雨景' }).click()
  const rename = page.getByRole('dialog', { name: '重命名分组' }).getByRole('textbox')
  await rename.fill('氛围')
  await rename.press('Enter')
  await manager.getByRole('button', { name: '删除分组：氛围' }).click()
  const confirmation = page.getByRole('dialog', { name: '确认操作' })
  await confirmation.getByText('删除分组“氛围”？').waitFor()
  await confirmation.getByRole('button', { name: '删除', exact: true }).click()
  await manager.getByRole('button', { name: '删除分组：氛围' }).waitFor({ state: 'hidden' })
  await manager.getByRole('button', { name: '关闭', exact: true }).click()
  await rain.getByRole('button', { name: '添加分组' }).waitFor()
  assert.equal(await page.locator('.dsh-tavern-resource-row').count(), 3)

  await t.test('游玩模式可绑定、重命名、解绑和删除剧本', async () => {
    const itemAction = async (title, action) => {
      await page.getByLabel('更多操作：' + title, { exact: true }).click()
      await page.getByRole('menu').getByRole('button', { name: action, exact: true }).click()
    }
    await itemAction('夜雨.txt', '绑定人物卡')
    await page.getByRole('combobox', { name: '选择要绑定的人物卡' }).selectOption(cardPath)
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await rain.getByText('已绑定：旅人', { exact: false }).waitFor()

    await itemAction('夜雨.txt', '重命名')
    const fileName = page.getByRole('dialog', { name: '重命名文件' }).getByRole('textbox')
    assert.equal(await fileName.inputValue(), '夜雨.txt')
    await fileName.fill('夜雨改名.txt')
    await fileName.press('Enter')
    const renamed = page.getByRole('button', { name: '夜雨改名.txt', exact: true })
    await renamed.waitFor()
    assert.equal(await fileResources.scriptForCard(cardPath), 'materials/夜雨改名.txt')
    assert.equal(await fileResources.readText('materials/夜雨改名.txt'), novels[0].text)

    await itemAction('夜雨改名.txt', '解绑人物卡')
    await confirmation.getByRole('button', { name: '确认', exact: true }).click()
    await page.locator('.dsh-tavern-resource-row').filter({ has: renamed }).getByText('未绑定', { exact: false }).waitFor()
    await itemAction('夜雨改名.txt', '删除')
    await confirmation.getByText('工作版和原版都会删除。').waitFor()
    await confirmation.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(calls.some(({ method }) => method === 'deleteResource'), false)
    await itemAction('夜雨改名.txt', '删除')
    await confirmation.getByRole('button', { name: '删除', exact: true }).click()
    await renamed.waitFor({ state: 'hidden' })
    assert.equal(await fileResources.readText('materials/夜雨改名.txt'), undefined)
  })

  await t.test('长篇正文可滚动，页脚可顺序翻页和跳到末页', async () => {
    const name = '长篇小说.txt'
    const paragraphs = Array.from({ length: 23 }, (_, i) => '第' + (i + 1) + '段' + '雨'.repeat(498) + '。')
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入小说或剧本' }).click(),
    ])
    await chooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(paragraphs.join('\n\n')) })
    const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
    await page.addStyleTag({ content: css + '\nmain { width: 330px; height: 420px; }' })
    await page.getByRole('button', { name, exact: true }).click()
    const reader = page.getByRole('region', { name: '剧本正文' })
    const nav = page.getByRole('navigation', { name: '剧本翻页' })
    const next = nav.getByRole('button', { name: '下一页' })
    const previous = nav.getByRole('button', { name: '上一页' })
    await nav.getByText('第 1 / 3 页').waitFor()
    assert.equal(await previous.isDisabled(), true)
    assert.equal(await reader.locator('pre').textContent(), paragraphs.slice(0, 10).join('\n\n'))
    assert.ok(await reader.evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop }) > 0)
    const [readingArea, footer, panel] = await Promise.all([reader.boundingBox(), nav.boundingBox(), page.locator('main').boundingBox()])
    assert.ok(footer.y >= readingArea.y + readingArea.height - 1)
    assert.ok(footer.y + footer.height <= panel.y + panel.height + 1)
    await next.click()
    await nav.getByText('第 2 / 3 页').waitFor()
    assert.equal(await reader.evaluate(node => node.scrollTop), 0)
    assert.match(await reader.locator('pre').textContent(), /第11段/)
    await nav.getByRole('spinbutton', { name: '剧本页码' }).fill('3')
    await nav.getByRole('button', { name: '跳转' }).click()
    await nav.getByText('第 3 / 3 页').waitFor()
    assert.ok((await reader.locator('pre').textContent()).endsWith(paragraphs.at(-1)))
    assert.equal(await next.isDisabled(), true)
    await previous.click()
    await nav.getByText('第 2 / 3 页').waitFor()
    assert.deepEqual(calls.filter(({ method, args }) => method === 'getResource' && args.path === 'materials/' + name)
      .map(({ args }) => args.page), [1, 2, 3, 2])
  })
})
