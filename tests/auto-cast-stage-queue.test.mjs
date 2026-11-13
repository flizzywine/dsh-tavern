// 自动选角's generation queue and runtime: priority, dedupe, the cheap checks, landing in
// one write while no director runs, and resuming from the record. Synthetic data only; ids differ from names.
import test from 'node:test'
import assert from 'node:assert/strict'
import {deflateSync} from 'node:zlib'
import {checkAssetImage} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {emptyAutoCastRecord, noteRound, planAutoCast, jobReady, jobFailed, jobsLanded, channelOpaque, channelDrawsSprites, noteDrawn, noteWriteFailure, autoCastProblem, AUTO_CAST_EMOTIONS, wantSettei, setteiGivenUp} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/auto-cast-queue.js'
import {createAutoCast, roundRequests} from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast.js'

const PACK = '11111111-1111-4111-8111-111111111111', OWN = '22222222-2222-4222-8222-222222222222'
const A = {packId:PACK, figureId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}, B = {packId:PACK, figureId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
const figure = (ref, over = {}) => ({ref, settei:false, sprites:[], ...over})
const summary = jobs => jobs.map(job => (job.ref === A || job.ref.figureId === A.figureId ? 'A' : 'B') + ':' + (job.kind === 'sprite' ? job.emotionId : 'settei'))

test('a round counts lines and the misses of emotions without a picture, for automatic figures only', () => {
  const cast = [figure(A, {settei:true, sprites:['calm']})]
  const record = noteRound(emptyAutoCastRecord(), [{ref:A, emotionId:'calm'}, {ref:A, emotionId:'joy'}, {ref:A, emotionId:'joy'}, {ref:A, emotionId:null}, {ref:B, emotionId:'sad'}], cast)
  assert.deepEqual(record.lines, {[PACK + '/' + A.figureId]:4})
  assert.deepEqual(record.misses, {[PACK + '/' + A.figureId]:{joy:2}})
})

test('晚一轮: a figure without any picture gets its 人设图 and first 立绘 first, then requests by misses', () => {
  let record = emptyAutoCastRecord()
  const cast = [figure(A, {settei:true, sprites:['calm']}), figure(B)]
  record = noteRound(record, [{ref:A, emotionId:'joy'}, {ref:A, emotionId:'joy'}, {ref:A, emotionId:'joy'}, {ref:A, emotionId:'sad'}, {ref:B, emotionId:'anxious'}], cast)
  assert.deepEqual(summary(planAutoCast(record, cast, 'late')), ['B:settei', 'A:joy', 'A:sad'], 'B has no picture: its 人设图 leads; its 立绘 waits for it')
  const withSettei = [cast[0], figure(B, {settei:true})]
  assert.deepEqual(summary(planAutoCast(record, withSettei, 'late')), ['B:anxious', 'A:joy', 'A:sad'])
  // the same picture is never planned twice: ready, in flight or failed twice recently.
  const busy = new Set(planAutoCast(record, withSettei, 'late').slice(0, 1).map(job => JSON.stringify(['sprite', PACK, B.figureId, 'anxious'])))
  assert.deepEqual(summary(planAutoCast(record, withSettei, 'late', {busy})), ['A:joy', 'A:sad'])
  const ready = jobReady(record, {kind:'sprite', ref:A, emotionId:'joy'}, 'f.png', 1)
  assert.deepEqual(summary(planAutoCast(ready, withSettei, 'late')), ['B:anxious', 'A:sad'])
  const failed = jobFailed(jobFailed(record, {kind:'sprite', ref:A, emotionId:'sad'}, 10, null, 'old'), {kind:'sprite', ref:A, emotionId:'sad'}, 20, Object.assign(new Error('渠道忙'), {code:'BUSY'}), 'old')
  assert.equal(Object.values(failed.jobs).find(job => job.emotionId === 'sad').error, 'BUSY', 'why it failed stays with the job')
  assert.deepEqual(summary(planAutoCast(failed, withSettei, 'late', {now:30, channel:'old'})), ['B:anxious', 'A:joy'])
  assert.deepEqual(summary(planAutoCast(failed, withSettei, 'late', {now:30, channel:'new'})), ['B:anxious', 'A:joy', 'A:sad'], 'another channel or model tries at once')
  assert.equal(Object.values(jobFailed(failed, {kind:'sprite', ref:A, emotionId:'sad'}, 40, null, 'new').jobs).find(job => job.emotionId === 'sad').failures, 1, 'and counts its own failures')
  assert.deepEqual(summary(planAutoCast(failed, withSettei, 'late', {now:20 + 31 * 60_000, channel:'old'})), ['B:anxious', 'A:joy', 'A:sad'], 'tried again after a pause')
  assert.deepEqual(summary(planAutoCast(record, withSettei, 'late', {sprites:false})), [], 'no 立绘 for a channel without transparency')
  const landed = jobsLanded(record, [{kind:'sprite', ref:A, emotionId:'joy'}])
  assert.equal(landed.misses[PACK + '/' + A.figureId].joy, undefined)
})

test('a CG waiting for a figure puts its 人设图 first, even when it never spoke; two failures in a row give it up for the pause', () => {
  const cast = [figure(A, {settei:true, sprites:['calm']}), figure(B)]
  const record = wantSettei(noteRound(emptyAutoCastRecord(), [{ref:A, emotionId:'joy'}], cast), [B])
  assert.deepEqual(summary(planAutoCast(record, cast, 'late')), ['B:settei', 'A:joy'], 'B never spoke: only its 人设图, no 立绘')
  assert.deepEqual(summary(planAutoCast(record, [cast[0], figure(B, {settei:true})], 'late')), ['A:joy'], 'once it has one, nothing more for B')
  const once = jobFailed(record, {kind:'identity-settei', ref:B}, 10, null, 'm')
  assert.equal(setteiGivenUp(once, B, 20), false)
  const twice = jobFailed(once, {kind:'identity-settei', ref:B}, 20, null, 'm')
  assert.equal(setteiGivenUp(twice, B, 30), true)
  assert.equal(setteiGivenUp(twice, B, 20 + 31 * 60_000), false, 'tried again after the pause')
})

test('积极: the common three for each figure in turn (more lines first), then the rest; 全部 reaches figures who never spoke', () => {
  const cast = [figure(A, {settei:true, sprites:['calm']}), figure(B, {settei:true, sprites:[]})]
  const record = noteRound(emptyAutoCastRecord(), [{ref:B, emotionId:null}, {ref:B, emotionId:null}, {ref:A, emotionId:null}], cast)
  const eager = summary(planAutoCast(record, cast, 'eager'))
  assert.deepEqual(eager.slice(0, 5), ['B:calm', 'B:anxious', 'B:joy', 'A:anxious', 'A:joy'])
  assert.deepEqual(eager.slice(5, 7), ['B:sad', 'B:shy'])
  assert.equal(eager.length, 5 + 6 + 6)
  const quiet = emptyAutoCastRecord()
  assert.deepEqual(planAutoCast(quiet, cast, 'eager'), [], 'nobody spoke')
  assert.equal(summary(planAutoCast(quiet, cast, 'all'))[0], 'A:anxious')
  assert.deepEqual(AUTO_CAST_EMOTIONS.slice(0, 3), ['calm', 'anxious', 'joy'])
})

test('a channel that drew an opaque 立绘 gets no more 立绘; status() may say so first', () => {
  assert.equal(channelDrawsSprites(emptyAutoCastRecord(), 'm', {transparent:true}), true)
  assert.equal(channelDrawsSprites(emptyAutoCastRecord(), 'm', {transparent:false}), false)
  assert.equal(channelDrawsSprites(channelOpaque(emptyAutoCastRecord(), 'm'), 'm', {}), false)
  assert.equal(channelDrawsSprites(channelOpaque(emptyAutoCastRecord(), 'm'), 'other', {}), true)
})

// ---------- runtime ----------
function crc32(bytes) {
  let crc = ~0
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc >>> 1 ^ 0xedb88320 & -(crc & 1) }
  return ~crc >>> 0
}
// width × height RGBA; `paint(x, y)` → [r,g,b,a].
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4)
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const settei = () => png(768, 512, (x, y) => [x % 255, y % 255, 90, 255])
const sprite = ({edge = false, opaque = false} = {}) => png(512, 768, (x, y) => opaque || (edge ? x < 300 : x > 100 && x < 400 && y > 40 && y < 700) ? [200, 100, 50, 255] : [0, 0, 0, 0])
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function settle(predicate) { for (let i = 0; i < 200 && !predicate(); i++) await tick() }

function harness({replies, transparent, matte, cost, refuse, failDraw} = {}) {
  const files = new Map(), writes = [], prompts = [], generated = []
  const store = {readJson:async key => files.has(key) ? structuredClone(files.get(key)) : null, writeJson:async (key, value) => files.set(key, structuredClone(value)),
    updateJson:async (key, fn) => files.set(key, fn(files.get(key) ?? null)), readBytes:async key => files.get(key) ?? null, writeBytes:async (key, data) => files.set(key, Buffer.from(data)), remove:async key => files.delete(key)}
  const state = {figures:[{ref:A, name:'甲', aliases:[], emotions:[{id:'calm', label:'平和'}, {id:'joy', label:'喜悦'}], settei:false, setteiHash:null, sprites:[], identityAppearance:'黑发'}]}
  let held = null
  const library = {writable:() => true,
    readCast:async () => ({cardId:'card-1', missingPackIds:[], packId:PACK, revision:'r1', raw:{}, rows:[{actorKey:'own', ref:{packId:OWN, figureId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}, name:'主角', aliases:[], enabled:true},
      ...state.figures.map(row => ({actorKey:'auto-' + row.ref.figureId, ref:row.ref, name:row.name, aliases:row.aliases, enabled:true}))], figures:structuredClone(state.figures)}),
    readMedia:async () => settei(),
    write:async input => { if (held) await held; if (refuse && input.changes.some(change => change.op === 'create')) throw Object.assign(new Error('Pack unavailable'), {code:refuse}); writes.push(input)
      for (const change of input.changes) { const row = state.figures.find(f => f.ref.figureId === change.ref?.figureId); if (!row) continue; for (const s of change.sprites || []) row.sprites.push(s.emotion); if (change.settei) { row.settei = true; row.setteiHash = 'h' } }
      return {status:'committed', refs:[]} }}
  const queue = [...(replies || [])]
  const images = {prompt:async input => { prompts.push(input); return {prompt:'p:' + input.kind, output:input.kind === 'sprite' ? {size:'1024x1536', background:'transparent', quality:'high'} : {size:'1536x1024', background:'opaque', quality:'high'}} },
    check:(data, kind) => checkAssetImage(data, kind),
    generate:async input => { generated.push(input); if (failDraw) throw Object.assign(new Error('渠道拒绝'), {code:'GENERATION_FAILED'}); const next = queue.shift() || (input.background === 'transparent' ? sprite() : settei()); return {data:new Uint8Array(next), mediaType:'image/png', ...(cost ? {cost} : {})} },
    status:async () => ({ready:true, model:'m', ...(transparent === undefined ? {} : {transparent})}), ...(matte ? {matte} : {})}
  const settings = {enabled:true, level:'late'}
  const cast = createAutoCast({store, settings:async () => settings, library, images, now:() => 1000})
  // holdWrites(): pack writes wait (never released) — the pictures stay drawn and not landed, as a restart finds them.
  return {cast, files, writes, prompts, generated, state, settings, holdWrites() { held = new Promise(() => {}) }}
}
const chat = {id:'chat-1', sessionId:'s-1', timeline:{branchId:'b1', revision:3}, messages:[{role:'assistant', turn:2, id:'m2'}]}
const kinds = writes => writes.flatMap(w => w.changes.flatMap(c => [...(c.settei ? ['identity-settei'] : []), ...(c.sprites || []).map(() => 'sprite')])).sort()
const body = lines => ({paragraphs:lines.map(([name, mood], i) => ({paragraphId:'p' + i, kind:'line', segment:{name, mood, text:'……'}}))})

test('round requests resolve over the whole cast with the shared resolver; only automatic figures count', () => {
  const cast = {packId:PACK, rows:[{actorKey:'own', ref:{packId:OWN, figureId:'x'}, name:'主角', aliases:[], enabled:true}, {actorKey:'a', ref:A, name:'甲', aliases:['阿甲'], enabled:true}],
    figures:[{ref:A, name:'甲', emotions:[{id:'calm', label:'平和'}, {id:'joy', label:'喜悦'}], defaultEmotion:'calm'}]}
  assert.deepEqual(roundRequests(body([['阿甲', '喜悦'], ['主角', '喜悦'], ['路人', '悲伤'], ['甲', ''], ['甲', '狂喜乱舞']]), cast), [{ref:A, emotionId:'joy'}, {ref:A, emotionId:'calm'}, {ref:A, emotionId:null}], 'no mood asks for the default emotion; an unmatched mood asks for none')
})

test('a new figure: 人设图 then its first 立绘 from it, each landed at once (a running director keeps its own assets)', async () => {
  const h = harness()
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => kinds(h.writes).length >= 2)
  assert.deepEqual(h.prompts.map(p => p.kind), ['identity-settei', 'sprite'])
  assert.match(h.prompts[0].userPrompt, /front view.*back view/)
  assert.equal(h.prompts[1].emotionId, 'joy')
  assert.equal(h.generated[1].references.length, 1, 'the 立绘 is drawn from the 人设图')
  assert.deepEqual(kinds(h.writes), ['identity-settei', 'sprite'])
  assert.deepEqual(h.writes[0].source, {chatId:'chat-1', branchId:'b1', revision:3, turn:2, messageId:'m2', paragraphIds:['p0']}, 'the write serves the round')
  await settle(() => ![...h.files.keys()].some(key => key.endsWith('.png')))
  assert.deepEqual([...h.files.keys()].filter(key => key.endsWith('.png')), [], 'landed pictures leave the disk')
})

test('a CG of the image plugin waits for the round’s casting, then for the 人设图 of the figures in it; a 人设图 that fails twice is unavailable', async () => {
  const h = harness()
  let cast = false
  const waiting = h.cast.awaitCast('cards/c.json', 's-1', 2).then(() => { cast = true })
  await tick()
  assert.equal(cast, false, 'the turn is not cast yet')
  await h.cast.round('cards/c.json', body([['路人', '']]), chat)
  await waiting
  assert.equal(cast, true)
  const ready = await h.cast.awaitSettei('cards/c.json', [A, {packId:OWN, figureId:'x'}])
  assert.deepEqual(ready, {unavailable:[]})
  assert.deepEqual(kinds(h.writes), ['identity-settei'], 'A never spoke: only its 人设图 is drawn, for the CG')
  assert.deepEqual(await h.cast.awaitSettei('cards/c.json', [A]), {unavailable:[]}, 'it has one now: no wait')
  const failing = harness({failDraw:true})
  assert.deepEqual(await failing.cast.awaitSettei('cards/c.json', [A]), {unavailable:[A]})
  assert.equal(failing.generated.length, 2, 'tried twice, then given up')
})

test('a failed cheap check redraws once, then the second picture is used; every call is kept with its cost', async () => {
  const h = harness({replies:[settei(), sprite({edge:true}), sprite({edge:true})], cost:{usd:0.04, estimated:true}})
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => kinds(h.writes).length >= 2)
  assert.equal(h.generated.length, 3, '人设图 + 立绘 + one redraw')
  const record = [...h.files].find(([key]) => key.endsWith('.json') && !key.endsWith('index.json'))[1]
  assert.deepEqual(record.drawn.map(row => [row.kind, row.emotionId, row.channel, row.cost?.usd, typeof row.ms]),
    [['identity-settei', null, 'm', 0.04, 'number'], ['sprite', 'joy', 'm', 0.04, 'number'], ['sprite', 'joy', 'm', 0.04, 'number']], 'kept after landing, the redraw too')
})

test('an opaque 立绘 marks the channel; no more 立绘 go to it', async () => {
  const h = harness({replies:[settei(), sprite({opaque:true})]})
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => h.writes.length > 0)
  await settle(() => h.generated.length >= 2)
  for (let i = 0; i < 20; i++) await tick()
  assert.equal(h.generated.length, 2)
  assert.deepEqual(kinds(h.writes), ['identity-settei'])
  const record = [...h.files].find(([key]) => key.endsWith('.json') && !key.endsWith('index.json'))[1]
  assert.deepEqual(record.channels, {m:{transparent:false}})
})

test('a channel without transparency: no 立绘 until a matte step is given; with one, the 立绘 is drawn on a key colour and keyed', async () => {
  const plain = harness({transparent:false})
  await plain.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => plain.writes.length > 0)
  for (let i = 0; i < 20; i++) await tick()
  assert.deepEqual(plain.prompts.map(p => p.kind), ['identity-settei'], 'without a matte step only the 人设图 is drawn')
  const keyed = []
  const h = harness({transparent:false, replies:[settei(), sprite({opaque:true})], matte:async input => { keyed.push(input); return sprite() }})
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => kinds(h.writes).length >= 2)
  assert.deepEqual(kinds(h.writes), ['identity-settei', 'sprite'])
  assert.equal(h.generated[1].background, 'opaque')
  assert.match(h.generated[1].prompt, /#00FF00/)
  assert.equal(keyed.length, h.generated.length - 1, 'every 立绘 drawn (a redraw too) is keyed')
  assert.ok(keyed.every(row => row.key === '#00FF00'))
})
test('switched off, nothing is counted or drawn; after a restart the record lands and continues', async () => {
  const h = harness()
  h.settings.enabled = false
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  assert.equal(h.generated.length, 0)
  h.settings.enabled = true
  h.holdWrites()
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  await settle(() => h.generated.length >= 2)
  h.cast.dispose()
  // a new runtime over the same files (a restart) lands what was drawn.
  const again = createAutoCast({store:{readJson:async k => h.files.get(k) ?? null, writeJson:async (k, v) => h.files.set(k, v), updateJson:async (k, fn) => h.files.set(k, fn(h.files.get(k) ?? null)),
    readBytes:async k => h.files.get(k) ?? null, writeBytes:async (k, d) => h.files.set(k, d), remove:async k => h.files.delete(k)},
    settings:async () => ({enabled:true, level:'late'}), library:{...h, writable:() => true, readCast:async () => ({cardId:'card-1', packId:PACK, revision:'r', rows:[], figures:structuredClone(h.state.figures)}),
      write:async input => { h.writes.push(input); return {refs:[]} }}, images:{status:async () => ({ready:false})}})
  await again.resume()
  await settle(() => h.writes.length > 0)
  assert.deepEqual(kinds(h.writes), ['identity-settei', 'sprite'])
})

test('automatic prompts come from the same editable templates as the asset pictures', async () => {
  const {createAssetGeneration} = await import('../tavern-plugin/lib/domain/asset-generation.js')
  const overrides = {}
  const generation = createAssetGeneration({store:{readJson:async () => ({revision:1, overrides})}, getLibrary:() => null, linkedAppearance:async ref => ref.figureId === 'f' ? {identityAppearance:'黑色短发'} : null})
  const figure = {ref:{packId:'p', figureId:'f'}, name:'甲', emotions:[{id:'joy', label:'喜悦'}]}
  const sprite = await generation.autoPrompt({kind:'sprite', figure, emotionId:'joy', fromSettei:true})
  assert.match(sprite.prompt, /甲/); assert.match(sprite.prompt, /喜悦/); assert.match(sprite.prompt, /黑色短发/); assert.match(sprite.prompt, /Image 1: Approved identity settei/)
  assert.deepEqual(sprite.output, {size:'1024x1536', background:'transparent', quality:'high'})
  overrides['identity-settei'] = 'Board of {{figureName}}. {{userPrompt}}'
  assert.equal((await generation.autoPrompt({kind:'identity-settei', figure, userPrompt:'front and back'})).prompt, 'Board of 甲. front and back', 'the user\'s edited template applies')
  generation.dispose()
})


// 11-12 验收: a write the library refused showed only in the host log; now the card's record keeps it for 自动素材's page.
test('a refused write is kept for the player and the round stops there; the status names it until a picture lands after it', async () => {
  const h = harness({refuse:'ASSET_UNAVAILABLE'})
  await h.cast.round('cards/c.json', body([['路人', '']]), chat)
  assert.deepEqual(await h.cast.status('cards/c.json'), {missingPacks:0, problem:{at:1000, kind:'write', error:'ASSET_UNAVAILABLE'}})
  assert.deepEqual(h.writes, [])
  const failed = noteWriteFailure(emptyAutoCastRecord(), {at:5, error:'REVISION_CONFLICT'})
  assert.deepEqual(autoCastProblem(noteDrawn(failed, {kind:'sprite', at:4})), autoCastProblem(failed), 'a picture before it does not clear it')
  assert.equal(autoCastProblem(noteDrawn(failed, {kind:'sprite', at:6})), null, 'a picture after it does')
  assert.deepEqual(autoCastProblem(noteDrawn(failed, {kind:'sprite', at:6, failed:true})), autoCastProblem(failed), 'nor a failed one')
  const drawFailed = jobFailed(failed, {kind:'sprite', ref:A, emotionId:'joy'}, 9, Object.assign(new Error('x'), {code:'GENERATION_FAILED'}))
  assert.deepEqual(autoCastProblem(drawFailed), {at:9, kind:'draw', error:'GENERATION_FAILED'}, 'the latest of cast, write and picture problems')
})
// 11-12: every figure 自动素材 made before 外貌 went with it had an empty 人物库 record (场景配图 read nothing). The 外貌 the
// record still held goes with the first pictures, or after a restart in one write for figures already drawn; then it leaves the record.
test('the 外貌 waiting in the record reaches the 人物库 record: with the pictures, or after a restart for a figure already drawn', async () => {
  const h = harness(), looks = {face:'黑发', bodySFW:'校服'}
  await h.cast.round('cards/c.json', body([['甲', '喜悦']]), chat)
  const key = 'card-1', file = [...h.files.keys()].find(k => k.startsWith('auto-cast/') && k !== 'auto-cast/index.json')
  h.cast.dispose()
  // a record from before the fix: its figure drawn, its 外貌 still waiting
  h.state.figures[0].settei = true
  h.files.set(file, {...h.files.get(file), appearance:{[PACK + '/' + A.figureId]:looks}, jobs:{}})
  h.writes.length = 0
  const again = createAutoCast({store:{readJson:async k => structuredClone(h.files.get(k) ?? null), writeJson:async (k, v) => h.files.set(k, v), updateJson:async (k, fn) => h.files.set(k, fn(h.files.get(k) ?? null)),
    readBytes:async k => h.files.get(k) ?? null, writeBytes:async (k, d) => h.files.set(k, d), remove:async k => h.files.delete(k)},
    settings:async () => ({enabled:true, level:'late'}), library:{writable:() => true, readCast:async () => ({cardId:key, missingPackIds:[], packId:PACK, revision:'r', rows:[], figures:structuredClone(h.state.figures)}),
      write:async input => { h.writes.push(input); return {refs:[]} }}, images:{status:async () => ({ready:false})}})
  await again.resume()
  await settle(() => h.writes.length > 0)
  assert.deepEqual(h.writes[0].changes, [{op:'patch', kind:'figures', ref:{packId:PACK, kind:'figures', figureId:A.figureId}, looks}])
  await settle(() => !h.files.get(file).appearance?.[PACK + '/' + A.figureId])
  assert.deepEqual(h.files.get(file).appearance, {}, 'the record keeps no copy')
  await again.resume(); await tick()
  assert.equal(h.writes.length, 1, 'delivered once')
})

