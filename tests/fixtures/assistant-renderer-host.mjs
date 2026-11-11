import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'

// Exercise the real registration and complete assistant component. Unrelated
// history, script, media and Markdown services are inert at this host boundary.
export async function assistantRendererHostScript(source) {
  source ??= await readFile(new URL('../../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const feature = parse(source, { ecmaVersion: 'latest' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'createTavernAssistantRendererFeatureModule')
  return `
const noop = () => {};
const liveTavernView = {getSnapshot: () => ({view: null})};
const useLiveTavernView = () => ({view: null});
const useTavernUiExtensions = noop, useTavernProseLayoutRevision = noop;
const tavernStoryTurnForDshTurn = () => 0, tavernProjectionForTurn = () => null;
const tavernLatestProjectionTurn = () => 0;
const tavernSessionTransition = {subscribe: () => noop, getSnapshot: () => false};
const galIsSuperseded = () => false, isPlayMode = () => false;
const useTavernTurnView = () => ({view: null}), useTavernPluginMedia = () => ({items: []});
const useTavernDistantFloor = () => 0;
const tavernFloorMeasureText = () => '', voiceObservedTurn = () => false;
const tavernFloorHeightStorageKey = () => '';
const TAVERN_EAGER_FLOORS = 3, TAVERN_RECENT_FLOORS = 3, TAVERN_LIVE_FLOORS = 3;
const tavernPlanOf = () => null, tavernPlanShowsRow = () => true;
const tavernUiExtensions = {presentReply: () => null};
const messageDeletionFeature = {Checkbox: () => null, assistantSelector: () => null};
const tavernModelRefusalNotice = () => '';
const tavernMvuReceiptForTurn = () => null;
const tavernModClients = {slot: () => []}, tavernStageBoundary = (_, child) => child;
const installTavernReplyRuns = noop, disposeTavernReplyRuns = noop;
const createSessionCompat = () => ({});
const createTavernFrameSlashExecutor = () => noop;
const createTavernScriptSessionOwner = () => ({start: noop, dispose: noop});
const registrations = [];
let service, mentions;
const ctx = {
  sessions: {},
  get: name => name === 'chatFileMentions' ? service : null,
  effect: (work, label) => { if (label === 'dsh-tavern: inline assistant renderer') work(); }
};
const slots = {inject: (_, work) => work(), register: (options, component) => registrations.push({options, component})};
const renderTavernAssistantBlocks = input => {
  mentions = input.mentions;
  return input.blocks.map((block, key) => React.createElement('p', {key}, block.text));
};
${source.slice(feature.start, feature.end)}
createTavernAssistantRendererFeatureModule().register({ctx, slots});
const registration = registrations.find(row => row.options.key === 'assistant-step');
const turn = {turn: 1, status: 'closed'};
const props = {
  sessionId: 'session-A',
  node: {id: 'answer', key: 'assistant-step', anchorSeq: 9, location: {kind: 'step', turn},
    data: {status: 'completed', finalNode: {seq: 9}, blocks: [{kind: 'text', text: 'Tavern reply'}]}},
  useTurnData: () => ({closing: {finalNode: {seq: 9}}}),
  useChat: select => select({timeline: {turnOrder: [1]}}),
};
globalThis.assistantHost = {
  element(mode) {
    service = mode === 'missing' ? null : {forClosing(owner, sessionId) {
      if (owner.turn !== turn || owner.seq !== 9 || sessionId !== 'session-A') throw Error('incorrect owner or session');
      return 'fallback mentions';
    }};
    const injected = mode === 'unrouted' ? {} : registration.options.inject?.('session-A') || {};
    const legacy = mode === 'legacy' ? {fileMentions: () => 'legacy mentions'} : {};
    return React.createElement(registration.component, {...props, ...injected, ...legacy});
  },
  mentions: () => mentions,
};`
}
