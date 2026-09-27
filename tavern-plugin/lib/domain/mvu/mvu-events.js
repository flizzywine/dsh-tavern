// MVU 服务端事件总线（第二阶段 T1）
// 移植自 MagVarUpdate 的 variable_events 常量 + 酒馆 eventOn/eventEmit 语义：
// 监听器按注册顺序同步 await 派发；服务端钩子（卡脚本/宿主）通过 on() 注册。

export const VARIABLE_EVENTS = Object.freeze({
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    COMMAND_PARSED: 'mag_command_parsed',
    SINGLE_VARIABLE_UPDATED: 'mag_single_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
    VARIABLE_INITIALIZED: 'mag_variable_initialized',
})

const listeners = new Map()

export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return handler
}

export function off(event, handler) {
    const list = listeners.get(event)
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
}

export async function emit(event, ...args) {
    const list = listeners.get(event)
    if (!list) return
    for (const handler of [...list]) {
        await handler(...args)
    }
}

export function listenerCount(event) {
    return event === undefined ? [...listeners.values()].reduce((n, l) => n + l.length, 0) : (listeners.get(event)?.length || 0)
}

export function clearAllListeners() {
    listeners.clear()
}
