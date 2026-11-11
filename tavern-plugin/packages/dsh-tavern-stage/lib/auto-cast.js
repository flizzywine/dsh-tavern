import {createHash} from 'node:crypto'
import resolution from '../../dsh-presentation-protocol/src/figure-resolution.cjs'
import {matchBubbleMood} from '../../dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {planAutoFigures} from './domain/auto-figure.js'
import {emptyAutoCastRecord, noteRound, planAutoCast, jobKey, figureKey, jobReady, jobFailed, jobsLanded, channelOpaque, channelDrawsSprites, noteCasting, castDrawn} from './domain/auto-cast-queue.js'

const {resolveFigureName} = resolution
const ROOT = 'auto-cast/', INDEX = ROOT + 'index.json', PER_CARD = 2
const recordPath = cardId => ROOT + sha(cardId).slice(0, 32) + '.json'
const sha = text => createHash('sha256').update(text).digest('hex')
// 人设图 (主人 11-11 选 C): front and back of the whole body plus part close-ups, in one board; the back serves CG and 配图.
export const SETTEI_VIEWS = 'Lay the board out as a full-body front view and a full-body back view side by side, with close-ups of the face, hair and signature parts.'
// A check that sends the picture back once; the second picture is used whatever it shows (主人: 不过就重做一次，再不过就用这张).
const REDRAW = new Set(['EMPTY_IMAGE', 'EDGE_CONTACT', 'LOW_RESOLUTION', 'ASPECT_MISMATCH'])
const joinTraits = traits => [traits.face, traits.bodySFW].filter(Boolean).join('；')

// One committed round's requests: every line whose speaker resolves (the shared resolver, over the card's whole cast) to a
// figure of the automatic pack, with the figure emotion its mood names (null: none written or none matched).
export function roundRequests(body, cast) {
  const requests = []
  for (const paragraph of body.paragraphs || []) {
    const segment = paragraph.segment
    if (paragraph.kind !== 'line' || paragraph.pending || !segment) continue
    const found = resolveFigureName(cast.rows, {...segment, ...(paragraph.figureId ? {figureId:paragraph.figureId, packId:paragraph.packId} : {})})
    if (found.status !== 'resolved' || found.row.ref.packId !== cast.packId) continue
    const figure = cast.figures.find(row => row.ref.figureId === found.row.ref.figureId)
    requests.push({ref:figure.ref, emotionId:segment.mood ? matchBubbleMood(segment.mood, figure.emotions || [])?.id ?? null : null})
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
      changes.push({op:'create', kind:'figures', value:{name, aliases}, ...(voice ? {voice:voice.from ? {from:voice.from} : {spec:voice.spec}} : {})})
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

// 自动选角's runtime: each committed round, the 选角助理 decides about the new speakers and they are
// written at once (copied, or created with their voice); then the round's requests are counted and the queue's best jobs are
// drawn on the image plugin's channel (at most PER_CARD at a time per card). A picture stays on disk until it lands; the ready
// pictures of a card land together while no director runs. Never in the way of the story: errors stay in the record and log.
// store: profile data; settings(cardPath) → {enabled, level} in effect; library: auto-cast-library.js; images: {prompt,
// generate, status, check} (the plugin image entry's automatic prompt, picture and cheap checks); idle() resolves once no director runs; cast({cardPath, chat, speakers, cast}) → the assistant's decisions.
export function createAutoCast({store, settings, library, images, idle, cast:castAssistant = null, now = Date.now, onError = () => {}}) {
  let active = true, chain = Promise.resolve()
  const records = new Map(), busy = new Map(), pumps = new Map(), landing = new Map(), controllers = new Set()
  const serial = task => { const next = chain.then(task); chain = next.catch(() => {}); return next }
  const read = async cardId => records.get(cardId) || {...emptyAutoCastRecord(), ...await store.readJson(recordPath(cardId))}
  const update = (cardId, change) => serial(async () => {
    const next = change(await read(cardId))
    records.set(cardId, next)
    await store.writeJson(recordPath(cardId), next)
    return next
  })
  const remember = (cardId, cardPath) => serial(() => store.updateJson(INDEX, index => ({...index, [cardId]:cardPath})))
  // The cast as the queue sees it: copied figures are not drawn; a 人设图 drawn and not yet landed already counts.
  const castFor = (cast, record) => cast.figures.filter(figure => castDrawn(record, figure)).map(figure => ({...figure,
    settei:figure.settei || record.jobs[jobKey({kind:'identity-settei', ref:figure.ref})]?.status === 'ready'}))

  async function draw(cast, job, channel) {
    const figure = cast.figures.find(row => row.ref.figureId === job.ref.figureId), record = await read(cast.cardId)
    const pictures = []
    if (job.kind === 'sprite') {
      const ready = record.jobs[jobKey({kind:'identity-settei', ref:job.ref})]
      pictures.push({data:ready?.status === 'ready' ? await store.readBytes(ready.file) : await library.readMedia({packId:cast.packId, expectedRevision:cast.revision, hash:figure.setteiHash}), mediaType:'image/png'})
    }
    // 外貌: the figure's 人物库 record's; the 选角助理's text stands in while the record has none.
    const pending = record.appearance?.[figureKey(job.ref)]
    const {prompt, output} = await images.prompt({kind:job.kind, figure:{ref:job.ref, name:figure.name, emotions:figure.emotions}, appearance:pending ? joinTraits(pending) : '',
      emotionId:job.emotionId, userPrompt:job.kind === 'identity-settei' ? SETTEI_VIEWS : '', fromSettei:job.kind === 'sprite'})
    const [width, height] = output.size.split('x').map(Number), controller = new AbortController()
    controllers.add(controller)
    try {
      for (let attempt = 0; ; attempt++) {
        const reply = await images.generate({prompt, width, height, background:output.background, quality:output.quality, references:pictures, signal:controller.signal})
        if (!active) return
        if (reply.mediaType !== 'image/png') throw Object.assign(new Error('生图渠道没有返回 PNG'), {code:'GENERATION_FAILED'})
        const data = Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength), checks = images.check(data, job.kind)
        if (job.kind === 'sprite' && !checks.hasTransparency) {
          // This channel draws no transparent picture: no more 立绘 for it.
          await update(cast.cardId, current => jobFailed(channelOpaque(current, channel), job, now(), 'OPAQUE_CHANNEL'))
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
        const channel = status.channel ?? status.model ?? 'default', record = await read(cast.cardId)
        const jobs = planAutoCast(record, castFor(cast, record), choice.level, {busy:new Set(running.keys()), sprites:channelDrawsSprites(record, channel, status), now:now()})
        if (!jobs.length && !running.size) return
        for (const job of jobs.slice(0, PER_CARD - running.size)) {
          const key = jobKey(job)
          running.set(key, draw(cast, job, channel)
            .catch(error => { onError(error); return update(cast.cardId, current => jobFailed(current, job, now(), error.code ? error.code + ': ' + error.message : error)) })
            .finally(() => { running.delete(key); void land(cardPath) }))
        }
        if (!running.size) return
        await Promise.race(running.values())
      }
    })().catch(onError).finally(() => pumps.delete(cardPath))
    pumps.set(cardPath, task)
    return task
  }

  // Every ready picture of the card in one write, once no director runs (a pack write stops a running director). A picture
  // whose place was filled meanwhile (the owner, another write) or whose figure is gone is dropped.
  function land(cardPath) {
    if (!active) return
    const previous = landing.get(cardPath) || Promise.resolve()
    const task = previous.then(async () => {
      await idle()
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
          const change = changes.get(figureKey(job.ref)) || {op:'patch', kind:'figures', ref:{packId:job.ref.packId, kind:'figures', figureId:job.ref.figureId}}
          if (job.kind === 'sprite') change.sprites = [...(change.sprites || []), {emotion:job.emotionId, image:'i' + index}]
          else change.settei = {image:'i' + index}
          changes.set(figureKey(job.ref), change)
        }
        await library.write({cardPath, changes:[...changes.values()], images:images_, source:record.source, requestId:sha(JSON.stringify(pictures.map(job => [jobKey(job), job.file])))})
      }
      await update(cast.cardId, current => jobsLanded(current, ready))
      for (const job of ready) await store.remove(job.file)
      void pump(cardPath)
    }).catch(onError)
    landing.set(cardPath, task)
    void task.finally(() => { if (landing.get(cardPath) === task) landing.delete(cardPath) })
    return task
  }

  const handles = async cardPath => active && library.writable() && (await settings(cardPath))?.enabled === true
  return {
    // Whether 自动选角 takes this card's new speakers (自动建人物 then leaves them to it).
    handles,
    // A committed round: cast and write its new speakers, count its requests, then draw. The card's opening (`opening`)
    // counts only from 积极 up: 晚一轮 waits for what the story itself asks. A round seen again (the same message of the
    // same branch) is not counted twice.
    async round(cardPath, body, chat, {opening = false} = {}) {
      const choice = active && library.writable() && await settings(cardPath)
      if (!choice?.enabled || opening && choice.level === 'late') return
      let cast = await library.readCast(cardPath)
      if (!cast) return
      const source = sourceOf(chat, body), last = (await read(cast.cardId)).source
      if (last && ['chatId', 'branchId', 'messageId'].every(key => last[key] === source[key])) return
      await remember(cast.cardId, cardPath)
      const speakers = newSpeakers(body, cast, await read(cast.cardId), {actorKey:'player', name:chat.macroState?.userName?.trim() || '你', aliases:[]})
      if (speakers.length && active) {
        const decided = castAssistant ? await castAssistant({cardPath, chat, speakers, cast}).catch(error => { onError(error); return null }) : null
        const plan = castChanges(speakers, decided)
        const written = plan.changes.length ? await library.write({cardPath, changes:plan.changes, sources:plan.sources, source, requestId:sha(JSON.stringify([source, plan.changes]))}) : {refs:[]}
        await update(cast.cardId, current => noteCasting(current, plan.entries.map((entry, index) => ({...entry, ref:written.refs[index]})), decided?.same || {}))
        cast = await library.readCast(cardPath)
      }
      await update(cast.cardId, current => ({...noteRound(current, roundRequests(body, cast), cast.figures), source}))
      return pump(cardPath)
    },
    // After a restart: land what was drawn and continue the queue of every card that has one.
    async resume() {
      const index = await store.readJson(INDEX) || {}
      for (const cardPath of new Set(Object.values(index))) { void land(cardPath); void pump(cardPath) }
    },
    pending:() => [...busy.values()].reduce((sum, running) => sum + running.size, 0),
    dispose() { active = false; library.dispose?.(); for (const controller of controllers) controller.abort() }
  }
}
