// The story read aloud: what a reply reads (story-reading.cjs, the stage's own reading, owner 11-16) and where 有声书's
// 播放 starts (the dsh-tavern-audiobook plugin's reader).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'acorn'
import bubbles from '../tavern-plugin/src/client/bubble-line.cjs'

const src = file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
async function functions(file, names) {
  const source = await src(file)
  return parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end)).join('\n')
}
const context = vm.createContext({ parseBubbles: bubbles.parseBubbles, module: { exports: {} } })
vm.runInContext(await functions('stage-page-index.cjs', ['stagePagePlain']) + '\n' + await functions('gal-stage-helpers.cjs', ['galPlain', 'galBlocks', 'galParagraphs']) + '\n'
  + (await src('features/prose-layout.js')).replace(/^const /gm, 'var ').replace(/^let /gm, 'var ') + '\n'
  + (await src('story-reading.cjs')).replace(/^const /gm, 'var ').replace("typeof window === 'undefined'", 'true'), context)
const core = context.module.exports
// the plugin's pure helpers, from its built client as Tavern's module loader runs it
const pluginContext = vm.createContext({ window: { __ModuleLoader__: { load({ factory }) { pluginContext.plugin = factory(() => ({ createElement() {}, Fragment: 'f' })) } } }, CSS: {} })
vm.runInContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-audiobook/client.js', import.meta.url), 'utf8'), pluginContext)
const ab = { ...pluginContext.plugin.__test, audiobookRowUnits: core.readingRowUnits, audiobookUnits: core.readingUnits }
ab.audiobookPause = ab.abPause; ab.audiobookPlace = ab.abPlace; ab.audiobookStartIndex = ab.abStartIndex; ab.audiobookPlaceIndex = ab.abPlaceIndex; ab.audiobookFlat = ab.abFlat; ab.audiobookFind = ab.abFind
// values made in the test's context compare as plain data
const plain = value => JSON.parse(JSON.stringify(value))
test('在页面文字里找到这一句：不看空白，从上一句之后往后找；改写过的正文按开头几个字找', () => {
  const nodes = [{ nodeValue: '小花 ' }, { nodeValue: '喜悦' }, { nodeValue: '这个这个！\n你画我猜！' }, { nodeValue: '这个这个！你画我猜！' }]
  const flat = ab.audiobookFlat(nodes)
  assert.equal(flat.text, '小花喜悦这个这个！你画我猜！这个这个！你画我猜！')
  assert.deepEqual(plain(ab.audiobookFind(flat.text, '这个这个！你画我猜！')), [4, 14])
  assert.deepEqual(plain(ab.audiobookFind(flat.text, '这个这个！你画我猜！', 14)), [14, 24])
  assert.equal(flat.at[4][0], nodes[2]); assert.equal(flat.at[4][1], 0)
  assert.deepEqual(plain(ab.audiobookFind('前面的字她一边说一边挥舞着手里的虚拟团子（改写）', '她一边说，一边挥舞着手里的虚拟团子。')), null, '标点不同就不是同一句')
  assert.deepEqual(plain(ab.audiobookFind('她一边说，一边挥舞着手里——改写了', '她一边说，一边挥舞着手里的虚拟团子。')), [0, 12])
})
