// the only legacy vocabulary. Used once at authenticated import or explicit CAS migration.
import {validateFigureEmotions,migrateCharacterEmotions} from '../asset-packs/figure-emotions.js'
import {canonicalJson} from '../asset-packs/common.js'
const legacy = [
  {
    "id": "joy",
    "label": "喜悦",
    "color": "#e0932a",
    "words": "开心 欢喜 欣喜 愉悦 满足 幸福 甜蜜 狂喜 兴奋 雀跃 畅快 陶醉 骄傲 自豪 自信"
  },
  {
    "id": "anger",
    "label": "愤怒",
    "color": "#e0524c",
    "words": "愤怒 暴怒 气愤 愤慨 暴躁 怨恨 敌意 恼火 窝火 生气 烦躁 烦闷"
  },
  {
    "id": "sad",
    "label": "悲伤",
    "color": "#4a86e0",
    "words": "难过 伤心 心酸 忧伤 惆怅 失落 低落 沮丧 悲伤 心痛 悲痛 痛苦 委屈 不甘 失望 受伤 孤独 寂寞 落寞"
  },
  {
    "id": "anxious",
    "label": "紧张",
    "color": "#c9a012",
    "words": "焦虑 紧张 不安 忐忑 担忧 慌张 焦躁 害怕 恐惧 惊恐 畏惧 胆怯 心慌 警惕 戒备"
  },
  {
    "id": "calm",
    "label": "平和",
    "color": "#3fa36b",
    "words": "平静 淡然 冷静 沉稳 从容 坦然 淡定 温馨 舒畅 惬意 温暖 欣慰 释然 感动 感恩 认真"
  },
  {
    "id": "shy",
    "label": "害羞",
    "color": "#1fa5b8",
    "words": "害羞 尴尬 窘迫 难堪 困惑 迷茫 疑惑 纠结 犹豫 无奈 无语"
  },
  {
    "id": "disgust",
    "label": "嫌弃",
    "color": "#8b67d6",
    "words": "厌恶 嫌弃 鄙视 反感 排斥 抗拒 不屑 冷淡 冷漠 疏离 麻木"
  },
  {
    "id": "love",
    "label": "爱恋",
    "color": "#e0609a",
    "words": "喜欢 爱慕 迷恋 倾慕 宠溺 依恋 心动"
  },
  {
    "id": "crying",
    "label": "哭泣",
    "color": "#659bc4",
    "words": "哭泣 流泪 落泪 泪流",
    "note": "明显流泪，默认克制落泪而非嚎啕大哭；与悲伤、紧张不同"
  }
];
// Labels describe feelings, not a universal face or pose. Authored guidance owns intensity.
const generation = 'Express this feeling at the character\'s own emotional intensity. Use the authored personality and expression notes to choose mouth opening, eyes and gesture size; when unspecified, use restrained, readable acting.';
const styles = {
 qwen:{joy:'语气开心、轻快',anger:'语气生气、强烈',sad:'语气悲伤、低落',anxious:'语气紧张、不安',shy:'语气害羞、腼腆',disgust:'语气厌恶、不满',love:'语气温柔、亲昵'},
 azure:{joy:'cheerful',anger:'angry',sad:'sad',anxious:'fearful',disgust:'disgruntled',love:'affectionate'},
 volcengine:{joy:'happy',anger:'angry',sad:'sad',anxious:'fear',shy:'shy',disgust:'hate',love:'lovey-dovey'},
 fish:{joy:'happy',anger:'angry',sad:'sad',anxious:'anxious',calm:'calm',shy:'embarrassed',disgust:'disgusted',love:'soft tone'}
};
export function importFigureVariants(manifest, figures, sprites) {
 const nextManifest=structuredClone(manifest), nextFigures=structuredClone(figures);
 for(const figure of Object.values(nextFigures)) {
  if (figure.schemaVersion === 2) { validateFigureEmotions(figure.emotions); continue; }
  if(Array.isArray(figure.emotions) && figure.outfits.every(o=>[...Object.keys(sprites[o.sprite?.manifestKey]?.emotions || {}),...Object.keys(o.avatars || {}),...Object.keys(o.live2d?.emotionMap || {})].every(id=>figure.emotions.some(e=>e.id===id))) && (figure.emotions.every(e=>e.label) || figure.emotions.length===1 && figure.emotions[0].label===undefined)) {
   validateFigureEmotions(figure.emotions);Object.assign(figure,migrateCharacterEmotions(figure));continue;
  }
  const old=figure.emotions||[], custom=old.filter(e=>!legacy.some(b=>b.id===e.id));
  figure.emotions=[...legacy.map(({id,label,color,words})=>({id,label,guidance:old.find(e=>e.id===id)?.guidance||'',color,words,
   generationGuidance:old.find(e=>e.id===id)?.generationGuidance??[generation,id==='crying'?'Visible tears.':'No tears; tears are reserved for crying.'].join('\n'),...(id==='crying'?{protectTears:true}:{})})),
   ...custom.map(e=>({...e,guidance:e.guidance||'',generationGuidance:e.generationGuidance??[generation,'No tears; tears are reserved for crying.'].join('\n')})).sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0)];
  const order=['calm',...legacy.map(e=>e.id).filter(id=>id!=='calm'),...custom.map(e=>e.id)];
  for(const outfit of figure.outfits){
   const sprite=sprites[outfit.sprite?.manifestKey],ids=new Set([...Object.keys(sprite?.emotions||{}),...Object.keys(outfit.avatars||{}),...Object.keys(outfit.live2d?.emotionMap||{}),...(outfit.live2d?['calm']:[])]);
   outfit.emotions=order.filter(id=>ids.has(id));
  }
  Object.assign(figure,migrateCharacterEmotions(figure));
  const voice=nextManifest.voiceLibrary?.voices?.[figure.voice?.voice];
  if(!voice)continue;
  voice.emotions||={};
  for(const row of figure.emotions){
   // Render aliases can re-enter legacy migration; a valid voice pointer is already authored.
   const pointer=old.find(e=>e.id===row.id)?.voiceEmotion;
   if(pointer && Object.hasOwn(voice.emotions,pointer)){row.voiceEmotion=pointer;continue;}
   const variantId=figure.voice.emotionVariants?.[row.id]??figure.voice.variant??'normal';
   const tuning={};
   for(const [sourceId,source]of Object.entries(voice.sources)){
    const p={...voice.variants?.normal?.tuning?.[sourceId],...voice.variants?.[variantId]?.tuning?.[sourceId]},own=(key)=>Object.hasOwn(p,key);
    if(source.provider==='qwen')tuning[sourceId]={moodInstruction:row.id==='calm'?null:own('moodInstruction')?p.moodInstruction:styles.qwen[row.id]||null};
    else if(source.provider==='azure')tuning[sourceId]={style:own('style')?p.style:styles.azure[row.id]||null};
    else if(source.provider==='volcengine')tuning[sourceId]={emotion:styles.volcengine[row.id]||null};
    else if(source.provider==='fish-audio')tuning[sourceId]={emotionTag:styles.fish[row.id]||null};
   }
   // A shared voice may have different figure variants. Keep their effective settings separate.
   const value={label:row.label,tuning,referenceEmotion:row.id};
   let id=row.id;
   if(voice.emotions[id]&&canonicalJson(voice.emotions[id])!==canonicalJson(value)) {
    const base=row.id+'-'+figure.id;id=base;
    for(let suffix=2;voice.emotions[id]&&canonicalJson(voice.emotions[id])!==canonicalJson(value);suffix++)id=base+'-'+suffix;
   }
   voice.emotions[id]=value;row.voiceEmotion=id;
  }
 }
 return {manifest:nextManifest,figures:nextFigures};
}
