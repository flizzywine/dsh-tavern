import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCardScripts } from '../tavern-plugin/lib/card-scripts.js'
import { createCardStorage } from '../tavern-plugin/lib/card-storage.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { createCardWorkspaceReader } from '../tavern-plugin/lib/domain/card-workspace-reader.js'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { createCardHandlers } from '../tavern-plugin/lib/rpc/cards.js'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

const bgm = { id: 'bgm', name: 'BGM', type: 'script', enabled: true, content: 'new Audio("song.mp3").play()' }
const utility = { id: 'utility', name: 'Utility', type: 'script', content: 'console.log("ready")' }
const disabled = { id: 'disabled', type: 'script', enabled: false, content: '<audio src="sound.mp3">' }
const cardPath = 'cards/a.json'
const key = 'card-scripts/card-a.json'

const cardIdFor = async value => value === cardPath || value === 'cards/renamed.json' ? 'card-a' : 'card-b'
async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'fork-card-scripts-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot })
  return { dataRoot, profileData, store: createCardScripts({ profileData, cardIdFor }) }
}

test('atomic setMuted round trip is card-ID scoped, concurrent-safe, validated and bounded', async t => {
  const { store, profileData } = await fixture(t)
  await Promise.all([store.setMuted(cardPath, ' bgm ', true), store.setMuted(cardPath, 'utility', true)])
  // Concurrent additions guarantee membership, not insertion order.
  assert.deepEqual((await store.muted('cards/renamed.json')).sort(), ['bgm', 'utility'].sort())
  assert.deepEqual(await store.muted('cards/b.json'), [])
  const persisted = await profileData.readJson(key)
  assert.deepEqual({ ...persisted, muted: persisted.muted.sort() }, { version: 1, muted: ['bgm', 'utility'].sort() })
  await store.setMuted(cardPath, 'bgm', false)
  const reopened = createCardScripts({ profileData, cardIdFor })
  assert.deepEqual(await reopened.muted(cardPath), ['utility'])
  await assert.rejects(store.setMuted(cardPath, '', true), /Invalid script ID/)
  await assert.rejects(store.setMuted(cardPath, 'x'.repeat(65), true), /Invalid script ID/)
  await assert.rejects(store.setMuted(cardPath, 'bgm', 'false'), /boolean/)
  await profileData.writeJson(key, { muted: Array.from({ length: 50 }, (_, i) => `script-${i}`) })
  await assert.rejects(store.setMuted(cardPath, 'extra', true), /50 scripts/)
  await store.setMuted(cardPath, 'script-0', true)
  await store.setMuted(cardPath, 'script-0', false)
  await store.setMuted(cardPath, 'extra', true)
  assert.equal((await store.muted(cardPath)).length, 50)
  const invalid = createCardScripts({ profileData, cardIdFor: async () => '../escape' })
  await assert.rejects(invalid.muted(cardPath), /Invalid cardId/)
})

test('host RPCs use unfiltered snapshot, reject unknown IDs, and toggles invalidate the view cache', async t => {
  const { dataRoot, profileData } = await fixture(t)
  const cardStorage = createCardStorage({ dataRoot, profileData })
  const cardScripts = createCardScripts({ profileData, cardIdFor: cardStorage.findId })
  const resourcePath = 'resources/' + cardPath
  const workspace = { meta: { id: 'card-a' } }
  await profileData.writeJson(resourcePath, workspace)
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  await profileData.writeJson(key, {version:1, muted:['bgm']})
  const snapshot = { spec: 'chara_card_v3', data: { extensions: {
    regex_scripts: [{ id: 'display', findRegex: 'old', replaceString: 'new', placement: [2] }],
    tavern_helper: { scripts: [bgm, utility, disabled, { ...utility, id: 'legacy-disabled', disabled: true }] }
  } } }
  const chat = { cardPath, cardName: 'Test card', cardDefinitionSnapshot: snapshot }
  const before = structuredClone(chat)
  let liveReads = 0
  const { readCardExtensions } = createCardWorkspaceReader({
    cardStorage: { readWorkspace: async () => {
      liveReads++
      return { raw: { spec: 'chara_card_v3', data: { extensions: { tavern_helper: { scripts: [bgm] } } } } }
    } },
    cardPreparation: {
      isWorkspace: card => Boolean(card.raw),
      present: ({ card, as }) => { assert.equal(as, 'card-extensions'); return inspectCardExtensions(card.raw || card) }
    },
    tavernExtensionSettings: { read: async () => ({}) }, cardScripts
  })
  assert.deepEqual(projectTavernHelperScripts((await readCardExtensions(cardPath, chat)).helperScripts).scripts.map(script => script.id), ['utility'])
  // The production RPC handler; index.js routes getCardScripts to the same method.
  const handlers = createCardHandlers({ chatForSession: async id => id === 'session' ? chat : undefined, readCardExtensions, cardScripts, resolveCardId: cardStorage.resolve, str: value => typeof value === 'string' ? value : '' })
  const rpc = (method, args) => (handlers[method] || handlers.setCardScriptMuted)(args, method)
  assert.match(host, /rpcHandlers\.getCardScripts = rpcHandlers\.setCardScriptMuted/)
  const response = await rpc('getCardScripts', { sessionId: 'session' })
  assert.deepEqual(response, { cardName: 'Test card', cardId: 'card-a', ...await cardScripts.list(inspectCardExtensions(snapshot).helperScripts, cardPath) })
  assert.equal(response.scripts.length, 4)
  assert.equal(response.scripts[0].muted, true)
  assert.equal(response.scripts[3].enabled, false)
  assert.equal(response.scripts.some(script => 'content' in script), false)
  for (const [index, expected] of [[0, bgm.content], [2, disabled.content]]) {
    const { id, ref } = response.scripts[index]
    assert.deepEqual(await rpc('getCardScriptSource', { sessionId: 'session', id, ref }), { content: expected })
  }
  await assert.rejects(rpc('getCardScriptSource', { sessionId: 'session', id: 'bgm', ref: 'helper:1' }), /找不到该脚本/)
  await assert.rejects(rpc('getCardScriptSource', { sessionId: 'missing', id: 'bgm', ref: 'helper:0' }), /找不到对话/)
  assert.equal(liveReads, 0, 'snapshot takes precedence over live card')
  await assert.rejects(rpc('getCardScripts', { sessionId: 'missing' }))
  await assert.rejects(rpc('setCardScriptMuted', { sessionId: 'session', id: 'unknown', muted: true }), /Unknown card script ID/)
  await assert.rejects(rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: 'false' }), /boolean/)
  const versionSource = host.slice(host.indexOf('    resourceVersion: async chat => {'), host.indexOf('    readChanges: chatPersistence.readChangedIndices,'))
  const resourceVersionsSource = host.slice(host.indexOf('  async function readCardResourceVersions('), host.indexOf('  const sessionProjection = createSessionViewProjection('))
  let reloadRevision = 0
  const resourceVersion = new Function('fileResources', 'profileData', 'cardScripts', 'stageRuntime', 'tavernExtensionSettings', 'promptTemplateGlobalVariables', 'cardUpdates', `${resourceVersionsSource}; return ({ ${versionSource} }).resourceVersion`)(
    { worldBookBindingForCard: async () => ({}), scriptForCard: async () => null }, profileData, cardScripts, { status: () => 'ready' }, { version: async () => '' }, { version: async () => '' }, { revision: () => reloadRevision })
  const originalVersion = await resourceVersion(chat)
  let fullReads = 0
  const views = createSessionViewReader({
    readState: async () => chat, readChat: async () => chat, resourceVersion,
    project: { cached: async (_, view) => view, full: async () => { fullReads++; return { tavernHelperScripts: projectTavernHelperScripts((await readCardExtensions(cardPath, chat)).helperScripts).scripts } } },
    activity: () => ({}), trace: { stage: async (_, run) => run(), state() {} }, foregroundRunning: () => false
  })
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['utility'])
  await views.read('session')
  assert.equal(fullReads, 1)
  const toggled = await rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: false })
  assert.equal(toggled.scripts[0].muted, false)
  assert.notEqual(await resourceVersion(chat), originalVersion)
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['bgm', 'utility'])
  assert.equal(fullReads, 2, 'preference-only change forces full projection without changing chat revision')
  await rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: true })
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['utility'])
  assert.deepEqual(projectTavernHelperScripts((await readCardExtensions(cardPath)).helperScripts).scripts, [], 'opening previews honor mutes')
  assert.equal(liveReads, 1)

  // The saved card and its display rules remain readable after the library copy
  // goes away. A missing mute-settings key must not turn scripts back on.
  await profileData.remove(resourcePath)
  assert.equal(await cardScripts.version(cardPath), '')
  assert.deepEqual((await views.read('session')).tavernHelperScripts, [])
  assert.deepEqual((await readCardExtensions(cardPath, chat)).regexScripts.map(script => script.id), ['display'])
  await assert.rejects(rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: false }), /人物卡已删除或缺少身份/)
  assert.deepEqual(await profileData.readJson(key), { version: 1, muted: ['bgm'] })
  await profileData.writeJson(resourcePath, workspace)
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['utility'])
  const beforeReload = await resourceVersion(chat)
  reloadRevision++
  assert.notEqual(await resourceVersion(chat), beforeReload)

  assert.deepEqual(chat, before)
  assert.match(host, /hasScripts: async function \(chat\) \{ return hasTavernScriptRuntime\(chat, \(await readCardExtensions\(chat.cardPath, chat\)\)/)
  assert.match(host, /requiresBrowser: async chat => hasTavernScriptRuntime\(chat, \(await readCardExtensions\(chat.cardPath, chat\)\)/)
  const projection = await readFile(new URL('../tavern-plugin/lib/domain/session-view-projection.js', import.meta.url), 'utf8')
  assert.match(projection, /readCardExtensions\(chat.cardPath, chat, settings\)/)
  assert.match(projection, /hasTavernScriptRuntime\(chat, cardExtensions.helperScripts\)/)
})

test('卡片脚本可按需展开源码，关闭或停用的脚本也可查看', async t => {
  const scripts = [
    { id: 'bgm', ref: 'helper:0', name: 'BGM', enabled: true, muted: true },
    { id: 'disabled', ref: 'helper:1', name: '停用工具', enabled: false }
  ]
  const html = '<script>document.body.dataset.executed = "yes"</script>\nconst player = null;'
  let fail = true
  const { page, calls } = await openTavernSettings(t, {
    section: 'dsh-tavern: card helper scripts tab', sessionId: 'game',
    respond(method, args) {
      if (method === 'getCardScripts') return { cardId: 'card-a', scripts }
      if (method === 'getCardScriptSource') {
        if (args.id === 'bgm' && fail) throw new Error('暂时无法读取')
        return { content: args.id === 'bgm' ? html : '' }
      }
    }
  })
  const viewSource = page.getByRole('button', { name: 'BGM · 查看代码', exact: true })
  await viewSource.waitFor()
  assert.equal(calls.some(call => call.method === 'getCardScriptSource'), false)
  await viewSource.press('Enter')
  await page.getByRole('alert').filter({ hasText: '暂时无法读取' }).waitFor()
  fail = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  const code = page.getByRole('region', { name: 'BGM 代码', exact: true }).locator('code')
  await code.waitFor()
  assert.equal(await code.textContent(), html)
  assert.equal(await page.evaluate(() => document.body.dataset.executed), undefined)
  assert.equal(await page.getByRole('switch', { name: 'BGM 运行' }).isChecked(), false)
  await page.getByRole('button', { name: 'BGM · 收起代码', exact: true }).click()
  await code.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '停用工具 · 查看代码', exact: true }).click()
  const empty = page.getByRole('region', { name: '停用工具 代码', exact: true }).locator('code')
  await empty.waitFor()
  assert.equal(await empty.textContent(), '（空）')
  assert.equal(await page.getByRole('switch', { name: '停用工具 运行' }).isDisabled(), true)
  assert.equal(calls.some(call => call.method === 'setCardScriptMuted'), false)
  assert.deepEqual(calls.filter(call => call.method === 'getCardScriptSource')
    .map(({ args }) => [args.sessionId, args.id, args.ref]), [
    ['game', 'bgm', 'helper:0'], ['game', 'bgm', 'helper:0'], ['game', 'disabled', 'helper:1']
  ])
})
