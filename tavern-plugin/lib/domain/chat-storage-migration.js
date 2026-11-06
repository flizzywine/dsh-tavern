import { mkdir, open, truncate } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { applyJsonChangesShared, diffJson } from './json-mutation.js'

/** Own cutover admission, source-version validation, failed-attempt suppression and explicit rollback. */
export function createChatStorageMigration({ native, compatible, journal, serialize, flushMaintenance,
  materialize, version, forgetState, layout, safeChatId, now, logger }) {
  const { read: materializeLegacy, version: legacyVersion, writeSnapshot, appendFrame } = journal
  // Explicit cutover only: original journals and compatible history remain intact.
  // All current writers share serialize()'s cross-process conversation lock.
  async function upgradeStorage(chatId,{onProgress=()=>{},assertCanMigrate=()=>{}}={}){
    safeChatId(chatId)
    if(!compatible)throw new Error('Migration requires the shared conversation lock')
    await flushMaintenance()
    return serialize(chatId,async()=>{
      if(await native.version(chatId))return {status:'native',alreadyActive:true}
      await mkdir(layout(chatId).root,{recursive:true})
      onProgress('reading')
      const captured=await version(chatId)
      const state=await materialize(chatId)
      if(!state)return {status:'missing'}
      if(state.chat.mode==='card')throw new Error('Card configuration is not a playable conversation')
      if(!Number.isSafeInteger(state.chat._storageRevision)||state.chat._storageRevision<1)throw new Error('Legacy Chat has no valid storage revision')
      await assertCanMigrate(state.chat)
      onProgress('converting')
      await native.create(chatId,state.chat,undefined,{migration:true,verifyBeforePublish:async restored=>{
        onProgress('verifying')
        if(!isDeepStrictEqual(restored,state.chat))throw new Error('Native migration round-trip verification failed')
        if(await version(chatId)!==captured)throw new Error('Source changed during native migration')
      }})
      forgetState(chatId)
      return {status:'native',alreadyActive:false,sourceRevision:state.revision,retainedLegacy:true}
    })
  }

  const migrationFailures=new Map()
  async function migrateCompatibility(chatId,{force=false}={}){
    if(await native.version(chatId))return {status:'native'}
    if(!compatible)throw new Error('Compatible storage is disabled')
    const current=await compatible.status(chatId)
    if(current?.mode==='legacy'&&!force)return {status:'legacy',reason:'explicit-restore'}
    if(current?.mode==='compatible'){await compatible.version(chatId);return {status:'compatible',alreadyActive:true}}
    const before=await legacyVersion(chatId)
    if(!force&&migrationFailures.get(chatId)?.version===before)return migrationFailures.get(chatId).result
    try{
      const result=await serialize(chatId,async()=>{
        if((await compatible.status(chatId))?.mode==='compatible')return {status:'compatible',alreadyActive:true}
        const paths=layout(chatId)
        await mkdir(paths.root,{recursive:true})
        const captured=await legacyVersion(chatId),state=await materializeLegacy(chatId)
        if(!state)return {status:'missing'}
        const result=await compatible.migrate(chatId,state.chat,captured,async()=>{
          if(await legacyVersion(chatId)!==captured)throw new Error('Source changed during migration')
        })
        forgetState(chatId);migrationFailures.delete(chatId)
        return result
      })
      return result
    }catch(error){
      // Publication may have succeeded even if acknowledgement was lost. Never
      // call that a legacy fallback or hide a damaged active target.
      if((await compatible.status(chatId))?.mode==='compatible')throw error
      const result={status:'legacy',reason:error.message}
      migrationFailures.set(chatId,{version:await legacyVersion(chatId),result})
      if(migrationFailures.size>128)migrationFailures.delete(migrationFailures.keys().next().value)
      logger?.warn?.('dsh-tavern: 旧档转换未完成，继续使用原存档:',chatId,error.message)
      return result
    }
  }
  async function restoreLegacy(chatId){
    if(await native.version(chatId))throw new Error('Native conversations are not legacy migrations')
    if(!compatible)throw new Error('Compatible storage is disabled')
    await flushMaintenance()
    return serialize(chatId,async()=>{
      const state=await compatible.read(chatId)
      if(!state)return {status:await materializeLegacy(chatId)?'legacy':'missing',alreadyActive:true}
      const paths=layout(chatId)
      await mkdir(paths.journals,{recursive:true})
      const legacy=await materializeLegacy(chatId)
      if(!legacy||legacy.revision>state.revision)throw new Error('Legacy restore source diverged')
      if(legacy.legacy)await writeSnapshot(paths,legacy.chat,legacy.revision)
      let previous=legacy.chat,openJournal=legacy.open
      if(openJournal&&legacy.openInvalidLine>0)await truncate(openJournal.path,legacy.openValidBytes)
      // Export every post-cutover revision, not only the newest snapshot: an
      // older release must retain rollback points created after migration.
      for(let revision=legacy.revision+1;revision<=state.revision;revision++){
        const historical=await compatible.read(chatId,revision)
        if(!historical)throw new Error('Missing compatible revision during restore')
        let changes=diffJson(previous,historical.chat)
        if(JSON.stringify(applyJsonChangesShared(previous,changes))!==JSON.stringify(historical.chat))changes=[{op:'set',path:[],value:historical.chat}]
        openJournal=await appendFrame(paths,{schemaVersion:1,chatId,baseRevision:revision-1,revision,timestamp:now(),source:'compatible-restore',changes},openJournal)
        previous=historical.chat
      }
      if(openJournal){
        const handle=await open(openJournal.path,'r+')
        try{await handle.sync()}finally{await handle.close()}
        if(process.platform!=='win32'){
          const directory=await open(paths.journals,'r')
          try{await directory.sync()}catch(error){if(!['EINVAL','ENOTSUP','EISDIR'].includes(error.code))throw error}finally{await directory.close()}
        }
      }
      await writeSnapshot(paths,state.chat,state.revision)
      const restored=await materializeLegacy(chatId)
      if(JSON.stringify(restored.chat)!==JSON.stringify(state.chat))throw new Error('Legacy restore verification failed')
      await compatible.deactivate(chatId)
      forgetState(chatId)
      // Explicit restore must not be immediately undone by auto migration.
      migrationFailures.set(chatId,{version:await legacyVersion(chatId),result:{status:'legacy',reason:'explicit-restore'}})
      return {status:'legacy',revision:state.revision}
    })
  }

  return Object.freeze({ upgradeStorage, migrateCompatibility, restoreLegacy })
}
