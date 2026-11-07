// Generated from dsh-presentation-protocol by build.mjs; do not edit.
// A card's cast voice fields (CHARX extensions.dsh_tavern.cast, Wiki「设计：cast-presentation」22/N) and a library
// figure's voice (voice-schema.js). The one mapping, used by card import (castVoice) and card export (castVoiceFields).
// Card channel names → voice service kinds; the same table read backwards on export.
export const CAST_VOICE_CHANNELS = Object.freeze({fish:'fish-audio', openai:'openai-compatible', volcengine:'volcengine', qwen:'qwen', azure:'azure'})
const CHANNEL_OF = Object.fromEntries(Object.entries(CAST_VOICE_CHANNELS).map(([channel, kind]) => [kind, channel]))

/**
 * A cast character's voice as a pack voice and the figure's binding. `references` are the clips already stored as pack
 * media ([{media, text}]); `channels` the voice service kinds configured here. A source without such a channel is
 * dropped and named in `dropped`: the clips stay as the voice's reference list and the figure chooses no source
 * (binding.source null), as when the card names none. Null voice when nothing is left.
 */
export function castVoice({name, references = [], voiceSource, voiceLanguage, voices = {}}, channels, voiceId) {
  const language = voiceLanguage || 'zh', sources = {}
  if (references.length) sources.fish = {kind:'reference-list', provider:'fish-audio', references:references.map(clip => ({media:clip.media, text:clip.text || '', language}))}
  const channel = voiceSource?.provider, kind = CAST_VOICE_CHANNELS[channel]
  let chosen = null, dropped = ''
  if (channel && !(kind && channels.includes(kind))) dropped = String(channel)
  else if (kind === 'fish-audio' && !voiceSource.clone && voices.fish) { sources['fish-id'] = {kind:'voice-id', provider:kind, voiceId:voices.fish}; chosen = 'fish-id' }
  else if (kind === 'fish-audio') { sources.fish ||= {kind:'reference-list', provider:kind, references:[]}; chosen = 'fish' }
  else if (kind) { sources[kind] = {kind:'preset', provider:kind, ...(voices[channel] ? {voiceName:voices[channel]} : {})}; chosen = kind }
  const defaultSource = chosen || Object.keys(sources)[0]
  if (!defaultSource) return {voice:null, binding:null, dropped}
  return {voice:{name, language, defaultSource, sources}, binding:{voice:voiceId, ...(chosen ? {} : {source:null})}, dropped}
}

/** The cast voice fields of a figure's voice: its reference clips ([{media, text}]), language and chosen source. */
export function castVoiceFields(voice, binding) {
  const references = Object.values(voice.sources).flatMap(source => source.kind === 'reference-list' ? source.references.map(clip => ({media:clip.media, text:clip.text})) : [])
  const source = binding.source === null ? null : voice.sources[binding.source ?? voice.defaultSource]
  const channel = source && CHANNEL_OF[source.provider]
  const fields = {references, voiceLanguage:binding.language || voice.language}
  if (!channel) return fields
  if (source.kind === 'reference-list') return {...fields, voiceSource:{provider:channel, clone:true}}
  const value = source.kind === 'voice-id' ? source.voiceId : source.voiceName
  return {...fields, voiceSource:{provider:channel}, ...(value ? {voices:{[channel]:value}} : {})}
}
