import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import { sourceFunction } from './fixtures/source-function.mjs'
import messages from '../tavern-plugin/packages/dsh-presentation-protocol/src/tts-messages.cjs'

test('MiniMax preview and figure warnings use shared messages; a valid 少女 has no warning', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js',import.meta.url),'utf8')
  const before = source.slice(source.indexOf('const VOICE_PROVIDERS='),source.indexOf('// ---------- data + preview plumbing'))
  const field = sourceFunction(source, 'FigureVoiceField')
  const sandbox = {describeTtsError:messages.describeTtsError,h:(type,props,...children)=>({type,props,children}),InlineField:'field',Glyph:'glyph',playerErrorText:()=>{throw new Error('MiniMax must not lose its message in the generic Latin-text filter')}}
  vm.createContext(sandbox)
  vm.runInContext(before+'\n'+field,sandbox)
  for (const code of ['MINIMAX_AUTH_FAILED','MINIMAX_BALANCE_REQUIRED']) {
    assert.equal(sandbox.voiceErrorText({code}),messages.describeTtsError(code))
    assert.equal(sandbox.voiceIssueText(code,{provider:'minimax'}),messages.describeTtsError(code))
  }
  const figure = {voice:{voice:'girl'}}, pack = {manifest:{voiceLibrary:{voices:{girl:{name:'少女',defaultSource:'mm',sources:{mm:{kind:'preset',provider:'minimax',voiceName:'female-shaonv'}}}}}}}
  assert.equal(sandbox.FigureVoiceField({pack,figure,status:{issues:[]}}).props.before,undefined)
  const warning = sandbox.FigureVoiceField({pack,figure,status:{issues:[{code:'SERVICE_REQUIRED'}]}})
  assert.match(warning.props.ariaLabel,/这个声音绑定的语音服务还没设置/)
  assert.doesNotMatch(warning.props.ariaLabel,/通义千问/)
  assert.ok(warning.props.before)
})
