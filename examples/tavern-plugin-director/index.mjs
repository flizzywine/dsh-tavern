// 导演插件示例（宿主侧）：每轮结算之后，让后台 Agent 读这一轮的正文和台词标注，
// 决定这一幕的地点、时间和气氛，存成这一轮的数据；浏览器侧 client.js 用它画舞台。
// 演示怎样只用插件接口做 Galgame 式的演出：settlementTask + runAgent 做导演，
// saveTurnData 存结果（回退、重新生成后自然失效），getCast 读 Tavern 标注好的说话人与情绪。
// 整个文件夹复制到 Tavern 数据目录的 plugins/ 下即可加载；舞台入口要在设置里打开「对话头像」。

export const name = 'tavern-plugin-director'
export const inject = ['tavern']

export const TIMES = ['清晨', '白天', '黄昏', '夜晚']
export const MOODS = ['平静', '温馨', '欢快', '紧张', '悲伤', '神秘']

const DIRECT_TOOL = {
  name: 'director_scene',
  description: '提交这一幕的舞台设定。只调用一次。',
  parameters: {
    type: 'object',
    properties: {
      place: { type: 'string', description: '地点，12 字以内，例如「酒馆大堂」' },
      time: { type: 'string', enum: TIMES },
      mood: { type: 'string', enum: MOODS }
    },
    required: ['place', 'time', 'mood']
  }
}

/** The scene the model chose, cleaned; null when it is not usable. */
export function cleanScene(args) {
  const place = typeof args?.place === 'string' ? [...args.place.trim()].slice(0, 12).join('') : ''
  if (!place || !TIMES.includes(args.time) || !MOODS.includes(args.mood)) return null
  return { place, time: args.time, mood: args.mood }
}

export function apply(ctx) {
  if (!(ctx.tavern.apiVersion >= 2) || typeof ctx.tavern.getCast !== 'function') return

  ctx.tavern.settlementTask({
    name: 'direct',
    title: '导演',
    phase: 'after',
    async run({ gameId, turn, textVersion, text, runAgent }) {
      const cast = await ctx.tavern.getCast({ gameId, turn })
      const speakers = cast ? [...new Set(cast.lines.map(line => line.speaker))].join('、') : ''
      let scene = null
      await runAgent({
        prompt: [
          '你是这部互动小说的舞台导演。读下面这一轮正文，决定这一幕的地点、时间和气氛，调用 director_scene 提交一次，然后结束。',
          speakers ? '本轮说话的人物：' + speakers : '',
          '【本轮正文】\n' + text.slice(-4000)
        ].filter(Boolean).join('\n\n'),
        tools: [{ ...DIRECT_TOOL, execute: async args => {
          scene = cleanScene(args)
          return scene ? { ok: true } : { ok: false, error: 'place 必填；time、mood 只能从给定选项里选' }
        } }]
      })
      if (scene) await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: scene })
    }
  })

  // 浏览器侧用 callHost 读某一轮的舞台设定。
  ctx.tavern.handle('tavern-plugin-director/scene', async ({ gameId, turn }) => {
    const record = await ctx.tavern.readTurnData({ gameId, turn })
    return record && record.turn === turn ? record.data : null
  })
}
