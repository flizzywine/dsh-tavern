// The stage's top-level helpers as one source (gal-stage-helpers.cjs), for fixtures that evaluate them beside their own runtime stubs.
import {readFileSync} from 'node:fs'
export const stageHelpersSource = readFileSync(new URL('../../tavern-plugin/src/client/gal-stage-helpers.cjs', import.meta.url), 'utf8')
// var, since one page may mount both the stage and the transcript, and each loads the helpers.
export const stageHelpersPageSource = stageHelpersSource.replace(/^const /gm, 'var ')
