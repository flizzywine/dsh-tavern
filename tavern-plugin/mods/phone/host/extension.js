import {createPhoneCalls} from '../call.js'
import {callGreeting, createCallGreetings} from '../call-greeting.js'
import {callRoundWorldbook, callDesignPersona, callRecognitionContext, storyRoundMessages, phoneMarkRounds, roundPhoneMessages, callStorySection, callPhoneRecords} from '../call-context.js'
import {phoneThreadDirectory, phonePeople} from '../threads.js'
import figureResolution from '../../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
const {figureSpeakerHandle} = figureResolution

// The dsh.phone mod's host side, its stage service (stage.js hostExtension; stage-extensions.js): the phone's directory
// (getStagePhoneThreads) and its calls (phoneCall*, phone-call.md). Speech recognition stays the core's shared service
// (ctx 'asr'); the call's voice goes through the card's asset consumer as the stage's own voices do. The core helpers it
// shares with the stage come in hostLibrary (the stage's request bindings), never by import.
export function createStagePhoneHost({ctx, managedModManagement, readCardWorkspace, stageDirector, chatForSession, assetRuntime, profileData, callModel,
  readRoundOps, readChatCard, readModCard, modConfigHost, replyDisplayForChat, pluginApi, resolveSlot, agentRegistry, backgroundTasks, speech,
  speechRecognition, readStageChat, readRoundView, worldbookRecallLog, dialogueBubbles, figureRuntimes,
  hostLibrary:{recognitionAudio, figureCatalogue, bubbleCharacter, bubbleVoiceSwitches, effectiveBubbleMoods, projectAgentMessageText}}) {
  async function stagePhoneDirectory(chat) {
    if(!await managedModManagement.enabled({modId:'dsh.phone',cardPath:chat.cardPath}))return {enabled:false,contacts:[],threads:[]}
    const raw=(await readCardWorkspace(chat.cardPath))?.raw,bindings=(raw?.data || raw)?.extensions?.dsh_tavern?.assetBindings
    const globalEnabledPackIds=ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []
    const library=ctx.get('assetLibrary'),ids=[...new Set([...(bindings?.boundPackIds || []),...globalEnabledPackIds])]
    const snapshots=library?(await Promise.all(ids.map(packId=>library.getPackSnapshot({packId}).catch(()=>null)))).filter(Boolean):[]
    let state
    for(const message of chat.messages.filter(row=>row.role==='assistant').slice().reverse()) {
      const turn=Number(message.turn || (message.greeting?1:0))
      if(!turn)continue
      const direction=await stageDirector.get(chat,turn,null,{readOnly:true}),record=direction.record || direction.preview
      state=record?.end || record?.entries.at(-1)?.state || record?.baseline
      if(state)break
    }
    const characters=figureCatalogue({snapshots,bindings,globalEnabledPackIds,roster:state?.actors})
    return {enabled:true,...phoneThreadDirectory(characters,state,{playerName:chat.macroState?.userName}),[PHONE_FIGURES]:characters}
  }
  const PHONE_FIGURES = Symbol('phone figures')

  // calls with one phone contact. Each contact's calls are
  // its own context window, stored beside the chat (phone-calls/<chatId>.json), anchored to the story position; the
  // story is read, never written. Recognition comes from the shared speech service, local by default.
  const phoneCalls = createPhoneCalls({
    serviceState:async ({sessionId, contact, origin}) => {
      const whole = await chatForSession(sessionId)
      const consumer = whole?.cardPath && await assetRuntime.consumer(whole, origin)
      return consumer ? consumer.speech.serviceState(contact.id) : {state:'unavailable'}
    },
    // An open call keeps her voice's provider resident (the generic residency lease), so it cannot go cold mid-call.
    hold:async ({sessionId, contact, origin}) => {
      const whole = await chatForSession(sessionId)
      const consumer = whole?.cardPath && await assetRuntime.consumer(whole, origin)
      return consumer ? consumer.speech.hold(contact.id) : null
    },
    store:{read:chatId => profileData.readJson('phone-calls/' + chatId + '.json'), update:(chatId, fn) => profileData.updateJson('phone-calls/' + chatId + '.json', fn)},
    model:async ({sessionId, selection, system, messages, signal, onText, onChunk}) => callModel({sessionId, selection, system, messages, signal, onText, onChunk, maxTokens:800, temperature:0.8}),
    context:async ({sessionId, contact, input, anchor, phase, calls, playerName}) => {
      const shared = {gameId:sessionId, turn:anchor.turn, target:'call', subject:contact}
      if (phase === 'start') {
        // One chain view through the dial's round names the rounds read in full: the latest four and every round that
        // marks a phone message (their beat ops come first, as the phone's own view reads them).
        const marks = await readRoundOps(sessionId, anchor.turn, Infinity), base = await marks.view([])
        const turns = storyRoundMessages(base.messages, anchor.turn).map(row => row.turn)
        const view = await marks.view([...new Set([...turns, ...phoneMarkRounds(marks.records)])].filter(turn => turn !== anchor.turn))
        const card = await readChatCard(view)
        const workspace = await readModCard(view.cardPath)
        const photoConfig = await modConfigHost.store.read({modId:'dsh.phone', cardId:workspace.meta.id})
        const photos = ['card', 'global'].flatMap(layer => photoConfig[layer].photos?.fixed || [])
        const display = await replyDisplayForChat(view, card, true), body = turn => display.projections.find(row => row.turn === turn)?.body
        const agentText = row => projectAgentMessageText(row, {charName:view.cardName, macroState:view.macroState})
        const rounds = storyRoundMessages(view.messages, anchor.turn).map(({turn, input, replies}) => ({turn, input:input.map(agentText).join('\n'),
          // The dial's own round stops at the page the reader was on: the pages after it have not happened yet.
          text:turn === anchor.turn && anchor.para ? (body(turn)?.displayUnits || []).slice(0, anchor.para).map(unit => unit.text).join('\n\n') : replies.map(agentText).join('\n\n')}))
        const current = view.messages.findLast(row => row.role === 'assistant' && Number(row.turn || (row.greeting ? 1 : 0)) === anchor.turn)?.stageDirectionAssetPacks
        const records = [...marks.records, [anchor.turn, current]], marked = new Set(phoneMarkRounds(records))
        const messages = records.filter(([turn]) => turn <= anchor.turn && marked.has(turn))
          .flatMap(([turn, record]) => roundPhoneMessages(turn, record, body(turn)?.paragraphs || [], turn === anchor.turn ? anchor.para : undefined))
        const directory = await stagePhoneDirectory(base), people = phonePeople(directory[PHONE_FIGURES] || [])
        const names = new Map([...people.map(row => [row.id, row.name]), ...directory.threads.filter(row => row.kind === 'group').map(row => [row.id, row.name]), ...(directory.playerId ? [[directory.playerId, playerName]] : [])])
        return {promptSections:[...await pluginApi.promptSections(shared), {name:'call-speech-recognition', text:callRecognitionContext(contact, people)},
          {name:'recent-story', text:callStorySection(rounds)}, {name:'phone-records', text:callPhoneRecords({calls, messages, photos, chatId:view.id, anchor, names, contact:contact.name, player:playerName})}],
        selection:await resolveSlot('dsh.phone','call',sessionId)}
      }
      return {turnSections:await pluginApi.turnContext({...shared,input})}
    },
  })
  ctx.effect(() => () => phoneCalls.dispose())
  // Greetings missing from the voice cache, made one at a time once nothing else is using the app (call-greeting.js).
  const callGreetings = createCallGreetings({
    idle:() => !agentRegistry.list().some(agent => agent.phase.kind !== 'idle') && !backgroundTasks.pendingCount() && !stageDirector.pendingCount()
      && !speech.pendingCount() && !(ctx.get('tts')?.pendingCount() || 0) && !phoneCalls.activeCount(),
    prepare:async ({sessionId, contactId, origin}) => {
      const chat = await readStageChat.view(sessionId)
      if (!chat) return
      // Read-only: checking the cache neither binds nor warms her voice; only a missing greeting is synthesized.
      const {consumer, language, contact, voiceAvailable} = await phoneCallHost.contact(sessionId, chat, contactId, origin, {readOnly:true})
      const line = voiceAvailable && consumer && callGreeting(language, contact.defaultEmotion)
      if (line && !await consumer.speech.readCached(contactId, {text:line.say, mood:line.mood})) await consumer.speech.synthesize(contactId, {text:line.say, mood:line.mood})
    },
  })
  ctx.effect(() => () => callGreetings.dispose())
  // The call's persona section lives as long as the stage does.
  pluginApi.builtinPromptSection({name:'persona', target:'call', unbounded:true,
    text:async ({gameId,subject,turn}) => callRoundWorldbook({chat:await readRoundView(gameId,turn),turn,recallLog:worldbookRecallLog,
      fallback:() => phoneCalls.persona({sessionId:gameId,contactId:subject.id})}),
  }, ctx)
  const phoneCallHost = {
    calls: phoneCalls,
    // Host-only entry point for a future incoming call; no ringing or director wiring.
    async startByContact({sessionId, contactId, origin, at}) {
      const chat = await readStageChat.view(sessionId)
      if (!chat) throw new Error('会话不存在')
      const contact = await phoneCallHost.contact(sessionId, chat, contactId, origin)
      if (!contact.voiceAvailable) throw new Error(contact.voiceProblem === 'voice-unbound' ? '这位联系人还没有配音，打不了电话' : '她的声音暂时打不开，请再拨一次')
      await phoneCallHost.listening()
      const {voiceProblem, consumer, ...callee} = contact
      const greeting = await phoneCallHost.greeting({sessionId, contactId, origin, consumer, language:callee.language, mood:callee.contact.defaultEmotion})
      const {audio, loudness, ...line} = greeting || {}
      return {...await phoneCalls.start({sessionId, chat, ...callee, at, origin, greeting:greeting ? line : null}), voiceAvailable:true, ...(greeting ? {greeting} : {})}
    },
    // Her pick-up line (call-greeting.js), read from the voice cache only: a hit plays the moment she picks up; a miss is
    // queued for idle time and never synthesized now - live synthesis on a busy machine is what kept the call silent.
    async greeting({sessionId, contactId, origin, consumer, language, mood}) {
      const line = consumer && callGreeting(language, mood)
      if (!line) return null
      const cached = await consumer.speech.readCached(contactId, {text:line.say, mood:line.mood}).catch(() => null)
      if (!cached) { callGreetings.want({sessionId, contactId, origin}); return null }
      return {...line, audio:Buffer.from(cached.audio).toString('base64'), loudness:cached.loudness}
    },
    // Contacts likely to be called (called before): their greetings are checked, and made if missing, in idle time.
    wantGreetings({sessionId, origin, contactIds}) { for (const contactId of contactIds) callGreetings.want({sessionId, contactId, origin}) },
    // The phone directory comes from the stage view; persona and voice from the whole chat, as the stage's own voices.
    async contact(sessionId, chat, contactId, origin, {readOnly = false} = {}) {
      const directory = await stagePhoneDirectory(chat), whole = await chatForSession(sessionId)
      if (!directory.enabled) throw new Error('手机模组没有为这张卡开启')
      const row = directory.contacts.find(item => item.id === contactId)
      if (!row) throw new Error('联系人不存在')
      const figure = directory[PHONE_FIGURES].find(item => item.actorKey === contactId)
      const design = (whole?.characterDesignDocument?.characters || []).find(item => figureResolution.resolveFigureName(directory[PHONE_FIGURES],item.name).actorKey === contactId)?.design || {}
      const persona = callDesignPersona(design)
      const consumer = whole?.cardPath && await assetRuntime.consumer(whole, origin)
      const opening = readOnly ? {readOnly:true} : {}
      let voice = consumer ? await consumer.speech.open(contactId, opening) : {available:false, diagnostics:['voice-unbound']}
      // The first open on a fresh runtime can race its own revision check; it asks to be opened again (as the stage player does).
      if (voice.diagnostics?.[0] === 'TTS_STALE') voice = await consumer.speech.open(contactId, opening)
      const config = await dialogueBubbles.read(chat.cardPath)
      const character = bubbleCharacter(config, {alias:contactId, name:row.name})
      const moods = effectiveBubbleMoods(config, character?.alias).filter(mood => !character?.promptEmotionIds || character.promptEmotionIds.includes(mood.id))
      return {contact:{id:contactId, name:row.name, handle:figureSpeakerHandle(directory[PHONE_FIGURES],figure), ref:figure.ref, moods, voiceRules:bubbleVoiceSwitches(config, character), defaultEmotion:character?.defaultEmotion || 'default'}, persona, language:voice.available ? voice.language || 'zh' : 'zh', voiceAvailable:voice.available === true, voiceProblem:voice.diagnostics?.[0] || null, playerName:chat.macroState?.userName || '', consumer}
    },
    // The 电话 app's facts about every contact, from one read of the phone's directory and stage (a card's cast can be over a
    // hundred figures: nothing here is read per contact). `voices`: who has a voice to call with (the app greys out the
    // others) - declared only, as the stage's cached voice reads: listing a contact binds or warms nothing; the call itself
    // opens the voice. `videos` / `selfFigure`: who can be seen on FaceTime (a stage figure), and whether the player has one.
    async directoryFacts(sessionId, origin) {
      const read = await phoneCallHost.read(sessionId, origin)
      if (!read.directory.enabled) return {voices:{}, videos:{}, selfFigure:false}
      const {directory, consumer} = read, scene = await phoneCallHost.scene({sessionId, origin}, read).catch(() => null)
      const shown = async who => Boolean(scene && await phoneCallHost.cast(scene, who).catch(() => null))
      const [voices, videos, selfFigure] = await Promise.all([
        Promise.all(directory.contacts.map(async row => [row.id, consumer ? await consumer.speech.voiced(row.id) : false])).then(Object.fromEntries),
        Promise.all(directory.contacts.map(async row => [row.id, await shown(row.id)])).then(Object.fromEntries), shown('self')])
      return {voices, videos, selfFigure}
    },
    // The phone's directory (stage view) and the card's asset consumer (whole chat), as every phone read starts.
    async read(sessionId, origin) {
      const chat = await readStageChat.view(sessionId)
      if (!chat) throw new Error('会话不存在')
      const directory = await stagePhoneDirectory(chat)
      if (!directory.enabled) return {chat, directory, consumer:null}
      const whole = await chatForSession(sessionId), consumer = whole?.cardPath && await assetRuntime.consumer(whole, origin)
      return {chat, directory, consumer}
    },
    // a call party's figure as the stage projects it - the same
    // presentation.character + materialize the stage uses, in the outfit of the page the call was made from (director state at
    // `at`; none: the default outfit) and `emotion` (her clause's mood id; the player: the default). Form ladder as the stage:
    // Live2D, Spine, picture. `who` is a contact id or 'self' (the player's own figure, resolved from the player name as the
    // phone's directory resolves it; no figure: null, never a guess). Descriptors only; the page's resource owner leases them.
    async figure({sessionId, who, emotion, at, origin}) {
      const found = await phoneCallHost.character({sessionId, who, emotion, at, origin})
      return {figure:found ? await found.presentation.materialize(found.character, {stage:true, portrait:false, descriptors:true}) : null}
    },
    async character({sessionId, who, emotion, at, origin}) {
      const scene = await phoneCallHost.scene({sessionId, at, origin})
      return scene && phoneCallHost.cast(scene, who, emotion)
    },
    // The call page's stage, read once for every figure on it: presentation, the director state at `at` and the figure
    // index. null: the phone is off or the card has no stage figures.
    async scene({sessionId, at, origin}, read) {
      const {chat, directory, consumer} = read || await phoneCallHost.read(sessionId, origin)
      if (!directory.enabled || !consumer?.presentation.available()) return null
      const turn = Number(at?.turn) || chat.messages.filter(row => row.role === 'assistant').map(row => Number(row.turn || (row.greeting ? 1 : 0))).at(-1) || 1
      const direction = await stageDirector.get(chat, turn, null, {readOnly:true}), record = direction.record || direction.preview
      const state = record ? (record.entries.filter(entry => !at?.para || entry.at <= at.para).at(-1)?.state || record.baseline) : null
      const presentation = consumer.presentation
      await presentation.sync(consumer.allowedPackIds.map(packId => ({packId})))
      const figureRows = await presentation.figureRows(state?.actors || {})
      const live2d = await figureRuntimes.available('live2d'), spine = await figureRuntimes.available('spine')
      return {directory, presentation, state, figureRows, live2d, spine}
    },
    async cast({directory, presentation, state, figureRows, live2d, spine}, who, emotion) {
      const alias = who === 'self' ? directory.playerId : directory.contacts.some(row => row.id === who) ? who : null
      if (!alias) return null
      // The clause's mood decides her face, not a 差分 the director chose for the stage page.
      const recorded = state?.actors?.[alias], actor = recorded ? {...recorded, stateId:undefined, imageSelection:undefined} : undefined
      const character = actor ? await presentation.character(alias, {actor, historical:true, emotion, live2d, spine, figureRows})
        : await presentation.character(alias, {emotion, live2d, spine, figureRows})
      return ['live2d','spine','sprite'].includes(character.form) ? {character, presentation} : null
    },
    readiness:() => speechRecognition.readiness(),
    async listening() {
      if (!(await speechRecognition.readiness()).available) throw new Error('语音识别尚未就绪，请检查识别服务设置')
    },
    async hear({audio, language}) {
      try {
        const pcm = recognitionAudio(audio)
        const [result,endpoint] = await Promise.all([
          // The snapshot's words become the player's line: a server's declared final model reads them.
          speechRecognition.service.recognize({audio:pcm,language,final:true}),
          speechRecognition.service.endpoint({audio:pcm}),
        ])
        // No turn detector (endpoint null): the call judges the end by the pause alone.
        return {...result, endpoint, ending:endpoint?.probability >= 0.95 ? 'complete' : 'open', asrMs:result.modelMs}
      } catch (error) { throw Object.assign(new Error('语音识别暂时不可用，请检查识别服务设置'), {code:error.code}) }
    },
  }

  return {stagePhoneDirectory, phoneCallHost}
}

// The phone's stage service (stage contribution hostExtension, stage-extensions.js). Its requests are built with the
// stage's request bindings (chats, models, speech, recognition, hostLibrary); work() reports live calls to deployment.
export function createPhoneExtension(core) {
  return {requests(bindings) {
    const phone = createStagePhoneHost(Object.create(bindings, {ctx:{value:core.ctx}}))
    const deps = Object.create(bindings, {stagePhoneDirectory:{value:phone.stagePhoneDirectory}, phoneCallHost:{value:phone.phoneCallHost}})
    const handlers = {
    async getStagePhoneThreads(args, method, serverTemplate, authority) {
      const { readStageChat, stagePhoneDirectory } = deps

        const chat=await readStageChat.view(args.sessionId)
        return chat?stagePhoneDirectory(chat):{enabled:false,contacts:[],threads:[]}

    },
    // one contact's call, its own context window.
    async phoneCallStart(args, method, serverTemplate, authority) {
      return deps.phoneCallHost.startByContact({sessionId:args.sessionId, contactId:String(args.contactId || ''), origin:authority?.origin, at:args.at})
    },
    async phoneCallHear(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.hear({audio:args.audio, language:args.language})
    },
    async phoneCallTurn(args) {
      const { phoneCallHost, readStageChat } = deps
      const said = String(args.said || '').trim()
      if (!said) throw new Error('没有听清')
      // The call is anchored to the latest round; its recent-story section reads its own view.
      // note: the camera's quiet line for the model (FaceTime), never in the transcript.
      const note = typeof args.note === 'string' ? args.note.slice(0, 200) : ''
      return phoneCallHost.calls.turn({sessionId:args.sessionId, callId:args.callId, said, note, cue:args.cue === true, timing:args.timing, chat:await readStageChat.view(args.sessionId,{configOnly:true})})
    },
    // the call turned into a video call (its record), and a call
    // party's stage figure (`who`: a contact id or 'self') in the outfit of the page it was made from and the clause's mood.
    async phoneCallVideo(args) {
      return deps.phoneCallHost.calls.video({sessionId:args.sessionId, callId:args.callId})
    },
    async phoneCallFigure(args, method, serverTemplate, authority) {
      const at = args.at && Number.isSafeInteger(args.at.turn) && args.at.turn > 0 ? {turn:args.at.turn, ...(Number.isSafeInteger(args.at.para) && args.at.para > 0 ? {para:args.at.para} : {})} : null
      return deps.phoneCallHost.figure({sessionId:args.sessionId, who:String(args.who || ''), emotion:typeof args.emotion === 'string' && args.emotion ? args.emotion : undefined, at, origin:authority?.origin})
    },
    async phoneCallPoll(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.poll({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, says:Number(args.says) || 0, subs:Number(args.subs) || 0, waitMs:Number(args.waitMs) || 0})
    },
    async phoneCallAlive(args) {
      return deps.phoneCallHost.calls.alive({sessionId:args.sessionId, callId:args.callId})
    },
    // her cached greeting sounded as she picked up: it enters the call's record
    async phoneCallGreeted(args) {
      return deps.phoneCallHost.calls.greeted({sessionId:args.sessionId, callId:args.callId})
    },
    async phoneCallTtsRequested(args, method, serverTemplate, authority) {
      return deps.phoneCallHost.calls.ttsRequested({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, origin:authority?.origin})
    },
    async phoneCallHeard(args) {
      return deps.phoneCallHost.calls.heard({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing})
    },
    async phoneCallInterrupt(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.interrupt({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing, retract:args.retract === true})
    },
    async phoneCallEnd(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.end({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing})
    },
    async phoneCallThreads(args, method, serverTemplate, authority) {
      const { phoneCallHost, readStageChat } = deps
      // Dev diagnostics: each phase's wall time, logged and returned as `timing`.
      const started = performance.now(), timing = {}
      const timed = async (name, work) => { const at = performance.now(); try { return await work } finally { timing[name] = Math.round(performance.now() - at) } }
      const chat = await timed('chatMs', readStageChat.view(args.sessionId,{configOnly:true}))
      // The call button shows only where calls can work: local speech recognition answering (started here when it is set
      // up but not running; `starting` asks the page to look again). `voices`: the phone's 电话 app also asks which
      // contacts have a voice to call with.
      const readiness = chat ? await timed('readinessMs', phoneCallHost.readiness()) : {available:false}
      if (!chat) return {threads:{}, ...readiness}
      const [calls, facts] = await Promise.all([timed('callsMs', phoneCallHost.calls.threads({chat})),
        args.voices === true ? timed('contactsMs', phoneCallHost.directoryFacts(args.sessionId, authority?.origin)) : null])
      timing.totalMs = Math.round(performance.now() - started)
      if (facts) { timing.contacts = Object.keys(facts.voices).length; console.info('[dsh-tavern.phone-directory]', JSON.stringify(timing)) }
      // The 电话 app opened: the contacts called before in this chat get their pick-up greeting ready in idle time.
      if (facts) phoneCallHost.wantGreetings({sessionId:args.sessionId, origin:authority?.origin, contactIds:Object.keys(calls.threads).filter(id => facts.voices[id])})
      return {...calls, ...(facts || {}), ...readiness, timing}
    }
    }
    return {methods:Object.keys(handlers), call:(method, args, authority) => handlers[method](args, method, false, authority),
      work:() => ({calls:phone.phoneCallHost.calls.activeCount()})}
  }}
}