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

test('正文开头的时间栏「地点 · 场合 · 时段 · 日期」也能读出时段，「晚上」算夜里', async () => {
  const { addSceneTime } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const night = addSceneTime('第一人称视角，半身近景，背面。民宿房间里，头顶那盏灯直照下来。', '南屿 · 海边民宿房间 · 晚上 · 2026年2月5日 · 星期四 · 腊月十八\n\n好看。')
  assert.match(night, /时间是夜里/)
  const day = addSceneTime('第一人称视角，近景。卧室里。', '东方名苑 · 午睡 · 下午 · 2026年2月7日 · 星期六\n\n她拉上窗帘。')
  assert.match(day, /白天/)
  assert.equal(addSceneTime('近景。卧室里。', '「明天早上 · 九点」她说。'), '近景。卧室里。', '没有日期或星期的不算时间栏')
})

test('已知是白天时，画面里写的「夜里」不再补窗外漆黑（拉窗帘的午睡不是夜）', async () => {
  const { addSceneTime } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const scene = '第一人称视角，近景。夜里，卧室窗帘拉得严严实实，屋里很暗。'
  assert.equal(addSceneTime(scene, '东方名苑 · 午睡 · 下午 · 2026年2月7日 · 星期六\n\n', ''), scene)
  assert.equal(addSceneTime(scene, '没有时间栏', 'afternoon'), scene)
  assert.match(addSceneTime(scene, '没有时间栏', 'night'), /漆黑/)
  assert.match(addSceneTime('第一人称视角，近景。卧室里。', '没有时间栏', 'afternoon'), /白天/, '画面没写时间时用已知时段')
})

test('规划在 <scene_time> 里报的时段', async () => {
  const { plannerSceneTime } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  assert.equal(plannerSceneTime('<reason>x</reason>\n<scene_time>下午</scene_time>\n<image>'), 'afternoon')
  assert.equal(plannerSceneTime('<scene_time>夜里</scene_time>'), 'night')
  assert.equal(plannerSceneTime('<scene_time>傍晚</scene_time>'), 'dusk')
  assert.equal(plannerSceneTime('没有标签'), '')
})
