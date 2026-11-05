import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageRuntimeHarness, runtimeSource, runtimeText, runtimeDirection, runtimeGroups} from './helpers/stage-runtime-harness.mjs'

// A gameMode step (a card's DM turn) has no stage page; its undirected turn still shows the predecessor's end, so the
// entry has a backdrop to accept instead of keeping its veil.
test('a turn with no page to anchor still projects its carry', () => {
  const h = createStageRuntimeHarness()
  try {
    const previousSource = runtimeSource({turn: 1, sourceKey: 'turn-1'})
    const previous = runtimeDirection(5, 2, {phase: 'done', complete: true, bindingKey: 'binding-1', prefixRevision: 9, token: {digest: 'd1'}, assetRevision: 3})
    h.dispatch({type: 'TURN_CHANGED', source: runtimeSource({turn: 2, sourceKey: 'turn-2'}), text: runtimeText(1, []), anchor: null})
    h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 2, generation: 0})
    h.dispatch({type: 'CARRY_RESULT', token: h.last('resolve-carry').token, carry: {source: previousSource, envelope: previous}})
    const project = h.last('project')
    assert.ok(project?.carry, 'the predecessor end is projected without an anchor')
    assert.equal(project.at, 2)
    h.readyProjection(project.token, runtimeGroups('end-1'))
    assert.equal(h.state.accepted.scene.identity, 'end-1')
  } finally {h.dispose()}
})
