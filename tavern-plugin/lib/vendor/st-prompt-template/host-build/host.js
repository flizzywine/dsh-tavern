import { createTemplateEvents } from './events.js'

// One module instance per dedicated browser frame. Never share this state between sessions.
export const eventSource = createTemplateEvents()
export const event_types = Object.freeze(Object.fromEntries([
  'CHAT_CHANGED', 'GENERATION_AFTER_COMMANDS', 'WORLDINFO_UPDATED', 'GENERATE_AFTER_DATA',
  'CHAT_COMPLETION_SETTINGS_READY', 'WORLDINFO_ENTRIES_LOADED', 'MESSAGE_SWIPE_DELETED',
  'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED',
  'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'SETTINGS_LOADED', 'SETTINGS_UPDATED',
  'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'APP_READY',
  'WORLDINFO_FORCE_ACTIVATE', 'CHAT_COMPLETION_PROMPT_READY', 'MESSAGE_DELETED'
].map(name => [name, name])))
// Protocol constants from SillyTavern 1.12.14 world-info.js and regex/engine.js.
export const world_info_logic = Object.freeze({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 })
export const world_info_position = Object.freeze({ before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6 })
export const regex_placement = Object.freeze({ MD_DISPLAY: 0, USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 })
export const METADATA_KEY = 'world_info', DEFAULT_DEPTH = 4, DEFAULT_WEIGHT = 100
export const ARGUMENT_TYPE = Object.freeze({ STRING: 'string', DICTIONARY: 'dictionary' })
export const POPUP_TYPE = Object.freeze({ TEXT: 1 })
export let chat = [], characters = [], groups = [], selected_group = null, this_chid = 0
export let chat_metadata = {}, extension_settings = {}, oai_settings = {}, nai_settings = {}, power_user = {}
export let world_info = {}, selected_world_info = [], world_names = []
export let name1 = '', name2 = '', user_avatar = '', main_api = '', online_status = ''
export let world_info_case_sensitive = false, world_info_match_whole_words = false, world_info_use_group_scoring = false, world_info_max_recursion_steps = 0
export let yaml
let host, sessionId, configured = false, projectionDepth = 0
const commands = new Map()

export function configureTemplateHost(snapshot, callbacks, libraries) {
  if (configured) throw new Error('Template host already configured; create a new frame for another session')
  if (!snapshot?.sessionId || !Array.isArray(snapshot.chat) || !Array.isArray(snapshot.characters)) throw new TypeError('Invalid template host snapshot')
  if (!libraries?.yaml) throw new TypeError('Template host requires YAML')
  configured = true
  host = callbacks; sessionId = snapshot.sessionId; yaml = libraries.yaml
  refreshTemplateSnapshot(snapshot)
}
export function refreshTemplateSnapshot(s) {
  if (s.sessionId !== sessionId) throw new Error('Template snapshot belongs to another session')
  ;({ chat, characters, chat_metadata, extension_settings, name1, name2 } = s)
  groups = s.groups || []; selected_group = s.selected_group ?? null; this_chid = s.this_chid ?? 0
  oai_settings = s.oai_settings || { prompts: [] }; nai_settings = s.nai_settings || {}; power_user = s.power_user || {}
  world_info = s.world_info || {}; selected_world_info = s.selected_world_info || []; world_names = s.world_names || []
  user_avatar = s.user_avatar || ''; main_api = s.main_api || 'openai'; online_status = s.online_status || ''
  const wi = s.worldInfoOptions || {}
  world_info_case_sensitive = wi.caseSensitive === true; world_info_match_whole_words = wi.matchWholeWords === true
  world_info_use_group_scoring = wi.useGroupScoring === true; world_info_max_recursion_steps = wi.maxRecursionSteps ?? 0
}
function call(name, ...args) {
  if (typeof host?.[name] !== 'function') {
    const error = new Error('ST-Prompt-Template host capability unavailable: ' + name)
    error.code = 'PROMPT_TEMPLATE_HOST_UNSUPPORTED'
    throw error
  }
  return host[name](...args)
}
export function getCurrentChatId() { return sessionId }
export function getGroupMembers(id = selected_group) { const group = groups.find(item => item.id === id); return group ? group.members.map(avatar => characters.find(c => c.avatar === avatar)).filter(Boolean) : [] }
export function getChatCompletionModel() { return call('getChatCompletionModel') }
export async function withTemplateProjection(action) { projectionDepth++; try { return await action() } finally { projectionDepth-- } }
export function saveChatConditional(...args) { if (projectionDepth) return Promise.resolve(); return call('saveChatConditional', { chat, chat_metadata, extension_settings }, ...args) }
export function saveSettingsDebounced() { return call('saveSettingsDebounced', extension_settings) }
export function renderExtensionTemplateAsync(...args) { return call('renderExtensionTemplateAsync', ...args) }
export function loadWorldInfo(...args) { return call('loadWorldInfo', ...args) }
export function substituteParams(...args) { return call('substituteParams', ...args) }
export function getRegexedString(...args) { return call('getRegexedString', ...args) }
export function getTokenCountAsync(...args) { return call('getTokenCountAsync', ...args) }
export function executeSlashCommandsWithOptions(...args) { return call('executeSlashCommandsWithOptions', ...args) }
export function getThumbnailUrl(...args) { return call('getThumbnailUrl', ...args) }
export function getUserAvatar(...args) { return call('getUserAvatar', ...args) }
export function getCharaFilename(...args) { return call('getCharaFilename', ...args) }
export function messageFormatting(...args) { return call('messageFormatting', ...args) }
export function updateMessageBlock(...args) { return call('updateMessageBlock', ...args) }
export function appendMediaToMessage(...args) { return call('appendMediaToMessage', ...args) }
export function addCopyToCodeBlocks(...args) { return call('addCopyToCodeBlocks', ...args) }
export function updateReasoningUI(...args) { return call('updateReasoningUI', ...args) }
export function callGenericPopup(...args) { return call('callGenericPopup', ...args) }
export function copyText(...args) { return call('copyText', ...args) }
export function parseRegexFromString(value) {
  const match = typeof value === 'string' && value.match(/^\/(.*)\/([dgimsuvy]*)$/s)
  if (!match) return null
  try { return new RegExp(match[1], match[2]) } catch { return null }
}
export class SlashCommand { static fromProps(props) { return { ...props } } }
export class SlashCommandArgument { static fromProps(props) { return { ...props } } }
export class SlashCommandNamedArgument extends SlashCommandArgument {}
export const SlashCommandParser = Object.freeze({ addCommandObject(command) {
  if (!command.name || typeof command.callback !== 'function') throw new TypeError('Invalid template command')
  if (commands.has(command.name)) throw new Error('Duplicate template command: ' + command.name)
  commands.set(command.name, command)
} })
export async function runTemplateCommand(name, args = {}, value = '') {
  const command = commands.get(name)
  if (!command) throw new Error('Unknown template command: ' + name)
  return await command.callback(args, value)
}
export function templateCommandNames() { return [...commands.keys()] }
export function disposeTemplateHost() { eventSource.clear(); commands.clear(); host = undefined; sessionId = undefined }
