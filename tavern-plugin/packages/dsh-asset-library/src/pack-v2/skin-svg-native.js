import {runMediaEncoder} from './media-encoder.js'

// Native decoding is an installed-library capability, not a portable authoring dependency.
export const decodeSvg = bytes => runMediaEncoder(['decode'], bytes, 30000)
