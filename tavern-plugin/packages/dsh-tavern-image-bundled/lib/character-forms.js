// 同一角色的不同形态（名字互为前缀，如「阿梅」与「阿梅（狐形）」）按画面线索选对条目。
//
// 形态条目可以填「形态线索」（formCues，逗号分隔，例如 fox ears, fox tail, 狐耳, 狐尾）。
// 规划常把显形画面写成基础名字的宏（${"name":"阿梅"}$），画面描述里却写着狐耳狐尾，
// 结果外貌按人形展开（黑发、无耳），和画面打架。这里只决定宏指向哪个条目，
// 不改画面里任何外貌词（那些词可能属于画面里的别人）。
//
// 规则：
//   - 宏已经点名某个带线索的形态：尊重。
//   - 画面（宏以外）出现某个形态的线索，而宏点的是同一角色的其他形态：改指向该形态；
//     但画面写着正在变回 / 线索在消失时，尊重宏原来的选择。
//   - 写着 no fox ears / without fox tail 的线索不算。
//   - 宏外面单独写的名字（人形的中文名、英文触发名）也一起换成该形态的英文触发名。
const MACRO = /\$\{([\s\S]*?)\}\$/g
const NAME_FIELDS = ['name', '名称', '角色']
const TRANSITION = /\b(?:disappear\w*|vanish\w*|fad(?:e|es|ed|ing)|shifting|receding|retract\w*|sinking|gone|turning back|changing back|transform\w*)\b|褪|消失|收起|变回/i

const norm = value => String(value ?? '').toLowerCase().replace(/[\s_\-.'"（）()]+/g, '')
const split = value => String(value ?? '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 「殷雪（人形）」和「殷雪（显形）」去掉括号后缀是同一个名字，也算同一角色的不同形态。
const baseName = v => String(v ?? '').replace(/\s*[（(][^）)]*[）)]\s*$/, '')
const sameFamily = (a, b) => {
  const x = String(a?.name ?? ''), y = String(b?.name ?? '')
  return Boolean(a && b && a !== b && x && y && (x.startsWith(y) || y.startsWith(x) || (baseName(x) && baseName(x) === baseName(y))))
}
const CHINESE_CUE_NEGATION = /(?:并不是|不是|并没有|没有|并无|并非|非|无|未曾|并未|不再|不带|不具有|不长|未见|看不到|看不见|不见)(?:[\u3400-\u9fff]{0,4})$/
export const hasPositiveChineseCue = (scene, cue) => {
  let at = scene.indexOf(cue)
  while (at >= 0) {
    const before = scene.slice(Math.max(0, at - 12), at)
    if (!CHINESE_CUE_NEGATION.test(before)) return true
    at = scene.indexOf(cue, at + cue.length)
  }
  return false
}
const cueHits = (scene, cues) => cues.filter(cue => (/[㐀-鿿]/.test(cue)
  ? hasPositiveChineseCue(scene, cue)
  : new RegExp('(?<![\\w-])' + escape(cue) + '(?![\\w-])', 'i').test(scene))).length

export function resolveCharacterForms(value, definitions) {
  const text = String(value ?? '')
  const people = (definitions?.characters ?? []).filter(c => c && c.enabled !== false && c.name)
  const withCues = people.filter(c => split(c.formCues).length)
  if (!withCues.length || !text.includes('${')) return text
  // 线索之前写着 no / without 的不算（no fox ears 表示人形）。
  const scene = text.replace(MACRO, ' ').replace(/\b(?:no|without)\s+(?:visible\s+)?([\w-]+(?:\s[\w-]+)?)/gi, ' ')
  const aliases = c => [c.id, c.name, ...split(c.match)].map(norm).filter(Boolean)
  const findPerson = asked => {
    const key = norm(asked)
    if (!key) return null
    const exact = people.filter(c => aliases(c).includes(key))
    if (exact.length === 1) return exact[0]
    if (exact.length || key.length < 3) return null
    // 短别名（如 "A Mei" 对 "A Mei human form"）：取名字最短的基础条目。
    const loose = people.filter(c => [c.name, ...split(c.match)].map(norm).some(n => n && (n.startsWith(key) || n.endsWith(key))))
    const base = loose.filter(c => loose.every(o => o === c || String(o.name).startsWith(String(c.name))))
    return base.length === 1 ? base[0] : (loose.length === 1 ? loose[0] : null)
  }
  const changes = new Map()
  const out = text.replace(MACRO, (original, body) => {
    let call
    try { call = JSON.parse('{' + body + '}') } catch { return original }
    const field = NAME_FIELDS.find(f => call[f] !== undefined)
    if (!field) return original
    const named = findPerson(call[field])
    if (!named) return original
    const family = people.filter(c => c === named || sameFamily(c, named))
    const forms = family.filter(c => c !== named && split(c.formCues).length)
      .map(c => ({ c, hits: cueHits(scene, split(c.formCues)) })).filter(f => f.hits > 0)
      .sort((a, b) => b.hits - a.hits)
    if (!forms.length) return original
    if (cueHits(scene, split(named.formCues)) >= forms[0].hits) return original
    // 宏点名的就是完整名字（不是基础名或短别名），而画面写着正在变回：尊重它。
    const exactly = aliases(named).includes(norm(call[field])) && norm(call[field]) !== norm(family.reduce((a, b) => (String(a.name).length <= String(b.name).length ? a : b)).name)
    if (exactly && TRANSITION.test(scene)) return original
    const target = forms[0].c
    changes.set(named, target)
    call[field] = target.name
    return '${' + JSON.stringify(call).slice(1, -1) + '}$'
  })
  if (!changes.size) return out
  // 宏外面单独写的名字（规划常在开头写「阿梅,」）也换掉，免得按名字注入时又带回原来那个形态。
  const parts = out.split(/(\$\{[\s\S]*?\}\$)/)
  for (let i = 0; i < parts.length; i += 2) {
    for (const [from, to] of changes) {
      const toAlias = split(to.match)[0] || to.name
      for (const alias of split(from.match)) parts[i] = parts[i].replace(new RegExp('(?<![\\w-])' + escape(alias) + '(?![\\w-])', 'gi'), toAlias)
      parts[i] = parts[i].replace(new RegExp(escape(from.name) + '(?![（(])', 'g'), toAlias)
    }
  }
  return parts.join('')
}
