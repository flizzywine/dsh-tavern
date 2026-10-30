import {modStageContribution} from './stage-contributions.js'
export function builtinConfigSchemas(manifests) {
  const schemas={}
  for(const manifest of manifests) {
    const fields=manifest.settingsSchema.fields.map(field=>({
      key:field.key,label:field.label,valueType:field.type==='toggle'?'boolean':field.type==='slider'?'number':field.type==='colour' || field.type==='text' || field.type==='segmented'?'string':'object',
      default:field.default,scope:'default+card',...(field.default===null?{nullable:true}:{}),
      ...(field.min===undefined?{}:{min:field.min,max:field.max}),...(field.maxLength?{maxLength:field.maxLength}:{}),
      ...(field.choices?{choices:field.choices.map(row=>row.value)}:{}),
      ui:{...(field.type==='colour'?{control:'colour'}:field.type==='segmented'?{control:'choice',choices:field.choices}:field.type==='text'?{control:'text'}:{}),...(field.unit?{unit:field.unit}:{}),...(field.type==='slider'?{integer:Number.isInteger(field.step)}:{})},
    }))
    modStageContribution(manifest.id)?.configFields?.(fields)
    for(const slot of manifest.variableSlots || [])if(!fields.some(field=>field.key===slot.id))fields.push({key:slot.id,label:slot.label,valueType:slot.valueType,default:[],fieldMapping:slot.fieldMapping || {}})
    schemas[manifest.id]={fields}
  }
  return schemas
}
export const stageConfigExports=[
  ['background','object','当前背景'],['timeOfDay','string','当前时段'],['characters','array','在场人物及形象色'],['contacts','array','手机联系人'],['speaker','string','当前说话人身份'],['mainCharacterColor','string','主角形象色'],['bgm','object','当前背景音乐'],['skin','object','舞台皮肤颜色'],
].map(([key,type,description])=>({path:'/'+key,name:key,type,description}))
