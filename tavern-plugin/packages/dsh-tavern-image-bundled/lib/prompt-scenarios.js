// A mode is resolved once, before selecting resources or running extension modules.
const clean = (value, length) => String(value ?? '').trim().slice(0, length)
export function normalizeScenarioSettings(value) {
  if (!value || !Array.isArray(value.modes)) return null
  const ids = new Set()
  const modes = value.modes.slice(0, 20).flatMap(mode => {
    const id = clean(mode?.id, 40)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) return []
    ids.add(id)
    return [{ id, name: clean(mode.name, 60) || id, description: clean(mode.description, 1000),
      keywords: [...new Set((Array.isArray(mode.keywords) ? mode.keywords : []).map(word => clean(word, 80)).filter(Boolean))].slice(0, 32) }]
  })
  if (!modes.length) return null
  const fallback = ids.has(value.fallback) ? value.fallback : modes[0].id
  return { policy: ['model', 'keywords', 'fixed'].includes(value.policy) ? value.policy : 'keywords',
    fallback, fixed: ids.has(value.fixed) ? value.fixed : fallback, modes }
}
function resolved(structure, settings, id, reason) {
  const decision = { id, name: settings.modes.find(mode => mode.id === id).name, reason }
  return { decision, structure: { ...structure, scenarioResolved: decision,
    blocks: structure.blocks.filter(block => !block.modes?.length || block.modes.includes(id)) } }
}
export function resolveTemplateScenarioSync(structure, { scene = '', signal, selected } = {}) {
  if (structure?.scenarioResolved) return { structure, decision: structure.scenarioResolved }
  const settings = normalizeScenarioSettings(structure?.scenarios)
  if (!settings) return { structure, decision: null }
  signal?.throwIfAborted()
  if (settings.modes.some(mode => mode.id === selected)) return resolved(structure, settings, selected, 'inherited')
  if (settings.policy === 'fixed') return resolved(structure, settings, settings.fixed, 'fixed')
  if (settings.policy === 'model') throw new Error('模型判断模式需要异步接口和可用的后台文字模型；也可以选择关键词或固定模式')
  const body = String(scene).normalize('NFKC').toLowerCase()
  const id = settings.modes.find(mode => mode.keywords.some(word => body.includes(word.normalize('NFKC').toLowerCase())))?.id || settings.fallback
  return resolved(structure, settings, id, 'keywords')
}
export async function resolveTemplateScenario(structure, context = {}) {
  const settings = normalizeScenarioSettings(structure?.scenarios)
  if (structure?.scenarioResolved || !settings || settings.policy !== 'model' || settings.modes.some(mode => mode.id === context.selected)) return resolveTemplateScenarioSync(structure, context)
  const { scene = '', choose, signal } = context
  signal?.throwIfAborted()
  if (!choose) throw new Error('模型判断模式需要可用的后台文字模型；也可以选择关键词或固定模式')
  const answer = await choose({ modes: settings.modes, fallback: settings.fallback, scene, signal })
  signal?.throwIfAborted()
  let id
  try { id = JSON.parse(String(answer).replace(/^```(?:json)?\s*|\s*```$/g, '').trim()).mode } catch { id = String(answer).trim() }
  if (!settings.modes.some(mode => mode.id === id)) throw new Error('模型未返回有效的场景模式，请重试或改为固定模式')
  return resolved(structure, settings, id, 'model')
}
