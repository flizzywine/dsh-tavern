// Static authoring errors require evidence; ambiguous names/scopes are review information.
import {figureNameKey as norm} from './figure-names.js'
const key = row => row.kind + '/' + row.id
const active = row => row.enabled !== false
const primary = row => row.kind === 'figure' ? row.aliases || [] : row.recall?.keywords || []
const words = row => [...primary(row), ...Object.values(row.recall?.synonyms || {}).flat()]
const categories = /^(?:魔女结界|魔女|结界|演唱|歌曲|音乐|bgm|音效|背景|服装|场景)$/u
const epithet = /(?:魔女|之王|女王|使者|化身)$/u
function entries({manifest, figures = {}}) {
  return [...(manifest.assets || []), ...Object.values(figures).flatMap(f => [{...f,kind:'figure'}, ...(f.outfits || []).map(o => ({...o,id:f.id+'/'+o.key,kind:'outfit',name:f.name+' / '+(o.label || o.key),subject:f.id,enabled:active(f)&&active(o)}))])]
}
const scope = row => row.kind === 'outfit' ? 'outfit/'+row.subject : row.kind
export function lintTriggers(document, {before} = {}) {
  const all = entries(document).filter(active), old = new Map(before ? entries(before).map(row => [key(row), row]) : [])
  // Renaming an installed entry (or its figure) does not author its existing triggers.
  const triggers = row => JSON.stringify([primary(row), row.recall?.synonyms || {}])
  const touched = row => !before || !old.has(key(row)) || !active(old.get(key(row))) || triggers(row) !== triggers(old.get(key(row)))
  const names = new Set(Object.values(document.figures || {}).flatMap(f => [f.name,...f.aliases || []]).filter(Boolean).map(norm))
  // A declared synonym of a known character is still that character, not a category.
  for (const row of all) for (const [root, aliases] of Object.entries(row.recall?.synonyms || {})) if (names.has(norm(root))) for (const alias of aliases) names.add(norm(alias))
  const usage = new Map(), issues = [], review = []
  for (const row of all) for (const word of new Set(words(row).map(norm))) {
    const id = scope(row)+'/'+word
    if (!usage.has(id)) usage.set(id, [])
    usage.get(id).push(row)
  }
  const add = (row, trigger, rule, detail) => {
    const example = row.kind === 'music' ? '离别、毕业、远行；曲名异译放在同一关键词的 synonyms' : row.kind === 'sfx' ? '敲门、叩门、门外' : row.kind === 'outfit' ? '睡衣；私服、夏装；只用服装本身的衣物词，不凑数' : '园丁：花园、蔷薇、剪刀'
    issues.push({entry:key(row),name:row.name || row.id,trigger,rule,example,message:`${row.name || row.id} [${key(row)}] 触发词「${trigger}」违反 ${rule}：${detail}。正例：${example}；修正后重试，确需覆盖才用 --force。`})
  }
  const info = (row,trigger,reason) => review.push({entry:key(row),trigger,reason})
  for (const row of all.filter(touched)) {
    // Directions are always-on instructions; their schema deliberately forbids trigger words. An entrance plays as the stage
    // opens and is never recalled (blue or off), so it has none either.
    if (row.kind === 'figure' || row.kind === 'directions' || row.kind === 'entrances' || row.kind === 'videos') continue
    // An empty blue audience needs no recall keywords: it is available without a story match.
    if (row.kind === 'audience' && row.recall?.mode === 'constant' && !words(row).length) continue
    const list = primary(row).map(norm), unique = new Set(words(row).map(norm))
    const minimum = row.kind === 'outfit' ? 1 : 3
    if (new Set(list).size < minimum || new Set(list).size > 6) add(row,list.join('、'),'count',`须有 ${minimum}–6 个主关键词；synonyms 是同义叫法，不另占名额`)
    for (const word of unique) {
      const peers = usage.get(scope(row)+'/'+word)
      const nameForm = names.has(word) || !epithet.test(word) && [row.name,row.label,...row.aliases || []].filter(Boolean).some(name => norm(name) === word)
      const unit = row.kind === 'music' && !names.has(word) && /(?:乐队|组合|ユニット)$/.test(word)
      if (list.filter(w=>w===word).length > 1) add(row,word,'duplicate','主关键词重复；同义表中的复用不算独立重复')
      if (nameForm) continue
      // Sound nouns/idioms (雷声、钟声、泣不成声) are prose, not mechanically appended labels.
      if (/(?:氛围|场景)$|^(?:奔跑|跑步|移动|战斗|攻击|走路)声$/u.test(word)) add(row,word,'suffix','不要在动作/情境后机械拼接声、氛围或场景')
      const length = [...word].length
      const long = /\p{Script=Han}/u.test(word) ? length > 4 : length > 32 || word.split(/\s+/).length > 3
      if (length < 2) add(row,word,'short-word','单字易误召回；使用短名或具体事件')
      else if (long) {
        if (epithet.test(word) || /(?:演唱|氛围|场景)$/.test(word)) add(row,word,'short-word','长称号/拼合标签不是实际短名，拆成正文短词')
        else if (row.kind === 'music' || /[\p{Script=Hiragana}\p{Script=Katakana}·・]/u.test(word) || /(?:房间|部屋|调整屋|学校|大学|学园)$/.test(word)) info(row,word,'可能是曲名、人物或地点的另一叫法；缺乏身份元数据，不按长度拒绝')
        else add(row,word,'short-word','一般正文词用 2–4 字；实际名字请提供 name/aliases 或人物身份依据')
      }
      if (unit) add(row,word,'music-unit','音乐不用乐队/组合名召回；成员姓名不属于组合名')
      if (peers.length >= 5 && !unit) {
        if (categories.test(word)) add(row,word,'group-generic',`同一选择范围 ${peers.length} 条 ${row.kind} 共用类别词，不能区分个体`)
        else info(row,word,`同范围 ${peers.length} 条共词；频次本身不能证明误召回，需结合卡绑定审阅`)
      }
    }
  }
  const sharedAliases = [...usage].filter(([id, peers]) => id.startsWith('figure/') && peers.length > 1).map(([id, peers]) => ({trigger:id.slice(7),figures:peers.map(p=>({id:p.id,name:p.name}))}))
  return {entries:all.length,checked:all.filter(touched).length,violations:issues.length,issues,sharedAliases,review}
}
export function enforceTriggers(before, after, force = false) {
  const result = lintTriggers(after,{before})
  if (result.violations && force !== true) {
    const error = new Error(result.issues.map(issue=>issue.message).join('\n'))
    Object.assign(error,{code:'TRIGGER_LINT',issues:result.issues,next_action:'修正所列触发词；明确接受误召回风险时用 --force。'})
    throw error
  }
  return result.issues
}
