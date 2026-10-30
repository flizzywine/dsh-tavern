import {createDanmakuController} from './controller.js'

const sessions=new Map()
export function prepare() { return {sections:[]} }
export function command() { throw Object.assign(new Error('Danmaku has no director commands'),{code:'MOD_PERMISSION_DENIED'}) }
export function settled() { return null }
export function dispose() { sessions.clear();return null }
export async function event(message,host) {
  const key=message.context.sessionId
  let controller=sessions.get(key)
  if(!controller){controller=createDanmakuController();sessions.set(key,controller)}
  if(message.payload.host) {
    const {entries,settings,models}=message.payload.host
    message={...message,payload:{...message.payload,danmaku:{groups:entries,settings,model:models.audience}}}
  }
  const result=await controller.handle(message,host)
  if(message.event==='session.disposed')sessions.delete(key)
  return result
}
