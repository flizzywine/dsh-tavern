// every variant is authored data; IDs carry no rendering or voice semantics.
import identity from '../shared/emotion-identity.cjs'
export const {matchBubbleMood} = identity
import {assertJson, check, shape, text, array, unique, record, integer, oneOf} from './common.js'
// a 差分 display name is at most 4 characters (code points). Checked where
// labels enter (pack install, the editor, lint); the badge never truncates.
export const FIGURE_EMOTION_LABEL_MAX = 4
export function figureEmotionLabelProblem(label) {
 return [...label].length > FIGURE_EMOTION_LABEL_MAX ? '差分名「' + label + '」超过 ' + FIGURE_EMOTION_LABEL_MAX + ' 个字；改成保留原意的自然短名（如「抬右翼闭眼」→「右翼闭眼」），ID 不变' : ''
}
export function validateFigureEmotions(value, path = '$.emotions') {
 assertJson(value);check(Array.isArray(value),path,'Expected array');const names=new Set();
 value.forEach((row,index)=>{
  const p=path+'['+index+']';
  const single = row?.label === undefined;
  shape(row,single ? ['id'] : ['id','label','guidance','voiceEmotion','words','color','generationGuidance','protectTears','remark'],single ? ['id'] : ['id','label'],p);
  if(single) check(value.length===1,p,'An unlabelled image must be the only entry');
  check(typeof row.id==='string'&&/^[a-z][a-z0-9_-]{0,23}$/.test(row.id),p+'.id');
  if(!single){text(row.label,p+'.label');check(row.label.trim()===row.label,p+'.label');check(!figureEmotionLabelProblem(row.label),p+'.label',figureEmotionLabelProblem(row.label),'LIMIT_EXCEEDED');}
  if(row.guidance!==undefined)text(row.guidance,p+'.guidance',60,0);
  if(row.remark!==undefined)text(row.remark,p+'.remark',4000,0);
  if(row.voiceEmotion!==undefined)text(row.voiceEmotion,p+'.voiceEmotion',80);
  if(row.words!==undefined)text(row.words,p+'.words',1000,0);
  if(row.color!==undefined)check(/^#[0-9a-fA-F]{6}$/.test(row.color),p+'.color');
  if(row.generationGuidance!==undefined)check(typeof row.generationGuidance==='string'&&row.generationGuidance.length<=4000&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(row.generationGuidance),p+'.generationGuidance');
  if(row.protectTears!==undefined)check(typeof row.protectTears==='boolean',p+'.protectTears');
  for(const name of new Set([row.id,...(single?[]:[row.label.toLowerCase()])])){check(!names.has(name),p,'Variant IDs and labels must be unambiguous','DUPLICATE_ID');names.add(name)}
 });unique(value.map(row=>row.id),path);return value;
}
export function figureSingleImage(figure) {const rows=figure?.emotions;return rows?.length===1 && rows[0].label===undefined ? rows[0].id : null;}
export function figureEmotionRows(figure) {return (figure?.emotions||[]).filter(row=>row.label!==undefined).map(row=>({...row}));}
export function figureOutfitEmotionRows(figure,outfit) {
 return figureEmotionRows(figure);
}

export function figureDefaultEmotion(figure, outfit) { return outfit?.defaultEmotion ?? figure?.emotions?.[0]?.id; }
export function validateOutfitEmotions(figure, outfit, path = '$.outfit') {
 check(!Object.hasOwn(outfit,'emotions'),path+'.emotions','Use figure.emotions','UNKNOWN_FIELD');
 const ids = (figure.emotions || []).map(row=>row.id);
 if(outfit.defaultEmotion !== undefined) check(ids.includes(outfit.defaultEmotion),path+'.defaultEmotion','Unknown default emotion','MISSING_DEPENDENCY');
 if(outfit.fallbackEmotions !== undefined) {
  check(Array.isArray(outfit.fallbackEmotions),path+'.fallbackEmotions','Expected array');unique(outfit.fallbackEmotions,path+'.fallbackEmotions');
  for(const id of outfit.fallbackEmotions) check(ids.includes(id) && id !== figureDefaultEmotion(figure,outfit),path+'.fallbackEmotions','Fallback must name a non-default figure emotion','INVALID_MANIFEST');
 }
 // 缺图时用 — a marked 差分 may name the 差分 that stands in (absent: the default).
 if(outfit.fallbackTo !== undefined) record(outfit.fallbackTo,path+'.fallbackTo',(use,q,id)=>check((outfit.fallbackEmotions || []).includes(id) && ids.includes(use) && use !== id,q,'A stand-in names another figure emotion for a marked 差分','INVALID_MANIFEST'));
 // 存为默认 — one cell's own default prompt (this figure × outfit × 差分 × view).
 if(outfit.genPrompts !== undefined) {
  shape(outfit.genPrompts,['sprite','avatar'],[],path+'.genPrompts');
  for(const [kind,map] of Object.entries(outfit.genPrompts)) record(map,path+'.genPrompts.'+kind,(value,q,id)=>check(ids.includes(id) && promptText(value),q,'Invalid default prompt'));
 }
 // this outfit's adopted generations, newest last (written by the asset-generation accept).
 if(outfit.genRecords !== undefined) {
  array(outfit.genRecords,path+'.genRecords',GEN_RECORDS);
  outfit.genRecords.forEach((row,index)=>{
   const q=path+'.genRecords['+index+']';
   shape(row,['kind','emotionId','at','prompt'],['kind','at'],q);oneOf(row.kind,['settei','sprite','avatar','avatar-sheet'],q+'.kind');integer(row.at,q+'.at');
   check(['sprite','avatar'].includes(row.kind) ? ids.includes(row.emotionId) : row.emotionId === undefined,q+'.emotionId');
   if(row.prompt !== undefined) check(promptText(row.prompt),q+'.prompt');
  });
 }
}
export const GEN_RECORDS = 24;
const promptText = value => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
// One ingress migration; existing author labels and media are never manufactured or removed.
export function migrateCharacterEmotions(figure) {
 if(!figure.outfits?.some(outfit=>Object.hasOwn(outfit,'emotions'))) return figure;
 const next=structuredClone(figure);
 for(const outfit of next.outfits) {
  if(outfit.defaultEmotion === undefined && outfit.emotions?.length) outfit.defaultEmotion = matchBubbleMood(outfit.emotions[0],next.emotions || [])?.id || outfit.emotions[0];
  delete outfit.emotions;
 }
 return next;
}
