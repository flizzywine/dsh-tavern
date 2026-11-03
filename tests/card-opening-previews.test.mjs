import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'

test('native swipe chooser receives opening bridge metadata without treating prose as a chooser', async () => {
  const card = { name: '选择台', first_mes: '<script>const ctx=SillyTavern.getContext();ctx.swipe.to(null,"right",{forceMesId:0,forceSwipeId:1});</script>', alternate_greetings: ['目标开场'] }
  const result = await projectCardOpeningPreviews({ card })
  assert.ok(result.openings[0].openingPreview)
  assert.equal(result.openings[0].openingPreview.openingIds[1], 'alternate:0')
  const prose = await projectCardOpeningPreviews({ card: { first_mes: 'He swiped his card. The character_menu appeared and he decided to jump.' } })
  assert.equal(prose.openings[0].openingPreview, null)
})

test('the card opening form replaces every greeting preview with the player name filled in', async () => {
  const card = { name: '丘比', first_mes: '来，告诉我你的愿望。', alternate_greetings: ['第二个'] }
  const result = await projectCardOpeningPreviews({ card, userName: '小圆', extensions: { openingSetup: { form: '```html\n<input value="{{user}}"><script>1</script>\n```' } } })
  for (const opening of result.openings) {
    assert.equal(opening.openingSetup, true)
    assert.equal(opening.projection.mode, 'html')
    assert.equal(opening.projection.parts.length, 1)
    assert.match(opening.projection.parts[0].content, /<input value="小圆">/)
  }
  assert.equal((await projectCardOpeningPreviews({ card })).openings[0].openingSetup, false)
})
