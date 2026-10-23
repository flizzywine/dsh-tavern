// 把这个文件夹打成一张 DSH 人物卡：node examples/dshcard-hello/build.mjs [输出路径]
// .dshcard 就是一个 ZIP：card.json + 图片 + plugins/ + dsh.json，用任何压缩工具打包也一样。
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] || path.join(here, '阿芙拉.dshcard')

// 卡的文字部分直接用仓库里的原创示例卡；DSH 卡里的 card.json 就是一张普通的 Character Card V3。
const card = JSON.parse(await readFile(path.join(here, '../avra/cards/avra-complete.json'), 'utf8'))
// CCv3 的 assets 指向包里的图片：icon 是卡面头像，emotion 导入后成为 Tavern「角色素材」里对应情绪的立绘。
card.data.assets = [
  { type: 'icon', uri: 'embeded://assets/icon/images/main.webp', name: 'main', ext: 'webp' },
  { type: 'emotion', uri: 'embeded://assets/emotion/images/neutral.webp', name: 'neutral', ext: 'webp' },
]

const manifest = {
  format: 'dshcard',
  formatVersion: 1,
  card: { version: '1.0.0', title: '阿芙拉', author: 'DSH Tavern 示例' },
  requires: { tavernApi: 2 },
  plugins: [{ name: 'dsh-card-hello-mood', path: 'plugins/hello-mood/', purpose: '每轮按剧情记下氛围，舞台底色跟着变' }],
}

const entries = [
  { path: 'card.json', content: JSON.stringify(card, null, 2) },
  { path: 'assets/icon/images/main.webp', content: await readFile(path.join(here, 'assets/avra-icon.webp')) },
  { path: 'assets/emotion/images/neutral.webp', content: await readFile(path.join(here, 'assets/avra-full.webp')) },
  { path: 'dsh.json', content: JSON.stringify(manifest, null, 2) },
]
for (const file of await readdir(path.join(here, 'plugin'))) {
  entries.push({ path: 'plugins/hello-mood/' + file, content: await readFile(path.join(here, 'plugin', file)) })
}
await writeFile(target, writeZipEntries(entries))
console.log('已生成 ' + target)
