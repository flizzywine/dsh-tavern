// Deleting the pack or a figure 通用声音 / 旁白声音 point at says what happens (owner 11-12: a mistaken delete must not quietly
// break 配音): an entry of the 系统设置包 is rebuilt from its default, anything else leaves them silent. The pointers are read
// where the voice page reads them (useReadingPointers).
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const shared = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/system-pack.cjs', import.meta.url), 'utf8')

test('the words: the system pack is rebuilt, a pointed pack or figure goes silent, anything else adds nothing', async () => {
  const voice = await client('asset-pack-voice-ui.js'), start = voice.indexOf('const READING_ROLES='), end = voice.indexOf('function useReadingPointers(')
  const context = {}
  vm.runInNewContext(shared + voice.slice(start, end) + ';this.readingLossText=readingLossText;this.SYSTEM_PACK=SYSTEM_PACK;', context)
  const {readingLossText, SYSTEM_PACK} = context
  const reading = {general:{figure:{packId:'p', figureId:'g'}}, narrator:{enabled:false, figure:{packId:'p', figureId:'n'}}}
  assert.equal(readingLossText(reading, 'p'), '通用声音、旁白声音正在用它里面的人物，删除后它们不出声，要在素材库里另选人物。')
  assert.equal(readingLossText(reading, 'p', 'n'), '旁白声音正在用它的声音，删除后它不出声，要在素材库里另选人物。')
  assert.equal(readingLossText(reading, 'other'), '')
  assert.equal(readingLossText(null, 'p'), '', 'pointers not read yet')
  assert.equal(readingLossText(reading, SYSTEM_PACK.id), '这是系统设置包：删掉后会按默认内容重建，改过的声音会丢失。')
})

test('the pack and figure delete confirmations add those words; the client takes the system ids from the shared module', async () => {
  const [ui, figure] = await Promise.all([client('asset-pack-ui.js'), client('asset-pack-figure-ui.js')])
  assert.match(ui, /\/\/ @include-protocol system-pack\.cjs/)
  assert.match(ui, /function Impact\(\{binding,packId\}\) \{[\s\S]*?readingLossText\(useReadingPointers\(binding\)\.value,packId\)/)
  assert.match(figure, /readingLossText\(reading,pack\.manifest\.id,figure\.id\)/)
  // a system figure has no 删除人物 (the library retires a deleted figure's id, so it could not be rebuilt).
  assert.match(ui, /remove:isSystemEntry\(packId,id\)\?null:/)
  // …and says so in its place, visibly (not a vanished button).
  assert.match(ui, /systemFigure:isSystemEntry\(packId,id\)/)
  assert.match(figure, /actions\?\.systemFigure&&h\(MenuItem,\{disabled:true\},'系统设置里的人物，不能删除'\)/)
})
