// authored full-image variants and normalized composition targets.
import { check, shape, text, array, unique, validateShortId } from './common.js'
export function validateCg(value, path) {
  const label = (value, path, max) => { text(value, path, max); check(value.trim().length > 0, path, 'Blank text') }
  if (value.description !== undefined) label(value.description,path+'.description',80)
  if (value.focusHints !== undefined) {
    array(value.focusHints, path + '.focusHints', 8)
    for (const [i, focus] of value.focusHints.entries()) {
      const p = `${path}.focusHints[${i}]`
      shape(focus, ['key', 'label', 'x', 'y', 'zoom'], ['key', 'label', 'x', 'y', 'zoom'], p)
      validateShortId(focus.key, p + '.key'); check(focus.key !== 'full', p + '.key', 'full is reserved')
      label(focus.label, p + '.label', 24)
      for (const key of ['x', 'y', 'zoom']) check(Number.isFinite(focus[key]) && focus[key] >= (key === 'zoom' ? 1 : 0) && focus[key] <= (key === 'zoom' ? 3 : 1), p + '.' + key, 'Invalid normalized focus')
    }
    unique(value.focusHints.map(f => f.key), path + '.focusHints')
  }
}
