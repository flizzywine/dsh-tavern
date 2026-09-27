// 卡脚本分派标记存储（proposal-card-runtime-full.md A.6.2 自愈）
// 独立运行时元数据缓存：不进存档（卡级属性非对话级）、不写卡文件（玩家资产不可篡改）、
// 不只放内存（重启丢失会让玩家每次重启后 UI 晚一个自愈周期）。
// key 绑脚本内容 hash → 卡更新自动失效重测；文件可丢弃 → 删了系统照常工作（重测即回）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function createCardScriptDispatchStore({ filePath, logger = console }) {
  let data = {}
  try { data = JSON.parse(readFileSync(filePath, 'utf8')) } catch {}
  let saveTimer = null

  function persist() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath + '.tmp', JSON.stringify(data, null, 2))
        writeFileSync(filePath, JSON.stringify(data, null, 2))
      } catch (error) { logger?.warn?.('[card-script-dispatch] 标记落盘失败:', String(error && error.message || error)) }
    }, 50)
  }

  function scriptKey(scriptId, content) {
    return str(scriptId) + ':' + createHash('sha256').update(str(content)).digest('hex').slice(0, 16)
  }

  return {
    scriptHash(content) {
      return createHash('sha256').update(str(content)).digest('hex').slice(0, 16)
    },
    /** 卡级标记（探针在事件钩子期触发、无法定位脚本时的粗粒度兜底） */
    lookupCard(cardPath) {
      const card = data[str(cardPath)]
      return card && card.__card__ && card.__card__.class === 'browser-ui' ? card.__card__ : null
    },
    markCard(cardPath, reason) {
      const card = data[str(cardPath)] || (data[str(cardPath)] = {})
      card.__card__ = { class: 'browser-ui', reason: str(reason), markedAt: Date.now() }
      persist()
    },
    /** 脚本级标记（加载期探针触发，可精确定位脚本） */
    lookupScript(cardPath, scriptId, content) {
      const card = data[str(cardPath)]
      const entry = card && card[scriptKey(scriptId, content)]
      return entry && entry.class === 'browser-ui' ? entry : null
    },
    markScript(cardPath, scriptId, content, reason) {
      const card = data[str(cardPath)] || (data[str(cardPath)] = {})
      card[scriptKey(scriptId, content)] = { class: 'browser-ui', reason: str(reason), markedAt: Date.now() }
      persist()
    }
  }
}
