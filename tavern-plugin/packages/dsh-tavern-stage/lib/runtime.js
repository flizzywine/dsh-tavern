import {STAGE_TIMER_FIELD} from '../../../mods/timer/stage-service.js'
import {readAudienceCorpus} from '../../../lib/danmaku-corpus.js'
import {describeOpeningScenes} from '../../../lib/domain/stage-opening-scene.js'
import {readStageProjection} from './domain/stage-projection.js'
import {readWidgetWindowProjection} from './domain/widget-window-projection.js'
import {STAGE_PLAYBACK_FIELD, saveStagePlayback, patchStagePlayback, addStageMeasurement} from './domain/stage-playback.js'
import {spineRuntimeAvailable, spineRuntimeStatus, importSpineRuntime} from '../../../lib/domain/tavern-runtime-assets.js'
import {stageModHistoryTurns} from '../../../lib/domain/stage-items.js'
import {registerStageClientAssets} from './client-assets.js'
import {createForegroundCapabilities} from '../../../lib/domain/foreground-capabilities.js'
import {createStageCardAssets} from './card-assets.js'
import {createResourceScope} from '../../../lib/domain/resource-scope.js'
import {createStageAssets, createStageModule, createStageServices} from './module.js'

// Private migration composition: one owner for the existing staged construction.
// These bindings are not the public interface of the future optional plugin.
export function createStageRuntime(core, factories = {assets:createStageAssets, start:createStageModule, services:createStageServices}) {
  const scope = createResourceScope(core.ctx, {onError:error => console.warn('dsh-tavern: stage cleanup failed',error?.message || error)})
  let phase = 'assets', module, services, cardAssets
  core.ctx.effect(() => () => scope.dispose(), 'dsh-tavern: stage lifetime')
  const failed = error => {phase = 'failed';void scope.dispose();throw error}
  const assert = expected => {
    if (!scope.active() || phase !== expected) throw Object.assign(Error('舞台生命周期状态不匹配: '+phase),{code:'STAGE_UNAVAILABLE'})
  }
  let assets
  try {
    const clientAssets = core.ctx.get?.('tavernClientAssets')
    if (clientAssets) scope.own(registerStageClientAssets(clientAssets))
    assets = factories.assets({...core,ctx:scope.ctx})
  } catch(error) {failed(error)}
  return Object.freeze({
    assets,
    foreground(bindings) {
      assert('assets')
      const capabilities=createForegroundCapabilities({...bindings,
        modPrompts:(chat,options)=>module?.managedModManagement.foreground(chat,options),
        judge:()=>assets.assetEngineSettings.read().values.judge})
      scope.own(capabilities)
      return capabilities
    },
    cards(bindings) {
      assert('assets')
      try {return cardAssets = createStageCardAssets({...bindings,...assets,modManifests:() => module?.modService.manifests() || [],ctx:scope.ctx,active:scope.active})}
      catch(error) {return failed(error)}
    },
    async start(bindings) {
      assert('assets');phase = 'starting'
      try {
        module = await factories.start({...bindings,...assets,ctx:scope.ctx,cardsActive:() => scope.active() && bindings.cardsActive()})
        assert('starting');phase = 'running'
        return module
      } catch(error) {phase = scope.active() ? 'failed' : phase;await scope.dispose();throw error}
    },
    services(bindings) {
      assert('running')
      try {
        services = factories.services({...bindings,...assets,...module,ctx:scope.ctx})
        phase = 'ready';return services
      } catch(error) {return failed(error)}
    },
    requests(bindings, registry) {
      assert('ready')
      const owned = Object.fromEntries(Object.entries({STAGE_TIMER_FIELD,readAudienceCorpus,describeOpeningScenes,readStageProjection,readWidgetWindowProjection,STAGE_PLAYBACK_FIELD,saveStagePlayback,patchStagePlayback,addStageMeasurement,spineRuntimeAvailable,spineRuntimeStatus,importSpineRuntime,stageModHistoryTurns,...assets,...cardAssets,...module,...services}).map(([key,value]) => [key,{value,enumerable:true}]))
      return module.requests(Object.create(bindings,owned),registry)
    },
    async dispose() {phase = 'disposed';await scope.dispose()},
    status:() => scope.active() ? phase : phase === 'failed' ? 'failed' : 'disposed'
  })
}
