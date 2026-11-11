import {MEDIA_PURPOSE_LIMITS} from '../packages/dsh-asset-library/lib/pack-v2/media.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check} = contract

// A mod config upload ({mime,data}): sniffed once, on entry, against its type and size limit.
const MOD_MEDIA_LIMITS = MEDIA_PURPOSE_LIMITS
const TYPES = {'image/png':'png','image/webp':'webp','image/jpeg':'jpg','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav'}
export const MOD_MEDIA_MIME = Object.freeze(Object.fromEntries(Object.entries(TYPES).map(([mime,ext]) => [ext,mime])))
const ascii = (bytes, at, text) => bytes.length >= at + text.length && bytes.toString('latin1', at, at + text.length) === text
const sniff = {
  png:b => ascii(b,0,'\x89PNG\r\n\x1a\n'), webp:b => ascii(b,0,'RIFF') && ascii(b,8,'WEBP'), jpg:b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  mp3:b => ascii(b,0,'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), ogg:b => ascii(b,0,'OggS'), wav:b => ascii(b,0,'RIFF') && ascii(b,8,'WAVE'),
}

export function decodeModMedia({mime,data}) {
  const ext = TYPES[mime],limit=mime?.startsWith('audio/')?MOD_MEDIA_LIMITS.audio:MOD_MEDIA_LIMITS.image
  check(ext && typeof data === 'string' && data.length <= Math.ceil(limit / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(data), '$.mime', 'Unsupported media type or size')
  const bytes = Buffer.from(data, 'base64')
  check(bytes.length > 0 && bytes.length <= limit, '$.data', 'Media size limit', 'MOD_RESOURCE_UNAVAILABLE')
  check(sniff[ext](bytes), '$.data', 'Media content does not match its type')
  return {bytes,ext}
}
