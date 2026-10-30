// The danmaku's settings beyond its manifest schema (tavern-plugin/lib/domain/mods/stage-contributions.js).
export default {
  configFields(fields) {
    for(const field of fields)if(['commentsPerRequest','minIntervalSeconds','maxCallsPerMinute'].includes(field.key))field.fixedOnly=true
    fields.push({key:'streamerName',label:'主播名称',valueType:'string',default:'',maxLength:64,scope:'card',fixedOnly:true})
    fields.push({key:'streamerAvatarRef',label:'主播头像',valueType:'object',default:null,nullable:true,scope:'card',fixedOnly:true,figureRef:true})
    fields.push({key:'streamerAvatarImage',label:'主播头像图片',valueType:'object',default:{},scope:'card',fixedOnly:true,ui:{control:'image'}})
  },
}
