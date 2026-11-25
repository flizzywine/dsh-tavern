// the 素材库 生图 dialog's 画风 menu (owner 11-24): it lists the image plugin's presets that add a painting style
// (addsStyle), each once, under plain descriptive names; 'no-style' is not an item but the menu's 清除画风 (无画风), and the
// structured scene templates (结构化模板, the 电影叙事 example template that doubled 电影叙事) are not styles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { listPromptPresets } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

test('the 画风 menu lists each painting style once, with a plain name', () => {
  const styles = listPromptPresets({}).filter(s => s.addsStyle)
  const ids = styles.map(s => s.id), names = styles.map(s => s.name)
  for (const id of ['no-style', 'structured-template', 'cinematic-example']) assert.ok(!ids.includes(id), id + ' is not a painting style')
  for (const id of ['galgame-clean', 'galgame-anime', 'galgame-polished', 'story-cinematic', 'anime-character']) assert.ok(ids.includes(id), id)
  assert.equal(new Set(names).size, names.length, 'no name twice: ' + names.join('、'))
  assert.deepEqual(names.filter(n => /galgame|·/i.test(n)), [], 'no product prefix in a name')
  assert.equal(styles.find(s => s.id === 'galgame-clean').name, '干净低细节')
})

test('a saved preset adds a style when it carries style words; an empty or structured one does not', () => {
  const saved = [
    { id: 'mine', name: '我的水彩', positive: 'watercolour wash' },
    { id: 'empty', name: '空', structure: { format: 'auto', blocks: [{ kind: 'scene', title: '场景' }, { kind: 'style', title: '画风', text: '' }] } },
    { id: 'scene', name: '剧情分节', structure: { format: 'structured', blocks: [{ kind: 'style', title: '画风', text: '油画' }] } }]
  const by = Object.fromEntries(listPromptPresets({ promptPresets: saved }).map(s => [s.id, s.addsStyle]))
  assert.deepEqual([by.mine, by.empty, by.scene], [true, false, false])
})
