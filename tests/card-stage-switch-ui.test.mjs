import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import protocol from '../tavern-plugin/packages/dsh-presentation-protocol/src/card-stage-mode.cjs'

// The 基础设置 helpers of the card page, with the mods' own modSwitchOn (mod-manager.js) and the shared stageMissing
// (asset-pack-widgets.js, the core's).
async function helpers() {
  const read = name => readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name, import.meta.url), 'utf8')
  const [source, mods, widgets] = await Promise.all([read('asset-pack-card-ui.js'), read('mod-manager.js'),
    readFile(new URL('../tavern-plugin/src/client/asset-pack-widgets.js', import.meta.url), 'utf8')])
  const sandbox = {cardStageMode:protocol.cardStageMode}
  vm.createContext(sandbox)
  vm.runInContext(widgets.slice(widgets.indexOf('const STAGE_REQUIRES='), widgets.indexOf('// Section with')), sandbox)
  vm.runInContext(mods.match(/^const modSwitchOn = .*$/m)[0], sandbox)
  vm.runInContext(source.slice(source.indexOf('const STAGE_SWITCH_DEFAULTS='), source.indexOf('// cards select packs')) +
    ';this.api={stageSwitchLayers,stagePrefs,stageActive,stageSwitchPatch,stageEnable};', sandbox)
  // Narrator settings share the card patch and four-state switch semantics.
  vm.runInContext(source.slice(source.indexOf('const NARRATOR_DEFAULT='), source.indexOf('// 通用声音 (tts.reading.dialogueVoice')) +
    ';Object.assign(this.api,{narratorLayers,narratorCardPatch,narratorWrite});', sandbox)
  const componentNames=['InlineGrid','InlineRow','Switch','StageSwitchTag','SwitchRow','SubpageHead','Help','StageSection'];
  Object.assign(sandbox,{React:{useRef:()=>({current:null}),useEffect:()=>{}},h:(type,props,...children)=>({type,props:props||{},children}),subpageKeys:()=>()=>{},
    core:{VoiceCataloguePicker:'picker',voiceKey:v=>v?JSON.stringify(v):'',voiceFromKey:k=>k?JSON.parse(k):null}});
  for(const name of componentNames)sandbox[name]=name;
  vm.runInContext(source.slice(source.indexOf('function GeneralVoiceField('),source.indexOf('function StagePerformanceRow('))+
    ';Object.assign(this.api,{GeneralVoiceField,NarratorVoiceField,StageVoicePage});',sandbox);
  return sandbox.api
}
const plain = value => JSON.parse(JSON.stringify(value))

const nodes = node => !node || typeof node !== 'object' ? [] : [node,...(node.children||[]).flat(Infinity).flatMap(nodes)]
for (const voice of [{browser:'browser-one'},{serviceId:'service-one',voice:'speaker-one'}]) {
  test('narrator card voice switch writes and removes its override: '+JSON.stringify(voice), async () => {
    const api=await helpers(),writes=[];
    const ctx={ext:{stage:{enabled:true}},writer:{reading:{narrator:{voice,enabled:false}},write:fn=>writes.push(plain(fn(ctx.ext)))}};
    const toggle=nodes(api.NarratorVoiceField({ctx})).find(n=>n.type==='Switch');
    toggle.props.onChange(true);
    assert.deepEqual(writes[0].stage.narrator.voice,voice);
    ctx.ext=writes[0];
    nodes(api.NarratorVoiceField({ctx})).find(n=>n.type==='Switch').props.onChange(false);
    assert.deepEqual(writes[1],{stage:{enabled:true}});
    const page=()=>nodes(api.StageVoicePage({ctx:{...ctx,active:{dialogue:true}},onBack:()=>{}}));
    ctx.ext={stage:{enabled:true}};
    assert.equal(page().some(n=>n.type===api.NarratorVoiceField),false);
    ctx.ext.stage.narrator={enabled:true};
    assert.equal(page().some(n=>n.type===api.NarratorVoiceField),true);
  })
}
test('general voice supports silent without changing narrator settings',async()=>{
  const api=await helpers(),writes=[];
  const field=api.GeneralVoiceField({ctx:{writer:{reading:{},setReading:p=>writes.push(plain(p))}}});
  nodes(field).find(n=>n.type==='picker').props.onPick('silent');
  assert.deepEqual(writes,[{dialogueVoice:{silent:true}}]);
})
