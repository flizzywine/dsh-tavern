// 履历 clip export — host-coordinate band, presets and the background job UI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import { chromium } from 'playwright'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const source = await read('tavern-plugin/packages/dsh-tavern-stage/src/client/clip-export.cjs')
const pure = vm.runInNewContext(source.slice(0, source.indexOf('// ---------- Background jobs')) + ';({clipBand,clipPreset,clipVisible,clipNextRecent,clipProgress,clipDuration,clipResolution})', {})
const json = value => JSON.parse(JSON.stringify(value))

test('export transport failures never show developer messages to the player', () => {
  const failure=vm.runInNewContext(source.slice(0,source.indexOf('// ---------- Background jobs'))+';clipFailure',{})
  for(const message of ['缓存对白未在所选段落开始播放','ffmpeg exited 1: E:/private/video.mp4','Failed to fetch']) {
    assert.equal(failure(new Error(message)),'暂时无法连接，请稍后重新打开导出面板')
  }
  assert.equal(failure(new Error('无法导出：GIF 最多 15 秒，请缩小所选段落范围')),'无法导出：GIF 最多 15 秒，请缩小所选段落范围')
})

test('the band follows host coordinates across turns, filling the separators and inputs inside it', () => {
  const page = (turn, para) => ({ type: 'page', turn, para })
  const entries = [page(1, 1), page(1, 2), { type: 'turn', turn: 2 }, { type: 'input', turn: 2 }, page(2, 1), { type: 'turn', turn: 3 }, { ...page(3, 0), anchor: { para: 1 } }, page(3, 2)]
  const band = pure.clipBand(entries, { from: { turn: 1, para: 2 }, to: { turn: 3, para: 1 } })
  assert.deepEqual(json(band.map(mark => mark && (mark.start ? 'start' : mark.end ? 'end' : 'in'))), [null, 'start', 'in', 'in', 'in', 'in', 'end', null])
  // A band starting on a turn's first paragraph leaves that turn's separator outside it.
  assert.equal(pure.clipBand(entries, { from: { turn: 2, para: 1 }, to: { turn: 2, para: 1 } }).filter(Boolean).length, 1)
})

test('presets stay within what the backlog shows; 最近 N grows on each press', () => {
  const all = []
  for (let turn = 1; turn <= 4; turn++) for (let para = 1; para <= 10; para++) all.push({ turn, para })
  const visible = pure.clipVisible(all, { turn: 4, para: 5 })
  assert.equal(visible.length, 35)
  assert.deepEqual(json(pure.clipPreset('turn', visible, { turn: 2, para: 7 })), { from: { turn: 2, para: 1 }, to: { turn: 2, para: 10 } })
  assert.deepEqual(json(pure.clipPreset('end', visible, { turn: 3, para: 4 })), { from: { turn: 3, para: 4 }, to: { turn: 4, para: 5 } })
  assert.deepEqual(json(pure.clipPreset('recent', visible, null, 10)), { from: { turn: 3, para: 6 }, to: { turn: 4, para: 5 } })
  assert.equal(pure.clipNextRecent(visible, null), 10)
  assert.equal(pure.clipNextRecent(visible, pure.clipPreset('recent', visible, null, 10)), 20)
  assert.equal(pure.clipNextRecent(visible, pure.clipPreset('recent', visible, null, 20)), 35, 'past the steps: everything shown')
  assert.deepEqual(json(pure.clipProgress({ phase: 'encode', frame: 450, totalFrames: 900, file: 1, totalFiles: 3 })), { phase: '编码', fraction: 0.5, file: '2/3' })
  assert.equal(pure.clipDuration(3725000), '1:02:05')
  assert.equal(pure.clipResolution([{ resolution: { height: 720 } }, { resolution: { height: 1080 } }, { resolution: { height: 1080 } }]), '1080p / 720p')
})

test('a late polling response cannot replace the cancelled terminal state', async () => {
  for (const reject of [false, true]) {
    let tick, resolvePoll, rejectPoll
    const jobs = vm.runInNewContext(source.slice(0, source.indexOf('// ---------- Selection')) + ';clipJobs', {
      setTimeout(fn) { tick = fn },
      rpc(method) {
        if (method === 'getClipExportJob') return new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject })
        return Promise.resolve(method === 'startClipExport' ? { jobId: 'job' } : { cancelled: true })
      }
    })
    await jobs.start('session', {}, '1080p'); tick()
    await jobs.cancel('session')
    if (reject) rejectPoll(new Error('late disconnected poll'))
    else resolvePoll({ jobId: 'job', state: 'running' })
    await Promise.resolve()
    assert.equal(jobs.get('session').state, 'cancelled')
  }
})

test('clip export and cinema buttons retain separate icon registrations',async()=>{
  const settings=await read('tavern-plugin/src/client/settings-ui.js'),stage=await read('tavern-plugin/src/client/stage-entries.js'),backlog=await read('tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-view.cjs')
  const icons=vm.runInNewContext(settings.slice(settings.indexOf('const ICON_PATHS'),settings.indexOf('// Foldable settings sections'))+'\n;({film:Icon({name:"film-mode"}),clip:Icon({name:"clip"})})',{React:{createElement:(type,props,...children)=>({type,props,children})}})
  const film=icons.film.children[0].props.d,clip=icons.clip.children[0].props.d
  assert.ok(film.startsWith('M3.5 5.5'));assert.ok(clip.startsWith('M5 4.5'));assert.notEqual(film,clip)
  assert.match(stage,/className: "fork-gal-film"[\s\S]*?name: "film-mode"/)
  assert.match(backlog,/className: "fork-gal-backlog-clip[\s\S]*?name: "clip"/)
  assert.ok(!source.includes('name: "film"')&&!source.includes('icon: "film"'))
})

