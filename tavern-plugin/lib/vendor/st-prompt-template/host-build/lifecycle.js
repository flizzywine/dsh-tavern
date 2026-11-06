import {templateHistoryIndices} from './history-window.js'
import { sameTemplateValue as same } from '../../../domain/template-state-patch.js'
import xxhash from 'xxhash-wasm'
import { eventSource, chat, getCurrentChatId, saveChatConditional } from './host.js'
import { mountTemplateMessages, captureTemplateDisplay } from './dom.js'
import { settings } from '../upstream/src/modules/ui.ts'

const copy = value => structuredClone(value)
const matches = (display, message) => display?.source === message.mes && display.swipe === (message.swipe_id || 0)

/** Historical display belongs to its message version, not today's variables. */
export function createTemplateLifecycle() {
  const hashing = xxhash()
  let previous, worlds, features, definition
  return async function synchronize(snapshot, changes) {
    if (snapshot.dsh?.settling) return { deferred: true }
    const currentDefinition = {characters:snapshot.characters,name1:snapshot.name1,name2:snapshot.name2}
    const changedDefinition = !same(definition,currentDefinition)
    const changedWorlds = !same(worlds, snapshot.worldbooks)
    const changedSettings = !same(features, snapshot.extension_settings.EjsTemplate)
    if (changedSettings) await eventSource.emit('SETTINGS_LOADED')
    if (!previous || changedWorlds || changedSettings || changedDefinition) {
      await eventSource.emit('CHAT_CHANGED', getCurrentChatId())
      if (previous && changedWorlds) for (const [name, book] of Object.entries(snapshot.worldbooks || {})) await eventSource.emit('WORLDINFO_UPDATED', name, book)
    }
    const { h64ToString } = await hashing
    const pending = new Set()
    for (const index of changes ?? templateHistoryIndices(chat) ?? chat.keys()) {
      if (index >= chat.length) continue;
      const message = chat[index]
      if (!(message.template_rendered?.hash === h64ToString(message.mes) && message.template_rendered.swipe === (message.swipe_id || 0)) && !matches(message.template_display,message)) pending.add(index)
    }
    // Yield between bounded batches so generation work can run before the next batch.
    const batch = new Set(settings.enabled && settings.render_enabled ? [...pending].slice(0, 8) : pending)
    mountTemplateMessages({renderIndices:settings.enabled && settings.render_enabled ? batch : new Set()})
    if (previous && chat.length < previous.length) await eventSource.emit('MESSAGE_DELETED', chat.length)
    for (const index of batch) {
      const message = chat[index], old = previous?.[index]
      const swipe = message.swipe_id || 0
      const sourceChanged = !old || old.mes !== message.mes || old.swipe_id !== swipe
      if (!old && previous) await eventSource.emit(message.is_user ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED', index)
      else if (old && old.swipe_id !== swipe) await eventSource.emit('MESSAGE_SWIPED', index)
      else if (old && old.mes !== message.mes) {
        message.is_ejs_processed ||= []; message.is_ejs_processed[swipe] = false
        await eventSource.emit('MESSAGE_EDITED', index)
      }
      if (old && (old.swipes?.length || 0) > (message.swipes?.length || 0)) await eventSource.emit('MESSAGE_SWIPE_DELETED', index, old.swipes.findIndex((text, i) => text !== message.swipes[i]))
      if (!old || old.swipe_id === swipe) await eventSource.emit(message.is_user ? 'USER_MESSAGE_RENDERED' : 'CHARACTER_MESSAGE_RENDERED', String(index), 'template-host', !sourceChanged || (!old && Boolean(message.is_ejs_processed?.[swipe])))
      if (settings.enabled && settings.render_enabled) {
        const display = captureTemplateDisplay(message,index)
        if (display) message.template_display = display
        else delete message.template_display
        message.template_rendered = {hash:h64ToString(message.mes),swipe:message.swipe_id || 0}
      }
    }
    if (pending.size) await saveChatConditional()
    if (changedDefinition) definition = copy(currentDefinition)
    const nextPrevious=new Array(chat.length)
    for(const index of templateHistoryIndices(chat) ?? chat.keys()) {
      const {mes,swipe_id,swipes}=chat[index]
      nextPrevious[index]=pending.has(index) && !batch.has(index) ? previous?.[index] : {mes,swipe_id,swipes:[...(swipes || [])]}
    }
    previous=nextPrevious
    if (changedWorlds) worlds = copy(snapshot.worldbooks)
    if (changedSettings) features = copy(snapshot.extension_settings.EjsTemplate)
    return { synchronized: batch.size > 0, deferred: pending.size > batch.size }
  }
}
