// The phone summary relay's host adapter (experimental, off by default).
// summary-relay.js owns every relay decision; this file only wires it to the stage: the per-card switch, the profile
// store, the story snapshot, the shared background task, the phone's read-only source and the next round's tail.
// Nothing here runs, reads or writes while the switch is off for a chat's card.
import {createHash} from 'node:crypto'
import {createSummaryRelay, relayRecords, relayRequestOf, relaySource, RAW_MIN_ROUNDS} from './summary-relay.js'
import {createCallSections} from './call-context.js'

const MOD = 'dsh.phone'
export const RELAY_CAPABILITY = 'phone-relay'
// Rewinds start a new timeline branch, but a round's text identifies it: an unchanged earlier round keeps its entries.
const LINE = 'story'
const turnOf = row => Number(row.turn || (row.greeting ? 1 : 0))
const roundText = (messages, turn) => messages.filter(row => row?.role === 'assistant' && turnOf(row) === turn).map(row => String(row.text ?? row.content ?? '')).join('\n\n')
// Identity of a round's committed text (a cache key, not a check).
const versionOf = text => createHash('sha1').update(text).digest('hex').slice(0, 16)

export const callTranscript = (call, player, name) => call.lines.filter(line => !line.cue)
  .map(line => (line.role === 'player' ? player : name) + '：' + (line.sub || line.text)).join('\n')

export const RELAY_SOURCES = [
  {id:'story', name:'Story', recentRounds:RAW_MIN_ROUNDS, compressionPrompt:'正文：一轮一条，写发生了什么、做出的决定、关系变化和未解决的事。'},
  {id:'phone', name:'Phone Call', recentRounds:3, compressionPrompt:'电话：写清谁和谁通话，说定的事、透露的信息和情绪变化；参与者填通话双方的人物 id。没有通话的轮次写「无通话」。'},
]

// estimate: the story's token estimate, from the host's shared-context service.
export function createPhoneRelayHost({library, estimate, chatForSession, profileData, managedModManagement, modConfigHost, readModCard, contextHost, service}) {
  const {callEventsSection} = createCallSections(library)
  const relays = new Map()
  const callsOf = async chatId => (await profileData.readJson('phone-calls/' + chatId + '.json'))?.threads || {}

  async function enabled(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat?.cardPath || !await managedModManagement.enabled({modId:MOD, cardPath:chat.cardPath})) return false
    // The resolved two-layer value: 本卡 when set, else 全局, else the default off (the four-state order for an on/off field).
    return (await modConfigHost.values(MOD, await readModCard(chat.cardPath))).summaryRelay === 'on'
  }

  function relayFor(sessionId, chatId) {
    let entry = relays.get(sessionId)
    if (entry) return entry
    const snapshot = {turn:0, versions:new Map()}
    const refresh = async () => {
      const chat = await chatForSession(sessionId)
      const turns = [...new Set((chat?.messages || []).filter(row => row?.role === 'assistant').map(turnOf).filter(Boolean))]
      snapshot.turn = Math.max(0, ...turns)
      snapshot.versions = new Map(turns.map(turn => [turn, versionOf(roundText(chat.messages, turn))]))
      return chat
    }
    const path = 'phone-summary-relay/' + chatId + '.json'
    const sources = RELAY_SOURCES.map(source => relaySource({...source, readRaw:async ({turn, rawRef}) => {
      if (source.id === 'story') return roundText((await chatForSession(sessionId)).messages, turn)
      const threads = await callsOf(chatId)
      for (const [contactId, thread] of Object.entries(threads)) {
        const call = thread.calls.find(row => row.id === rawRef)
        if (call) return callTranscript(call, '玩家', contactId)
      }
      return ''
    }}))
    const readAnchor = () => ({branchId:LINE, turn:snapshot.turn, textVersion:snapshot.versions.get(snapshot.turn)})
    const relay = createSummaryRelay({sources, estimate, readAnchor,
      versionAt:turn => snapshot.versions.get(turn),
      store:{
        read:() => profileData.readJson(path),
        // CAS against the state the plan was made from; the snapshot is refreshed right before the critical section.
        async update(expected, transform) {
          await refresh()
          let wrote = false
          await profileData.updateJson(path, current => {
            if (JSON.stringify(current ?? null) !== JSON.stringify(expected ?? null)) throw Object.assign(new Error('relay state changed'), {code:'RELAY_CONFLICT'})
            const next = transform(current)
            wrote = next !== undefined
            return next
          })
          return wrote
        },
      },
      // The round's shared background request when one was captured for it (same model, system and tools, instruction at the
      // end); otherwise one plain background call that carries the raw text itself, since it has no lookup tool.
      async runSharedTask({instruction, signal}) {
        const anchor = contextHost.sharedAnchor(sessionId)
        if (anchor?.turn === snapshot.turn) return contextHost.runSharedTask({sessionId, anchor, instruction, signal})
        const request = relayRequestOf(instruction), raw = []
        if (request.summarize) for (let turn = request.summarize.fromTurn; turn <= request.summarize.toTurn; turn++) raw.push({turn, source:'story', text:await sources[0].readRaw({turn})})
        for (const event of request.events) raw.push({turn:event.anchor.turn, source:'phone', participants:event.participants, text:await sources[1].readRaw({turn:event.anchor.turn, rawRef:event.rawRef})})
        const result = await contextHost.callBackground({sessionId, signal, system:'<relay_role>\nYou compress story records into a structured summary index.\n</relay_role>',
          text:relayRecords(raw) + '\n\n' + instruction})
        return {output:result.output, usage:result.usage, measurement:{standalone:true}}
      },
    })
    entry = {relay, refresh, readAnchor}
    relays.set(sessionId, entry)
    return entry
  }

  // One switch read per use: an off chat gets its controller disabled (in-flight work cancelled), and nothing else.
  async function active(sessionId) {
    const on = await enabled(sessionId)
    const entry = on ? relayFor(sessionId, (await chatForSession(sessionId)).id) : relays.get(sessionId)
    if (!entry) return null
    entry.relay.setEnabled(on)
    if (!on) return null
    await entry.refresh()
    return entry
  }

  const cleanups = []
  // The phone's calls, readable by turn through the shared source tool; a call's own reader sees only its contact.
  const capability = service.readCapability({name:RELAY_CAPABILITY, authorize:({sessionId}) => enabled(sessionId), sources:[{name:'phone',
    readRaw:async ({sessionId, args, scope}) => {
      const chat = await chatForSession(sessionId), threads = await callsOf(chat.id)
      return Object.entries(threads).filter(([contactId]) => !scope?.contact || scope.contact === contactId)
        .flatMap(([contactId, thread]) => thread.calls.filter(call => call.anchor?.turn === args.turn && (args.para === undefined || !call.anchor.para || call.anchor.para <= args.para))
          .map(call => '#' + args.turn + ' Phone Call [' + contactId + ']\n' + callTranscript(call, '玩家', contactId))).join('\n\n') || '这一轮没有通话。'
    }}]})
  cleanups.push(() => capability.revoke())
  cleanups.push(contextHost.registerSharedProvider({prepare:async ({sessionId}) => await enabled(sessionId)
    ? {owner:'dsh-tavern-stage', name:RELAY_CAPABILITY, consumer:{id:'summary-relay'}, scope:{}} : null}))
  // Every written round (owner point 4): after the round's background work, the relay decides whether it is due (every 5
  // rounds, or the round after a call ended). Off for the card: nothing is read, written or sent.
  cleanups.push(service.on('reply-committed', async ({gameId}) => {
    if (!await enabled(gameId)) return relays.get(gameId)?.relay.setEnabled(false)
    await contextHost.afterBackground(gameId)
    const entry = await active(gameId)
    if (!entry) return
    const result = await entry.relay.committed()
    if (result.status === 'committed') console.info('dsh-tavern: 手机摘要中转站已更新', JSON.stringify({sessionId:gameId, turn:entry.readAnchor().turn, usage:result.usage, measurement:result.measurement}))
  }))
  // A call that ended since the last round enters the next story round once, as its source text (owner point 9).
  cleanups.push(service.turnSection({name:'phone-relay-events', position:'after', target:'story', text:async ({gameId, turn}) => {
    const entry = relays.get(gameId) && await active(gameId)
    if (!entry) return ''
    const rows = await entry.relay.projectEvents({targetTurn:Number(turn)})
    return rows.length ? callEventsSection(rows.map(row => row.text).join('\n\n')) : ''
  }}))

  return {
    active,
    async callEnded({sessionId, call}) {
      if (!call.lines.some(line => !line.cue)) return
      const entry = await active(sessionId)
      if (!entry) return
      await entry.relay.recordEvent({eventId:call.id, anchor:entry.readAnchor(), sourceId:'phone', rawRef:call.id, participants:[call.contact.id]})
    },
    // The call's story context with the relay on (owner points 10–12): summary entries before the raw window, raw rounds
    // = max(3, rounds the summary has not reached), the summary entries the raw window covers dropped.
    async callStory(sessionId, turn) {
      const entry = await active(sessionId)
      if (!entry) return null
      const projected = await entry.relay.project({turn})
      return {summary:projected.text, rounds:turn - projected.plan.raw.from + 1}
    },
    async bindCall({sessionId, anchor, contactId}) {
      const chat = await chatForSession(sessionId)
      return contextHost.bind({owner:'dsh-tavern-stage', name:RELAY_CAPABILITY, sessionId, consumer:{id:'phone-call', contact:contactId},
        anchor:{branchId:chat.timeline.branchId, turn:anchor.turn, textVersion:String(chat.timeline.revision), ...(anchor.para ? {para:anchor.para} : {})},
        scope:{contact:contactId}})
    },
    dispose() {
      for (const {relay} of relays.values()) relay.dispose()
      relays.clear()
      for (const cleanup of cleanups.reverse()) cleanup?.()
    },
  }
}
