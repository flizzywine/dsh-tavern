const words=['团子','布丁','企鹅','星星','饭团','咸鱼','汽水','风铃','薄荷','云朵','月亮','蘑菇','橘子','纸飞机','积木','海盐','麦芽','雨点','书签','松果','豆沙','山雀','竹笋','琥珀','茶杯','胶片','雪糕','树叶','枕头','年糕','铃兰','砂糖']
const modifiers=['路过的','熬夜的','快乐的','迷路的','会发光的','不想早起的','追番的','正在摸鱼的','慢半拍的','打哈欠的','周末的','口袋里的','打游戏的','午后的','刚睡醒的','听雨的']
const actions=['今天也要','明天记得','偶尔想要','悄悄开始','周末只想','现在准备','下次一定','每天坚持']
const endings=['早睡','看海','喝茶','听歌','发呆','散步','追番','吃饭','画画','看云','摸鱼','读书']
const latin=['mint','cloud','rice','yueliang','moyu','orange','paper','xingxing','echo','slow','soda','chashui','rain','sleepy','leaf','wind']
const handles=['day','box','note','room','time','radio','walk','dream','log','page','light','wave','tea','cat','sky','moon']
const fandom=['追番中','等更新','补档员','单推人','应援部','观察日记','名场面收藏','片尾不跳']

// Deterministic identity PRNG, not an account lookup or integrity hash.
export function viewerNickname(chatId,commentId,group,parentAuthor=null) {
  let seed=2166136261
  for(const char of JSON.stringify([chatId,commentId]))seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0
  const next=()=>{
    seed=(seed+0x6d2b79f5)>>>0
    let value=Math.imul(seed^(seed>>>15),seed|1)
    value^=value+Math.imul(value^(value>>>7),value|61)
    return (value^(value>>>14))>>>0
  }
  const pick=values=>values[next()%values.length]
  const allowed=name=>name!==parentAuthor && name!==group.name
  const pool=group.content.nicknamePool
  // Authored handles are occasional accents, not a stem repeated across the stream.
  if(next()%5===0 && pool?.length) {
    const name=pick(pool)
    if(allowed(name))return name
  }
  for(let attempt=0;attempt<4;attempt++) {
    const shape=next()%8
    const name=shape===0 ? 'bili_'+String(10000000+next()%90000000) :
      shape===1 ? pick(actions)+pick(endings) :
      shape===2 ? pick(modifiers)+pick(words) :
      shape===3 ? pick(words)+String(10+next()%990) :
      shape===4 ? pick(latin)+pick(handles) :
      shape===5 ? pick(latin)+'_'+pick(handles) :
      shape===6 ? pick(words)+pick(['・','の'])+pick(words) :
      pick(words)+pick(fandom)
    if(allowed(name))return name
  }
  // Three distinct candidates suffice for the two forbidden names.
  const number=10000000+next()%89999997
  for(let step=0;step<3;step++) {
    const name='bili_'+String(number+step)
    if(allowed(name))return name
  }
}
