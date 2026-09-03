import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function functionSource(name, next) {
  return source.slice(source.indexOf('function ' + name + '('), source.indexOf('function ' + next + '('))
}
function dockWith(nodes, mode = 'story', releaseCapabilities = { sceneImages: true }) {
  const selections = []
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useTavernSessionMode: () => mode,
    useLiveTavernView: () => ({ view: { releaseCapabilities, replyProjections: nodes.some(node => node.kind === 'assistant') ? [{ turn: 1 }, { turn: 2 }] : [] } }),
    isPlayMode: value => ['story', 'free', 'script'].includes(value),
    CandidateAction: 'actions', TavernCompactionAction: 'compact', TavernMoreActions: 'more', SceneImageAction: 'scene-image',
    props: {
      sessionId: 'session1',
      useSession(selector) { selections.push('session'); return selector({ running: false, blank: false }) },
      useChat(selector) { selections.push('chat'); return selector({ legacy: { nodes } }) }
    }
  }
  // Execute the actual dock component, with alpha.2's split lifecycle/Chat props.
  const helper = source.includes('function latestTavernAssistantMessageId(')
    ? functionSource('latestTavernAssistantMessageId', 'createPlayControlsFeatureModule') : ''
  const dock = functionSource('CandidateDockActions', 'CandidateQuestion')
  const rendered = vm.runInNewContext(helper + dock + '\nCandidateDockActions(props)', context)
  return { rendered, selections }
}

test('alpha.2 dock keeps play controls when messages only exist on the Chat snapshot', () => {
  for (const mode of ['story', 'free', 'script']) {
    const { rendered, selections } = dockWith([
      { kind: 'assistant', messageId: 'opening' },
      { kind: 'assistant', messageId: 'reply2' },
      { kind: 'tool-result' }
    ], mode)
    assert.equal(rendered.children[0]?.type, 'actions')
    assert.equal(rendered.children[0].props.messageId, 'reply2')
    assert.equal(rendered.children[1]?.type, 'scene-image')
    assert.equal(rendered.children[1].props.turn, 2)
    assert.equal(rendered.children[1].props.running, false)
    assert.equal(rendered.children[2]?.type, 'more')
    assert.deepEqual(selections, ['chat', 'session'])
  }
})

test('empty Chat keeps compaction but does not invent a response or show play controls in card mode', () => {
  assert.equal(dockWith([]).rendered.children[0], null)
  assert.equal(dockWith([]).rendered.children[1].props.turn, 0)
  assert.equal(dockWith([]).rendered.children[2].type, 'more')
  assert.equal(dockWith([{ kind: 'assistant', messageId: 'a' }], 'card').rendered.children[0], null)
  assert.equal(dockWith([{ kind: 'assistant', messageId: 'a' }], 'card').rendered.children[1], null)
})

test('disabled or missing image capability hides only the image action', () => {
  for (const capabilities of [{ sceneImages: false }, {}, null]) {
    for (const mode of ['story', 'free', 'script']) {
      const { rendered } = dockWith([{ kind: 'assistant', messageId: 'reply2' }], mode, capabilities)
      assert.equal(rendered.children[0].type, 'actions')
      assert.equal(rendered.children[0].props.messageId, 'reply2')
      assert.equal(rendered.children[1], null)
      assert.equal(rendered.children[2].type, 'more')
      const empty = dockWith([], mode, capabilities).rendered
      assert.equal(empty.children[0], null)
      assert.equal(empty.children[1], null)
      assert.equal(empty.children[2].type, 'more')
    }
  }
})

test('all dependent panels read messages from Chat, never from Session lifecycle', () => {
  for (const [name, next] of [
    ['CandidateAction', 'CandidateDockActions'],
    ['CandidateQuestion', 'CandidateGuidePanel'],
    ['CandidateGuidePanel', 'RegenPanel'],
    ['TavernStatusPanel', 'TavernStatusTab']
  ]) {
    const component = functionSource(name, next)
    assert.match(component, /props\.useChat\(latestTavernAssistantMessageId\)/, name)
    assert.doesNotMatch(component, /snapshot\.nodes/, name)
  }
  assert.match(functionSource('TavernStatusTab', 'setCandidatePanel'), /uiConversation\.binding\(binding\)\.target\("chat"\)/)
})
