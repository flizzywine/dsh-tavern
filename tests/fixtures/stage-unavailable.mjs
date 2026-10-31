import {register} from 'node:module'
import assert from 'node:assert/strict'
register('./stage-unavailable-loader.mjs', import.meta.url)
await assert.rejects(import('../../tavern-plugin/packages/dsh-tavern-stage/lib/index.js'), error => error.code === 'ERR_MODULE_NOT_FOUND')
process.env.DSH_TEST_STAGE_UNAVAILABLE = '1'
await import('./plugin-without-stage.mjs')
