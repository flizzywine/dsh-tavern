// SillyTavern 酒馆助手（JS-Slash-Runner）迁移插件生成器与数据清洗工具。
// 生成的 JSON 脚本可直接导入酒馆助手，在 SillyTavern 内批量勾选角色与聊天记录并打包为 `.dshtransfer`。

export const MIGRATION_HELPER_SCRIPT_ID = 'dsh-tavern-migration-helper'
export const MIGRATION_HELPER_SCRIPT_NAME = 'dsh-tavern迁移助手'
export const MIGRATION_HELPER_BUTTON_NAME = '📦 DSH 迁移导出'
export const MIGRATION_HELPER_FILENAME = '酒馆助手脚本-dsh-tavern迁移助手.json'

/**
 * 构建在浏览器与 Node 环境均可独立运行的迁移核心函数集合。
 * 通过函数序列化注入到酒馆助手脚本 iframe 中，保证线上脚本与单测逻辑完全同源。
 */
export function createMigrationHelperCore() {
  function str(value) {
    return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function safeFileName(value, fallback = 'untitled') {
    const cleaned = str(value)
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80)
    return cleaned || fallback
  }

  function utf8Bytes(input) {
    if (input instanceof Uint8Array) return input
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    return new TextEncoder().encode(str(input))
  }

  // 纯 JS SHA-256：兼容 SillyTavern 局域网 HTTP 环境（非 Secure Context 下无 crypto.subtle）。
  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])

  function sha256Hex(input) {
    const data = utf8Bytes(input)
    const bitLenHi = Math.floor((data.length * 8) / 0x100000000)
    const bitLenLo = (data.length * 8) >>> 0
    const padLen = ((data.length + 9 + 63) & ~63)
    const padded = new Uint8Array(padLen)
    padded.set(data, 0)
    padded[data.length] = 0x80
    const view = new DataView(padded.buffer)
    view.setUint32(padLen - 8, bitLenHi, false)
    view.setUint32(padLen - 4, bitLenLo, false)

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
    const w = new Uint32Array(64)

    for (let offset = 0; offset < padLen; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false)
      for (let i = 16; i < 64; i++) {
        const v0 = w[i - 15], v1 = w[i - 2]
        const s0 = ((v0 >>> 7) | (v0 << 25)) ^ ((v0 >>> 18) | (v0 << 14)) ^ (v0 >>> 3)
        const s1 = ((v1 >>> 17) | (v1 << 15)) ^ ((v1 >>> 19) | (v1 << 13)) ^ (v1 >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
        const ch = (e & f) ^ (~e & g)
        const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const temp2 = (S0 + maj) >>> 0
        h = g; g = f; f = e; e = (d + temp1) >>> 0
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(n => n.toString(16).padStart(8, '0')).join('')
  }

  const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    return value >>> 0
  })

  function crc32(bytes) {
    let value = 0xffffffff
    for (let i = 0; i < bytes.length; i++) value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
  }

  function writeZipStored(entries) {
    const localParts = []
    const centralParts = []
    let offset = 0
    for (const entry of entries) {
      const nameBytes = utf8Bytes(entry.path)
      const dataBytes = utf8Bytes(entry.content)
      const crc = crc32(dataBytes)

      const header = new Uint8Array(30)
      const hv = new DataView(header.buffer)
      hv.setUint32(0, 0x04034b50, true)
      hv.setUint16(4, 20, true)
      hv.setUint16(6, 0x0800, true) // UTF-8
      hv.setUint16(8, 0, true) // STORED
      hv.setUint16(12, 0x0021, true)
      hv.setUint32(14, crc, true)
      hv.setUint32(18, dataBytes.length, true)
      hv.setUint32(22, dataBytes.length, true)
      hv.setUint16(26, nameBytes.length, true)

      const central = new Uint8Array(46)
      const cv = new DataView(central.buffer)
      cv.setUint32(0, 0x02014b50, true)
      cv.setUint16(4, 20, true)
      central.set(header.subarray(4, 30), 6)
      cv.setUint32(42, offset, true)

      localParts.push(header, nameBytes, dataBytes)
      centralParts.push(central, nameBytes)
      offset += header.length + nameBytes.length + dataBytes.length
    }

    let centralLength = 0
    for (const part of centralParts) centralLength += part.length
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, entries.length, true)
    ev.setUint16(10, entries.length, true)
    ev.setUint32(12, centralLength, true)
    ev.setUint32(16, offset, true)

    const totalLength = offset + centralLength + eocd.length
    const out = new Uint8Array(totalLength)
    let cursor = 0
    for (const part of localParts) { out.set(part, cursor); cursor += part.length }
    for (const part of centralParts) { out.set(part, cursor); cursor += part.length }
    out.set(eocd, cursor)
    return out
  }

  /**
   * 清洗并转换单份 SillyTavern 聊天记录为 DSH Tavern `parseChatHistory` 兼容的 JSONL。
   */
  function sanitizeSillyTavernChatForDsh(rawInput, options = {}) {
    const maxMessages = Number(options.maxMessages) > 0 ? Number(options.maxMessages) : 2000
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 8 * 1024 * 1024
    const rows = []
    if (typeof rawInput === 'string') {
      const lines = rawInput.replace(/^\uFEFF/, '').split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (isPlainObject(parsed)) rows.push(parsed)
        } catch {
          // 跳过损坏行，保留有效楼层
        }
      }
    } else if (Array.isArray(rawInput)) {
      for (const item of rawInput) {
        if (isPlainObject(item)) rows.push(item)
      }
    }

    let rawHeader = null
    if (rows.length > 0 && (
      Object.prototype.hasOwnProperty.call(rows[0], 'chat_metadata') ||
      Object.prototype.hasOwnProperty.call(rows[0], 'user_name') ||
      Object.prototype.hasOwnProperty.call(rows[0], 'character_name') ||
      typeof rows[0].mes !== 'string'
    )) {
      rawHeader = rows.shift()
    }

    const fallbackAssistant = str(rows.find(r => r && r.is_user === false && r.is_system !== true && str(r.name).trim())?.name).trim()
    const fallbackUser = str(rows.find(r => r && r.is_user === true && str(r.name).trim())?.name).trim()
    const characterName = str(options.characterName || rawHeader?.character_name || rawHeader?.chat_metadata?.character_name || fallbackAssistant || '未命名角色').trim()
    const userName = str(options.userName || rawHeader?.user_name || fallbackUser || '你').trim()

    const header = {
      user_name: userName,
      character_name: characterName,
      create_date: str(rawHeader?.create_date || new Date().toISOString()),
      chat_metadata: Object.assign(
        {},
        isPlainObject(rawHeader?.chat_metadata) ? rawHeader.chat_metadata : {},
        {
          character_name: characterName,
          ...(options.characterAvatar ? { character_avatar: str(options.characterAvatar) } : {})
        }
      )
    }

    const warnings = []
    const cleanedMessages = []
    let skippedSystem = 0
    let skippedEmpty = 0
    let strippedAttachments = 0
    let hasMvu = false

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      if (row.is_system === true || row.extra?.type === 'narrator') {
        skippedSystem += 1
        continue
      }
      const rawSwipe = Number.isSafeInteger(row.swipe_id) && row.swipe_id >= 0 ? row.swipe_id : 0
      let mes = typeof row.mes === 'string' ? row.mes : ''
      if (Array.isArray(row.swipes)) {
        if (rawSwipe > 0 && typeof row.swipes[rawSwipe] === 'string' && row.swipes[rawSwipe].trim()) {
          mes = row.swipes[rawSwipe]
        } else if (!mes.trim()) {
          const candidate = row.swipes[rawSwipe] ?? row.swipes[0]
          if (typeof candidate === 'string') mes = candidate
        }
      }
      if (!mes.trim()) {
        skippedEmpty += 1
        continue
      }

      const isUser = Boolean(row.is_user)
      // DSH Tavern 单角色对话要求所有 assistant 楼层角色名一致，否则报错「暂不支持多角色群聊记录」
      const speakerName = isUser ? (str(row.name).trim() || userName) : characterName

      let validVar = null
      if (row.variables !== undefined && row.variables !== null) {
        let rawVar = null
        if (Array.isArray(row.variables)) {
          rawVar = row.variables[rawSwipe] ?? row.variables[0]
        } else if (isPlainObject(row.variables)) {
          rawVar = row.variables[rawSwipe] ?? row.variables[String(rawSwipe)] ?? row.variables[0] ?? row.variables['0'] ??
            (isPlainObject(row.variables.stat_data) ? row.variables : null)
        }
        if (isPlainObject(rawVar) && isPlainObject(rawVar.stat_data)) {
          validVar = {
            stat_data: rawVar.stat_data,
            ...(isPlainObject(rawVar.schema) ? { schema: rawVar.schema } : {}),
            ...(isPlainObject(rawVar.initialized_lorebooks) ? { initialized_lorebooks: rawVar.initialized_lorebooks } : {}),
            ...(rawVar.display_data !== undefined ? { display_data: rawVar.display_data } : {}),
            ...(rawVar.delta_data !== undefined ? { delta_data: rawVar.delta_data } : {})
          }
          hasMvu = true
        }
      }

      if (row.extra?.media?.length || row.extra?.image || row.extra?.file || row.extra?.tool_invocations?.length) {
        strippedAttachments += 1
      }

      const message = {
        name: speakerName,
        is_user: isUser,
        is_system: false,
        send_date: str(row.send_date || ''),
        mes,
        swipe_id: 0,
        swipes: [mes],
        ...(validVar ? { variables: [validVar] } : {})
      }
      cleanedMessages.push(message)
    }

    // 若消息楼层未挂变量快照，但 chat_metadata.variables 含 MVU stat_data，则补到最后一条消息上
    if (!hasMvu && cleanedMessages.length > 0 && isPlainObject(rawHeader?.chat_metadata?.variables?.stat_data)) {
      const metaVar = rawHeader.chat_metadata.variables
      cleanedMessages[cleanedMessages.length - 1].variables = [{
        stat_data: metaVar.stat_data,
        ...(isPlainObject(metaVar.schema) ? { schema: metaVar.schema } : {}),
        ...(isPlainObject(metaVar.initialized_lorebooks) ? { initialized_lorebooks: metaVar.initialized_lorebooks } : {})
      }]
      hasMvu = true
    }

    // 若存在 MVU 快照但首条消息缺少快照，则用最早的快照补齐首条消息，避免无静态 [initvar] 的 MVU 卡在导入阶段报错
    if (hasMvu && cleanedMessages.length > 0 && !cleanedMessages[0].variables) {
      const earliestWithVar = cleanedMessages.find(m => Array.isArray(m.variables) && m.variables[0])
      if (earliestWithVar) {
        cleanedMessages[0].variables = [earliestWithVar.variables[0]]
      }
    }

    if (skippedSystem > 0) warnings.push('已过滤 ' + skippedSystem + ' 条系统/旁白消息')
    if (skippedEmpty > 0) warnings.push('已跳过 ' + skippedEmpty + ' 条空消息')
    if (strippedAttachments > 0) warnings.push('已剥离 ' + strippedAttachments + ' 条消息中的附件或工具调用字段')

    let finalMessages = cleanedMessages
    let truncatedCount = 0
    if (finalMessages.length > maxMessages) {
      const dropped = finalMessages.length - maxMessages
      truncatedCount += dropped
      // 保留第一条开场白（若为助手开场）与最近的消息
      if (finalMessages[0] && !finalMessages[0].is_user && maxMessages > 1) {
        finalMessages = [finalMessages[0], ...finalMessages.slice(-(maxMessages - 1))]
      } else {
        finalMessages = finalMessages.slice(-maxMessages)
      }
      warnings.push('超出 2000 条上限，已裁剪早期 ' + dropped + ' 条消息')
    }

    const headerLine = JSON.stringify(header)
    let lines = [headerLine, ...finalMessages.map(m => JSON.stringify(m))]
    let jsonl = lines.join('\n') + '\n'
    while (utf8Bytes(jsonl).length > maxBytes && finalMessages.length > 1) {
      // 若超过 8MB 上限，保留首条开场白并从最早的历史消息开始裁剪
      const removeIdx = finalMessages[0] && !finalMessages[0].is_user && finalMessages.length > 2 ? 1 : 0
      finalMessages.splice(removeIdx, 1)
      truncatedCount += 1
      lines = [headerLine, ...finalMessages.map(m => JSON.stringify(m))]
      jsonl = lines.join('\n') + '\n'
    }

    let turns = 0
    for (const msg of finalMessages) {
      if (!msg.is_user) turns += 1
    }

    return {
      usable: finalMessages.length > 0,
      jsonl,
      header,
      messages: finalMessages,
      messageCount: finalMessages.length,
      turns,
      turnCount: turns,
      truncatedCount,
      characterName,
      userName,
      hasMvu,
      skippedCount: skippedSystem + skippedEmpty,
      warnings
    }
  }

  /**
   * 将 SillyTavern 世界书（entries 对象或数组）转换为符合 DSH Tavern 人物卡校验的 V2/V3 `character_book`。
   */
  function convertWorldInfoToCharacterBook(rawBook, fallbackName = '') {
    if (!isPlainObject(rawBook)) return null
    const rawEntries = Array.isArray(rawBook.entries)
      ? rawBook.entries
      : (isPlainObject(rawBook.entries) ? Object.values(rawBook.entries) : [])
    const POSITIONS = ['before_char', 'after_char', 'an_top', 'an_bottom', 'at_depth', 'em_top', 'em_bottom']
    const entries = []
    rawEntries.forEach((entry, index) => {
      if (!isPlainObject(entry)) return
      const keys = Array.isArray(entry.keys)
        ? entry.keys.map(str).filter(Boolean)
        : (Array.isArray(entry.key) ? entry.key.map(str).filter(Boolean) : [])
      const secondaryKeys = Array.isArray(entry.secondary_keys)
        ? entry.secondary_keys.map(str).filter(Boolean)
        : (Array.isArray(entry.keysecondary) ? entry.keysecondary.map(str).filter(Boolean) : [])
      const id = Number.isInteger(entry.id) ? entry.id : (Number.isInteger(entry.uid) ? entry.uid : index)
      const order = Number.isFinite(Number(entry.insertion_order))
        ? Number(entry.insertion_order)
        : (Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100)
      const enabled = typeof entry.enabled === 'boolean' ? entry.enabled : entry.disable !== true
      const rawPos = entry.position
      const posString = typeof rawPos === 'string' && rawPos
        ? rawPos
        : (POSITIONS[Number(rawPos)] || 'before_char')
      const posNum = typeof rawPos === 'number' ? rawPos : ( Number.isFinite(Number(entry.extensions?.position)) ? Number(entry.extensions.position) : 0 )
      const ext = Object.assign({}, isPlainObject(entry.extensions) ? entry.extensions : {}, {
        position: posNum,
        depth: Number.isFinite(Number(entry.depth ?? entry.extensions?.depth)) ? Number(entry.depth ?? entry.extensions?.depth) : 4,
        role: Number.isFinite(Number(entry.role ?? entry.extensions?.role)) ? Number(entry.role ?? entry.extensions?.role) : 0,
        selectiveLogic: Number.isFinite(Number(entry.selectiveLogic ?? entry.extensions?.selectiveLogic)) ? Number(entry.selectiveLogic ?? entry.extensions?.selectiveLogic) : 0,
        probability: Number.isFinite(Number(entry.probability ?? entry.extensions?.probability)) ? Number(entry.probability ?? entry.extensions?.probability) : 100,
        useProbability: Boolean(entry.useProbability ?? entry.extensions?.useProbability ?? true),
        exclude_recursion: Boolean(entry.excludeRecursion ?? entry.extensions?.exclude_recursion ?? false),
        prevent_recursion: Boolean(entry.preventRecursion ?? entry.extensions?.prevent_recursion ?? false),
        delay_until_recursion: Boolean(entry.delayUntilRecursion ?? entry.extensions?.delay_until_recursion ?? false),
        display_index: Number.isFinite(Number(entry.displayIndex ?? entry.extensions?.display_index)) ? Number(entry.displayIndex ?? entry.extensions?.display_index) : index
      })
      entries.push({
        id,
        keys,
        secondary_keys: secondaryKeys,
        comment: str(entry.comment || entry.name || ''),
        content: str(entry.content || ''),
        constant: Boolean(entry.constant),
        selective: entry.selective !== false,
        insertion_order: order,
        enabled,
        position: posString,
        extensions: ext
      })
    })
    return {
      name: str(rawBook.name || fallbackName || ''),
      description: str(rawBook.description || ''),
      scan_depth: Number.isFinite(Number(rawBook.scan_depth ?? rawBook.scanDepth)) ? Number(rawBook.scan_depth ?? rawBook.scanDepth) : 4,
      token_budget: Number.isFinite(Number(rawBook.token_budget ?? rawBook.tokenBudget)) ? Number(rawBook.token_budget ?? rawBook.tokenBudget) : 2048,
      recursive_scanning: Boolean(rawBook.recursive_scanning ?? rawBook.recursive ?? false),
      extensions: isPlainObject(rawBook.extensions) ? rawBook.extensions : {},
      entries
    }
  }

  /**
   * 将 SillyTavern 角色对象（v1/v2/v3）规范化为符合 DSH Tavern 校验的 `chara_card_v3` JSON 对象。
   */
  function normalizeSillyTavernCardForDsh(rawChar, standaloneWorldbook = null) {
    let base = isPlainObject(rawChar) ? rawChar : {}
    if (typeof base.json_data === 'string' && base.json_data.trim()) {
      try {
        const parsedJson = JSON.parse(base.json_data)
        if (isPlainObject(parsedJson)) base = Object.assign({}, base, parsedJson)
      } catch {
        // 忽略损坏的 json_data，回退到对象属性
      }
    }
    const data = isPlainObject(base.data) ? Object.assign({}, base, base.data) : Object.assign({}, base)
    const name = str(data.name || base.name || '未命名角色').trim() || '未命名角色'
    const stringList = value => Array.isArray(value) ? value.map(str).filter(s => s.trim() !== '') : []

    const givenBook = isPlainObject(standaloneWorldbook?.characterBook)
      ? standaloneWorldbook.characterBook
      : standaloneWorldbook
    let characterBook = null
    if (isPlainObject(data.character_book)) {
      characterBook = convertWorldInfoToCharacterBook(data.character_book, str(data.character_book.name || data.extensions?.world || name))
    }
    if ((!characterBook || !characterBook.entries || characterBook.entries.length === 0) && isPlainObject(givenBook)) {
      characterBook = convertWorldInfoToCharacterBook(givenBook, str(givenBook.name || data.extensions?.world || name))
    }

    const extensions = Object.assign(
      {},
      isPlainObject(base.extensions) ? base.extensions : {},
      isPlainObject(data.extensions) ? data.extensions : {}
    )
    if (Array.isArray(extensions.tavern_helper)) {
      const converted = {}
      for (const item of extensions.tavern_helper) {
        if (Array.isArray(item) && typeof item[0] === 'string' && item.length >= 2) {
          converted[item[0]] = item[1]
        }
      }
      extensions.tavern_helper = converted
    }
    if (isPlainObject(extensions.tavern_helper)) {
      const th = Object.assign({}, extensions.tavern_helper)
      if (th.variables !== undefined && !isPlainObject(th.variables)) delete th.variables
      if (th.scripts !== undefined && !Array.isArray(th.scripts)) delete th.scripts
      extensions.tavern_helper = th
    } else if (extensions.tavern_helper !== undefined) {
      delete extensions.tavern_helper
    }

    const normalizedData = {
      name,
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      first_mes: str(data.first_mes),
      mes_example: str(data.mes_example),
      creator_notes: str(data.creator_notes ?? data.creatorcomment),
      system_prompt: str(data.system_prompt),
      post_history_instructions: str(data.post_history_instructions),
      creator: str(data.creator),
      character_version: str(data.character_version || '1.0'),
      tags: stringList(data.tags),
      alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(str) : [],
      group_only_greetings: stringList(data.group_only_greetings),
      extensions,
      ...(characterBook ? { character_book: characterBook } : {})
    }

    return {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      name,
      description: normalizedData.description,
      personality: normalizedData.personality,
      scenario: normalizedData.scenario,
      first_mes: normalizedData.first_mes,
      mes_example: normalizedData.mes_example,
      creatorcomment: normalizedData.creator_notes,
      tags: normalizedData.tags,
      data: normalizedData
    }
  }

  /**
   * 将收集好的人物卡、世界书、SillyTavern 聊天记录打包为标准 `.dshtransfer` 字节流与清单。
   */
  function packMigrationTransferBundle({
    name = 'SillyTavern迁移备份',
    createdAt = Date.now(),
    sourceTavern = 'SillyTavern (dsh-tavern迁移助手)',
    platform = 'web',
    cards = [],
    worldbooks = [],
    chats = []
  } = {}) {
    const usedEntries = new Set()
    const zipEntries = []
    const partMap = new Map()

    function uniqueEntry(rawEntry) {
      const slash = rawEntry.lastIndexOf('/')
      const dir = slash >= 0 ? rawEntry.slice(0, slash + 1) : ''
      const base = slash >= 0 ? rawEntry.slice(slash + 1) : rawEntry
      const dot = base.lastIndexOf('.')
      const stem = dot > 0 ? base.slice(0, dot) : base
      const ext = dot > 0 ? base.slice(dot) : ''
      let candidate = dir + stem + ext
      let index = 2
      while (usedEntries.has(candidate.toLowerCase())) {
        candidate = dir + stem + ' (' + index + ')' + ext
        index += 1
      }
      usedEntries.add(candidate.toLowerCase())
      return candidate
    }

    function addPartItem(kind, label, item, defaultExt) {
      const rawFileName = str(item.fileName || item.title || item.key || 'item')
      const hasExt = rawFileName.toLowerCase().endsWith(defaultExt.toLowerCase())
      const stem = hasExt ? rawFileName.slice(0, rawFileName.length - defaultExt.length) : rawFileName
      const fileName = safeFileName(stem, kind) + defaultExt
      const entry = uniqueEntry('parts/' + kind + '/' + fileName)
      const bytes = utf8Bytes(item.content)
      const hash = sha256Hex(bytes)

      let part = partMap.get(kind)
      if (!part) {
        part = { kind, label, bytes: 0, items: [] }
        partMap.set(kind, part)
      }
      part.bytes += bytes.length
      part.items.push({
        key: str(item.key || entry),
        title: str(item.title || stem),
        bytes: bytes.length,
        sha256: hash,
        entry
      })
      zipEntries.push({ path: entry, content: bytes })
    }

    for (const card of cards) addPartItem('cards', '人物卡', card, '.json')
    for (const wb of worldbooks) addPartItem('worldbooks', '世界书', wb, '.json')
    for (const chat of chats) addPartItem('chats', '对话与存档', chat, '.jsonl')

    const parts = [...partMap.values()].filter(p => p.items.length > 0)
    const cleanName = safeFileName(name, 'SillyTavern迁移备份')
    const manifest = {
      spec: 'dsh-tavern.transfer',
      version: 1,
      name: cleanName,
      createdAt: Number(createdAt) || Date.now(),
      source: { tavern: str(sourceTavern), platform: str(platform) },
      parts,
      totals: {
        items: parts.reduce((sum, p) => sum + p.items.length, 0),
        bytes: parts.reduce((sum, p) => sum + p.bytes, 0)
      }
    }

    const allEntries = [
      { path: 'manifest.json', content: utf8Bytes(JSON.stringify(manifest, null, 2) + '\n') },
      ...zipEntries
    ]
    const archiveBytes = writeZipStored(allEntries)
    return {
      manifest,
      filename: cleanName + '.dshtransfer',
      bytes: archiveBytes
    }
  }

  return {
    str,
    isPlainObject,
    safeFileName,
    utf8Bytes,
    sha256Hex,
    crc32,
    writeZipStored,
    sanitizeSillyTavernChatForDsh,
    convertWorldInfoToCharacterBook,
    normalizeSillyTavernCardForDsh,
    packMigrationTransferBundle
  }
}

const core = createMigrationHelperCore()
export const sanitizeSillyTavernChatForDsh = core.sanitizeSillyTavernChatForDsh
export const convertWorldInfoToCharacterBook = core.convertWorldInfoToCharacterBook
export const normalizeSillyTavernCardForDsh = core.normalizeSillyTavernCardForDsh
export const packMigrationTransferBundle = core.packMigrationTransferBundle
export const sha256Hex = core.sha256Hex

/**
 * 生成运行在酒馆助手（JS-Slash-Runner）脚本沙箱内的完整前端与批量导出代码。
 */
export function buildMigrationHelperScriptContent() {
  return `(function () {
  'use strict';

  const createMigrationHelperCore = ${createMigrationHelperCore.toString()};
  const core = createMigrationHelperCore();
  const {
    str,
    isPlainObject,
    safeFileName,
    utf8Bytes,
    sanitizeSillyTavernChatForDsh,
    normalizeSillyTavernCardForDsh,
    packMigrationTransferBundle
  } = core;

  const BUTTON_NAME = ${JSON.stringify(MIGRATION_HELPER_BUTTON_NAME)};
  const MODAL_ID = 'dsh-tavern-migration-modal-root';
  const EXT_MENU_ITEM_ID = 'dsh-tavern-migration-ext-item';
  const STYLE_ID = 'dsh-tavern-migration-style';

  function getHostWindow() {
    try {
      return window.parent && window.parent !== window ? window.parent : window;
    } catch (_e) {
      return window;
    }
  }

  function getStContext() {
    const host = getHostWindow();
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
      return SillyTavern.getContext();
    }
    if (host.SillyTavern && typeof host.SillyTavern.getContext === 'function') {
      return host.SillyTavern.getContext();
    }
    return typeof SillyTavern !== 'undefined' ? SillyTavern : (host.SillyTavern || {});
  }

  function notify(type, message, title) {
    const host = getHostWindow();
    const t = host.toastr || (typeof toastr !== 'undefined' ? toastr : null);
    if (t && typeof t[type] === 'function') {
      t[type](message, title || 'DSH Tavern 迁移助手');
    } else {
      console.log('[DSH Tavern 迁移助手]', type, message);
    }
  }

  async function stFetchJson(url, body) {
    const host = getHostWindow();
    const ctx = getStContext();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}
    );
    const response = await host.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {})
    });
    if (!response.ok) {
      throw new Error('请求 ' + url + ' 失败 (HTTP ' + response.status + ')');
    }
    return await response.json();
  }

  async function loadAllCharacters() {
    const ctx = getStContext();
    if (typeof ctx.getCharacters === 'function' && (!Array.isArray(ctx.characters) || ctx.characters.length === 0)) {
      try { await ctx.getCharacters(); } catch (_e) {}
    }
    const chars = Array.isArray(ctx.characters) ? ctx.characters : [];
    const currentAvatar = ctx.characterId !== undefined && chars[ctx.characterId]
      ? chars[ctx.characterId].avatar
      : '';
    return chars.map((ch, index) => ({
      index,
      avatar: str(ch.avatar),
      name: str(ch.name || ch.data?.name).trim() || str(ch.avatar).replace(/\\.[^.]+$/, '') || '未命名角色',
      currentChat: str(ch.chat),
      worldName: str(ch.data?.extensions?.world || ch.extensions?.world || ''),
      isCurrent: Boolean(currentAvatar && ch.avatar === currentAvatar),
      raw: ch
    })).filter(ch => ch.avatar);
  }

  async function fetchCharacterChats(charItem) {
    try {
      const data = await stFetchJson('/api/characters/chats', { avatar_url: charItem.avatar });
      if (!data || data.error) return [];
      const list = Array.isArray(data) ? data : (isPlainObject(data) ? Object.values(data) : []);
      return list
        .filter(item => isPlainObject(item) && str(item.file_name).trim())
        .map(item => {
          const rawName = str(item.file_name).trim();
          const cleanId = rawName.replace(/\\.jsonl$/i, '');
          return {
            fileName: rawName.endsWith('.jsonl') ? rawName : rawName + '.jsonl',
            fileId: cleanId,
            fileSize: str(item.file_size || ''),
            chatItems: Number(item.chat_items) || 0,
            lastMes: item.last_mes || '',
            preview: str(item.mes || '').slice(0, 80)
          };
        });
    } catch (err) {
      console.warn('[DSH迁移助手] 获取角色聊天列表失败:', charItem.name, err);
      return [];
    }
  }

  async function fetchSingleChatContent(charItem, chatMeta) {
    const ctx = getStContext();
    try {
      const rows = await stFetchJson('/api/chats/get', {
        ch_name: charItem.name,
        file_name: chatMeta.fileId,
        avatar_url: charItem.avatar
      });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (_err) {
      // 回退到 /api/chats/export
    }
    try {
      const exported = await stFetchJson('/api/chats/export', {
        file: chatMeta.fileName,
        avatar_url: charItem.avatar,
        format: 'jsonl',
        exportfilename: chatMeta.fileName
      });
      if (exported && typeof exported.result === 'string' && exported.result.trim()) {
        return exported.result;
      }
    } catch (_err2) {}

    // 若正好是当前打开的对话，可从内存上下文兜底读取
    if (charItem.isCurrent && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
      const currentId = typeof ctx.getCurrentChatId === 'function' ? str(ctx.getCurrentChatId()) : str(ctx.chatId || charItem.currentChat);
      if (!currentId || currentId.replace(/\\.jsonl$/i, '') === chatMeta.fileId) {
        return [
          {
            user_name: str(ctx.name1 || '你'),
            character_name: charItem.name,
            chat_metadata: isPlainObject(ctx.chatMetadata) ? ctx.chatMetadata : {}
          },
          ...ctx.chat
        ];
      }
    }
    throw new Error('无法读取聊天记录：' + chatMeta.fileName);
  }

  async function fetchFullCharacterData(charItem) {
    const ctx = getStContext();
    if (charItem.raw?.shallow && typeof ctx.unshallowCharacter === 'function') {
      try { await ctx.unshallowCharacter(String(charItem.index)); } catch (_e) {}
    }
    try {
      const full = await stFetchJson('/api/characters/get', { avatar_url: charItem.avatar });
      if (isPlainObject(full) && (full.name || full.data)) return full;
    } catch (_e) {}
    const latest = Array.isArray(ctx.characters) && ctx.characters[charItem.index] ? ctx.characters[charItem.index] : charItem.raw;
    return latest || charItem.raw;
  }

  async function fetchWorldbookData(worldName) {
    if (!worldName) return null;
    const ctx = getStContext();
    if (typeof ctx.loadWorldInfo === 'function') {
      try {
        const book = await ctx.loadWorldInfo(worldName);
        if (isPlainObject(book) && isPlainObject(book.entries)) {
          return Object.assign({ name: worldName }, book);
        }
      } catch (_e) {}
    }
    try {
      const book = await stFetchJson('/api/worldinfo/get', { name: worldName });
      if (isPlainObject(book) && isPlainObject(book.entries)) {
        return Object.assign({ name: worldName }, book);
      }
    } catch (_e) {}
    return null;
  }

  function triggerBrowserDownload(bytes, filename, mimeType) {
    const host = getHostWindow();
    const doc = host.document;
    const blob = new Blob([bytes], { type: mimeType || 'application/zip' });
    const url = host.URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      host.URL.revokeObjectURL(url);
    }, 15000);
  }

  function injectStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = \`
      #\${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(10, 12, 16, 0.72);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #e6edf3;
      }
      #\${MODAL_ID} * { box-sizing: border-box; }
      .dsh-mig-panel {
        width: 100%;
        max-width: 780px;
        max-height: 88vh;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 12px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .dsh-mig-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid #262c36;
        background: #1c2128;
      }
      .dsh-mig-title {
        font-size: 16px;
        font-weight: 600;
        color: #f0f6fc;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-mig-sub {
        font-size: 12px;
        color: #8b949e;
        margin-top: 2px;
      }
      .dsh-mig-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 10px 18px;
        border-bottom: 1px solid #262c36;
        background: #13171d;
      }
      .dsh-mig-search {
        flex: 1;
        min-width: 180px;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid #30363d;
        background: #0d1117;
        color: #e6edf3;
        font-size: 13px;
      }
      .dsh-mig-btn {
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid #30363d;
        background: #21262d;
        color: #c9d1d9;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .dsh-mig-btn:hover:not(:disabled) { background: #30363d; color: #fff; }
      .dsh-mig-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .dsh-mig-btn.primary {
        background: #238636;
        border-color: #2ea043;
        color: #ffffff;
        font-weight: 600;
      }
      .dsh-mig-btn.primary:hover:not(:disabled) { background: #2ea043; }
      .dsh-mig-options {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 8px 18px;
        border-bottom: 1px solid #262c36;
        background: #161b22;
        font-size: 12px;
        color: #c9d1d9;
      }
      .dsh-mig-options label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .dsh-mig-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .dsh-mig-char {
        border: 1px solid #262c36;
        border-radius: 8px;
        background: #0d1117;
        overflow: hidden;
      }
      .dsh-mig-char-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        cursor: pointer;
        user-select: none;
      }
      .dsh-mig-char-head:hover { background: #161b22; }
      .dsh-mig-char-name {
        font-size: 14px;
        font-weight: 600;
        color: #e6edf3;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dsh-mig-badge {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 999px;
        background: #1f6feb33;
        color: #58a6ff;
        border: 1px solid #1f6feb66;
        font-weight: 500;
      }
      .dsh-mig-meta {
        font-size: 12px;
        color: #8b949e;
      }
      .dsh-mig-chats {
        border-top: 1px solid #21262d;
        padding: 6px 12px 8px 32px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        background: #11161d;
      }
      .dsh-mig-chat-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      }
      .dsh-mig-chat-row:hover { background: #1c2128; }
      .dsh-mig-chat-title {
        flex: 1;
        color: #c9d1d9;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-mig-foot {
        padding: 12px 18px;
        border-top: 1px solid #262c36;
        background: #1c2128;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .dsh-mig-status {
        font-size: 12px;
        color: #8b949e;
        flex: 1;
      }
    \`;
    doc.head.appendChild(style);
  }

  async function openMigrationModal() {
    const host = getHostWindow();
    const doc = host.document;
    injectStyles(doc);

    const existing = doc.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const state = {
      characters: [],
      chatsByAvatar: new Map(),
      selectedChats: new Map(), // avatar -> Set(fileName)
      expanded: new Set(),
      search: '',
      includeCards: true,
      includeWorldbooks: true,
      scanning: false,
      exporting: false,
      statusText: '正在读取角色列表…',
      lastExport: null
    };

    const overlay = doc.createElement('div');
    overlay.id = MODAL_ID;
    doc.body.appendChild(overlay);

    function closeModal() {
      if (state.exporting) return;
      overlay.remove();
    }

    function selectedCounts() {
      let charCount = 0;
      let chatCount = 0;
      for (const [avatar, set] of state.selectedChats.entries()) {
        if (set && set.size > 0) {
          charCount += 1;
          chatCount += set.size;
        }
      }
      return { charCount, chatCount };
    }

    async function ensureChatsLoaded(charItem) {
      if (state.chatsByAvatar.has(charItem.avatar)) {
        return state.chatsByAvatar.get(charItem.avatar);
      }
      const list = await fetchCharacterChats(charItem);
      state.chatsByAvatar.set(charItem.avatar, list);
      return list;
    }

    async function scanAllChats(autoSelectAll) {
      if (state.scanning || state.exporting) return;
      state.scanning = true;
      render();
      try {
        const total = state.characters.length;
        let done = 0;
        const batchSize = 5;
        for (let i = 0; i < total; i += batchSize) {
          const slice = state.characters.slice(i, i + batchSize);
          await Promise.all(slice.map(async ch => {
            const list = await ensureChatsLoaded(ch);
            if (autoSelectAll && list.length > 0) {
              state.selectedChats.set(ch.avatar, new Set(list.map(item => item.fileName)));
            }
            done += 1;
          }));
          state.statusText = '正在扫描聊天记录 (' + done + '/' + total + ')…';
          render();
        }
        const counts = selectedCounts();
        state.statusText = '扫描完成：共发现 ' +
          Array.from(state.chatsByAvatar.values()).reduce((s, arr) => s + arr.length, 0) +
          ' 份聊天记录' + (counts.chatCount ? '，已选 ' + counts.chatCount + ' 份' : '');
      } finally {
        state.scanning = false;
        render();
      }
    }

    async function runBatchExport() {
      const counts = selectedCounts();
      if (counts.chatCount === 0 || state.exporting) {
        notify('warning', '请至少勾选一份要导出的聊天记录');
        return;
      }
      state.exporting = true;
      state.lastExport = null;
      render();

      try {
        const exportedCards = [];
        const exportedWorldbooks = [];
        const exportedChats = [];
        const seenWorldbooks = new Set();
        let processedChats = 0;
        let skippedEmptyChats = 0;

        for (const ch of state.characters) {
          const pickedSet = state.selectedChats.get(ch.avatar);
          if (!pickedSet || pickedSet.size === 0) continue;

          const chatList = await ensureChatsLoaded(ch);
          const pickedMetas = chatList.filter(item => pickedSet.has(item.fileName));
          if (pickedMetas.length === 0) continue;

          let standaloneBook = null;
          const fullChar = (state.includeCards || state.includeWorldbooks) ? await fetchFullCharacterData(ch) : ch.raw;
          const worldName = str(fullChar?.data?.extensions?.world || fullChar?.extensions?.world || ch.worldName).trim();

          if (state.includeWorldbooks && worldName) {
            standaloneBook = await fetchWorldbookData(worldName);
            if (standaloneBook && !seenWorldbooks.has(worldName.toLowerCase())) {
              seenWorldbooks.add(worldName.toLowerCase());
              exportedWorldbooks.push({
                key: 'worldbooks/' + safeFileName(worldName, 'worldbook') + '.json',
                title: worldName,
                fileName: safeFileName(worldName, 'worldbook') + '.json',
                content: JSON.stringify(standaloneBook, null, 2) + '\\n'
              });
            }
          }

          if (state.includeCards) {
            const cardDoc = normalizeSillyTavernCardForDsh(fullChar, standaloneBook);
            const cardFileName = safeFileName(cardDoc.name || ch.name, 'card') + '.json';
            exportedCards.push({
              key: 'cards/' + cardFileName,
              title: cardDoc.name || ch.name,
              fileName: cardFileName,
              content: JSON.stringify(cardDoc, null, 2) + '\\n'
            });
          }

          for (const chatMeta of pickedMetas) {
            processedChats += 1;
            state.statusText = '正在转换 (' + processedChats + '/' + counts.chatCount + ')：' + ch.name + ' · ' + chatMeta.fileId;
            render();

            const rawChat = await fetchSingleChatContent(ch, chatMeta);
            const sanitized = sanitizeSillyTavernChatForDsh(rawChat, {
              characterName: ch.name,
              characterAvatar: ch.avatar
            });
            if (sanitized.messageCount === 0) {
              skippedEmptyChats += 1;
              continue;
            }
            const title = ch.name + ' · ' + chatMeta.fileId + '（' + sanitized.messageCount + ' 条）';
            const fileName = safeFileName(ch.name + ' - ' + chatMeta.fileId, 'chat') + '.jsonl';
            exportedChats.push({
              key: 'st-chat:' + ch.avatar + ':' + chatMeta.fileName,
              title,
              fileName,
              content: sanitized.jsonl
            });
          }
        }

        if (exportedChats.length === 0) {
          throw new Error('所选聊天记录均为空，没有可导出的有效消息');
        }

        state.statusText = '正在生成 .dshtransfer 迁移包…';
        render();

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
          pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
        const bundle = packMigrationTransferBundle({
          name: 'SillyTavern迁移-' + stamp,
          createdAt: now.getTime(),
          cards: exportedCards,
          worldbooks: exportedWorldbooks,
          chats: exportedChats
        });

        triggerBrowserDownload(bundle.bytes, bundle.filename);
        state.lastExport = {
          filename: bundle.filename,
          bytes: bundle.bytes,
          chats: exportedChats.length,
          cards: exportedCards.length,
          worldbooks: exportedWorldbooks.length,
          skipped: skippedEmptyChats
        };
        state.statusText = '导出完成：' + exportedChats.length + ' 份聊天记录' +
          (exportedCards.length ? '、' + exportedCards.length + ' 张人物卡' : '') +
          (exportedWorldbooks.length ? '、' + exportedWorldbooks.length + ' 本世界书' : '') +
          (skippedEmptyChats ? '（跳过 ' + skippedEmptyChats + ' 份空记录）' : '');
        notify('success', '已生成 ' + bundle.filename + '，请在 DSH Tavern「导出与导入 → 导入」中选该文件完成迁移');
      } catch (err) {
        const msg = str(err && err.message || err);
        state.statusText = '导出失败：' + msg;
        notify('error', msg);
      } finally {
        state.exporting = false;
        render();
      }
    }

    async function runJsonlExport() {
      const counts = selectedCounts();
      if (counts.chatCount === 0 || state.exporting) {
        notify('warning', '请至少勾选一份要导出的聊天记录');
        return;
      }
      state.exporting = true;
      render();
      try {
        let exportedCount = 0;
        let processed = 0;
        for (const ch of state.characters) {
          const pickedSet = state.selectedChats.get(ch.avatar);
          if (!pickedSet || pickedSet.size === 0) continue;
          const chatList = await ensureChatsLoaded(ch);
          const pickedMetas = chatList.filter(item => pickedSet.has(item.fileName));
          for (const chatMeta of pickedMetas) {
            processed += 1;
            state.statusText = '正在清洗 (' + processed + '/' + counts.chatCount + ')：' + ch.name + ' · ' + chatMeta.fileId;
            render();
            const rawChat = await fetchSingleChatContent(ch, chatMeta);
            const sanitized = sanitizeSillyTavernChatForDsh(rawChat, {
              characterName: ch.name,
              characterAvatar: ch.avatar
            });
            if (sanitized.messageCount === 0) continue;
            const fileName = safeFileName(ch.name + ' - ' + chatMeta.fileId, 'chat') + '.jsonl';
            triggerBrowserDownload(utf8Bytes(sanitized.jsonl), fileName, 'application/x-ndjson');
            exportedCount += 1;
          }
        }
        if (exportedCount === 0) {
          throw new Error('所选聊天记录均为空，没有可导出的有效消息');
        }
        state.statusText = '已导出 ' + exportedCount + ' 份清洗后 .jsonl，可在 DSH Tavern「选择人物卡 → 导入 SillyTavern 聊天记录」中导入';
        notify('success', '已导出 ' + exportedCount + ' 份清洗后 .jsonl 聊天文件');
      } catch (err) {
        const msg = str(err && err.message || err);
        state.statusText = '导出失败：' + msg;
        notify('error', msg);
      } finally {
        state.exporting = false;
        render();
      }
    }

    function render() {
      const counts = selectedCounts();
      const query = state.search.trim().toLowerCase();
      const visibleChars = state.characters.filter(ch => {
        if (!query) return true;
        if (ch.name.toLowerCase().includes(query) || ch.avatar.toLowerCase().includes(query)) return true;
        const chats = state.chatsByAvatar.get(ch.avatar) || [];
        return chats.some(c => c.fileId.toLowerCase().includes(query));
      });

      overlay.innerHTML = '';
      const panel = doc.createElement('div');
      panel.className = 'dsh-mig-panel';
      overlay.appendChild(panel);

      // Header
      const head = doc.createElement('div');
      head.className = 'dsh-mig-head';
      head.innerHTML = \`
        <div>
          <div class="dsh-mig-title">📦 DSH Tavern 迁移助手</div>
          <div class="dsh-mig-sub">批量导出 SillyTavern 聊天记录、关联人物卡与世界书为 .dshtransfer 迁移包</div>
        </div>
      \`;
      const closeBtn = doc.createElement('button');
      closeBtn.className = 'dsh-mig-btn';
      closeBtn.textContent = '关闭';
      closeBtn.disabled = state.exporting;
      closeBtn.onclick = closeModal;
      head.appendChild(closeBtn);
      panel.appendChild(head);

      // Toolbar
      const toolbar = doc.createElement('div');
      toolbar.className = 'dsh-mig-toolbar';
      const searchInput = doc.createElement('input');
      searchInput.className = 'dsh-mig-search';
      searchInput.placeholder = '搜索角色名或聊天记录文件名…';
      searchInput.value = state.search;
      searchInput.oninput = e => {
        state.search = e.target.value;
        render();
        const input = panel.querySelector('.dsh-mig-search');
        if (input) {
          input.focus();
          input.setSelectionRange(state.search.length, state.search.length);
        }
      };
      toolbar.appendChild(searchInput);

      const scanAllBtn = doc.createElement('button');
      scanAllBtn.className = 'dsh-mig-btn';
      scanAllBtn.textContent = state.scanning ? '正在扫描…' : '扫描并全选全部记录';
      scanAllBtn.disabled = state.scanning || state.exporting;
      scanAllBtn.onclick = () => scanAllChats(true);
      toolbar.appendChild(scanAllBtn);

      const currentChar = state.characters.find(c => c.isCurrent);
      if (currentChar) {
        const curBtn = doc.createElement('button');
        curBtn.className = 'dsh-mig-btn';
        curBtn.textContent = '仅选当前角色 (' + currentChar.name + ')';
        curBtn.disabled = state.scanning || state.exporting;
        curBtn.onclick = async () => {
          state.selectedChats.clear();
          const list = await ensureChatsLoaded(currentChar);
          state.selectedChats.set(currentChar.avatar, new Set(list.map(i => i.fileName)));
          state.expanded.add(currentChar.avatar);
          state.statusText = '已全选当前角色「' + currentChar.name + '」的 ' + list.length + ' 份聊天记录';
          render();
        };
        toolbar.appendChild(curBtn);
      }

      const clearBtn = doc.createElement('button');
      clearBtn.className = 'dsh-mig-btn';
      clearBtn.textContent = '清空选择';
      clearBtn.disabled = state.scanning || state.exporting || counts.chatCount === 0;
      clearBtn.onclick = () => {
        state.selectedChats.clear();
        state.statusText = '已清空选择';
        render();
      };
      toolbar.appendChild(clearBtn);
      panel.appendChild(toolbar);

      // Options
      const opts = doc.createElement('div');
      opts.className = 'dsh-mig-options';

      const cardOpt = doc.createElement('label');
      const cardCb = doc.createElement('input');
      cardCb.type = 'checkbox';
      cardCb.checked = state.includeCards;
      cardCb.disabled = state.exporting;
      cardCb.onchange = e => { state.includeCards = e.target.checked; };
      cardOpt.append(cardCb, doc.createTextNode('附带所选角色的人物卡（DSH 侧尚未导入该卡时必选，已有同名同内容卡会自动去重）'));

      const wbOpt = doc.createElement('label');
      const wbCb = doc.createElement('input');
      wbCb.type = 'checkbox';
      wbCb.checked = state.includeWorldbooks;
      wbCb.disabled = state.exporting;
      wbCb.onchange = e => { state.includeWorldbooks = e.target.checked; };
      wbOpt.append(wbCb, doc.createTextNode('附带角色绑定的世界书'));

      opts.append(cardOpt, wbOpt);
      panel.appendChild(opts);

      // Character & Chat List
      const body = doc.createElement('div');
      body.className = 'dsh-mig-body';
      if (visibleChars.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'dsh-mig-meta';
        empty.style.padding = '24px 0';
        empty.style.textAlign = 'center';
        empty.textContent = state.characters.length === 0 ? '未检测到角色卡' : '没有匹配的角色或记录';
        body.appendChild(empty);
      } else {
        for (const ch of visibleChars) {
          const loadedChats = state.chatsByAvatar.get(ch.avatar);
          const picked = state.selectedChats.get(ch.avatar) || new Set();
          const isOpen = state.expanded.has(ch.avatar);

          const card = doc.createElement('div');
          card.className = 'dsh-mig-char';

          const rowHead = doc.createElement('div');
          rowHead.className = 'dsh-mig-char-head';

          const cb = doc.createElement('input');
          cb.type = 'checkbox';
          cb.disabled = state.exporting || (Array.isArray(loadedChats) && loadedChats.length === 0);
          cb.checked = Array.isArray(loadedChats) ? (loadedChats.length > 0 && picked.size === loadedChats.length) : picked.size > 0;
          cb.indeterminate = picked.size > 0 && (!Array.isArray(loadedChats) || picked.size < loadedChats.length);
          cb.onclick = async e => {
            e.stopPropagation();
            const list = await ensureChatsLoaded(ch);
            if (picked.size === list.length && list.length > 0) {
              state.selectedChats.delete(ch.avatar);
            } else if (list.length > 0) {
              state.selectedChats.set(ch.avatar, new Set(list.map(i => i.fileName)));
              state.expanded.add(ch.avatar);
            }
            render();
          };

          const nameBox = doc.createElement('div');
          nameBox.className = 'dsh-mig-char-name';
          nameBox.textContent = (isOpen ? '▾ ' : '▸ ') + ch.name;
          if (ch.isCurrent) {
            const curBadge = doc.createElement('span');
            curBadge.className = 'dsh-mig-badge';
            curBadge.textContent = '当前角色';
            nameBox.appendChild(curBadge);
          }

          const meta = doc.createElement('span');
          meta.className = 'dsh-mig-meta';
          if (Array.isArray(loadedChats)) {
            meta.textContent = (picked.size ? '已选 ' + picked.size + ' / ' : '') + '共 ' + loadedChats.length + ' 份记录';
          } else {
            meta.textContent = '点击展开查看记录';
          }

          rowHead.onclick = async () => {
            if (state.expanded.has(ch.avatar)) {
              state.expanded.delete(ch.avatar);
              render();
            } else {
              state.expanded.add(ch.avatar);
              await ensureChatsLoaded(ch);
              render();
            }
          };

          rowHead.append(cb, nameBox, meta);
          card.appendChild(rowHead);

          if (isOpen) {
            const chatsWrap = doc.createElement('div');
            chatsWrap.className = 'dsh-mig-chats';
            if (!Array.isArray(loadedChats)) {
              const loading = doc.createElement('div');
              loading.className = 'dsh-mig-meta';
              loading.textContent = '正在加载聊天记录列表…';
              chatsWrap.appendChild(loading);
            } else if (loadedChats.length === 0) {
              const none = doc.createElement('div');
              none.className = 'dsh-mig-meta';
              none.textContent = '该角色暂无已保存的聊天记录';
              chatsWrap.appendChild(none);
            } else {
              for (const chatItem of loadedChats) {
                const cRow = doc.createElement('label');
                cRow.className = 'dsh-mig-chat-row';
                const cCb = doc.createElement('input');
                cCb.type = 'checkbox';
                cCb.disabled = state.exporting;
                cCb.checked = picked.has(chatItem.fileName);
                cCb.onchange = e => {
                  const set = state.selectedChats.get(ch.avatar) || new Set();
                  if (e.target.checked) set.add(chatItem.fileName);
                  else set.delete(chatItem.fileName);
                  if (set.size > 0) state.selectedChats.set(ch.avatar, set);
                  else state.selectedChats.delete(ch.avatar);
                  render();
                };
                const cTitle = doc.createElement('span');
                cTitle.className = 'dsh-mig-chat-title';
                cTitle.textContent = chatItem.fileId;
                const cMeta = doc.createElement('span');
                cMeta.className = 'dsh-mig-meta';
                cMeta.textContent = [
                  chatItem.chatItems ? chatItem.chatItems + ' 条' : '',
                  chatItem.fileSize || ''
                ].filter(Boolean).join(' · ');
                cRow.append(cCb, cTitle, cMeta);
                chatsWrap.appendChild(cRow);
              }
            }
            card.appendChild(chatsWrap);
          }

          body.appendChild(card);
        }
      }
      panel.appendChild(body);

      // Footer
      const foot = doc.createElement('div');
      foot.className = 'dsh-mig-foot';
      const status = doc.createElement('div');
      status.className = 'dsh-mig-status';
      status.textContent = state.statusText + '（已选 ' + counts.charCount + ' 个角色 · ' + counts.chatCount + ' 份记录）';
      foot.appendChild(status);

      const actionBox = doc.createElement('div');
      actionBox.style.display = 'flex';
      actionBox.style.gap = '8px';

      if (state.lastExport) {
        const redownloadBtn = doc.createElement('button');
        redownloadBtn.className = 'dsh-mig-btn';
        redownloadBtn.textContent = '重新下载 (' + state.lastExport.filename + ')';
        redownloadBtn.onclick = () => triggerBrowserDownload(state.lastExport.bytes, state.lastExport.filename);
        actionBox.appendChild(redownloadBtn);
      }

      const jsonlBtn = doc.createElement('button');
      jsonlBtn.className = 'dsh-mig-btn';
      jsonlBtn.disabled = state.exporting || state.scanning || counts.chatCount === 0;
      jsonlBtn.textContent = '导出清洗后 .jsonl';
      jsonlBtn.title = '直接下载清洗后的 .jsonl 文件，可在 DSH Tavern「选择人物卡 → 导入 SillyTavern 聊天记录」中导入';
      jsonlBtn.onclick = runJsonlExport;
      actionBox.appendChild(jsonlBtn);

      const exportBtn = doc.createElement('button');
      exportBtn.className = 'dsh-mig-btn primary';
      exportBtn.disabled = state.exporting || state.scanning || counts.chatCount === 0;
      exportBtn.textContent = state.exporting ? '正在打包导出…' : '导出 .dshtransfer 迁移包';
      exportBtn.onclick = runBatchExport;
      actionBox.appendChild(exportBtn);

      foot.appendChild(actionBox);
      panel.appendChild(foot);
    }

    render();
    state.characters = await loadAllCharacters();
    const currentChar = state.characters.find(c => c.isCurrent);
    if (currentChar) {
      const list = await ensureChatsLoaded(currentChar);
      if (list.length > 0) {
        state.selectedChats.set(currentChar.avatar, new Set(list.map(i => i.fileName)));
        state.expanded.add(currentChar.avatar);
      }
      state.statusText = '已加载 ' + state.characters.length + ' 个角色，默认选中当前角色「' + currentChar.name + '」';
    } else {
      state.statusText = '已加载 ' + state.characters.length + ' 个角色，可点击角色展开或点「扫描并全选全部记录」';
    }
    render();
  }

  function mountUiEntries() {
    // 1. 注册酒馆助手脚本按钮
    try {
      if (typeof appendInexistentScriptButtons === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
      }
      if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
        eventOn(getButtonEvent(BUTTON_NAME), () => { void openMigrationModal(); });
      }
    } catch (err) {
      console.warn('[DSH迁移助手] 注册脚本按钮失败:', err);
    }

    // 2. 在 SillyTavern 顶部扩展菜单（#extensionsMenu）挂载入口，无打开对话时也能直接唤醒
    try {
      const host = getHostWindow();
      const doc = host.document;
      const extMenu = doc.getElementById('extensionsMenu');
      if (extMenu && !doc.getElementById(EXT_MENU_ITEM_ID)) {
        const item = doc.createElement('div');
        item.id = EXT_MENU_ITEM_ID;
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.title = '批量导出酒馆聊天记录为 DSH Tavern (.dshtransfer) 迁移格式';
        item.innerHTML = '<div class="fa-solid fa-box-archive extensionsMenuExtensionButton"></div><span>DSH Tavern 迁移助手</span>';
        item.addEventListener('click', () => { void openMigrationModal(); });
        extMenu.appendChild(item);
      }
    } catch (_e) {}

    // 3. 注册 /dsh-migrate 斜杠命令
    try {
      const ctx = getStContext();
      if (ctx.SlashCommandParser && ctx.SlashCommand && typeof ctx.SlashCommandParser.addCommandObject === 'function') {
        ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
          name: 'dsh-migrate',
          aliases: ['dsh-export'],
          helpString: '打开 DSH Tavern 迁移助手，批量导出聊天记录为 .dshtransfer 格式',
          callback: async () => {
            await openMigrationModal();
            return '';
          }
        }));
      }
    } catch (_e) {}
  }

  function cleanupUiEntries() {
    try {
      const host = getHostWindow();
      const doc = host.document;
      doc.getElementById(MODAL_ID)?.remove();
      doc.getElementById(EXT_MENU_ITEM_ID)?.remove();
      doc.getElementById(STYLE_ID)?.remove();
    } catch (_e) {}
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanupUiEntries);
    mountUiEntries();
  }
})();`
}

/**
 * 生成符合 N0VI028/JS-Slash-Runner `Script` Schema 的完整脚本对象。
 */
export function buildSillyTavernMigrationScript() {
  return {
    type: 'script',
    enabled: true,
    name: MIGRATION_HELPER_SCRIPT_NAME,
    id: MIGRATION_HELPER_SCRIPT_ID,
    info: [
      '### DSH Tavern 迁移助手',
      '',
      '在 SillyTavern 中批量扫描并勾选角色的聊天记录（`.jsonl`）、关联人物卡与世界书，一键清洗并打包为 DSH Tavern 原生支持的 `.dshtransfer` 迁移包。',
      '',
      '#### 使用方法',
      '1. 导入本脚本后，打开右侧开关启用脚本。',
      '2. 点击聊天输入框上方的 **「📦 DSH 迁移导出」** 按钮，或点击顶部扩展菜单（魔法棒图标）中的 **「DSH Tavern 迁移助手」**，或发送斜杠命令 `/dsh-migrate`。',
      '3. 在弹窗中勾选需要迁移的角色与聊天记录，点击 **「导出 .dshtransfer 迁移包」**。',
      '4. 打开 DSH Tavern 侧栏 **「导出与导入 → 导入」**，选择导出的 `.dshtransfer` 文件即可整包导入。'
    ].join('\n'),
    content: buildMigrationHelperScriptContent(),
    button: {
      enabled: true,
      buttons: [
        {
          name: MIGRATION_HELPER_BUTTON_NAME,
          visible: true
        }
      ]
    },
    data: {},
    export_with: {
      data: true,
      button: true
    }
  }
}

/**
 * 序列化为可直接导入酒馆助手的格式化 JSON 文本。
 */
export function exportSillyTavernMigrationScript() {
  return JSON.stringify(buildSillyTavernMigrationScript(), null, 2) + '\n'
}
