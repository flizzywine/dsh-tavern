import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const normalized = value => value.replace(/[\s_-]/g, '').toLowerCase()
const words = values => new Set(values.split('|').map(normalized))
const visual = words('外貌|外观|发色|发型|瞳色|眼睛颜色|体型|身高|辨识特征|衣着|衣着状态|服装|服饰|穿着|装束|姿势|姿态|当前姿势|动作|当前动作|当前行动|表情|站位|位置|所在位置|持物|手持物品|appearance|hair|hair color|hair style|eye color|body type|height|outfit|clothing|clothes|attire|pose|posture|action|current action|expression|position|location|holding')
const environment = words('地点|位置|所在位置|当前地点|时间|时段|天气|光照|照明|季节|环境描述|location|place|time|time of day|weather|lighting|season|description')
const environmentGroups = words('世界|场景|当前场景|环境|世界状态|场景状态|world|scene|current scene|environment|world state|scene state')
const names = words('姓名|名字|名称|name|full name|character name')
const ignored = words('schema|schemas|delta_data|display_data|description|descriptions|模板|规则|更新规则|提示词|说明|描述|备注|历史|日志|背包|物品栏|数值|好感度|心理活动|rules|instructions|prompt|history|logs|inventory|stats|thoughts')
const actorGroup = key => /人物|角色|^(?:characters?|people|actors?|npcs?)$/i.test(key)
const pointer = parts => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')
function mentioned(text, name) {
  if (name.length < 2 || name.length > 100 || /[\n\r<>]/.test(name)) return false
  if (/[\u3400-\u9fff]/u.test(name)) return text.includes(name)
  return new RegExp('(?<![\\p{L}\\p{N}_])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'iu').test(text)
}

/** Small, evidenced visual projection of one already selected message snapshot.
 * Unknown schemas stay unknown: no global variable fallback or full tree output. */
export function sceneStateSources(snapshot, target, currentText) {
  const sources = [], omitted = []
  const skip = reason => ({ sources, omitted: [{ reason }] })
  if (!snapshot || snapshot.settleStatus !== 'done' || snapshot.mvu?.enabled === false) return skip('scene-state-not-ready')
  const message = (snapshot.messages || []).find(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) === target.turn)
  if (!message) return skip('scene-state-missing-message')
  const swipe = Math.max(0, Number(message.swipeId) || 0)
  const body = String(message.swipes?.[swipe] ?? message.sourceText ?? message.text ?? '')
  if (swipe !== target.swipeId || hash(body) !== target.sourceDigest) return skip('scene-state-body-mismatch')
  if (message.mvu?.pending || ['error', 'failed', 'partial', 'stale'].includes(message.mvu?.receipt?.status)) return skip('scene-state-not-ready')
  const root = message.variables?.[swipe]?.stat_data
  if (!object(root)) return { sources, omitted }
  let visited = 0, remaining = 2400
  const counts = new Map(), seen = new WeakSet()
  const omit = reason => counts.set(reason, (counts.get(reason) || 0) + 1)
  function add(value, path, actor) {
    if (typeof value !== 'string') return
    if (!value.trim() || /^(?:未明确|未知|未定义|无|不详|unknown|null|undefined)$/i.test(value.trim())) return
    // Do not interpret HTML, commands or v1 [value, description] tuples as facts.
    if (value.length > 400 || /[<>`]|\{\{|\b(?:stat_data|delta_data|display_data|JSONPatch|UpdateVariable|mvu_submit_update)\b/i.test(value)) { omit('scene-state-nonvisual-value'); return }
    const pathText = pointer(['stat_data', ...path])
    const text = (actor ? actor + ' · ' : '') + path.join(' / ') + '：' + value
    if (sources.length >= 40 || text.length + 2 > remaining) { omit('scene-state-budget'); return }
    remaining -= text.length + 2
    const origin = { kind: 'mvu-state', bodyDigest: target.sourceDigest, swipeId: swipe, path: pathText,
      valueDigest: hash(value), ...(Number.isSafeInteger(snapshot._storageRevision) ? { storageRevision: snapshot._storageRevision } : {}) }
    sources.push({ id: 'state-' + hash(JSON.stringify([target.key, origin, value])).slice(0, 24), turn: target.turn, text, origin })
  }
  function walk(value, path = [], actor = '', visualParent = false, scene = true) {
    if (++visited > 6000) { omit('scene-state-scan-budget'); return }
    if (path.length > 10) { omit('scene-state-depth-budget'); return }
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (++visited > 6000) { omit('scene-state-scan-budget'); break }
        if (object(value[i])) walk(value[i], [...path, String(i)], actor, visualParent, scene)
      }
      return
    }
    const declaredName = Object.entries(value).find(([key, item]) => names.has(normalized(key)) && typeof item === 'string')?.[1]
    // An explicit named record overrides an outer actor, including off-stage actors.
    if (declaredName && !visualParent && (!scene || path.length === 0)) { actor = mentioned(currentText, declaredName) ? declaredName : ''; scene = false }
    for (const [key, item] of Object.entries(value)) {
      if (++visited > 6000) { omit('scene-state-scan-budget'); break }
      const field = normalized(key)
      if (key.startsWith('$') || key.startsWith('_') || key.length > 100 || ignored.has(field) && !(scene && field === 'description')) continue
      const nextPath = [...path, key]
      const fieldVisual = Boolean(actor) && (visualParent || visual.has(field))
      const fieldScene = scene && environment.has(field) && (field !== 'description' || path.length > 0)
      if (typeof item === 'string') { visited++; if (fieldVisual || fieldScene) add(item, nextPath, actor); continue }
      if (!item || typeof item !== 'object') continue
      let nextActor = fieldVisual ? actor : ''
      if (!visual.has(field) && !environmentGroups.has(field) && !actorGroup(key) && !names.has(field)
        && (path.length === 0 || path.some(actorGroup)) && mentioned(currentText, key)) nextActor = key
      walk(item, nextPath, nextActor, fieldVisual, scene && environmentGroups.has(field))
    }
  }
  walk(root)
  omitted.push(...[...counts].map(([reason, count]) => ({ reason, count })))
  return { sources, omitted }
}
