// Generated from dsh.danmaku by build.mjs; do not edit.
export const SC_AMOUNTS = Object.freeze([30,50,100,500,1000,2000])

// Called by the fixed audience kind owner only when importing/writing content.
export function validateAudienceContent(content) {
  const fail = field => { throw Object.assign(new Error('Invalid audience content: ' + field), {code:'MOD_RESOURCE_UNAVAILABLE'}) }
  if (!content || typeof content !== 'object' || Array.isArray(content) ||
      Object.keys(content).some(key => !['persona','tone','catchphrases','examples','nicknamePool','triggers','chains'].includes(key))) fail('fields')
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max
  for (const [key,max] of [['persona',1200],['tone',600]]) if (!text(content[key],max)) fail(key)
  for (const [key,max] of [['catchphrases',120],['examples',240]]) {
    if (!Array.isArray(content[key]) || content[key].length > 12 || !content[key].every(value => text(value,max))) fail(key)
  }
  if(content.nicknamePool!==undefined && (!Array.isArray(content.nicknamePool) || !content.nicknamePool.length ||
      content.nicknamePool.length>32 || !content.nicknamePool.every(name=>text(name,24)))) fail('nicknamePool')
  for (const kind of ['triggers','chains']) {
    if (content[kind] === undefined) continue
    const rows=content[kind],ids=new Set(),trigger=kind==='triggers'
    if (!Array.isArray(rows) || rows.length>12) fail(kind)
    for (const row of rows) {
      const fields=trigger?['id','keywords','lines','probability','cooldown']:['id','match','replies','probability']
      if (!row || Object.keys(row).some(key=>!fields.includes(key)) || typeof row.id!=='string' ||
          !/^[a-zA-Z0-9._-]{1,64}$/.test(row.id) || ids.has(row.id)) fail(kind+'.id')
      ids.add(row.id)
      const lines=trigger?row.lines:row.replies
      if (!Array.isArray(lines) || !lines.length || lines.length>12 || !lines.every(line=>text(line,160) || line && typeof line==='object' && !Array.isArray(line) &&
          Object.keys(line).every(key=>['text','kind','amount'].includes(key)) && text(line.text,160) &&
          ['comment','highlight'].includes(line.kind) && (line.kind==='highlight' ? line.amount==null || SC_AMOUNTS.includes(line.amount) : line.amount==null))) fail(kind+'.lines')
      if (trigger ? !Array.isArray(row.keywords) || !row.keywords.length || row.keywords.length>12 ||
          !row.keywords.every(word=>text(word,120) && [...word.trim()].length>=2) :
          !text(row.match,160) || [...row.match.trim()].length<2) fail(kind+'.match')
      if ((!trigger || row.probability!==undefined) &&
          (typeof row.probability!=='number' || !Number.isFinite(row.probability) || row.probability<0 || row.probability>1)) fail(kind+'.probability')
      if (row.cooldown!==undefined && (typeof row.cooldown!=='number' || !Number.isFinite(row.cooldown) || row.cooldown<0 || row.cooldown>3600)) fail(kind+'.cooldown')
    }
  }
  return structuredClone(content)
}
