import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { readTransferBundle } from '../tavern-plugin/lib/domain/transfer-bundle.js'
import { createProfileDataStore, TAVERN_SETTINGS_PATH } from '../tavern-plugin/lib/profile-data-store.js'
import { exportRescueBundle } from '../tavern-plugin/lib/rescue-export.mjs'

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
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
