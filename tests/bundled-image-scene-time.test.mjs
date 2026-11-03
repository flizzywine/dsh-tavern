import test from 'node:test'
import assert from 'node:assert/strict'
import { addSceneTime, crowdSize, sceneHeadcount } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

test('画面写了夜里：补一句窗外漆黑，插在镜头句后面', () => {
  const out = addSceneTime('近景，正面平视。夜里的厨房，她在切菜。', '')
  assert.equal(out, '近景，正面平视。时间是夜里，画面里看得到的窗外、门外和天空都是漆黑的夜色，光线昏暗，只有近处被灯火照亮。夜里的厨房，她在切菜。')
})

test('画面没写时间：从正文最后一个状态栏补；写了白天或已经写了漆黑的不动', () => {
  const body = '[时间|腊月廿三|傍晚|酉时]\n她推门进来。'
  assert.match(addSceneTime('全身，客厅里她脱下外套。', body), /时间是傍晚/)
  assert.equal(addSceneTime('全身，午后的阳光照进客厅。', body), '全身，午后的阳光照进客厅。')
  assert.equal(addSceneTime('夜里，窗外漆黑，她点灯。', ''), '夜里，窗外漆黑，她点灯。')
  assert.equal(addSceneTime('1girl, night, kitchen', ''), '1girl, night, kitchen', '英文 tag 画面不动')
  assert.equal(addSceneTime('她的长发如夜幕般垂落，午后阳光明亮。', body), '她的长发如夜幕般垂落，午后阳光明亮。')
  assert.equal(addSceneTime('她并非在夜里，午后阳光照亮客厅。', body), '她并非在夜里，午后阳光照亮客厅。')
  assert.equal(addSceneTime('午后阳光洒进屋里，窗外夜色渐深。', body), '午后阳光洒进屋里，窗外夜色渐深。', '昼夜线索冲突时不擅自补时间')
})

test('开头的人物宏和镜头句保持在前面，时间句插在它们后面', () => {
  const scene = '${"name":"Xu Jinghao"}$\n半身，平视。夜里她站在路灯下。'
  assert.ok(addSceneTime(scene, '').startsWith('${"name":"Xu Jinghao"}$\n半身，平视。时间是夜里'))
})

test('读取本轮开头有日期的时间栏，忽略对白里的类似文本及歧义时段', () => {
  const scene = '全身，客厅里她脱下外套。'
  assert.match(addSceneTime(scene, '客厅 · 午休 · 下午 · 2026年2月3日\n她走进来。'), /时间是午后/)
  assert.match(addSceneTime(scene, '客厅 · 晚上 · 星期二\n她走进来。'), /时间是夜里/)
  assert.equal(addSceneTime(scene, '她走进来。\n客厅 · 晚上 · 星期二'), scene)
  assert.equal(addSceneTime(scene, '客厅 · 下午 · 晚上 · 星期二'), scene)
  assert.equal(addSceneTime(scene, '客厅 · 午休 · 下午'), scene)
  assert.match(addSceneTime('夜里的客厅，她脱下外套。', '客厅 · 下午 · 星期二'), /时间是夜里/, '画面明确入夜时保留画面时段')
})

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

test('三个人以上：竖图改横图；两个人不动', () => {
  const three = '${"name":"A"}$ 她站着。${"name":"B"}$ 他坐着。${"name":"C"}$ 她笑着。'
  assert.equal(sceneHeadcount(three), 3)
  assert.equal(crowdSize('竖图', three), '竖图')
  assert.equal(crowdSize('', three), '横图')
  assert.equal(crowdSize('横图', three), '横图')
  assert.equal(crowdSize('竖图', '${"name":"A"}$ ${"name":"B"}$ 画面里是两个人。'), '竖图')
  assert.equal(crowdSize('832x1216', '画面里是三个人。'), '832x1216')
  assert.equal(crowdSize('portrait', three), 'portrait')
  const twoCharactersAndOutfit = '${"name":"A"}$ 她站着。${"name":"B"}$ 他坐着。${"name":"夏日制服","upperBody":"visible"}$'
  assert.equal(sceneHeadcount(twoCharactersAndOutfit), 2)
  assert.equal(crowdSize('', twoCharactersAndOutfit), '')
})
