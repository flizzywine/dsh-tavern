#!/usr/bin/env node
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {exportConversationToFormat2,migrateConversationToSqlite} from '../tavern-plugin/lib/domain/conversation-storage-format.js'

export async function migrateConversationStorage({dataRoot,chatId,restoreLegacy=false,native=false,sqlite=false,exportFormat2=false,dryRun=false}){
 if(!dataRoot||!chatId)throw Error('Required: --data PATH --chat ID')
 const modes=[restoreLegacy,native,sqlite,exportFormat2].filter(Boolean)
 if(modes.length>1)throw Error('Only one of --native, --restore-legacy, --sqlite, --export-format-2 may be specified')
 const chatsRoot=path.join(path.resolve(dataRoot),'chats')
 if(sqlite)return migrateConversationToSqlite({root:chatsRoot,chatId,dryRun})
 if(exportFormat2)return exportConversationToFormat2({root:chatsRoot,chatId,inPlace:true})
 const store=createChatJournalStore({dataRoot:path.resolve(dataRoot)})
 return native?store.upgradeStorage(chatId):restoreLegacy?store.restoreLegacy(chatId):store.migrateCompatibility(chatId,{force:true})
}
async function main(){
 const args=process.argv.slice(2),values={}
 for(let i=0;i<args.length;i++){
  const key=args[i]
  if(['--restore-legacy','--native','--sqlite','--export-format-2','--dry-run'].includes(key)){if(values[key])throw Error('Duplicate option');values[key]=true;continue}
  if(!['--data','--chat'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||values[key])throw Error('Usage: node bin/migrate-conversation-storage.mjs --data PATH --chat ID [--native | --restore-legacy | --sqlite [--dry-run] | --export-format-2]')
  values[key]=args[++i]
 }
 const result=await migrateConversationStorage({dataRoot:values['--data'],chatId:values['--chat'],restoreLegacy:values['--restore-legacy']===true,native:values['--native']===true,sqlite:values['--sqlite']===true,exportFormat2:values['--export-format-2']===true,dryRun:values['--dry-run']===true})
 console.log(JSON.stringify(result,null,2))
 if(result.status==='missing'||(!values['--restore-legacy']&&!values['--dry-run']&&!['compatible','native','sqlite','format2'].includes(result.status)))process.exitCode=2
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1})
