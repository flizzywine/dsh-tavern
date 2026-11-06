import {realpath} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createLegacyConversationMapping} from '../tavern-plugin/lib/domain/legacy-conversation-mapping.js'

async function canonical(target){
 const absolute=path.resolve(target)
 try{return await realpath(absolute)}catch(error){
  if(error.code!=='ENOENT')throw error
  const parent=path.dirname(absolute)
  if(parent===absolute)throw error
  return path.join(await canonical(parent),path.basename(absolute))
 }
}
function contains(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))}

/** Read-only source audit. A verified shadow is never an authority switch. */
export async function verifyConversationMigration({sourceData,chatId,targetRoot,targetId=chatId}){
 if(!sourceData||!chatId||!targetRoot)throw Error('Required: --source-data, --chat, --target-root')
 const sourcePath=await canonical(sourceData),destination=await canonical(targetRoot)
 if(contains(sourcePath,destination)||contains(destination,sourcePath))throw Error('Source and target roots must be separate, non-overlapping directories')
 const source=createChatJournalStore({dataRoot:sourcePath,maxCachedChats:0})
 const before=await source.version(chatId)
 const started=performance.now(),chat=await source.read(chatId)
 const sourceReadMs=performance.now()-started
 if(!chat)throw Error('Source Chat not found')
 const captured=await source.version(chatId)
 if(before!==captured)throw Error('Source changed while reading; retry with a stable source')
 const store=createConversationPageStore({root:destination}),mapping=createLegacyConversationMapping({store})
 const importing=performance.now()
 const receipt=await mapping.importChat(targetId,chat)
 const importMs=performance.now()-importing
 const verifying=performance.now()
 const restored=await mapping.exportChat(targetId,{snapshotId:receipt.snapshotId})
 if(JSON.stringify(restored)!==JSON.stringify(chat))throw Error('Persisted legacy round-trip mismatch')
 const verifyMs=performance.now()-verifying
 const sourceChanged=await source.version(chatId)!==captured
 return {scope:'read-only journal source to isolated paged shadow; no production cutover',
  status:sourceChanged?'source-changed':'verified',...receipt,sourceReadMs,importMs,verifyMs,sourceChanged,activated:false}
}
async function main(){
 const values={},args=process.argv.slice(2),allowed=new Set(['--source-data','--chat','--target-root','--target-id'])
 for(let i=0;i<args.length;i+=2){
  if(!allowed.has(args[i])||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(values,args[i]))throw Error('Usage: node bin/verify-conversation-migration.mjs --source-data PATH --chat ID --target-root SEPARATE_PATH [--target-id ID]')
  values[args[i]]=args[i+1]
 }
 const result=await verifyConversationMigration({sourceData:values['--source-data'],chatId:values['--chat'],targetRoot:values['--target-root'],targetId:values['--target-id']})
 console.log(JSON.stringify(result,null,2))
 if(result.sourceChanged)process.exitCode=2
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error(error.message);process.exitCode=1})
}
