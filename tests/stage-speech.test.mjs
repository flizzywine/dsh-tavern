import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/cast-stage.js', import.meta.url), 'utf8')

test('全屏舞台：位置不变的新轮次和重新生成都朗读，普通重绘不重复朗读', async () => {
  const start = source.indexOf('function TavernStageFullscreen(')
  const end = source.indexOf('\n\t\tfunction ', start + 1)
  const effects = [], heard = []
  let cursor = 0
  let reader = { index: 0, turn: 1, beats: [{ text: '第一句' }], setIndex() {} }
  const render = vm.runInNewContext(source.slice(start, end) + '; TavernStageFullscreen', {
    React: {
      createElement: () => null,
      useState: initial => [initial, () => {}],
      useEffect(fn, deps) {
        const index = cursor++, old = effects[index]
        if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return
        old?.cleanup?.()
        effects[index] = { deps, cleanup: fn() }
      }
    },
    useTavernStageReader: () => reader,
    useTavernStageReading: () => ({ on: true }),
    tavernBeatSpeech: (sessionId, beat) => ({ sessionId, text: beat.text }),
    tavernSpeech: { speak: async input => { heard.push(input); return true } },
    document: { addEventListener() {}, removeEventListener() {} },
    window: { setTimeout, clearTimeout },
    TavernStageReadButton() {}, TavernStageSceneView() {}
  })
  const draw = () => { cursor = 0; render({ sessionId: 'game', data: {} }) }
  draw()
  draw()
  reader = { ...reader, turn: 2, beats: [{ text: '下一轮' }] }
  draw()
  reader = { ...reader, beats: [{ text: '重新生成' }] }
  draw()
  draw()
  await Promise.resolve()
  assert.deepEqual(heard.map(item => item.text), ['第一句', '下一轮', '重新生成'])
  effects.forEach(effect => effect.cleanup?.())
})
