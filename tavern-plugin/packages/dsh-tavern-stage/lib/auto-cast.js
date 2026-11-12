import {createHash} from 'node:crypto'
import resolution from '../../dsh-presentation-protocol/src/figure-resolution.cjs'
import {matchBubbleMood} from '../../dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {planAutoFigures} from './domain/auto-figure.js'
import {emptyAutoCastRecord, noteRound, planAutoCast, jobKey, figureKey, jobReady, jobFailed, jobsLanded, channelOpaque, channelDrawsSprites, noteCasting, castDrawn, noteDrawn, noteWriteFailure, autoCastProblem, looksDelivered, wantSettei, setteiGivenUp} from './domain/auto-cast-queue.js'

const {resolveFigureName} = resolution
const ROOT = 'auto-cast/', INDEX = ROOT + 'index.json', PER_CARD = 2
// How long a CG of the image plugin waits: for a round's casting (the 选角助理, about 20 s), for a 人设图 (50–100 s, after
// the card's pictures in flight).
const CAST_WAIT_MS = 90_000, SETTEI_WAIT_MS = 300_000
const recordPath = cardId => ROOT + sha(cardId).slice(0, 32) + '.json'
const sha = text => createHash('sha256').update(text).digest('hex')
// 人设图 (主人 11-11 选 C): front and back of the whole body plus part close-ups, in one board; the back serves CG and 配图.
export const SETTEI_VIEWS = 'Lay the board out as a full-body front view and a full-body back view side by side, with close-ups of the face, hair and signature parts.'
// A check that sends the picture back once; the second picture is used whatever it shows (主人: 不过就重做一次，再不过就用这张).
const REDRAW = new Set(['EMPTY_IMAGE', 'EDGE_CONTACT', 'LOW_RESOLUTION', 'ASPECT_MISMATCH'])
const joinTraits = traits => [traits.face, traits.bodySFW].filter(Boolean).join('；')

// One committed round's requests: every line whose speaker resolves (the shared resolver, over the card's whole cast) to a
// figure of the automatic pack, with the figure emotion its mood names (null: none matched); a line with no mood shows the
// figure's default emotion, so that is what it asks for.
export function roundRequests(body, cast) {
  const requests = []
  for (const paragraph of body.paragraphs || []) {
    const segment = paragraph.segment
    if (paragraph.kind !== 'line' || paragraph.pending || !segment) continue
    const found = resolveFigureName(cast.rows, {...segment, ...(paragraph.figureId ? {figureId:paragraph.figureId, packId:paragraph.packId} : {})})
    if (found.status !== 'resolved' || found.row.ref.packId !== cast.packId) continue
    const figure = cast.figures.find(row => row.ref.figureId === found.row.ref.figureId)
    requests.push({ref:figure.ref, emotionId:segment.mood ? matchBubbleMood(segment.mood, figure.emotions || [])?.id ?? null : figure.defaultEmotion})
  }
  return requests
}

// The round's new speakers (the shared planner, as 自动建人物), less the names the 选角助理 already found to be an existing
// figure under another name.
export function newSpeakers(body, cast, record, playerIdentity) {
  const same = Object.keys(record.same || {}).map((name, i) => ({actorKey:'same-' + i, name, aliases:[], enabled:true}))
  return planAutoFigures({body, figureRows:cast.rows, playerIdentity}).creates.filter(row => resolveFigureName(same, {name:row.name}).status !== 'resolved')
}

// The 选角助理's decisions as one write: each speaker not found to be an existing figure is copied from the library or
// created (with its voice: a library voice copied, or a 配音后端 voice's spec). → {changes, sources, entries:[{name, copied, appearance}]}.
export function castChanges(speakers, decided) {
  const changes = [], sources = [], entries = []
  for (const {name, aliases} of speakers) {
    if (decided?.same[name]) continue
    const copy = decided?.copy[name], voice = decided?.voice[name]
    if (copy) { changes.push({op:'copy', kind:'figures', source:copy.source, patch:{name, aliases}}); sources.push({packId:copy.source.packId, revision:copy.revision}) }
    else {
      // 外貌 goes with the figure to its 配图 人物库 record (looks), its 人物介绍 into the pack (description).
      const looks = decided?.appearance[name], about = decided?.about?.[name]
      changes.push({op:'create', kind:'figures', value:{name, aliases, ...(about ? {description:about} : {})}, ...(looks ? {looks} : {}),
        ...(voice ? {voice:voice.from ? {from:voice.from} : {spec:voice.spec}} : {})})
      if (voice?.from) sources.push({packId:voice.from.packId, revision:voice.revision})
    }
    entries.push({name, copied:!!copy, ...(!copy && decided?.appearance[name] ? {appearance:decided.appearance[name]} : {})})
  }
  return {changes, sources, entries}
}

// The source a write serves (the library's automatic source): the committed round.
const sourceOf = (chat, body) => {
  const message = chat.messages.findLast(row => row.role === 'assistant'), turn = Number(message.turn || (message.greeting ? 1 : 0))
  return {chatId:chat.id, branchId:chat.timeline.branchId, revision:chat.timeline.revision, turn, messageId:message.id || 'turn:' + turn, paragraphIds:body.paragraphs.map(row => row.paragraphId)}
}

// The key colour for a channel without transparency (as Dot's deliveries): green, magenta for a figure that wears green.
const keyColor = (figure, pending) => /绿|green/i.test([figure.name, figure.identityAppearance, pending && joinTraits(pending)].filter(Boolean).join(' ')) ? '#FF00FF' : '#00FF00'
const keyBackground = key => 'Background: one flat solid ' + key + ' colour filling the whole canvas, no shadow, gradient or floor; keep that colour out of the character.'

// 自动选角's runtime: each committed round, the 选角助理 decides about the new speakers and they are
// written at once (copied, or created with their voice); then the round's requests are counted and the queue's best jobs are
// drawn on the image plugin's channel (at most PER_CARD at a time per card). A picture stays on disk until it lands; the ready
// pictures of a card land together. Never in the way of the story: errors stay in the record and log.
// store: profile data; settings(cardPath) → {enabled, level} in effect; library: auto-cast-library.js; images: {prompt,
// generate, status, check, matte?} (the plugin image entry's automatic prompt, picture and cheap checks; matte({data, key}) → a transparent PNG,
// the local keying of a channel that cannot draw transparent pictures — not wired yet);
// cast({cardPath, chat, speakers, cast}) → the assistant's decisions.
export function createAutoCast({store, settings, library, images, cast:castAssistant = null, now = Date.now, onError = () => {}}) {
  let active = true, chain = Promise.resolve()
  const records = new Map(), busy = new Map(), pumps = new Map(), landing = new Map(), controllers = new Set()
  // sessionId → the last turn round() has finished with; the waits of awaitCast and awaitSettei, tried again on every change.
  const castTurns = new Map(), waits = new Set()
  const wake = () => { for (const wait of [...waits]) wait() }
  const until = (check, ms, signal) => new Promise(resolve => {
    const done = () => { clearTimeout(timer); waits.delete(test); signal?.removeEventListener('abort', done); resolve() }
    const test = () => void Promise.resolve().then(check).then(ok => ok && done(), done)
    const timer = setTimeout(done, ms)
    waits.add(test); signal?.addEventListener('abort', done, {once:true}); test()
  })
  const serial = task => { const next = chain.then(task); chain = next.catch(() => {}); return next }
  const read = async cardId => records.get(cardId) || {...emptyAutoCastRecord(), ...await store.readJson(recordPath(cardId))}
  const update = (cardId, change) => serial(async () => {
    const next = change(await read(cardId))
    records.set(cardId, next)
    await store.writeJson(recordPath(cardId), next)
    wake()
    return next
  })
  const remember = (cardId, cardPath) => serial(() => store.updateJson(INDEX, index => ({...index, [cardId]:cardPath})))
  // The cast as the queue sees it: copied figures are not drawn; a 人设图 drawn and not yet landed already counts.
  const castFor = (cast, record) => cast.figures.filter(figure => castDrawn(record, figure)).map(figure => ({...figure,
    settei:figure.settei || record.jobs[jobKey({kind:'identity-settei', ref:figure.ref})]?.status === 'ready'}))

  // keyed: the channel draws no transparent picture, so a 立绘 is drawn on a flat key colour and keyed out here (images.matte).
  async function draw(cast, job, channel, keyed) {
    const figure = cast.figures.find(row => row.ref.figureId === job.ref.figureId), record = await read(cast.cardId)
    const pictures = []
    if (job.kind === 'sprite') {
      const ready = record.jobs[jobKey({kind:'identity-settei', ref:job.ref})]
      pictures.push({data:ready?.status === 'ready' ? await store.readBytes(ready.file) : await library.readMedia({packId:cast.packId, hash:figure.setteiHash}), mediaType:'image/png'})
    }
    // 外貌: the figure's 人物库 record's; the 选角助理's text stands in while the record has none.
    const pending = record.appearance?.[figureKey(job.ref)]
    const {prompt:base, output} = await images.prompt({kind:job.kind, figure:{ref:job.ref, name:figure.name, emotions:figure.emotions}, appearance:pending ? joinTraits(pending) : '',
      emotionId:job.emotionId, userPrompt:job.kind === 'identity-settei' ? SETTEI_VIEWS : '', fromSettei:job.kind === 'sprite'})
    const key = keyed && job.kind === 'sprite' ? keyColor(figure, pending) : null
    const prompt = key ? base + '\n\n' + keyBackground(key) : base
    const [width, height] = output.size.split('x').map(Number), controller = new AbortController()
    // Every call is kept (drawn): what, how long, and its cost when the image entry returns one.
    const generate = async input => {
      const at = now(), entry = {kind:job.kind, ref:job.ref, emotionId:job.emotionId ?? null, channel, at}
      try {
        const reply = await images.generate(input)
        await update(cast.cardId, current => noteDrawn(current, {...entry, ms:now() - at, ...(reply.cost ? {cost:reply.cost} : {})}))
        return reply
      } catch (error) { await update(cast.cardId, current => noteDrawn(current, {...entry, ms:now() - at, failed:true})); throw error }
    }
    controllers.add(controller)
    try {
      for (let attempt = 0; ; attempt++) {
        const reply = await generate({prompt, width, height, background:key ? 'opaque' : output.background, quality:output.quality, references:pictures, signal:controller.signal})
        if (!active) return
        if (reply.mediaType !== 'image/png') throw Object.assign(new Error('生图渠道没有返回 PNG'), {code:'GENERATION_FAILED'})
        const drawn = Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength)
        const data = key ? Buffer.from(await images.matte({data:drawn, key})) : drawn, checks = images.check(data, job.kind)
        if (key && !checks.hasTransparency) { await update(cast.cardId, current => jobFailed(current, job, now(), 'MATTE_FAILED', channel)); return }
        if (job.kind === 'sprite' && !checks.hasTransparency) {
          // This channel draws no transparent picture: no more 立绘 for it.
          await update(cast.cardId, current => jobFailed(channelOpaque(current, channel), job, now(), 'OPAQUE_CHANNEL', channel))
          return
        }
        if (attempt === 0 && checks.warnings.some(row => REDRAW.has(row.code))) continue
        const file = ROOT + sha(cast.cardId).slice(0, 32) + '/' + sha(jobKey(job)) + '.png'
        await store.writeBytes(file, data)
        await update(cast.cardId, current => jobReady(current, job, file, now()))
        return
      }
    } finally { controllers.delete(controller) }
  }

  // At most PER_CARD pictures at a time per card; a finished one lands and the queue is planned again.
  function pump(cardPath) {
    if (!active || pumps.has(cardPath)) return pumps.get(cardPath)
    const running = busy.get(cardPath) || new Map()
    busy.set(cardPath, running)
    const task = (async () => {
      while (active) {
        const choice = await settings(cardPath)
        if (!choice?.enabled || !library.writable()) return
        const cast = await library.readCast(cardPath), status = await images.status()
        if (!cast?.packId || !status?.ready) return
        // The channel as status() names it (its id, its model): a pause after failures is this channel's alone.
        const channel = [status.channel, status.model].filter(Boolean).join('/') || 'default', record = await read(cast.cardId)
        const transparent = channelDrawsSprites(record, channel, status), keyed = !transparent && !!images.matte
        const jobs = planAutoCast(record, castFor(cast, record), choice.level, {busy:new Set(running.keys()), sprites:transparent || keyed, now:now(), channel})
        if (!jobs.length && !running.size) return
        for (const job of jobs.slice(0, PER_CARD - running.size)) {
          const key = jobKey(job)
          running.set(key, draw(cast, job, channel, keyed)
            .catch(error => { onError(error); return update(cast.cardId, current => jobFailed(current, job, now(), error.code ? error.code + ': ' + error.message : error, channel)) })
            .finally(() => { running.delete(key); void land(cardPath) }))
        }
        if (!running.size) return
        await Promise.race(running.values())
      }
    })().catch(onError).finally(() => pumps.delete(cardPath))
    pumps.set(cardPath, task)
    return task
  }

  // Every ready picture of the card in one write, at once (a running director finishes on the assets it started with). A picture
  // whose place was filled meanwhile (the owner, another write) or whose figure is gone is dropped.
  function land(cardPath) {
    if (!active) return
    const previous = landing.get(cardPath) || Promise.resolve()
    const task = previous.then(async () => {
      const cast = active && await library.readCast(cardPath)
      if (!cast?.packId) return
      const record = await read(cast.cardId), ready = Object.values(record.jobs).filter(job => job.status === 'ready')
      const open = job => { const figure = cast.figures.find(row => figureKey(row.ref) === figureKey(job.ref)); return figure && (job.kind === 'sprite' ? !figure.sprites.includes(job.emotionId) : !figure.settei) }
      const pictures = ready.filter(open)
      if (!ready.length || !record.source) return
      if (pictures.length) {
        const images_ = {}, changes = new Map()
        for (const [index, job] of pictures.entries()) {
          images_['i' + index] = await store.readBytes(job.file)
          // the 外貌 still waiting in the record goes with the figure's pictures to its 人物库 record (the one home), then leaves the record
          const looks = record.appearance?.[figureKey(job.ref)]
          const change = changes.get(figureKey(job.ref)) || {op:'patch', kind:'figures', ref:{packId:job.ref.packId, kind:'figures', figureId:job.ref.figureId}, ...(looks ? {looks} : {})}
          if (job.kind === 'sprite') change.sprites = [...(change.sprites || []), {emotion:job.emotionId, image:'i' + index}]
          else change.settei = {image:'i' + index}
          changes.set(figureKey(job.ref), change)
        }
        await library.write({cardPath, changes:[...changes.values()], images:images_, source:record.source, requestId:sha(JSON.stringify(pictures.map(job => [jobKey(job), job.file])))})
      }
      await update(cast.cardId, current => looksDelivered(jobsLanded(current, ready), pictures.map(job => figureKey(job.ref))))
      for (const job of ready) await store.remove(job.file)
      void pump(cardPath)
    }).catch(onError)
    landing.set(cardPath, task)
    void task.finally(() => { if (landing.get(cardPath) === task) landing.delete(cardPath) })
    return task
  }

  // 外貌 a figure's record still holds after its 人设图 landed: written before 外貌 went with the figure (11-11), so its 人物库 record
  // is empty and 场景配图 drew someone else. One write takes it there (the same looks), then the record drops it.
  async function deliver(cardPath) {
    const cast = active && await library.readCast(cardPath)
    if (!cast?.packId) return
    const record = await read(cast.cardId)
    const waiting = cast.figures.filter(figure => figure.settei && record.appearance?.[figureKey(figure.ref)])
    if (!waiting.length || !record.source) return
    const changes = waiting.map(figure => ({op:'patch', kind:'figures', ref:{packId:figure.ref.packId, kind:'figures', figureId:figure.ref.figureId}, looks:record.appearance[figureKey(figure.ref)]}))
    await library.write({cardPath, changes, source:record.source, requestId:sha(JSON.stringify(['looks', changes]))})
    await update(cast.cardId, current => looksDelivered(current, waiting.map(figure => figureKey(figure.ref))))
  }

  // round()'s work; done() once its speakers are written (before the drawing it starts), so awaitCast does not wait for pictures.
  async function castRound(cardPath, body, chat, opening, done) {
    const choice = active && library.writable() && await settings(cardPath)
    if (!choice?.enabled || opening && choice.level === 'late') return
    let cast = await library.readCast(cardPath)
    if (!cast) return
    const source = sourceOf(chat, body), last = (await read(cast.cardId)).source
    if (last && ['chatId', 'branchId', 'messageId'].every(key => last[key] === source[key])) return
    await remember(cast.cardId, cardPath)
    const speakers = newSpeakers(body, cast, await read(cast.cardId), {actorKey:'player', name:chat.macroState?.userName?.trim() || '你', aliases:[]})
    if (speakers.length && active) {
      let failure = null
      const decided = castAssistant ? await castAssistant({cardPath, chat, speakers, cast}).catch(error => {
        onError(error); failure = {at:now(), error:String(error?.code || error?.message || error).slice(0, 200)}; return null }) : null
      const plan = castChanges(speakers, decided)
      // a write the library refuses is kept for the player (status), not only the host log; the round's speakers are asked again next round
      const written = plan.changes.length ? await library.write({cardPath, changes:plan.changes, sources:plan.sources, source, requestId:sha(JSON.stringify([source, plan.changes]))}).catch(async error => {
        onError(error); await update(cast.cardId, current => noteWriteFailure(current, {at:now(), error:String(error?.code || error?.message || error).slice(0, 200)})); return null }) : {refs:[]}
      if (!written) return
      await update(cast.cardId, current => noteCasting(current, plan.entries.map((entry, index) => ({...entry, ref:written.refs[index]})), decided?.same || {}, failure))
      cast = await library.readCast(cardPath)
    }
    await update(cast.cardId, current => ({...noteRound(current, roundRequests(body, cast), cast.figures), source}))
    done()
    return pump(cardPath)
  }

  const handles = async cardPath => active && library.writable() && (await settings(cardPath))?.enabled === true
  return {
    // Whether 自动选角 takes this card's new speakers (自动建人物 then leaves them to it).
    handles,
    // A committed round: cast and write its new speakers, count its requests, then draw. The card's opening (`opening`)
    // counts only from 积极 up: 晚一轮 waits for what the story itself asks. A round seen again (the same message of the
    // same branch) is not counted twice.
    async round(cardPath, body, chat, {opening = false} = {}) {
      const turn = Number(chat.messages.findLast(row => row.role === 'assistant')?.turn || 0)
      const done = () => { castTurns.set(chat.sessionId, Math.max(castTurns.get(chat.sessionId) || 0, turn)); wake() }
      try { return await castRound(cardPath, body, chat, opening, done) } finally { done() }
    },
    // The image plugin plans a settled turn's CG after this: the people the turn brought in are written (with their 外貌 in
    // their 人物库 record), so the plan names them by their record. At once for a card 自动选角 does not take.
    async awaitCast(cardPath, sessionId, turn, signal) {
      if (await handles(cardPath)) await until(() => (castTurns.get(sessionId) || 0) >= turn, CAST_WAIT_MS, signal)
    },
    // A CG of these figures (refs of the card's 自动生成 pack; others are not ours) waits for their 人设图: each one without is
    // drawn first, and this resolves once it has landed (the host then puts it on the record). → {unavailable: refs whose
    // 人设图 did not come: it failed, or the wait ran out}.
    async awaitSettei(cardPath, refs, signal) {
      const cast = active && await library.readCast(cardPath)
      const pending = () => library.readCast(cardPath).then(async current => {
        const record = await read(cast.cardId), figures = current?.figures || []
        return refs.filter(ref => { const figure = figures.find(row => figureKey(row.ref) === figureKey(ref)); return figure && !figure.settei && castDrawn(record, figure) })
      })
      const waiting = cast?.packId ? await pending() : []
      if (!waiting.length) return {unavailable:[]}
      await update(cast.cardId, current => wantSettei(current, waiting))
      void pump(cardPath)
      await until(async () => { const left = await pending(), record = await read(cast.cardId); return left.every(ref => setteiGivenUp(record, ref, now())) }, SETTEI_WAIT_MS, signal)
      return {unavailable:await pending()}
    },
    // After a restart: land what was drawn and continue the queue of every card that has one.
    async resume() {
      const index = await store.readJson(INDEX) || {}
      for (const cardPath of new Set(Object.values(index))) { void deliver(cardPath).catch(onError).then(() => land(cardPath)); void pump(cardPath) }
    },
    // 自动素材's page: the card's bound packs not installed (their figures are cast anew) and the latest problem (autoCastProblem).
    async status(cardPath) {
      const cast = active && library.writable() && await library.readCast(cardPath)
      return cast ? {missingPacks:cast.missingPackIds.length, problem:autoCastProblem(await read(cast.cardId))} : null
    },
    pending:() => [...busy.values()].reduce((sum, running) => sum + running.size, 0),
    dispose() { active = false; library.dispose?.(); for (const controller of controllers) controller.abort() }
  }
}
