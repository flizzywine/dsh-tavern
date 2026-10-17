import test from 'node:test'
import assert from 'node:assert/strict'
import {createConversationMigration} from '../tavern-plugin/lib/domain/conversation-migration.js'

test('migration job deduplicates clicks, reports stages and survives request lifetime',async()=>{
 let release, calls=0,version='journal:old',notifications=0
 const gate=new Promise(resolve=>{release=resolve})
 const service=createConversationMigration({store:{version:async()=>version,migrateNative:async(id,options)=>{
  calls++;await options.assertCanMigrate({});options.onProgress('converting');await gate;version='native:new';return {status:'native'}
 }},notify:()=>notifications++})
 assert.equal((await service.status('old')).format,'legacy')
 service.start('old');service.start('old')
 await Promise.resolve()
 assert.equal(calls,1)
 assert.equal((await service.status('old')).stage,'converting')
 release();await service.dispose()
 assert.equal((await service.status('old')).phase,'completed');assert.equal(notifications,1)
})
