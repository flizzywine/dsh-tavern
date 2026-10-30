// Whole-phrase admission, not keyword extraction: an emotional suffix cannot launder a plot fact.
const rules={
  laugh:/^(?:哈{2,}|嘿{2,}|嘻{2,}|[wｗ]{2,}|233+|草|笑死我了|笑死|笑不活了|绷不住了|蚌埠住了|笑喷了|吐槽|好笑)$/u,
  cute:/^(?:可爱|萌|萌死了|awsl)$/u,
  sad:/^(?:呜{2,}|嘤{2,}|哭了|哭死|泪目|心疼|心痛|难过|难受|伤心|悲伤|抱抱|感动)$/u,
  tense:/^(?:紧张|担心|害怕|吓人|吓死我了|屏住呼吸|小心|救命)$/u,
  shock:/^(?:卧槽|我去|哇{1,}|啊{2,}|震惊|惊讶|意外|没想到|天哪|天啊)$/u,
  sweet:/^(?:甜|好甜|发糖|甜死了|磕到了|嗑到了|kswl|kdl|害羞)$/u,
  cool:/^(?:帅|帅气|厉害|牛|牛逼|燃|帅炸了)$/u,
  awkward:/^(?:尴尬|啊这|这就尴尬了|社死|无语|绷不住)$/u,
  applause:/^(?:6{2,}|8{2,}|好耶|太好了|加油|鼓掌|精彩|漂亮|干得好|赞|支持)$/u,
  greeting:/^(?:你好|早上好|晚上好|早安|晚安|来了|我来了|大家好|再见)$/u,
  neutral:/^(?:嗯{2,}|哦{2,}|喔{2,}|噢{2,}|嗯哼|原来如此|这样啊|围观|继续)$/u,
};
const moodRules={
  laugh:/happy|joy|laugh|amused|笑|开心|高兴|幽默|好笑|调侃|玩笑|吐槽|打趣|逗/,cute:/cute|adorable|可爱|萌|撒娇/,
  sad:/sad|sorrow|cry|hurt|lonely|悲|哭|泪|失落|难过|心疼|痛苦|寂寞|沉重|叹息/,tense:/tense|fear|nervous|anxious|scared|heartbeat|shake|紧张|害怕|担心|不安|警惕|恐惧|犹豫|发抖|危险|颤抖|皱眉|皱紧|鬼故事/,
  shock:/surpris|shock|astonish|flash|惊讶|震惊|惊愕|愣住|诧异|吃惊|瞪大/,sweet:/shy|blush|love|romantic|affection|hearts|害羞|脸红|羞涩|亲吻|拥抱|发糖|心动|告白|甜蜜/,
  cool:/confident|proud|determined|帅|坚定|决心|自信|潇洒|利落|昂首/,
  awkward:/awkward|embarrass|尴尬|无语|语塞|僵住|干笑|沉默/,applause:/excited|cheer|triumph|庆祝|成功|精彩|欢呼|鼓掌|赢了|做到了|太好了/,
  greeting:/greeting|早上好|晚上好|早安|晚安|你好|再见|打招呼|招手/,
};
const compact=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]/gu,'');
export function reactionClass(text,cast=[],names=cast.flatMap(c=>[c.name,...(c.aliases||[])]).map(compact).filter(Boolean)) {
  let value=compact(text);
  if(!value||value.length>18)return null;
  if(names.some(name=>value.includes(name)))return null;
  const variants=[value,value.replace(/^(?:真的|真是|超级|特别|实在|非常|有点|好|太|很|真|超)+/u,'').replace(/(?:啊|呀|啦|呢|捏|哇|吧|了)+$/u,'')];
  for(const [kind,rule]of Object.entries(rules))if(variants.some(v=>rule.test(v)))return kind==='neutral'&&(/[!！]/u.test(text)||/[哦喔噢]{3,}/u.test(value))?'shock':kind;
  return null;
}
export const moodText=text=>String(text||'').replace(/(?:没有|并没|并不|不再|并未|未曾|不)(?:太|再)?(?:笑|哭|开心|高兴|紧张|害怕|生气)/gu,'')
export function reactionFitsPage(reaction,text,signals={}) {
  if(reaction.reactionClass!=='tense'||!/吓|救命/u.test(reaction.text))return true
  return /fear|scared|害怕|恐惧|危险|恐怖|鬼|惊吓/u.test([text,signals.mood,signals.narration,...(Array.isArray(signals.effects)?signals.effects:[])].join(' ').toLowerCase())
}
export function pageReactionClasses(text,signals={}) {
  const hints=[signals.mood,...(Array.isArray(signals.emotions)?signals.emotions:[]),...(Array.isArray(signals.effects)?signals.effects:[])].filter(x=>typeof x==='string').join(' ').toLowerCase();
  const prose=moodText(text)+' '+moodText(signals.narration);
  const explicit=Object.entries(moodRules).filter(([,rule])=>rule.test(hints)).map(([kind])=>kind);
  let classes=explicit.length?explicit:Object.entries(moodRules).filter(([,rule])=>rule.test(prose)).map(([kind])=>kind);
  // Negative beats win over incidental mentions of laughter or sweetness in the same page.
  if(classes.some(c=>['sad','tense'].includes(c)))classes=classes.filter(c=>!['laugh','cute','sweet','applause'].includes(c));
  return [...new Set(classes)];
}
export function createReactionPool(corpus) {
  const pool=new Map(),names=corpus.cast.flatMap(c=>[c.name,...(c.aliases||[])]).map(compact).filter(Boolean);
  for(const w of corpus.segments)for(const c of w.comments){
    const kind=reactionClass(c.text,corpus.cast,names);if(!kind)continue;
    const key=kind+'\0'+c.text;
    if(!pool.has(key))pool.set(key,{text:c.text,reactionClass:kind,window:w.id,provenance:c.provenance,density:w.density,count:c.count||1});
  }
  return [...pool.values()];
}
