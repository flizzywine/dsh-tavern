// The phone's source beat as the built client registers it (mods/phone/client/core.js): mod-clients.js, the phone's beat and
// the core's automatic voice gate (source-beat.cjs), for tests that run the core client sources as script text.
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
const read = rel => readFile(new URL('../../tavern-plugin/' + rel, import.meta.url), 'utf8')
export const phoneSourceBeatScript = async () => [await read('src/client/mod-clients.js'), await read('mods/phone/client/beat.cjs'),
  'tavernModClients.register("dsh.phone", {source: {beat: phoneModBeat}});', await read('src/client/source-beat.cjs')].join('\n')
// The node runtime kernel's gate with the phone's beat (stage-runtime.cjs phoneBeatKernel), for tests that build the kernel.
const require = createRequire(import.meta.url)
const {phoneModBeat} = require('../../tavern-plugin/mods/phone/client/beat.cjs')
const {stageAutoVoiceAllowed} = require('../../tavern-plugin/src/client/source-beat.cjs')
export const phoneBeatKernel = {phoneModAutoVoiceAllowed: (direction, para, directorEnabled) => stageAutoVoiceAllowed(direction, para, directorEnabled, phoneModBeat)}