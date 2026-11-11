import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { validateCardText } from '../tavern-plugin/lib/domain/card-validation.js'
import { parseChatHistory } from '../tavern-plugin/lib/domain/chat-history-import.js'
import {
  buildSillyTavernMigrationScript,
  convertWorldInfoToCharacterBook,
  exportSillyTavernMigrationScript,
  MIGRATION_HELPER_BUTTON_NAME,
  MIGRATION_HELPER_FILENAME,
  MIGRATION_HELPER_SCRIPT_ID,
  MIGRATION_HELPER_SCRIPT_NAME,
  normalizeSillyTavernCardForDsh,
  packMigrationTransferBundle,
  sanitizeSillyTavernChatForDsh
} from '../tavern-plugin/lib/domain/sillytavern-migration-helper.js'
import { readTransferBundle } from '../tavern-plugin/lib/domain/transfer-bundle.js'
import { createTransferChats } from '../tavern-plugin/lib/domain/transfer-chats.js'
import { createTransferImport } from '../tavern-plugin/lib/domain/transfer-import.js'

test('buildSillyTavernMigrationScript 生成符合 JS-Slash-Runner Script Schema 的脚本且与示例文件一致', async () => {
  const script = buildSillyTavernMigrationScript()
  assert.equal(script.type, 'script')
  assert.equal(script.enabled, true)
  assert.equal(script.id, MIGRATION_HELPER_SCRIPT_ID)
  assert.equal(script.name, MIGRATION_HELPER_SCRIPT_NAME)
  assert.equal(typeof script.content, 'string')
  assert.equal(typeof script.info, 'string')
  assert.deepEqual(script.button, {
    enabled: true,
    buttons: [{ name: MIGRATION_HELPER_BUTTON_NAME, visible: true }]
  })
  assert.deepEqual(script.data, {})
  assert.deepEqual(script.export_with, { data: true, button: true })

  // 验证注入到 iframe 的脚本语法合法
  assert.doesNotThrow(() => new Function(script.content))

  const exportedText = exportSillyTavernMigrationScript()
  const standalonePath = path.resolve('examples/sillytavern-migration-helper', MIGRATION_HELPER_FILENAME)
  const fileText = await readFile(standalonePath, 'utf8')
  assert.equal(fileText, exportedText)
})

test('sanitizeSillyTavernChatForDsh 清洗 SillyTavern 复杂聊天记录并通过 parseChatHistory 校验', () => {
  const rawLines = [
    JSON.stringify({
      user_name: '旅行者',
      character_name: '星野',
      create_date: '2026-11-09@12h00m00s',
      chat_metadata: { note_prompt: '保持温柔' }
    }),
    // 系统提示消息（将被跳过）
    JSON.stringify({
      name: 'System',
      is_user: false,
      is_system: true,
      mes: '[系统初始化]'
    }),
    // 旁白消息（自动转为角色叙述或跳过，不会触发 parseChatHistory 报错）
    JSON.stringify({
      name: 'Narrator',
      is_user: false,
      mes: '夜幕降临在旧校舍。',
      extra: { type: 'narrator', reasoning: 'internal thought' }
    }),
    // 玩家消息，带图片/文件附件字段
    JSON.stringify({
      name: '旅行者',
      is_user: true,
      send_date: '2026-11-09 12:01',
      mes: '你在看什么？',
      extra: {
        image: 'data:image/png;base64,AAA',
        file: { name: 'note.txt' },
        media: [{ url: 'x.png' }]
      }
    }),
    // AI 回复：使用多 swipe + 对象格式的 variables + 工具调用残留 + 别名角色名
    JSON.stringify({
      name: '星野（礼服）',
      is_user: false,
      send_date: '2026-11-09 12:02',
      swipe_id: 1,
      swipes: ['初稿回复', '「在看今晚的猎户座。」她转过头微笑。'],
      mes: '旧正文',
      variables: {
        0: { stat_data: { affection: 10 } },
        1: { stat_data: { affection: 25, mood: '平静' } }
      },
      extra: {
        tool_invocations: [{ name: 'status' }],
        reasoning: '思考内容'
      }
    }),
    // 空消息（应被跳过）
    JSON.stringify({
      name: '旅行者',
      is_user: true,
      mes: '   '
    })
  ]

  const cleaned = sanitizeSillyTavernChatForDsh(rawLines.join('\n'), { characterName: '星野' })
  assert.equal(cleaned.usable, true)
  assert.equal(cleaned.characterName, '星野')
  assert.equal(cleaned.userName, '旅行者')
  assert.equal(cleaned.messageCount, 2)
  assert.equal(cleaned.turnCount, 1)
  assert.equal(cleaned.skippedCount, 3)

  const parsed = parseChatHistory(cleaned.jsonl)
  assert.equal(parsed.messages.length, 2)
  assert.equal(parsed.userName, '旅行者')
  assert.equal(parsed.hasMvu, true)
  assert.equal(parsed.messages[0].role, 'user')
  assert.equal(parsed.messages[0].text, '你在看什么？')
  assert.equal(parsed.messages[1].role, 'assistant')
  assert.equal(parsed.messages[1].name, '星野')
  assert.equal(parsed.messages[1].text, '「在看今晚的猎户座。」她转过头微笑。')
  assert.deepEqual(parsed.messages[1].variables, { stat_data: { affection: 25, mood: '平静' } })
})

test('sanitizeSillyTavernChatForDsh 超出 2000 条消息时截取最近消息并继承此前 MVU 变量快照', () => {
  const rows = [
    { user_name: '阿九', character_name: '侦探', chat_metadata: {} },
    {
      name: '侦探',
      is_user: false,
      mes: '第 1 条（含初始快照）',
      swipe_id: 0,
      variables: [{ stat_data: { clue: 3 } }]
    }
  ]
  for (let i = 2; i <= 2005; i++) {
    rows.push({
      name: i % 2 === 0 ? '阿九' : '侦探',
      is_user: i % 2 === 0,
      mes: '消息 #' + i
    })
  }
  const cleaned = sanitizeSillyTavernChatForDsh(rows, { characterName: '侦探' })
  assert.equal(cleaned.usable, true)
  assert.equal(cleaned.truncatedCount, 5)
  assert.equal(cleaned.messageCount, 2000)

  const parsed = parseChatHistory(cleaned.jsonl)
  assert.equal(parsed.messages.length, 2000)
  assert.equal(parsed.hasMvu, true)
  assert.deepEqual(parsed.messages[0].variables, { stat_data: { clue: 3 } })
  assert.equal(parsed.messages.at(-1).text, '消息 #2005')
})

test('normalizeSillyTavernCardForDsh 与 convertWorldInfoToCharacterBook 生成可通过 validateCardText 的 V3 人物卡', () => {
  const worldInfo = {
    name: '学园设定集',
    entries: {
      0: {
        uid: 0,
        key: ['旧校舍', '天文台'],
        keysecondary: ['夜晚'],
        comment: '地点背景',
        content: '旧校舍顶楼有一座废弃天文台。',
        constant: false,
        selective: true,
        order: 100,
        position: 0,
        disable: false
      }
    }
  }
  const book = convertWorldInfoToCharacterBook(worldInfo, '学园设定集')
  assert.equal(Array.isArray(book.entries), true)
  assert.equal(book.entries.length, 1)
  assert.deepEqual(book.entries[0].keys, ['旧校舍', '天文台'])

  const rawChar = {
    name: '星野',
    description: '天文社社长',
    personality: '温和安静',
    scenario: '旧校舍屋顶',
    first_mes: '今晚的星空很清楚。',
    mes_example: '<START>\n{{user}}: 你好\n{{char}}: 晚上好。',
    data: {
      alternate_greetings: ['你来了？'],
      tags: ['学园', '日常'],
      extensions: { world: '学园设定集' }
    }
  }
  const card = normalizeSillyTavernCardForDsh(rawChar, { characterBook: book })
  const text = JSON.stringify(card, null, 2)
  const validated = validateCardText(text)
  assert.equal(validated.valid, true)
  assert.deepEqual(validated.errors, [])
  assert.equal(card.name, '星野')
  assert.equal(card.data.character_book.entries.length, 1)
})

test('packMigrationTransferBundle 打包的 .dshtransfer 可直接通过 DSH Tavern 预览并导入人物卡与聊天记录', async () => {
  const cardDoc = normalizeSillyTavernCardForDsh({
    name: '星野',
    description: '天文社社长',
    first_mes: '今晚的星空很清楚。'
  })
  const chat1 = sanitizeSillyTavernChatForDsh([
    { user_name: '旅行者', character_name: '星野', chat_metadata: {} },
    { name: '星野', is_user: false, mes: '今晚的星空很清楚。' },
    { name: '旅行者', is_user: true, mes: '借我看一下望远镜。' },
    { name: '星野', is_user: false, mes: '给，小心别碰偏了焦距。' }
  ], { characterName: '星野' })
  const chat2 = sanitizeSillyTavernChatForDsh([
    { user_name: '旅行者', character_name: '星野', chat_metadata: {} },
    { name: '星野', is_user: false, mes: '下雨了，今晚观测取消。' },
    { name: '旅行者', is_user: true, mes: '那我们在活动室喝茶吧。' },
    { name: '星野', is_user: false, mes: '好主意，我带了红茶。' }
  ], { characterName: '星野' })

  const packed = packMigrationTransferBundle({
    name: 'SillyTavern迁移测试包',
    cards: [{ key: 'char-hoshino', title: '星野', fileName: '星野.json', content: JSON.stringify(cardDoc, null, 2) }],
    worldbooks: [{
      key: 'wb-academy',
      title: '学园设定集',
      fileName: '学园设定集.json',
      content: JSON.stringify({ name: '学园设定集', entries: {} }, null, 2)
    }],
    chats: [
      { key: 'chat-1', title: '星野 · 晴夜观测', fileName: '星野_晴夜观测.jsonl', content: chat1.jsonl },
      { key: 'chat-2', title: '星野 · 雨夜红茶', fileName: '星野_雨夜红茶.jsonl', content: chat2.jsonl }
    ]
  })

  // 校验 ZIP 结构、manifest 与 SHA-256 哈希无任何问题
  const bundle = readTransferBundle(Buffer.from(packed.bytes))
  assert.deepEqual(bundle.issues, [])
  assert.deepEqual(bundle.manifest.parts.map(p => p.kind), ['cards', 'worldbooks', 'chats'])

  // 搭建目标机导入环境（初始没有任何人物卡）
  const storedCards = new Map()
  const storedWorldbooks = new Map()
  const importedChats = []
  const sessions = []
  const chatRecords = new Map()

  const fileResources = {
    async list(kind) {
      if (kind === 'card') return [...storedCards.keys()]
      if (kind === 'worldbook') return [...storedWorldbooks.keys()]
      return []
    },
    async readText(p) {
      return storedCards.get(p) ?? storedWorldbooks.get(p)
    }
  }

  const transferChats = createTransferChats({
    async listSessions() { return sessions },
    async readChat(id) { return chatRecords.get(id) },
    async exportSave() { throw new Error('unused') },
    async importSave() { throw new Error('should not call importSave for .jsonl') },
    async updateChat(chatId, updater) {
      const current = chatRecords.get(chatId)
      if (current) chatRecords.set(chatId, updater(current))
    },
    fileResources,
    async importChatHistory(args) {
      const parsed = parseChatHistory(args.text)
      const chatId = 'chat-' + (importedChats.length + 1)
      const sessionId = 'session-' + (importedChats.length + 1)
      const record = {
        id: chatId,
        sessionId,
        cardPath: args.cardPath,
        cardName: '星野',
        title: args.fileName.replace(/\.jsonl$/i, ''),
        mode: 'story',
        requestMode: 'tavern',
        messages: parsed.messages,
        importHistory: { digest: parsed.digest }
      }
      importedChats.push({ ...args, chatId, sessionId })
      sessions.push({ id: chatId, sessionId, title: record.title, cardName: '星野', mode: 'story', requestMode: 'tavern' })
      chatRecords.set(chatId, record)
      return { chatId, sessionId, title: record.title, mode: 'story' }
    }
  })

  const importer = createTransferImport({
    fileResources,
    worldBooks: {
      async catalog() { return { standalone: [], embedded: [], diagnostics: [] } },
      async import(payload) {
        const p = 'worldbooks/' + payload.name
        storedWorldbooks.set(p, payload.text)
        return { kind: 'standalone', path: p, name: payload.name.replace(/\.json$/, ''), entryCount: 0 }
      }
    },
    presetLibrary: { async catalog() { return { presets: [] } } },
    promptDocuments: {},
    userPreferenceProfile: { async read() { return { profiles: [] } } },
    regexManager: { async read() { return { global: [] } } },
    readTavernSettings: () => ({}),
    updateTavernSettings: async () => ({}),
    async importCard(payload) {
      const p = 'cards/' + payload.name
      storedCards.set(p, payload.text)
      return { path: p }
    },
    importPreset: async () => ({}),
    backup: async () => '',
    chats: transferChats
  })

  // 1. 预览：虽然本机尚无「星野」人物卡，但包内自带了「星野」人物卡，所以两条聊天记录均可导入
  const preview = await importer.preview(bundle.manifest, bundle.files)
  assert.equal(preview.canApply, true)
  const chatPartPreview = preview.parts.find(p => p.kind === 'chats')
  assert.equal(chatPartPreview.selectable, 2)
  assert.equal(chatPartPreview.items.every(item => item.usable === true && item.duplicate === false), true)

  // 2. 应用导入：先落盘人物卡，再导入两条聊天记录
  const applied = await importer.apply({ manifest: bundle.manifest, files: bundle.files })
  const byKind = Object.fromEntries(applied.results.map(r => [r.kind, r]))
  assert.equal(byKind.cards.added, 1)
  assert.equal(byKind.worldbooks.added, 1)
  assert.equal(byKind.chats.added, 2)
  assert.equal(byKind.chats.failed.length, 0)
  assert.equal(importedChats.length, 2)
  assert.equal(importedChats[0].cardPath, 'cards/星野.json')
  assert.equal(importedChats[1].cardPath, 'cards/星野.json')

  // 3. 再次预览同一个包：人物卡与聊天记录均被识别为重复，默认跳过
  const previewAgain = await importer.preview(bundle.manifest, bundle.files)
  const chatPartAgain = previewAgain.parts.find(p => p.kind === 'chats')
  assert.equal(chatPartAgain.items.every(item => item.duplicate === true), true)
})

test('包内与本机均缺少对应人物卡时，预览提示缺少人物卡且不勾选；MVU 变量不兼容时自动回退为仅导正文', async () => {
  const chat = sanitizeSillyTavernChatForDsh([
    { user_name: '旅行者', character_name: '未知少女', chat_metadata: {} },
    { name: '未知少女', is_user: false, mes: '你好。', swipe_id: 0, variables: [{ stat_data: { oldKey: 1 } }] }
  ], { characterName: '未知少女' })

  const packed = packMigrationTransferBundle({
    name: '仅聊天记录迁移包',
    chats: [{ key: 'chat-only', title: '未知少女 · 第 1 局', fileName: '未知少女.jsonl', content: chat.jsonl }]
  })
  const bundle = readTransferBundle(Buffer.from(packed.bytes))

  const storedCards = new Map()
  const calls = []
  const fileResources = {
    async list(kind) { return kind === 'card' ? [...storedCards.keys()] : [] },
    async readText(p) { return storedCards.get(p) }
  }
  const transferChats = createTransferChats({
    async listSessions() { return [] },
    async readChat() { return null },
    async exportSave() { throw new Error('unused') },
    async importSave() { throw new Error('unused') },
    fileResources,
    async importChatHistory(args) {
      calls.push(args)
      if (!args.textOnly) throw new Error('变量结构与人物卡不兼容，请换卡或选择仅导入正文')
      return { chatId: 'chat-fallback', sessionId: 'session-fallback', title: '未知少女 · 第 1 局' }
    }
  })
  const importer = createTransferImport({
    fileResources,
    worldBooks: { async catalog() { return { standalone: [] } } },
    presetLibrary: { async catalog() { return { presets: [] } } },
    promptDocuments: {},
    userPreferenceProfile: { async read() { return { profiles: [] } } },
    regexManager: { async read() { return { global: [] } } },
    readTavernSettings: () => ({}),
    updateTavernSettings: async () => ({}),
    importCard: async () => ({}),
    importPreset: async () => ({}),
    backup: async () => '',
    chats: transferChats
  })

  // 本机无卡且包内无卡 -> 预览标记 usable: false 并给出提示
  const previewMissing = await importer.preview(bundle.manifest, bundle.files)
  const itemMissing = previewMissing.parts[0].items[0]
  assert.equal(itemMissing.usable, false)
  assert.match(itemMissing.reason, /缺少人物卡「未知少女」/)

  // 本机放入 DSH 工作台格式的人物卡后，预览变为可用，且应用时自动回退 textOnly: true
  storedCards.set('cards/girl-workspace.json', JSON.stringify({
    kind: 'dsh-tavern-character-workspace',
    version: 1,
    raw: { spec: 'chara_card_v3', data: { name: '未知少女', description: 'x' } }
  }))
  const previewReady = await importer.preview(bundle.manifest, bundle.files)
  assert.equal(previewReady.parts[0].items[0].usable, true)

  const applied = await importer.apply({ manifest: bundle.manifest, files: bundle.files })
  assert.equal(applied.results[0].added, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].textOnly, false)
  assert.equal(calls[1].textOnly, true)
  assert.equal(calls[1].cardPath, 'cards/girl-workspace.json')
})

test('移动端非安全上下文 operationId、旧版数组格式 tavern_helper 与首条消息 MVU 快照补齐兼容', () => {
  // 1. 旧版酒馆助手将 extensions.tavern_helper 存为键值对数组时，规范化后可通过人物卡校验
  const legacyCard = normalizeSillyTavernCardForDsh({
    name: 'Dr. Alice v1.2',
    first_mes: '你好。',
    data: {
      extensions: {
        tavern_helper: [
          ['scripts', [{ id: 's1', name: 'test', content: '' }]],
          ['variables', { hp: 100 }]
        ]
      }
    }
  })
  const cardValidation = validateCardText(JSON.stringify(legacyCard))
  assert.equal(cardValidation.valid, true)
  assert.deepEqual(cardValidation.errors, [])
  assert.equal(legacyCard.name, 'Dr. Alice v1.2')
  assert.deepEqual(legacyCard.data.extensions.tavern_helper.variables, { hp: 100 })

  // 2. 仅尾部或 chat_metadata 含 MVU 快照时，自动补齐到首条消息，使得 parsed.messages 不出现无快照缺口
  const sanitized = sanitizeSillyTavernChatForDsh([
    { user_name: '玩家', character_name: 'Dr. Alice v1.2', chat_metadata: { variables: { stat_data: { hp: 85 } } } },
    { name: 'Dr. Alice v1.2', is_user: false, mes: '第一轮回复' },
    { name: '玩家', is_user: true, mes: '继续' },
    { name: 'Dr. Alice v1.2', is_user: false, mes: '第二轮回复' }
  ])
  const parsed = parseChatHistory(sanitized.jsonl)
  assert.equal(parsed.hasMvu, true)
  assert.equal(parsed.messages.some(m => !m.variables), false)
  assert.deepEqual(parsed.messages[0].variables.stat_data, { hp: 85 })

  // 3. 误将 .dshtransfer 压缩包传给 parseChatHistory 时给出明确入口提示
  assert.throws(
    () => parseChatHistory('PK\u0003\u0004binaryzipcontent'),
    /这是压缩包（\.dshtransfer \/ \.dshsave）/
  )
})

