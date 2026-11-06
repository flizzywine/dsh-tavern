import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeResourceName } from './file-resources.js'

const scriptText = value => String(value || '').replace(/\r\n?/g, '\n').trim()

/** Materialize a save's resources without replacing existing local resources. */
export function createGameSaveResources({ resources, cardPreparation }) {
  let tail = Promise.resolve()
  // 同一个存档反复导入（换台机器、重试、连点）不该每次都多一张卡：内容和本机某张卡
  // 完全一致时直接复用它。人物卡的 meta/id/时间戳每次都不同，只比读者看得见的内容字段。
  const CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags', 'creator', 'character_version']
  function cardFingerprint(workspace) {
    const card = cardPreparation.project(workspace) || {}
    const picked = {}
    for (const field of CARD_FIELDS) {
      const value = card[field]
      if (value === undefined || value === null || value === '') continue
      picked[field] = value
    }
    return JSON.stringify(picked)
  }
  async function identicalCard(workspace) {
    let target
    try { target = cardFingerprint(workspace) } catch { return '' }
    for (const path of await resources.list('card').catch(() => [])) {
      const text = await resources.readText(path).catch(() => undefined)
      if (typeof text !== 'string') continue
      try {
        const value = JSON.parse(text)
        const existing = cardPreparation.isWorkspace(value) ? value : cardPreparation.migrate({ working: value })
        if (cardFingerprint(existing) === target) return path
      } catch { /* 读不了就跳过这张 */ }
    }
    return ''
  }
  // 有剧本的存档必须拿自己那张卡（剧本绑定挂在卡上，共用会改到别人的局），
  // 没剧本的存档只要内容一样就复用——同一个包里的多局就是这么叠出好几张同名卡的。
  async function importCard(payload, reuse) {
    const workspace = cardPreparation.create({ kind: 'import', payload })
    if (reuse) {
      const existing = await identicalCard(workspace)
      if (existing) return existing
    }
    return resources.importCard(payload, workspace, { unique: true })
  }

  async function prepare(save) {
    let cardPath = String(save.chat.cardPath || ''), importedCard = '', importedScript = ''
    const rollback = async () => {
      if (importedCard) {
        await resources.unbindMaterial(importedCard)
        await resources.remove(importedCard)
      }
      if (importedScript) await resources.remove(importedScript)
    }
    try {
      if (save.card?.payload) {
        let local = null
        try { local = await resources.originalCardPayload(cardPath) } catch {}
        if (!local || JSON.stringify(local) !== JSON.stringify(save.card.payload)) {
          cardPath = importedCard = await importCard(save.card.payload, !save.script)
        }
      }
      if (save.script && (save.chat.mode || 'story') === 'script') {
        const text = scriptText(save.script.text)
        if (!text) throw new Error('存档包里的剧本为空')
        const bound = cardPath ? await resources.scriptForCard(cardPath) : null
        const identical = bound && scriptText(await resources.readText(bound)) === text
        if (!identical) {
          // Changing a reused card's binding would also change its existing games.
          if (!importedCard) {
            let payload = save.card?.payload
            if (!payload && cardPath) payload = await resources.originalCardPayload(cardPath)
            if (!payload) {
              const current = (cardPath && await resources.readCard(cardPath)) || save.chat.cardDefinitionSnapshot
              if (!current) throw new Error('存档缺少可恢复的人物卡')
              const raw = cardPreparation.isWorkspace(current) ? cardPreparation.present({ card: current, as: 'raw' }) : current
              payload = { kind: 'text', name: path.posix.basename(cardPath) || '存档人物卡.json', text: JSON.stringify(raw) }
            }
            cardPath = importedCard = await importCard(payload)
          }
          // A script belongs to one card. Always create an independent material,
          // including when another material has the same name or same contents.
          const name = safeResourceName(path.posix.basename(String(save.script.path || '剧本.txt')))
          const parsed = path.parse(name)
          importedScript = await resources.importText('source', { name: parsed.name + ' (' + randomUUID() + ')' + parsed.ext, text })
          await resources.bindMaterial(cardPath, importedScript)
        }
      }
      return { cardPath, importedCard, rollback }
    } catch (error) {
      try { await rollback() } catch { /* Keep the original import failure. */ }
      throw error
    }
  }

  return function prepareResources(save) {
    const operation = tail.catch(() => {}).then(() => prepare(save))
    tail = operation
    return operation
  }
}
