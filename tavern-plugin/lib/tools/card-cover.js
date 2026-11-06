import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { coverImageAsPng } from '../domain/card-cover-image.js'
import { normalizeResourcePath } from '../domain/file-resources.js'

const MAX_COVER_BYTES = 30 * 1024 * 1024

// Local paths the user names: absolute, or starting with ~.
function localPath(value, label) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('缺少' + label)
  const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\') ? path.join(os.homedir(), raw.slice(1)) : raw
  if (!path.isAbsolute(expanded)) throw new Error(label + '须是完整路径（绝对路径或以 ~ 开头）: ' + raw)
  return path.normalize(expanded)
}

// IHDR always comes first: width and height sit at bytes 16–23.
function pngSize(png) { return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } }

export function registerCardCoverTools({ chatForSession, exportCardPng, fileResources, presentCardText, str, tools }) {
  async function cardPathFor(args, exec) {
    const chat = await chatForSession(exec?.agent?.session?.id || '')
    if (!chat || chat.mode !== 'card') throw new Error('人物卡封面只能在卡片工作台中处理')
    const explicit = str(args.path).trim()
    const cardPath = explicit || str(chat.cardPath)
    if (!cardPath) throw new Error('当前还没有人物卡，请先创建人物卡')
    return normalizeResourcePath(cardPath, 'card')
  }

  tools.register(defineTool({
    name: 'tavern_set_card_cover',
    description: '仅卡片模式：用一张本地图片给人物卡配封面或更换封面。图片支持 PNG、JPG、WebP，统一存成 PNG，不缩放。人物卡原件随之变成带封面的 PNG 卡，卡数据原样嵌入；工作数据不变，恢复原版仍恢复原来的卡内容。',
    parameters: {
      image: { type: 'string', required: true, description: '本地图片的完整路径，如 /Users/me/Pictures/角色.jpg 或 ~/Downloads/封面.png' },
      path: { type: 'string', description: '人物卡路径，如 cards/角色.json；省略时为当前人物卡' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, image: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, bytes: { type: 'integer', required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: '已为 ' + value.path + ' 配好封面：' + value.image + ' → PNG ' + value.width + '×' + value.height + '，' + value.bytes + ' 字节；卡数据已嵌入，无需再核对。' }]
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cardPath = await cardPathFor(args, exec)
      const image = localPath(args.image, '图片路径')
      const data = await readFile(image).catch(error => { throw new Error(error?.code === 'ENOENT' ? '图片不存在: ' + image : '读取图片失败: ' + (error?.message || error)) })
      if (data.length > MAX_COVER_BYTES) throw new Error('图片超过 30 MB，请换一张小一点的图')
      const png = await coverImageAsPng(data)
      await fileResources.setCardCover(cardPath, png, async () => (await presentCardText(cardPath)).text)
      return { path: cardPath, image, ...pngSize(png), bytes: png.length }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_export_card_png',
    description: '仅卡片模式：把带封面的人物卡导出成标准酒馆 PNG 卡文件（封面 + 当前工作数据，与导出 JSON 内容相同，可导入 SillyTavern）。人物卡还没有封面时先用 tavern_set_card_cover。不覆盖已存在的文件。',
    parameters: {
      output: { type: 'string', required: true, description: '导出文件的完整路径，以 .png 结尾，如 ~/Downloads/角色.png' },
      path: { type: 'string', description: '人物卡路径，如 cards/角色.json；省略时为当前人物卡' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, output: { type: 'string', required: true }, name: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, bytes: { type: 'integer', required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: '已导出 PNG 人物卡「' + value.name + '」：' + value.output + '（' + value.width + '×' + value.height + '，' + value.bytes + ' 字节，内嵌 chara 与 ccv3 卡数据，可直接导入 SillyTavern）；目录不存在时已自动创建，无需再核对。' }]
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cardPath = await cardPathFor(args, exec)
      const output = localPath(args.output, '导出路径')
      if (path.extname(output).toLowerCase() !== '.png') throw new Error('导出路径须以 .png 结尾: ' + output)
      const file = await exportCardPng(cardPath)
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, file.bytes, { flag: 'wx' }).catch(error => { throw new Error(error?.code === 'EEXIST' ? '文件已存在，请换一个名字: ' + output : '写入失败: ' + (error?.message || error)) })
      return { path: cardPath, output, name: file.name, ...pngSize(file.bytes), bytes: file.bytes.length }
    }
  }))
}
