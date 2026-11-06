// Value-shape evidence used by the existing binding ranker, not a second resolver.
const pad = n => String(n).padStart(2,'0')
const digit = value => /^\d+$/.test(value) ? Number(value) : value === '十' ? 10 : value.includes('十') ? (value.startsWith('十')?1:'零一二三四五六七八九'.indexOf(value[0]))*10+(value.endsWith('十')?0:'零一二三四五六七八九'.indexOf(value.at(-1))) : '零一二三四五六七八九'.indexOf(value)
export function normalizeVariableFormat(value,format) {
  if (typeof value !== 'string') return null
  const text=value.trim()
  if(format==='time') {
    let m=/(?:^|[T\s，,])(?:(上午|下午|晚上|夜晚|中午|凌晨|早上|早晨|午前|午後)\s*)?(\d{1,2})[:：](\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?(?=$|[\sZ+，,（(])/i.exec(text)
    let hour,minute,period
    if(m){period=m[1] || m[5];hour=Number(m[2]);minute=Number(m[3]);if(m[4] && Number(m[4])>59)return null}
    else {
      m=/^(上午|下午|晚上|夜晚|中午|凌晨|早上|早晨|午前|午後)?\s*([\d零一二三四五六七八九十]{1,3})[点點時时](?:\s*([\d零一二三四五六七八九十]{1,3})分?|([半]))?(?:整)?$/.exec(text)
      if(!m)return null
      period=m[1];hour=digit(m[2]);minute=m[4]?30:m[3]?digit(m[3]):0
    }
    if(hour<0 || hour>23 || minute<0 || minute>59)return null
    if(period && /下午|晚上|夜晚|午後|PM/i.test(period) && hour<12)hour+=12
    if(period && /上午|凌晨|早上|早晨|午前|AM/i.test(period) && hour===12)hour=0
    if(period==='中午' && hour<11)hour+=12
    return {value:pad(hour)+':'+pad(minute),ordinal:hour*60+minute}
  }
  if(format==='date') {
    let m=/^(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?:日)?(?=$|[T\s，,(（])/.exec(text)
    if(m) {
      const year=m[1]?Number(m[1]):2000,month=Number(m[2]),day=Number(m[3]),date=new Date(Date.UTC(year,month-1,day))
      if(month<1 || month>12 || day<1 || date.getUTCDate()!==day)return null
      return {value:(m[1]?m[1]+'-':'')+pad(month)+'-'+pad(day),ordinal:date.getTime()/86400000}
    }
    m=/^第\s*(\d+)\s*[天日]$/.exec(text)
    if(m)return {value:'第'+Number(m[1])+'天',ordinal:Number(m[1])}
    return null
  }
  if(format==='weekday') {
    const m=/^(?:(?:星期|周|週)([一二三四五六日天])|([月火水木金土日])曜日|(?:mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?))$/i.exec(text)
    if(!m)return null
    const index=m[1]?'一二三四五六日天'.indexOf(m[1]):m[2]?'月火水木金土日'.indexOf(m[2]):['mon','tue','wed','thu','fri','sat','sun'].indexOf(text.slice(0,3).toLowerCase())
    return {value:'星期'+'一二三四五六日'[Math.min(index,6)],ordinal:Math.min(index,6)}
  }
  return null
}
export const variableGuessHints = Object.freeze({
  time:{format:'time',keywords:['时间','時間','时刻','時刻','当前时间','當前時間','現在時刻','time','clock','currentTime','datetime'],preferredParents:['世界状态','世界狀態','世界','world','worldstate','环境','環境','scene'],threshold:65},
  date:{format:'date',keywords:['日期','日付','日','date','day','当前日期','現在日付','datetime','时间','時間'],preferredParents:['世界状态','世界','world','worldstate','环境','環境','scene'],threshold:65},
  weekday:{format:'weekday',keywords:['星期','曜日','weekday','周','週'],preferredParents:['世界状态','世界','world','环境','scene'],threshold:65},
  inventory:{keywords:['背包','背包物品','物品栏','物品欄','持有物','所持品','持ち物','インベントリ','inventory','backpack','items'],preferredParents:['玩家','主角','player','主人公'],threshold:65},
})
