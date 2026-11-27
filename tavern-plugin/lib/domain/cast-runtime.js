import { hasCardAssetBindings } from '../card-asset-bindings.js'
import { readCardAssetExtension } from './card-asset-bindings.js'
import { bubbleCastLines } from './cast-annotation.js'
import { RECENT_FLOORS } from './plugin-turns.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createCastRuntime({
  castAssets, chatHeaderForSession, readRoundView, replyDisplayForChat, readChatCard, pluginTurns,
  recentStateForSession, sessionStateForSession, dialogueBubbles, readCardWorkspace, speech, conversationRegistry, sessionSignals,
  pluginApi, cardSpeech
}) {
  function castAssetView(cardPath, manifest) {
    const key = castAssets.keyOf(cardPath)
    const url = file => file ? '/api/dsh-tavern/cast-asset?' + new URLSearchParams({ card: key, file }).toString() : ''
    return manifest.characters.map(character => ({ name: character.name, aliases: character.aliases || [], avatarUrl: url(character.avatar), avatars: {}, voices: character.voices || {},
      sprites: Object.fromEntries(Object.entries(character.sprites || {}).map(([emotion, file]) => [emotion, url(file)])) }))
  }
  // The cast as everyone sees it: the player's own assets, then what plugins offer (a DSH card's packs).
  // A character both have keeps the player's pictures and fills only what the player left empty.
  async function castView(sessionId, cardPath, manifest) {
    const own = castAssetView(cardPath, manifest)
    const offered = await pluginApi().castAssetSources({ gameId: str(sessionId) }).catch(() => [])
    const names = character => [character.name, ...character.aliases]
    for (const item of offered) {
      const match = own.find(character => names(character).some(name => names(item).includes(name)))
      if (!match) { own.push({ ...item, voices: {} }); continue }
      if (!match.avatarUrl) match.avatarUrl = item.avatarUrl
      match.avatars = { ...item.avatars, ...match.avatars }
      match.sprites = { ...item.sprites, ...match.sprites }
    }
    return own
  }
  async function castCardOf(sessionId) {
    const header = await chatHeaderForSession(str(sessionId), ['cardPath', 'cardName', 'mode', 'macroState'])
    if (!header || !header.cardPath || !['story', 'script'].includes(header.mode || 'story')) throw new Error('这一局没有绑定人物卡')
    return { path: str(header.cardPath), name: str(header.cardName), player: str(header.macroState && header.macroState.userName).trim() || '你' }
  }
  // Each turn's spoken lines (getCast, onCastAnnotated, getStage, registerTurnView): its round body's bubble paragraphs,
  // as the chat shows them (the read getRoundBody makes); the round view names the earlier turns so their floors carry their text.
  async function castLinesFor(sessionId, turns) {
    const last = Math.max(...turns)
    const chat = await readRoundView(sessionId, last, turns.filter(turn => turn !== last))
    const display = await replyDisplayForChat(chat, await readChatCard(chat), true)
    return new Map(turns.map(turn => [turn, bubbleCastLines(display.projections.find(row => row.turn === turn)?.body)]))
  }
  async function readCast(sessionId, turn) {
    const material = await pluginTurns.readTurn(sessionId, turn)
    const lines = material ? (await castLinesFor(material.sessionId, [material.turn])).get(material.turn) : []
    return lines.length ? { turn: material.turn, textVersion: material.key, lines } : null
  }
  // A settled or edited reply: its lines came with its text, so tell plugins they are there.
  async function announceCast(sessionId) {
    const material = await pluginTurns.readLatestSettledTurn(sessionId)
    const cast = material && !material.greeting ? await readCast(material.sessionId, material.turn) : null
    if (cast) pluginApi().castAnnotated(material.sessionId, cast)
  }
  // The stage reads the latest turns as plain text, with their spoken lines and the card's cast.
  async function castStage(sessionId, count) {
    const card = await castCardOf(sessionId)
    // At most ten turns: the latest floors hold them.
    const state = await recentStateForSession(str(sessionId), RECENT_FLOORS) || await sessionStateForSession(str(sessionId))
    const storyTurns = [...new Set((state?.messages || []).filter(message => message?.role === 'assistant').map(message => Number(message.turn || (message.greeting ? 1 : 0))).filter(turn => turn > 0))]
    const wanted = storyTurns.slice(-Math.max(1, Math.min(10, Number(count) || 5)))
    const turns = []
    for (const turn of wanted) {
      const material = await pluginTurns.readTurn(str(sessionId), turn).catch(() => null) || (turn === wanted.at(-1) ? await pluginTurns.readPendingTurn(str(sessionId)).catch(() => null) : null)
      if (material && material.turn === turn) turns.push({ turn, text: material.text })
    }
    const lines = turns.length ? await castLinesFor(str(sessionId), turns.map(item => item.turn)) : new Map()
    for (const item of turns) item.lines = lines.get(item.turn)
    const manifest = await castAssets.read(card.path)
    const background = (manifest.backgrounds || [])[0]
    // Whether this card's games show the stage: the player's 舞台 switch, for a card with bound packs.
    return { enabled: (await dialogueBubbles.read(card.path).catch(() => null))?.stage?.enabled === true, player: card.player, card: { name: card.name, imageUrl: '/api/dsh-tavern/card-image?path=' + encodeURIComponent(card.path) },
      background: background ? '/api/dsh-tavern/cast-asset?' + new URLSearchParams({ card: castAssets.keyOf(card.path), file: background.file }).toString() : '',
      cast: await castView(sessionId, card.path, manifest), turns }
  }
  // One line in its voice through the voice service (domain/speech.js): { url, mediaType, loudness }, { browser, voice, text }
  // or { skip, reason } (TTS_UNAVAILABLE without a voice service). A figure voice needs the stage's card speech, which only
  // a page's authenticated origin opens; without it the line uses the 台词朗读 voice.
  async function speakLine(sessionId, { speaker, text, emotion, narration } = {}, origin) {
    const card = await castCardOf(str(sessionId)).catch(() => null)
    const figures = card && origin ? await cardSpeech({ sessionId: str(sessionId), cardPath: card.path }, origin) : null
    // without the stage, narration reads the card's narrator layer and its own 旁白 voice (narrator:<card id>) directly.
    const workspace = card && !figures && narration === true ? await readCardWorkspace(card.path).catch(() => null) : null
    const extension = workspace?.raw && hasCardAssetBindings(workspace.raw) ? readCardAssetExtension(workspace.raw) : undefined
    return speech.speak({ text, speaker: str(speaker), emotion: str(emotion) || 'neutral', narration: narration === true, figures, extension })
  }
  // The asset packs this game's card carries, with the base address of their files.
  async function cardPacksOf(sessionId) {
    const card = await castCardOf(str(sessionId))
    return ((await castAssets.read(card.path)).packs || []).map(pack => ({ ...pack,
      baseUrl: '/api/dsh-tavern/pack-file?' + new URLSearchParams({ pack: pack.id, v: pack.contentHash }).toString() + '&path=' }))
  }
  // A card's cast or packs changed outside the stage page: games of that card re-read them.
  async function castAssetsChanged(cardPath) {
    for (const item of await conversationRegistry.list().catch(() => [])) {
      if (item && item.cardPath === cardPath && item.sessionId) sessionSignals.publish(item.sessionId, { kind: 'cast', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
    }
  }
  async function castEdit(sessionId, edit) {
    const card = await castCardOf(sessionId)
    const result = await edit(card.path, card)
    const manifest = result?.cast || result
    return { ...(result?.cast ? { imported: result.imported, skipped: result.skipped, characters: result.characters } : {}), cast: await castView(sessionId, card.path, manifest) }
  }

  return { castView, castCardOf, readCast, announceCast, castStage, speakLine, cardPacksOf, castAssetsChanged, castEdit }
}
