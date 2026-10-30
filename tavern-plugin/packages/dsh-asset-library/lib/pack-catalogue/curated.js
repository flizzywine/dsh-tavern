// Publication slots, not a second catalogue protocol. A release supplies an ordinary
// catalogue entry as source; null means not produced/published and stays invisible.
export const CURATED_SLOTS = Object.freeze([
  {id:'backgrounds',title:'通用背景',source:null},
  {id:'bgm',title:'通用 BGM',source:null},
  {id:'sfx',title:'通用 SE',source:null},
  {id:'ambience',title:'通用环境音',source:null},
  {id:'characters',title:'通用人物',source:null},
  {id:'dafeiyu',title:'大肥鱼示例卡',source:null}
])
export const curatedEntries = (slots = CURATED_SLOTS) => slots.filter(slot => slot.source).map(slot => ({...slot.source,extensions:{...slot.source.extensions,'dsh:curated':slot.id}}))
export const isCuratedEntry = entry => CURATED_SLOTS.some(slot => slot.id === entry.extensions?.['dsh:curated'])
