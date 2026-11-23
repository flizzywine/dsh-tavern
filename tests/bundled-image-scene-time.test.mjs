import test from 'node:test'
import assert from 'node:assert/strict'
import { addSceneTime } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

test('每张图读取挂载句以前的时段，后文入夜不影响早一点的画面', () => {
  const day = '她坐在窗边看书。', night = '她起身关上窗户。'
  const body = '[时间|下午]\n' + day + '\n[时间|晚上]\n' + night
  const scene = '近景，她望向窗外。'
  assert.match(addSceneTime(scene, body, day), /时间是午后/)
  assert.match(addSceneTime(scene, body, night), /时间是夜里/)
  assert.match(addSceneTime(scene, body + '\n' + day, day), /时间是午后/)
  assert.equal(addSceneTime(scene, day + '\n[时间|晚上]', day), scene)
  assert.equal(addSceneTime(scene, day + '\n[时间|晚上]', '不确定的挂载句'), scene)
  assert.match(addSceneTime('夜里，她望向窗外。', body, day), /时间是夜里/, '画面的明确时段优先')
})
