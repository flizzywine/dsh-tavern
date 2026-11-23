import {runMediaEncoder} from './media-encoder.js'

// Native decoding is an installed-library capability, not a portable authoring dependency.
// One process decodes a whole batch: starting it and loading sharp costs far more than a drawing's decode.
// Resolves to null, or to the index and reason of the first image that does not decode.
export async function decodeSvgs(images) {
  // Each image is framed by its uint32 LE byte length.
  const frames = images.flatMap(bytes => { const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return [length, bytes] })
  return JSON.parse(await runMediaEncoder(['decode'], Buffer.concat(frames), 30000 * images.length))
}