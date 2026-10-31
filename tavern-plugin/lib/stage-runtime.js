import {createStageCardAssets} from './stage-card-assets.js'
import {createResourceScope} from './domain/resource-scope.js'
import {createStageAssets, createStageModule, createStageServices} from './stage-module.js'

// Private migration composition: one owner for the existing staged construction.
// These bindings are not the public interface of the future optional plugin.
export function createStageRuntime(core, factories = {assets:createStageAssets, start:createStageModule, services:createStageServices}) {
  const scope = createResourceScope(core.ctx, {onError:error => console.warn('dsh-tavern: stage cleanup failed',error?.message || error)})
  let phase = 'assets', module, services
  core.ctx.effect(() => () => scope.dispose(), 'dsh-tavern: stage lifetime')
  const failed = error => {phase = 'failed';void scope.dispose();throw error}
  const assert = expected => {
    if (!scope.active() || phase !== expected) throw Object.assign(Error('舞台生命周期状态不匹配: '+phase),{code:'STAGE_UNAVAILABLE'})
  }
  let assets
  try {assets = factories.assets({...core,ctx:scope.ctx})} catch(error) {failed(error)}
  return Object.freeze({
    assets,
    cards(bindings) {
      assert('assets')
      try {return createStageCardAssets({...bindings,...assets,ctx:scope.ctx,active:scope.active})}
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
    async dispose() {phase = 'disposed';await scope.dispose()},
    status:() => scope.active() ? phase : phase === 'failed' ? 'failed' : 'disposed'
  })
}
