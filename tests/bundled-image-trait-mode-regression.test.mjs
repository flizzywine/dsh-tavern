import test from 'node:test'
import assert from 'node:assert/strict'
import { injectDefinitions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

// Fictional adult character: each trait and outfit field has a unique marker so leakage is visible.
const adult = {
  id: 'adult-25', name: 'Ari', match: 'Ari', age: 25, enabled: true,
  traits: {
    face: 'FACE_ADULT_25_ONLY',
    bodySFW: 'BODY_SFW_ONLY',
    bodyNSFW: 'BODY_NSFW_ONLY',
    lowerSFW: 'LOWER_SFW_ONLY',
    lowerNSFW: 'LOWER_NSFW_ONLY',
    negative: 'TRAIT_NEGATIVE_ONLY',
  },
  referenceImage: { id: 'a'.repeat(64), mediaType: 'image/png', name: 'ari.png', byteLength: 64 },
  outfits: [{
    id: 'adult-outfit', name: 'Everyday', default: true,
    upper: 'OUTFIT_UPPER_ONLY', lower: 'OUTFIT_LOWER_ONLY',
    shoes: 'OUTFIT_SHOES_ONLY', full: 'OUTFIT_FULL_ONLY',
    negative: 'OUTFIT_NEGATIVE_ONLY',
    referenceImage: { id: 'b'.repeat(64), mediaType: 'image/png', name: 'outfit.png', byteLength: 64 },
  }],
}
const definitions = { characters: [adult] }

test('all mode retains trait and outfit negatives through normal named injection', () => {
  const raw = 'Ari stands beside a window.'
  const injected = injectDefinitions(raw, definitions, { traitMode: 'all' }, { raw })
  assert.ok(injected.text.includes('BODY_NSFW_ONLY'))
  assert.ok(injected.negatives.includes('TRAIT_NEGATIVE_ONLY'))
  assert.ok(injected.negatives.includes('OUTFIT_NEGATIVE_ONLY'))
})
