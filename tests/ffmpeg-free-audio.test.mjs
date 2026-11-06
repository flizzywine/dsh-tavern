import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {chromium} from 'playwright'
import meter from '../tavern-plugin/shared/pcm-loudness.cjs'
import {measureVoiceLoudness} from '../tavern-plugin/packages/dsh-tavern-tts/src/loudness.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {authorAudioLoudness} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/audio-loudness.js'
import {speechAudioToWav} from '../tavern-plugin/lib/speech-wav.js'
import {clipRun} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

const fixtures = new URL('../tavern-plugin/packages/dsh-tavern-tts/tests/fixtures/loudness/', import.meta.url)
const voices = await Promise.all(['speech-24000-0.wav','speech-44100-1.wav'].map(name => readFile(new URL(name, fixtures))))
const ref = (bytes, args=[]) => {
  const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-nostdin',...args,'-i','pipe:0','-af','apad=whole_dur=0.4,ebur128=peak=true','-f','null','-'], {input:bytes,encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(result.status,0,result.stderr || String(result.error))
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(result.stderr.slice(result.stderr.lastIndexOf('Summary:')))[1])
}
test('PCM core and WAV adapter agree with local ffmpeg within 0.5 LU', () => {
  for (const bytes of voices) assert.ok(Math.abs(measureVoiceLoudness(bytes).lufs-ref(bytes)) <= 0.5)
  for (const count of [4,6]) {
    const channels=Array.from({length:count},(_,c)=>Float32Array.from({length:48000},(_,i)=>0.1*Math.sin(i*(c+1)*0.07)))
    const bytes=Buffer.alloc(48000*count*4)
    for(let i=0;i<48000;i++)for(let c=0;c<count;c++)bytes.writeFloatLE(channels[c][i],(i*count+c)*4)
    const expected=ref(bytes,['-f','f32le','-ar','48000','-ac',String(count),'-channel_layout',count===4?'quad':'5.1'])
    assert.ok(Math.abs(meter.measurePcmLoudness(channels,48000).lufs-expected)<=0.5)
  }
})

test('browser upload preparation, worker, replace metadata and server publication need no ffmpeg', async t => {
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent('<main></main>')
  const core=await readFile(new URL('../tavern-plugin/shared/pcm-loudness.cjs',import.meta.url),'utf8')
  const adapter=await readFile(new URL('../tavern-plugin/src/client/audio-loudness.js',import.meta.url),'utf8')
  const ui=await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js',import.meta.url),'utf8')
  const preparation=ui.slice(ui.indexOf('  const AUDIO_MIME='),ui.indexOf('  const fileStem='))
  await page.addScriptTag({content:core+'\n'+adapter+'\n'+preparation+'\nwindow.prepareAudio=prepareAudio;window.measureAudioBufferLoudness=measureAudioBufferLoudness;'})
  const root=await mkdtemp(join(tmpdir(),'ffmpeg-free-assets-'))
  const service=createAssetPackService({assetRoot:join(root,'assets'),authorizeLease:async()=>true})
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
  const originalPath=process.env.PATH, originalFfmpeg=process.env.FFMPEG_PATH
  process.env.PATH='';delete process.env.FFMPEG_PATH
  t.after(()=>{process.env.PATH=originalPath;if(originalFfmpeg!==undefined)process.env.FFMPEG_PATH=originalFfmpeg})
  let snapshot=(await service.createPack({name:'测试音频',expectedRevision:null})).snapshot
  const packId=snapshot.manifest.id
  for(const [index,bytes] of voices.entries()) {
    const prepared=await page.evaluate(async bytes=>{
      const result=await prepareAudio(new File([new Uint8Array(bytes)],'voice.wav'))
      return {descriptor:result.descriptor,loudness:result.loudness}
    },Array.from(bytes))
    assert.ok(Number.isFinite(prepared.loudness.lufs))
    assert.ok(Math.abs(prepared.loudness.lufs-measureVoiceLoudness(bytes).lufs)<0.5)
    const staged=await service.putBlob({packId,expectedRevision:snapshot.revision,bytes,descriptor:prepared.descriptor})
    snapshot=staged.snapshot
    const assets=['music','sfx','ambience'].map(kind=>({kind,id:kind,name:'测试声音',enabled:true,recall:{mode:'keyword',keywords:['离别','毕业','远行']},directorNote:'',media:staged.hash,loudness:prepared.loudness}))
    snapshot=(await service.patchPack({packId,expectedRevision:snapshot.revision,patch:{assets}})).snapshot
    for(const asset of snapshot.manifest.assets)assert.deepEqual(asset.loudness,prepared.loudness)
    // Both upload and replacement use the same prepareAudio value; no old-media measurement survives.
    assert.match(ui,/next\.loudness=media\.loudness/)
    const invalid=structuredClone(assets);invalid[0].loudness.lufs=index?Infinity:-101
    await assert.rejects(service.patchPack({packId,expectedRevision:snapshot.revision,patch:{assets:invalid}}))
  }
  // Two long fixtures exercise the actual browser Worker path without playing audio.
  for(const frequency of [220,880]) {
    const result=await page.evaluate(async frequency=>{
      const audio=new AudioBuffer({numberOfChannels:2,length:480000,sampleRate:48000})
      for(let c=0;c<2;c++){const samples=audio.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]=0.1*Math.sin(2*Math.PI*frequency*i/48000)}
      return await measureAudioBufferLoudness(audio)
    },frequency)
    assert.ok(Number.isFinite(result.lufs));assert.ok(Number.isFinite(result.peak))
  }
  for(const signature of ['OggS','fLaC']) {
    const message=await page.evaluate(async signature=>{
      const bytes=new Uint8Array(24);bytes.set([...signature].map(c=>c.charCodeAt(0)))
      try {await prepareAudio(new File([bytes],'unsupported'))}catch(error){return error.message}
    },signature)
    assert.match(message,/浏览器无法解码.*WAV/)
  }
})

test('PCM16 speech passes through and remaining ffmpeg boundaries explain the remedy', async t => {
  const oldPath=process.env.PATH,oldFfmpeg=process.env.FFMPEG_PATH
  process.env.PATH='';delete process.env.FFMPEG_PATH
  t.after(()=>{process.env.PATH=oldPath;if(oldFfmpeg!==undefined)process.env.FFMPEG_PATH=oldFfmpeg})
  for(const bytes of voices) assert.deepEqual(await speechAudioToWav(bytes,'audio/wav'),bytes)
  for(const mediaType of ['audio/mpeg','audio/ogg'])await assert.rejects(speechAudioToWav(Buffer.alloc(16),mediaType),/安装 ffmpeg.*WAV/)
  for(const kind of ['music','ambience']) {
    const manifest={assets:[{kind,id:kind,name:'测试',media:'audio'}],blobs:{audio:{ext:'wav'}}}
    await assert.rejects(authorAudioLoudness(manifest,new Map([['media/audio.wav',voices[0]]]),{measure:async()=>null}),/缺少响度.*安装 ffmpeg.*作者/)
  }
  for(const command of ['missing-ffmpeg-test','missing-ffprobe-test'])await assert.rejects(clipRun(command,[]),error=>{
    assert.match(error.clipUserMessage,/片段导出需要 ffmpeg 和 ffprobe/);return true
  })
  const ui=await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js',import.meta.url),'utf8')
  const terms=ui.slice(ui.indexOf('const PLAYER_TERMS='),ui.indexOf('\nfunction playerError',ui.indexOf('const PLAYER_TERMS=')))
  const playerPlain=new Function(terms+';return playerPlain')()
  for(const message of ['请安装 ffmpeg 后重新导入素材包','插件配音需要 ffmpeg，请安装后重试'])assert.equal(playerPlain(message),message)
})
