import {variableGuessHints} from '../../lib/domain/variable-bindings/index.js'
import {withBuiltinPhoneDevice} from './logic.js'
import {phoneModMarker,phoneModSourceMarker} from './stage-phone.cjs'
import {phoneGroup,applyPhoneGroup} from './threads.js'

// A card's private config pack holds at most 128 files / 16 MiB (asset library), the phone's pictures ≤ 480 KB each.
export const PHONE_PHOTOS_MAX=30
export const PHONE_TONES=Object.freeze([{value:'drop',label:'水滴'},{value:'chime',label:'叮咚'},{value:'pop',label:'轻响'},{value:'none',label:'静音'}])

// The phone's part of the director transaction (tavern-plugin/lib/domain/mods/stage-contributions.js).
export default {
  // Builtins and uploaded settings are presentation resources, never recall candidates.
  catalogue:withBuiltinPhoneDevice,
  configFields(fields) {
    // The settings page names what the player sees on the phone.
    Object.assign(fields.find(row=>row.key==='clockText'),{label:'状态栏时间',guessHints:variableGuessHints.time,ui:{control:'time'}})
    Object.assign(fields.find(row=>row.key==='cutout'),{label:'机型'})
    Object.assign(fields.find(row=>row.key==='battery'),{label:'电量',min:0})
    // 来信提示音: a few built-in sounds (view/assets/<value>.wav), 静音 = none.
    Object.assign(fields.find(row=>row.key==='sound'),{valueType:'string',default:'drop',choices:PHONE_TONES.map(row=>row.value),ui:{control:'choice',choices:PHONE_TONES}})
    Object.assign(fields.find(row=>row.key==='accentColor'),{label:'主题色',default:'#6f8fd8',autoRef:{source:'stage',path:'/mainCharacterColor'},autoLabel:'主角形象色'})
    Object.assign(fields.find(row=>row.key==='surfaceColor'),{default:'#f4f2ec',autoRef:{source:'stage',path:'/skin/surface'},autoLabel:'舞台皮肤'})
    Object.assign(fields.find(row=>row.key==='bodyColor'),{default:'#3b3a38',autoRef:{source:'stage',path:'/skin/line'},autoLabel:'舞台皮肤'})
    fields.find(row=>row.key==='battery').ui={unit:'%',integer:true}
    // 照片 is the phone's one picture library — the pictures the player imported, later FaceTime snapshots — a layer's
    // [{file, name?}] (oldest first). 墙纸 is one uploaded picture of the same layer ({file}), {} = the phone's built-in
    // wallpaper; 本卡 over 全局 (phone-photos.md).
    fields.push({key:'photos',label:'照片',valueType:'array',default:[],ui:{control:'images',maxItems:PHONE_PHOTOS_MAX}})
    fields.push({key:'wallpaper',label:'墙纸',valueType:'object',default:{},ui:{control:'image'}})
    fields.push({key:'dateText',label:'日期',valueType:'string',default:'',guessHints:variableGuessHints.date})
    fields.push({key:'weekdayText',label:'星期',valueType:'string',default:'',guessHints:variableGuessHints.weekday})
    fields.push({key:'signal',label:'信号',valueType:'number',default:4,min:0,max:4,ui:{integer:true}})
    fields.push({key:'carrier',label:'运营商',valueType:'string',default:'',maxLength:64})
    // Contacts come from the card's characters (stage alias); a fixed value overrides 备注名 / 头像 per alias:
    // {[alias]:{name?:string,avatar?:{file}}}. Avatar files live in the same layer's files/.
    fields.push({key:'contacts',label:'联系人',valueType:'object',default:{},records:{name:'text',avatar:'image'}})
  },
  admitParams(command,params,state,context,metadata,check) {
    if(command.admission?.source === 'phone.message') {
      const threads=state.modState?.[command.modId]?.threads || {},group=params.thread!==undefined
      const marker=phoneModSourceMarker(params,context.phone?.units[metadata.at - 1],context.phone?.characters || [],threads,context.phone?.playerId)
      check(marker,group ? '$.thread' : '$.to','Choose a destination matching this source speaker.','ARG_INVALID')
      const {op:_,...rest}=marker
      params=rest
    }
    return command.admission?.phoneGroup ? phoneGroup(params,context.phone?.characters || []) : params
  },
  applyStageState(state,command,params) {
    return command.admission?.phoneGroup ? applyPhoneGroup(state,params) : undefined
  },
  promptState(own,command) {
    return own.threads && command.admission?.phoneGroup ? {threads:own.threads} : undefined
  },
  sourceMarker:{op:'phone.message',valid:phoneModMarker},
  promptActors(own,actor) {
    if(own.threads)for(const thread of Object.values(own.threads))thread.participants=thread.participants.map(id=>id==='$player'?id:actor(id) || id)
    return own
  },
}
