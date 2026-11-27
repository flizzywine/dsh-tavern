import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { readGameSave } from '../tavern-plugin/lib/domain/game-save.js'
import { buildTransferManifest, createTransferBundleWriter, readTransferBundle, readTransferBundleFile, transferItem } from '../tavern-plugin/lib/domain/transfer-bundle.js'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
import { createProfileDataStore, TAVERN_SETTINGS_PATH } from '../tavern-plugin/lib/profile-data-store.js'
import { exportRescueBundle, listRescueParts } from '../tavern-plugin/lib/rescue-export.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const SCRIPT = path.join(REPO_ROOT, 'tavern-plugin', 'lib', 'rescue-export.mjs')

async function seedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-test-'))
  const dshHome = path.join(root, '.dsh-tavern')
  const profileRoot = path.join(dshHome, 'profile-data', 'tavern')
  const dataRoot = path.join(profileRoot, 'data')
  const sessionsRoot = path.join(profileRoot, 'sessions')
  await mkdir(dataRoot, { recursive: true })

  const fileResources = createFileResourceStore({ dataRoot })
  const profileData = createProfileDataStore({ dataRoot })

  // 1) 人物卡
  const cardPayload = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '林雾',
      description: '茶馆掌柜',
      personality: '温和',
      scenario: '雨夜茶馆',
      first_mes: '请进，外面雨大。',
      mes_example: ''
    }
  }
  const cardPath = await fileResources.importCard({
    kind: 'text',
    name: 'linwu.json',
    text: JSON.stringify(cardPayload)
  }, {
    kind: 'card-workspace',
    version: 1,
    raw: cardPayload,
    draft: cardPayload.data
  })

  // 2) 世界书
  const worldBookDoc = {
    name: '江南风物志',
    entries: {
      '0': { uid: 0, key: ['茶馆'], content: '城西老茶馆', comment: '茶馆设定', disable: false }
    }
  }
  await fileResources.importWorldBook(
    { kind: 'text', name: 'jiangnan.json', text: JSON.stringify(worldBookDoc) },
    worldBookDoc
  )

  // 3) 预设
  await fileResources.importText('preset', {
    name: '默认写法.json',
    text: JSON.stringify({ prompts: [{ identifier: 'main', name: '主提示词', content: '保持克制细腻的文风。' }] })
  })

  // 4) 酒馆设置（故意混入不应导出的敏感字段）
  await profileData.writeJson(TAVERN_SETTINGS_PATH, {
    candidatePickMode: 'send',
    recentReplyFirst: true,
    apiKey: 'sk-should-never-be-exported',
    secretToken: 'top-secret'
  })

  // 5) 完好对局 + 原生会话日志
  const chatJournalStore = createChatJournalStore({
    dataRoot,
    legacyData: profileData,
    now: Date.now,
    logger: { warn() {}, error() {}, log() {} },
    backgroundSnapshots: false,
    newConversations: true,
    migrateLegacy: false
  })
  const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: c => c, now: Date.now })
  const goodChat = {
    id: 'chat-good1',
    sessionId: 'sess-good1',
    mode: 'story',
    requestMode: 'dsh',
    title: '雨夜初遇',
    cardPath,
    cardName: '林雾',
    macroState: { userName: '你', local: {}, global: {} },
    messages: [
      { id: 'm1', role: 'assistant', turn: 1, greeting: true, content: '请进，外面雨大。' },
      { id: 'm2', role: 'user', turn: 2, content: '来一壶龙井。' },
      { id: 'm3', role: 'assistant', turn: 2, content: '好嘞，稍等。' }
    ]
  }
  await chatPersistence.write(goodChat)
  await profileData.writeJson('index.json', {
    cards: [{ path: cardPath, name: '林雾' }],
    chats: [{ id: 'chat-good1', sessionId: 'sess-good1', title: '雨夜初遇', cardName: '林雾', cardPath, mode: 'story' }]
  })
  await profileData.writeJson('sessions.json', { 'sess-good1': 'chat-good1' })

  const sessionDir = path.join(sessionsRoot, 'proj-a', 'sess-good1')
  await mkdir(sessionDir, { recursive: true })
  await writeFile(path.join(sessionDir, 'session.jsonl'),
    JSON.stringify({ id: 'sess-good1', version: 1, inheritedEventCount: 0 }) + '\n' +
    JSON.stringify({ seq: 0, type: 'user/message', content: '来一壶龙井。' }) + '\n',
    'utf8')

  // 6) 额外塞一个损坏的对局文件，验证救援时能跳过它并继续救出完好对局
  await mkdir(path.join(dataRoot, 'chats'), { recursive: true })
  await writeFile(path.join(dataRoot, 'chats', 'chat-broken1.json'), '{"id":"chat-broken1","sessionId":', 'utf8')

  return { root, dshHome, dataRoot }
}

test('exportRescueBundle 离线导出标准 .dshtransfer，不含敏感字段且跳过损坏项', async () => {
  const fixture = await seedFixture()
  try {
    const outFile = path.join(fixture.root, 'out', 'rescue.dshtransfer')
    const statuses = []
    const res = await exportRescueBundle({
      dshHome: fixture.dshHome,
      sourceRoot: REPO_ROOT,
      outFile,
      onStatus: msg => statuses.push(msg)
    })

    assert.ok(statuses.length > 0, '应上报进度状态')
    assert.ok(res.bytes > 0)
    const raw = await readFile(outFile)
    const bundle = readTransferBundle(raw)
    assert.deepEqual(bundle.issues, [], '导出的 .dshtransfer 校验不应有问题')

    const kinds = new Set(bundle.manifest.parts.map(p => p.kind))
    assert.ok(kinds.has('cards'), '应包含人物卡')
    assert.ok(kinds.has('worldbooks'), '应包含世界书')
    assert.ok(kinds.has('presets'), '应包含预设')
    assert.ok(kinds.has('settings'), '应包含酒馆设置')
    assert.ok(kinds.has('chats'), '应包含完好的对话与存档')
    assert.ok(!kinds.has('logs'), '救援包默认不带诊断日志')

    // 确认酒馆设置只带白名单字段，不泄露 API key
    const settingsPart = bundle.manifest.parts.find(p => p.kind === 'settings')
    const settingsJson = JSON.parse(bundle.files.get(settingsPart.items[0].entry).toString('utf8'))
    assert.equal(settingsJson.candidatePickMode, 'send')
    assert.equal(settingsJson.recentReplyFirst, true)
    assert.equal(settingsJson.apiKey, undefined)
    assert.equal(settingsJson.secretToken, undefined)

    // 确认完好对局成功导出
    const chatsPart = bundle.manifest.parts.find(p => p.kind === 'chats')
    assert.equal(chatsPart.items.length, 1)
    assert.equal(chatsPart.items[0].title, '雨夜初遇')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rescue-export.mjs CLI 按 DSH_STATUS / DSH_PROGRESS / RESULT 协议输出', async () => {
  const fixture = await seedFixture()
  try {
    const outFile = path.join(fixture.root, 'cli-rescue.dshtransfer')
    const run = spawnSync(process.execPath, [SCRIPT, '--out', outFile, '--dsh-home', fixture.dshHome, '--source-root', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    })
    assert.equal(run.status, 0, `CLI 退出码非 0：\n${run.stdout}\n${run.stderr}`)
    const lines = run.stdout.split(/\r?\n/).filter(Boolean)
    assert.ok(lines.some(line => line.startsWith('DSH_STATUS ')), '应输出 DSH_STATUS 行')
    assert.ok(lines.some(line => line.startsWith('DSH_PROGRESS ')), '应输出 DSH_PROGRESS 行')
    const resultLine = lines.find(line => line.startsWith('RESULT '))
    assert.ok(resultLine, '应输出 RESULT 行')
    const parsed = JSON.parse(resultLine.slice('RESULT '.length))
    assert.equal(parsed.kind, 'ok')
    assert.ok(parsed.filename.endsWith('.dshtransfer'))
    assert.ok(parsed.totals.items >= 4)

    const bundle = readTransferBundle(await readFile(outFile))
    assert.deepEqual(bundle.issues, [])
    const streamed = await readTransferBundleFile(outFile)
    try {
      assert.deepEqual(streamed.issues, [])
      assert.equal(streamed.manifest.totals.items, bundle.manifest.totals.items)
    } finally {
      await streamed.close()
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rescue-export.mjs --list 扫描可导出板块与 --selection-file 局部逐项导出', async () => {
  const fixture = await seedFixture()
  try {
    // 额外加第二张人物卡，验证可以只导出指定单张卡 + 指定单局对话
    const fileResources = createFileResourceStore({ dataRoot: fixture.dataRoot })
    const secondCard = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '沈青', description: '画师', personality: '沉静', scenario: '画室', first_mes: '请坐。', mes_example: '' }
    }
    const secondCardPath = await fileResources.importCard(
      { kind: 'text', name: 'shenqing.json', text: JSON.stringify(secondCard) },
      { kind: 'card-workspace', version: 1, raw: secondCard, draft: secondCard.data }
    )

    // 1) --list 扫描
    const listRun = spawnSync(process.execPath, [SCRIPT, '--list', '--dsh-home', fixture.dshHome, '--source-root', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    })
    assert.equal(listRun.status, 0, `CLI --list 失败：\n${listRun.stdout}\n${listRun.stderr}`)
    const listLine = listRun.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT '))
    assert.ok(listLine, '应输出 RESULT 行')
    const listed = JSON.parse(listLine.slice('RESULT '.length))
    assert.equal(listed.kind, 'list')
    assert.ok(Array.isArray(listed.groups) && listed.groups.length >= 3)
    const cardPart = listed.parts.find(p => p.kind === 'cards')
    assert.ok(cardPart && cardPart.items.length === 2, '应列出 2 张人物卡')
    assert.ok(!listed.parts.some(p => p.kind === 'logs'), '救援列表不含 exportOnly 诊断日志')

    // 2) --selection-file + --no-images 仅导出第二张卡和酒馆设置
    const selFile = path.join(fixture.root, 'selection.json')
    await writeFile(selFile, JSON.stringify({ cards: [secondCardPath], settings: ['current'] }), 'utf8')
    const outFile = path.join(fixture.root, 'partial.dshtransfer')
    const exportRun = spawnSync(process.execPath, [
      SCRIPT, '--out', outFile, '--dsh-home', fixture.dshHome, '--source-root', REPO_ROOT,
      '--selection-file', selFile, '--no-images'
    ], { cwd: REPO_ROOT, encoding: 'utf8' })
    assert.equal(exportRun.status, 0, `CLI 局部导出失败：\n${exportRun.stdout}\n${exportRun.stderr}`)

    const streamed = await readTransferBundleFile(outFile)
    try {
      assert.deepEqual(streamed.issues, [])
      const kinds = new Set(streamed.manifest.parts.map(p => p.kind))
      assert.deepEqual([...kinds].sort(), ['cards', 'settings'])
      const cards = streamed.manifest.parts.find(p => p.kind === 'cards')
      assert.equal(cards.items.length, 1)
      assert.equal(cards.items[0].key, secondCardPath)
      const exportedCard = JSON.parse((await streamed.files.get(cards.items[0].entry)).toString('utf8'))
      assert.equal(exportedCard.data.name, '沈青')
    } finally {
      await streamed.close()
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('exportRescueBundle 同包带世界书/预设时不在对话存档里重复嵌入快照', async () => {
  const fixture = await seedFixture()
  try {
    const fileResources = createFileResourceStore({ dataRoot: fixture.dataRoot })
    const profileData = createProfileDataStore({ dataRoot: fixture.dataRoot })
    const cards = await fileResources.list('card')
    const books = await fileResources.list('worldbook')
    const presets = await fileResources.list('preset')
    await fileResources.bindWorldBook(cards[0], books[0])

    const chatJournalStore = createChatJournalStore({
      dataRoot: fixture.dataRoot,
      legacyData: profileData,
      now: Date.now,
      logger: { warn() {}, error() {}, log() {} },
      backgroundSnapshots: false,
      newConversations: true,
      migrateLegacy: false
    })
    const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: c => c, now: Date.now })
    const chat = await chatPersistence.read('chat-good1')
    chat.openingWorldbookSnapshot = { name: '江南风物志', entries: [{ uid: 0, content: '很大的一本世界书' }] }
    chat.runtimePresetPath = presets[0]
    chat.runtimePresetSnapshot = { prompts: [{ identifier: 'main', content: '预设快照' }] }
    await chatPersistence.write(chat)

    // 同时选 chats + worldbooks + presets → 对话存档应省去重复的世界书和预设快照
    const dedupOut = path.join(fixture.root, 'dedup.dshtransfer')
    await exportRescueBundle({
      dshHome: fixture.dshHome,
      sourceRoot: REPO_ROOT,
      outFile: dedupOut,
      selection: { chats: ['chat-good1'], worldbooks: ['*'], presets: ['*'] }
    })
    const dedupBundle = readTransferBundle(await readFile(dedupOut))
    const dedupChatEntry = dedupBundle.manifest.parts.find(p => p.kind === 'chats').items[0].entry
    const dedupSave = readGameSave(dedupBundle.files.get(dedupChatEntry))
    assert.equal(dedupSave.chat.openingWorldbookSnapshot, undefined, '同包带世界书时应去掉重复开局世界书快照')
    assert.equal(dedupSave.chat.runtimePresetSnapshot, undefined, '同包带预设时应去掉重复预设快照')

    // 只选 chats → 单独导出对局必须保留快照以自包含
    const soloOut = path.join(fixture.root, 'solo.dshtransfer')
    await exportRescueBundle({
      dshHome: fixture.dshHome,
      sourceRoot: REPO_ROOT,
      outFile: soloOut,
      selection: { chats: ['chat-good1'] }
    })
    const soloBundle = readTransferBundle(await readFile(soloOut))
    const soloChatEntry = soloBundle.manifest.parts.find(p => p.kind === 'chats').items[0].entry
    const soloSave = readGameSave(soloBundle.files.get(soloChatEntry))
    assert.ok(soloSave.chat.openingWorldbookSnapshot, '只导对话时应保留开局世界书快照')
    assert.ok(soloSave.chat.runtimePresetSnapshot, '只导对话时应保留预设快照')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('createTransferBundleWriter 流式写盘：已压缩后缀直存、文本压缩、超限中止并清临时文件', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-stream-zip-test-'))
  try {
    const outFile = path.join(dir, 'stream.dshtransfer')
    const writer = await createTransferBundleWriter(outFile)
    const textContent = Buffer.from(JSON.stringify({ hello: 'world'.repeat(200) }), 'utf8')
    const fakeSave = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])
    await writer.addEntry('parts/settings/tavern-settings.json', textContent)
    await writer.addEntry('parts/chats/game.dshsave', fakeSave)
    const manifest = buildTransferManifest({
      name: '流式测试',
      parts: [
        { kind: 'settings', label: '酒馆设置', items: [transferItem({ key: 'current', title: '酒馆设置', entry: 'parts/settings/tavern-settings.json', content: textContent })] },
        { kind: 'chats', label: '对话与存档', items: [transferItem({ key: 'chat-1', title: '测试局', entry: 'parts/chats/game.dshsave', content: fakeSave })] }
      ]
    })
    await writer.finalize(manifest)

    // 验证压缩方式：.json 用 deflate(8)，.dshsave 直存(0)
    const zip = await openZipFile(outFile)
    try {
      assert.equal(zip.entries.get('parts/settings/tavern-settings.json').method, 8)
      assert.equal(zip.entries.get('parts/chats/game.dshsave').method, 0)
      assert.ok(zip.entries.has('manifest.json'))
    } finally {
      await zip.close()
    }

    // 两种读取器均可无错校验
    assert.deepEqual(readTransferBundle(await readFile(outFile)).issues, [])
    const streamed = await readTransferBundleFile(outFile)
    try {
      assert.deepEqual(streamed.issues, [])
      assert.equal(streamed.manifest.totals.items, 2)
    } finally {
      await streamed.close()
    }

    // 超限中止时应清理临时文件
    const smallOut = path.join(dir, 'limited.dshtransfer')
    const limited = await createTransferBundleWriter(smallOut, { maxArchiveBytes: 200 })
    await assert.rejects(
      async () => {
        try {
          await limited.addEntry('parts/chats/big.dshsave', Buffer.alloc(512, 7))
        } catch (err) {
          await limited.abort()
          throw err
        }
      },
      /请取消一部分板块后分两次导出/
    )
    const leftovers = (await readdir(dir)).filter(name => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [], '中止后不应残留 .tmp-* 临时文件')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listRescueParts API 返回分组、板块与条目元数据', async () => {
  const fixture = await seedFixture()
  try {
    const listed = await listRescueParts({ dshHome: fixture.dshHome, sourceRoot: REPO_ROOT })
    assert.ok(listed.groups.some(g => g.id === 'story'))
    assert.ok(listed.groups.some(g => g.id === 'lore'))
    const chats = listed.parts.find(p => p.kind === 'chats')
    assert.ok(chats && chats.items.length === 1)
    assert.equal(chats.items[0].title, '雨夜初遇')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
