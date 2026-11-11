import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCharacterForms } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-forms.js'

test('中文否定形态线索不触发形态切换，肯定线索仍可切换', () => {
  const definitions = { characters: [
    { id: 'mei-human', name: '阿梅（人形）', match: '阿梅', formCues: '人形' },
    { id: 'mei-fox', name: '阿梅（狐形）', formCues: '狐耳, 狐尾' },
  ] }
  const macro = '${"name":"阿梅"}$'

  for (const denial of ['没有狐耳', '没有明显的狐耳', '不带狐尾', '无狐耳', '不是狐耳']) {
    assert.equal(resolveCharacterForms(`${macro} ${denial}`, definitions), macro + ` ${denial}`, denial)
  }
  assert.equal(resolveCharacterForms(`${macro} 她长出狐耳和狐尾`, definitions), '${"name":"阿梅（狐形）"}$ 她长出狐耳和狐尾')
  assert.equal(resolveCharacterForms(`${macro} no fox ears`, definitions), macro + ' no fox ears')
})
