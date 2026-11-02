import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createDurableFilePromotion} from '../../../lib/durable-file-promotion.js'
import {modError} from '../../../lib/domain/mod-system-contract.js'

// Authored packs share the host's crash-recoverable promotion and cross-process lock.
export function createManagedModPackOwner({root}) {
  const file=path.join(root,'packs.json'),files=createDurableFilePromotion({writeLockStaleMs:Number.MAX_SAFE_INTEGER})
  const listeners=new Set(),decode=bytes=>bytes?JSON.parse(bytes.toString('utf8')):{revision:'0',packs:{}}
  return Object.freeze({read:async()=>decode(await files.read(file)),subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},
    async compareAndSwap({expectedRevision,modId,pack}) {
      let next
      try {
        await files.update(file,bytes=>{
          const before=decode(bytes)
          if(before.revision!==expectedRevision)throw modError('MOD_REVISION_CONFLICT','Mod packs changed; refresh before saving')
          next={revision:randomUUID(),packs:{...before.packs,[modId]:{...before.packs[modId],[pack.id]:pack}}}
          return JSON.stringify(next)
        })
      } catch(error) {
        if(error.code==='DSH_TAVERN_WRITE_CONFLICT')throw modError('MOD_REVISION_CONFLICT','Pack write is in progress')
        throw error
      }
      for(const notify of listeners)notify()
      return next
    },
  })
}
