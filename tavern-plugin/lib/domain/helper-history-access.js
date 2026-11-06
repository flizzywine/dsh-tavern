import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// A read-only capability for one immutable Chat revision. No caller-supplied
// chat/revision can widen it; restarting the host invalidates all capabilities.
export function createHelperHistoryAccess({read}) {
 const secret=randomBytes(32)
 const sign=body=>createHmac('sha256',secret).update(body).digest()
 function issue({chatId,revision,messageCount}) {
  const body=Buffer.from(JSON.stringify({chatId,revision,messageCount})).toString('base64url')
  return {token:body+'.'+sign(body).toString('base64url'),revision,messageCount}
 }
 async function selected(token,from,to) {
  const [body,signature,...extra]=String(token||'').split('.')
  const supplied=Buffer.from(signature||'','base64url'),expected=sign(body||'')
  if(extra.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw Error('Invalid history capability')
  const scope=JSON.parse(Buffer.from(body,'base64url').toString())
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>=scope.messageCount||to-from>=48)throw Error('Invalid history range')
  const result=await read(scope.chatId,{from,to,revision:scope.revision})
  if(!result)throw Error('History revision unavailable')
  return {revision:scope.revision,from,to,messages:result.context.messages}
 }
 return Object.freeze({issue,read:selected})
}
