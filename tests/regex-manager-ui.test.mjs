import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/features/regex-library.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const forkInlineSource = await readFile(new URL('../tavern-plugin/src/client/inline-field.js', import.meta.url), 'utf8')

const DATA = {
  sessionId: 's1', mode: 'story', revision: 'r1', migrated: 0, warning: '',
  overrides: { preset: {}, card: { c1: true } },
  global: [{
    key: 'g1', source: 'global', id: 'g1', name: '全局A', findRegex: '/a/g', replaceString: 'A',
    trimStrings: [], placement: [2], markdownOnly: true, promptOnly: false, runOnEdit: false,
    minDepth: null, maxDepth: null, sourceEnabled: true, overridden: false, enabled: true, invalid: false
  }],
  preset: {
    name: 'P', path: 'presets/p.json',
    scripts: [{
      key: 'p1#1', source: 'preset', id: 'p1', name: '预设A', findRegex: '/p/g', replaceString: 'P',
      trimStrings: [], placement: [2], markdownOnly: false, promptOnly: true, runOnEdit: false,
      minDepth: null, maxDepth: null, sourceEnabled: true, overridden: false, enabled: true, invalid: false
    }]
  },
  card: {
    name: 'C', path: 'cards/c.png',
    scripts: [{
      key: 'c1', source: 'card', id: 'c1', name: '卡A', findRegex: '/c/g', replaceString: 'C',
      trimStrings: [], placement: [2], markdownOnly: true, promptOnly: false, runOnEdit: false,
      minDepth: null, maxDepth: null, sourceEnabled: false, overridden: true, enabled: true, invalid: false
    }]
  }
}

test('正则库页面：三来源、开关、本局覆盖、新建与试运行', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 520, height: 1100 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()) })
  await page.route('http://tavern.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }))
  await page.goto('http://tavern.test/')
  await page.addStyleTag({ content: ':root{--dsw-alias-label-primary:#2b2520;--dsw-alias-label-secondary:#6d645a;--dsw-alias-label-tertiary:#9a9085;--dsw-alias-border-l2:#e7dfd3;--dsw-alias-bg-base:#fffdfa;--dsw-specific-input-major:#fffefc;--dsw-specific-input-minor:#faf5ee;--dsw-specific-sidebar-fill:#fbf8f2;--dsw-alias-interactive-bg-hover:#f6f0e8;--dsw-alias-label-primary-foreground:#fff;--dsh-tavern-accent:#c96442;--dsh-tavern-accent-soft:#f8eae2;--dsh-tavern-accent-border:#e9c5b6;--dsh-tavern-font-sans:system-ui;}\n' + css })
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    var React = modules.react;
    window.__calls = [];
    window.__data = ${JSON.stringify(DATA)};
    window.rpc = async function (method, args) {
      window.__calls.push({ method: method, args: JSON.parse(JSON.stringify(args || {})) });
      if (method === 'getRegexManager') return JSON.parse(JSON.stringify(window.__data));
      if (method === 'writeGlobalRegexes') {
        const global = (args.scripts || []).map(function (script, index) {
          return {
            key: script.id || ('new-' + index), source: 'global', id: script.id || ('new-' + index),
            name: script.name || '未命名正则', findRegex: script.findRegex || '', replaceString: script.replaceString || '',
            trimStrings: script.trimStrings || [], placement: script.placement || [],
            markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true, runOnEdit: script.runOnEdit === true,
            minDepth: script.minDepth === undefined ? null : script.minDepth, maxDepth: script.maxDepth === undefined ? null : script.maxDepth,
            sourceEnabled: script.enabled !== false, overridden: false, enabled: script.enabled !== false, invalid: !String(script.findRegex || '').trim()
          };
        });
        window.__data.global = global; window.__data.revision = 'r' + window.__calls.length;
        return { global: JSON.parse(JSON.stringify(global)), revision: window.__data.revision };
      }
      if (method === 'setRegexOverride') {
        const map = window.__data.overrides[args.source] || {};
        if (args.enabled === null) delete map[args.key]; else map[args.key] = args.enabled;
        window.__data.overrides[args.source] = map;
        return { overrides: JSON.parse(JSON.stringify(window.__data.overrides)) };
      }
      if (method === 'setRegexOverrides') {
        for (const change of args.changes || []) {
          const map = window.__data.overrides[change.source] || {};
          if (change.enabled === null) delete map[change.key]; else map[change.key] = change.enabled;
          window.__data.overrides[change.source] = map;
        }
        return { overrides: JSON.parse(JSON.stringify(window.__data.overrides)) };
      }
      if (method === 'previewRegexScripts') return { text: 'PREVIEW', changed: true, applied: [{ index: 0, id: 'x', name: 'x', matches: 2 }], warnings: [] };
      if (method === 'importRegexes') return { imported: 0, revision: window.__data.revision, global: window.__data.global };
      throw new Error('unexpected RPC: ' + method);
    };
    window.useTavernConfirm = function () { return async function () { return true; }; };
    window.usePersistentError = function () { return React.useState(''); };
    window.useVisibleDataRefresh = function (_visible, _affects, refresh) { React.useEffect(function () { refresh(); }, []); };
    window.tavernDataChangeAffects = function () { return false; };
    window.notifyTavernDataChanged = function () {};
    window.__downloads = [];
    window.downloadTavernBlob = function (blob, filename) { window.__downloads.push({ name: filename, size: blob && blob.size }); };
    window.parseTextResourceFile = async function () { return { name: 'x.json', text: '[]' }; };
  ` })
  // the page uses the shared controls (Switch, TextArea, InlineField, SearchBox, EmptyState).
  await page.addScriptTag({ content: forkInlineSource + '\nwindow.PanelLoading = function () { return null; };' })
  await page.addScriptTag({ content: source })
  await page.evaluate(() => {
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#root')).render(
      React.createElement(RegexLibraryTab, { scope: { sessionId: 's1' }, visible: true }))
  })
  await page.waitForSelector('text=全局正则')
  const text = () => page.locator('#root').innerText()
  assert.match(await text(), /全局正则/)
  assert.match(await text(), /预设 · P/)
  assert.match(await text(), /人物卡 · C/)
  assert.match(await text(), /本局覆盖/)

  // global switch persists
  await page.locator('.dsh-tavern-rx-row.src-global .dsh-tavern-rx-switch').click()
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'writeGlobalRegexes'))
  assert.equal(await page.evaluate(() => window.__data.global[0].enabled), false)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-global .dsh-tavern-rx-switch').getAttribute('aria-checked'), 'false')

  // preset switch writes a session override only
  await page.locator('.dsh-tavern-rx-row.src-preset .dsh-tavern-rx-switch').click()
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'setRegexOverride'))
  const override = await page.evaluate(() => window.__calls.find(call => call.method === 'setRegexOverride').args)
  assert.deepEqual(override, { source: 'preset', key: 'p1#1', enabled: false })
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-row.src-preset .dsh-tavern-rx-switch')?.getAttribute('aria-checked') === 'false')
  assert.match(await page.locator('.dsh-tavern-rx-row.src-preset').innerText(), /本局覆盖/)

  // enabled-state filter combines with the source filter
  await page.locator('.dsh-tavern-rx-state-filter', { hasText: '已停用' }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-global').count(), 1)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-preset').count(), 1)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-card').count(), 0)
  await page.locator('.dsh-tavern-rx-state-filter', { hasText: '已启用' }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-global').count(), 0)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-preset').count(), 0)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-card').count(), 1)
  await page.locator('.dsh-tavern-rx-state-filter', { hasText: '全部' }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.dsh-tavern-rx-row').count(), 3)

  // new regex editor saves through the global list
  await page.getByRole('button', { name: '新建' }).click()
  await page.locator('.dsh-tavern-rx-row.is-new input[type="text"]').first().fill('新规则')
  await page.locator('.dsh-tavern-rx-row.is-new textarea').first().fill('/n/g')
  await page.locator('.dsh-tavern-rx-row.is-new textarea').nth(1).fill('N')
  await page.locator('.dsh-tavern-rx-row.is-new').getByRole('button', { name: '保存' }).click()
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'writeGlobalRegexes' && call.args.scripts.length === 2))
  await page.waitForSelector('text=新规则')

  // a single rule test uses the editor draft
  await page.locator('.dsh-tavern-rx-row.src-global').first().locator('.dsh-tavern-rx-row-head').evaluate(element => element.click())
  await page.waitForTimeout(100)
  await page.locator('.dsh-tavern-rx-row.src-global').first().locator('.dsh-tavern-rx-test > summary').evaluate(element => element.click())
  await page.locator('.dsh-tavern-rx-row.src-global').first().locator('.dsh-tavern-rx-test button').evaluate(element => element.click())
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'previewRegexScripts'))
  const previewed = await page.evaluate(() => window.__calls.find(call => call.method === 'previewRegexScripts').args)
  assert.equal(previewed.scripts.length, 1)
  assert.equal(previewed.scripts[0].findRegex, '/a/g')

  // resetting a session override goes through the same RPC with null
  await page.locator('.dsh-tavern-rx-row.src-card .dsh-tavern-rx-row-head').evaluate(element => element.click())
  await page.waitForTimeout(100)
  await page.locator('.dsh-tavern-rx-row.src-card').getByRole('button', { name: '恢复跟随来源' }).evaluate(element => element.click())
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'setRegexOverride' && call.args.source === 'card' && call.args.enabled === null))
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-row.src-card .dsh-tavern-rx-switch')?.getAttribute('aria-checked') === 'false')
  assert.doesNotMatch(await page.locator('.dsh-tavern-rx-row.src-card').innerText(), /本局覆盖/)

  // chain preview runs through the host RPC
  await page.locator('.dsh-tavern-rx-chain > summary').evaluate(element => element.click())
  assert.equal(await page.locator('.dsh-tavern-rx-chain').getAttribute('open'), '')
  await page.locator('.dsh-tavern-rx-chain').getByRole('button', { name: '运行' }).evaluate(element => element.click())
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'previewRegexScripts'))
  await page.waitForSelector('text=PREVIEW')

  // multi-select: a row checkbox selects without expanding the row, select-all follows the current filters
  const presetRow = page.locator('.dsh-tavern-rx-row.src-preset')
  // the row selector is the shared Switch (role=switch) inside the .dsh-tavern-rx-select label.
  await presetRow.locator('.dsh-tavern-rx-select input').click()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-bulk-count')?.textContent === '已选 1 条')
  assert.equal(await presetRow.locator('.dsh-tavern-rx-row-head').getAttribute('aria-expanded'), 'false')
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '清除' }).click()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-bulk-count')?.textContent === '未选择')
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '全选当前' }).click()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-bulk-count')?.textContent === '已选 4 条')

  // bulk disable: one global write plus one batch override, both applied immediately
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '停用' }).evaluate(element => element.click())
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'setRegexOverrides'))
  await page.waitForFunction(() => [...document.querySelectorAll('.dsh-tavern-rx-switch')].every(node => node.getAttribute('aria-checked') === 'false'))
  assert.equal(await page.evaluate(() => window.__data.global.every(script => script.enabled === false)), true)
  assert.equal(await page.evaluate(() => window.__data.overrides.card.c1), false)
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-bulk-count')?.textContent === '未选择')

  // bulk export includes every selected source
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '全选当前' }).click()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-bulk-count')?.textContent === '已选 4 条')
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '导出' }).evaluate(element => element.click())
  await page.waitForFunction(() => window.__downloads.length > 0)
  assert.equal(await page.evaluate(() => window.__downloads[0].name), 'tavern-regex-selected.json')
  assert.ok(await page.evaluate(() => window.__downloads[0].size) > 0)

  // bulk delete only removes global rules; preset/card sources stay
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '删除' }).evaluate(element => element.click())
  await page.waitForFunction(() => window.__data.global.length === 0)
  await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-rx-row.src-global').length === 0)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-global').count(), 0)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-preset').count(), 1)
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-card').count(), 1)
  await page.waitForSelector('.dsh-tavern-rx-notice')
  assert.match(await page.locator('.dsh-tavern-rx-notice').innerText(), /已删除 2 条全局正则/)

  // selecting only source rules cannot delete them, and says why
  await page.locator('.dsh-tavern-rx-row.src-preset .dsh-tavern-rx-select input').click()
  await page.locator('.dsh-tavern-rx-bulk').getByRole('button', { name: '删除' }).evaluate(element => element.click())
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-rx-notice')?.textContent.includes('不能在这里删除'))
  assert.equal(await page.locator('.dsh-tavern-rx-row.src-preset').count(), 1)
  assert.deepEqual(errors, [])
})
