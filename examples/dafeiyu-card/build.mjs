// Build 大肥鱼.source.dshcard (the raw source for compress.mjs) from the Galgame fork's card bundle (Wiki「设计：dsh-card-format」):
// the card and its four asset packs as they are. It carries no plugin: Tavern's stage draws it from those packs.
//
//   node examples/dafeiyu-card/build.mjs dafeiyu.card-bundle.zip 大肥鱼.source.dshcard
//
// The bundle is the fork's release attachment:
// https://github.com/jerryzmtz/dsh-tavern-galgame/releases/latest/download/dafeiyu.card-bundle.zip
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openZipFile } from '../../tavern-plugin/lib/domain/zip-file.js'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const [source, target] = process.argv.slice(2)
if (!source || !target) { console.error('用法：node build.mjs <dafeiyu.card-bundle.zip> <输出.dshcard>'); process.exit(1) }

// Readable folder names for the packs; each pack keeps its id in its own manifest.json.
const NAMES = { '8eb406da-b0af-4070-9e67-8e056c5e9b2e': 'dafeiyu', 'af7b2c46-40f1-4ea5-984b-5c03108a238d': 'china-backgrounds',
  '41818b6c-9c54-4b73-8f3a-0e6ea5ba9e36': 'general-bgm', '2f3f4666-0098-4a45-9d07-9ff0cc42d1b2': 'general-sfx' }

const zip = await openZipFile(source, { label: '卡包' })
const read = async file => zip.readBuffer(zip.entries.get(file), 512 * 1024 * 1024)
const json = async file => JSON.parse((await read(file)).toString('utf8'))
const bundle = await json('dsh-tavern-card-bundle.json')
const card = await json('card/card.json')
const data = card.data
const entries = []
const packs = []
for (const dependency of bundle.dependencies) {
  const name = NAMES[dependency.packId]
  if (!name) throw new Error('不认识的素材包：' + dependency.packId)
  const prefix = 'packs/' + dependency.packId + '/'
  const manifest = await json(prefix + 'manifest.json')
  let bytes = 0
  for (const entry of zip.entries.values()) {
    if (!entry.path.startsWith(prefix)) continue
    entries.push({ path: 'assets/' + name + '/' + entry.path.slice(prefix.length), content: await read(entry.path) })
    bytes += entry.size
  }
  packs.push({ id: manifest.id, title: manifest.name, format: manifest.format, contentHash: dependency.contentHash, bytes,
    path: 'assets/' + name + '/', credits: (manifest.credits || []).map(file => 'assets/' + name + '/' + file) })
}

// CCv3 assets point into the packs: the cover at the CHARX place, the default outfit's expressions in place.
const lead = data.extensions.dsh_tavern.openings.lead
const leadName = NAMES[lead.packId]
const figure = await json('packs/' + lead.packId + '/figures/' + lead.figureId + '.json')
const outfit = figure.outfits.find(item => item.enabled !== false) || figure.outfits[0]
entries.push({ path: 'assets/icon/images/main.png', content: await read(bundle.cover.path) })
data.assets = [{ type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' },
  ...Object.entries(outfit.avatars).map(([emotion, hash]) => ({ type: 'emotion', uri: 'embeded://assets/' + leadName + '/media/' + hash + '.png', name: emotion, ext: 'png' }))]
data.group_only_greetings ??= []
card.spec = 'chara_card_v3'
card.spec_version = '3.0'
entries.push({ path: 'card.json', content: JSON.stringify(card, null, 2) })

// The recommended preset for new games (dsh.json defaults).
for (const file of await readdir(path.join(here, 'presets'))) entries.push({ path: 'presets/' + file, content: await readFile(path.join(here, 'presets', file)) })

entries.push({ path: 'dsh.json', content: JSON.stringify({
  format: 'dshcard', formatVersion: 1,
  card: { version: '1.0.0', title: data.name, author: data.creator || '' },
  requires: { tavernApi: 2 },
  // A new game starts with the stage-friendly preset and settlement on; no status bar, no web search.
  defaults: {
    preset: { path: 'presets/dafeiyu-stage.json', title: '大肥鱼 · 舞台演出' },
    settings: { statusBarPlacement: 'sidebar', backgroundTasks: { posture: true, variables: true }, webSearch: false, sceneImages: false }
  },
  packs
}, null, 2) })
await zip.close()
await writeFile(target, writeZipEntries(entries))
console.log('已生成 ' + target + '：' + entries.length + ' 个文件，' + packs.length + ' 个素材包')
