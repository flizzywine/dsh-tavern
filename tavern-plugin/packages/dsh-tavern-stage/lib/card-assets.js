import {createCardAssetBoundary} from '../../../lib/card-asset-bindings.js'
import {createCardBundleAdapter,createCardBundleWriter} from './card-bundle.js'
import {createCardZipTargets} from './card-zip-target.js'
import {normalizeResourcePath} from '../../../lib/domain/file-resources.js'
import {readCardVariableSources} from '../../../lib/domain/card-variable-bindings.js'

// Private composition of the stage-owned asset/card bridge.
export function createStageCardAssets({ctx,active,assetEngineSettings,modManifests,fileResources,readCardWorkspace,updateCard,
  syncBubbles,readCharacterBook,readSessionMap,persistence,cardId,cardPreparation,cardStorage,bumpCardProjectionRevision,syncCardName}) {
  const cardAssetBindings = createCardAssetBoundary({ctx, modConfig:true, getEngine:() => assetEngineSettings.read().values, modManifests, listCards:async () => (await fileResources.list('card')).map(path => ({path})), readWorkspace:readCardWorkspace, updateCard, syncBubbles:path => syncBubbles(path), readCharacterBook:path => readCharacterBook(path),
    readVariableSources:async ({path,sessionId}) => {
      const chatPersistence = persistence()
      const chatId = (await readSessionMap())[sessionId]
      const indexed = chatId ? await chatPersistence.readSessionState(chatId) : null
      return readCardVariableSources({path,indexed,readWindow:chatPersistence.readWindow,readRevision:chatPersistence.readRevision})
    }})
  ctx.provide('tavernAssetDependencies', Object.freeze({apiVersion:2, get:request => cardAssetBindings.dependencies(request)}))
  const cardZipTargets = createCardZipTargets({id:cardId, listCards:() => fileResources.list('card'), readWorkspace:readCardWorkspace, importCard:fileResources.importCard})
  const assetCards = createCardBundleAdapter({
    cardPreparation, dependencies:request => cardAssetBindings.dependencies(request), getEngine:() => assetEngineSettings.read().values,
    async authorizeTarget(path) {
      if (!active()) throw Object.assign(new Error('Card owner unavailable'), {code:'ASSET_UNAVAILABLE'})
      const normalized = normalizeResourcePath(path, 'card')
      const workspace = await readCardWorkspace(normalized)
      if (!active()) throw Object.assign(new Error('Card owner unavailable'), {code:'ASSET_UNAVAILABLE'})
      const reserved = cardZipTargets.get(normalized)
      if (reserved) return reserved
      if (!workspace) throw Object.assign(new Error('Card target unavailable'), {code:'NOT_FOUND'})
      return {cardId:workspace.meta.id}
    },
    readWorkspace:readCardWorkspace,
    readCover:fileResources.readCardImage,
    withCardLock:cardStorage.withCardLock,
    writeWorkspace:createCardBundleWriter({readWorkspace:readCardWorkspace,cardPreparation,bumpCardProjectionRevision,syncCardName,
    async publish(path, workspace, cover) {
      if (!active()) throw Object.assign(new Error('Card owner unavailable'), {code:'ASSET_UNAVAILABLE'})
      const normalized = normalizeResourcePath(path, 'card')
      // The package publication gate and existing card queue are already held.
      // Commit the complete prepared workspace once, never call updateCard here.
      if (cardZipTargets.get(normalized)) await cardZipTargets.commit(normalized, workspace, cover)
      else if (cover) await fileResources.writeCardImage(normalized, cover, workspace)
      else await fileResources.writeWorking(normalized, JSON.stringify(workspace, null, 2))
    }})
  })
  ctx.provide('tavernAssetCards', Object.freeze({apiVersion:2, ...assetCards}))
  return {cardAssetBindings,cardZipTargets}
}
