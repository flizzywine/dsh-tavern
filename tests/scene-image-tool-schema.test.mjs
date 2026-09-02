import test from 'node:test'
import { SCENE_PLAN_TOOL } from '../tavern-plugin/lib/domain/scene-plan.js'
import { SCENE_ADJUSTMENT_TOOL } from '../tavern-plugin/lib/domain/scene-image-adjustment.js'
import { createSceneReferences } from '../tavern-plugin/lib/domain/scene-references.js'
import { assertImageToolSchema } from './fixtures/assert-image-tool-schema.mjs'

const reference = createSceneReferences({ snapshot: {}, target: { turn: 1 }, sources: [] }).tool
for (const tool of [reference, SCENE_PLAN_TOOL, SCENE_ADJUSTMENT_TOOL]) {
  test(`${tool.name} declares a raw object-rooted JSON Schema, not a DSH authoring property map`, () => assertImageToolSchema(tool))
}
