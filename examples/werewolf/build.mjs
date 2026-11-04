import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { pluginManifestProblem } from '../../tavern-plugin/lib/domain/plugin-manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(process.argv[2] || resolve(here, '../../output/werewolf/六人狼人杀.dshcard'))
const pkg = JSON.parse(await readFile(resolve(here, 'plugin/package.json'), 'utf8'))
const problem = pluginManifestProblem(pkg)
if (problem) throw new Error(problem)
const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {
  name: '月下六席 · 狼人杀', description: '一位真人、五位独立NPC和DM主持的六人狼人杀。请在玩法面板点击开始；NPC和DM使用本局后台模型。',
  personality: '', scenario: '', first_mes: '欢迎来到月下六席。启用卡内插件，并在下方玩法面板点击「开始 六人狼人杀」。你默认坐在1号位，身份随机分配。每次点击推进一个行动，轮到你时发言或选择目标。',
  mes_example: '', creator: 'DSH Tavern', character_version: pkg.version, tags: ['狼人杀', '多Agent', '游戏'],
  creator_notes: '需要支持 gameMode 能力的 DSH Tavern。规则全部由卡内插件实现；每次NPC行动会调用后台模型。支持节点回退、撤销回退和存档恢复。',
  extensions: {} } }
const manifest = { format: 'dshcard', formatVersion: 1, card: { version: pkg.version, title: card.data.name, author: 'DSH Tavern' },
  requires: { tavernApi: 7 }, plugins: [{ name: pkg.name, path: 'plugins/werewolf/', purpose: '接管狼人杀玩法、独立NPC和专用界面' }] }
const entries = [{ path: 'card.json', content: JSON.stringify(card, null, 2) }, { path: 'dsh.json', content: JSON.stringify(manifest, null, 2) }]
for (const file of await readdir(resolve(here, 'plugin'))) entries.push({ path: 'plugins/werewolf/' + file, content: await readFile(resolve(here, 'plugin', file)) })
await mkdir(dirname(target), { recursive: true })
await writeFile(target, writeZipEntries(entries))
console.log(target)
