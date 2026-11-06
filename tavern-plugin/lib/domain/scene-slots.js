import { createHash } from 'node:crypto'

// A turn's first picture lives at the turn's own key; pictures added later
// ("新增插图") are further slots of the same turn, each with its own record and plan.
export const SCENE_EXTRA_SLOTS = 5
export const sceneSlotKey = (key, slot) => slot ? createHash('sha256').update(key + ':slot:' + slot).digest('hex') : key
/** Every picture slot key of the given turn keys. */
export const sceneSlotKeys = keys => keys.flatMap(key => Array.from({ length: SCENE_EXTRA_SLOTS + 1 }, (_, slot) => sceneSlotKey(key, slot)))
