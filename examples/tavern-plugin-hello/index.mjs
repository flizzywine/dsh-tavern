// 最小 Tavern 插件示例（宿主侧）：每轮正文写完后，在第一句话所在的段落后面挂一张图；
// 浏览器侧 client.js 在每条消息下加「重画示例图」按钮，通过 callHost 调用这里的 tavern-plugin-hello/redraw；
// 另外请模型在正文末尾写一个 hello###…### 标记，由 client.js 显示成徽章。
// 把 drawImage() 换成你自己的生图服务，就是一个完整的生图插件。
// 整个文件夹复制到 Tavern 数据目录的 plugins/ 下即可加载。接口说明见 docs/plugin-api.md。

export const name = 'tavern-plugin-hello'
export const inject = ['tavern', 'attachments']

// 一张 96×64 的蓝色 PNG，代替真正的生图结果。
const DEMO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAaUlEQVR42u3QMQ0AAAgDsMlBIhKRhQNujiZV0FQPhygQJEiQIEGCBAlCkCBBggQJEiQIQYIECRIkSJAgBAkSJEiQIEGCBCFIkCBBggQJEoQgQYIECRIkSBCCBAkSJEiQIEGCECRIkKB/FrvQwfDSKcbsAAAAAElFTkSuQmCC'

async function drawImage(_prompt) {
  return { data: new Uint8Array(Buffer.from(DEMO_PNG, 'base64')), mediaType: 'image/png' }
}

export function apply(ctx) {
  if (ctx.tavern.apiVersion < 1) return

  // 先挂一个占位，正文里马上显示「生成中…」；画好后换成图片。
  async function draw(turn) {
    const firstSentence = turn.text.split(/(?<=[。！？!?])/)[0].trim()
    const { id } = await ctx.tavern.attach({
      gameId: turn.gameId, turn: turn.turn, textVersion: turn.textVersion,
      item: { kind: 'image', status: 'pending', anchor: firstSentence, caption: '示例插图' }
    })
    try {
      const image = await drawImage(turn.text)
      const attachment = await ctx.attachments.saveImage({ data: image.data, mediaType: image.mediaType, name: 'hello' })
      await ctx.tavern.update(id, { status: 'ready', attachment })
    } catch (error) {
      await ctx.tavern.update(id, { status: 'failed', error: String(error?.message || error).slice(0, 200) })
    }
    return { id }
  }

  ctx.tavern.onTurnSettled(draw)

  if (ctx.tavern.apiVersion < 2) return
  ctx.tavern.promptSection({ name: 'hello', text: '在正文最后单独写一行 hello###一句给玩家的问候###。' })
  // 浏览器侧按钮调用这里：用 getTurn 读这一轮当前显示的正文，再画一张。
  ctx.tavern.handle('tavern-plugin-hello/redraw', async ({ gameId, turn }) => {
    const current = await ctx.tavern.getTurn({ gameId, turn })
    if (!current) throw new Error('这一轮还没写完')
    return await draw(current)
  })
}
