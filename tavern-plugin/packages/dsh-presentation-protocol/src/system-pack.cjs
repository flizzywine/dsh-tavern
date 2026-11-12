// 系统设置包: the one asset pack holding what the system itself falls back on — today the figures 通用声音 and
// 旁白声音 speak with. Single authority: the pack and each entry are known by these fixed ids, never by
// name; the host rebuilds a missing pack, and adds an entry it does not have yet, from the defaults here
// (dsh-tavern-stage/lib/system-pack.js), so pointers at them stay valid. The library retires a deleted figure's id, so the
// client offers no 删除人物 for these figures. A feature that needs a default asset adds its entry here instead of making a pack of its own.
const SYSTEM_PACK = Object.freeze({
  id:'a6048e6c-e74d-4ef8-ab6f-1162d97659ed',
  name:'系统设置（请勿删除）',
  description:'系统自己要用的兜底素材：通用声音和旁白声音用的就是这里的人物，可以改它们的声音。删掉这个包，下次启动时会按默认内容重建，改过的声音会丢失。这个包不用对卡启用。',
});
// The figures: role → fixed figure id; their default voice is the browser's own, read in 中文.
const SYSTEM_FIGURES = Object.freeze({
  general:Object.freeze({id:'0e6bd60d-c6c2-4739-b863-d423ac190bc2', name:'通用声音'}),
  narrator:Object.freeze({id:'fc8d9412-c610-4ffe-a823-8e54b138c508', name:'旁白声音'}),
});
const systemFigureDefault = role => ({
  figure:{schemaVersion:1, name:SYSTEM_FIGURES[role].name, aliases:[], enabled:true, outfits:[]},
  voiceSpec:{name:SYSTEM_FIGURES[role].name, language:'zh', defaultSource:'main', sources:{main:{kind:'preset', provider:'browser'}}},
});
// Whether a pack (or one figure of it) is a system entry, which the host rebuilds when it goes missing.
const isSystemEntry = (packId, figureId) => packId === SYSTEM_PACK.id && (figureId === undefined || Object.values(SYSTEM_FIGURES).some(f => f.id === figureId));
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = {SYSTEM_PACK, SYSTEM_FIGURES, systemFigureDefault, isSystemEntry};
