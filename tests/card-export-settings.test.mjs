import test from 'node:test'
import assert from 'node:assert/strict'
import {withoutPlayerChoices} from '../tavern-plugin/lib/domain/card-export-settings.js'

// A card's own switches (stage.switches) are the author's settings and travel with the card; only the player's skin choice stays behind.
test('card export drops the player skin choice and keeps the card switches', () => {
  const raw = {spec:'chara_card_v3', data:{extensions:{dsh_tavern:{stage:{enabled:true, skinChoice:'x', switches:{music:'off'}}}}}}
  assert.deepEqual(withoutPlayerChoices(raw).data.extensions.dsh_tavern.stage, {enabled:true, switches:{music:'off'}})
})