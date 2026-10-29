import { LlmAdapter } from '@deepseek-ai/dsh-llm'

// Installed only by the isolated scenario. This substitutes model output, never stage APIs.
export const name = 'stage-stream-fixture'
export const inject = ['llm', 'tavern']
export function apply(ctx) {
  let mode = 'normal', gates = {}, released = {}, foreground = 0, late = 0
  const requests = [], receipts = [], warnings = []
  ctx.effect(() => {
    const warn = console.warn
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); warn(...args) }
    return () => { console.warn = warn }
  })
  ctx.tavern.handle('stage-stream-fixture/control', ({ action, value } = {}) => {
    if (action === 'arm') { mode = value; gates = {}; released = {}; if (mode === 'normal') { requests.length = 0; receipts.length = 0; foreground = 0; late = 0 } }
    if (action === 'body' || action === 'late') { released[action] = true; gates[action]?.() }
    return { requests, receipts, foreground, late, warnings }
  })
  function wait(key, signal) {
    if (released[key] || signal?.aborted) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(() => { signal?.removeEventListener('abort', done); reject(Error('Fixture gate timed out: ' + key)) }, 60000)
      gates[key] = done
      signal?.addEventListener('abort', done, { once: true })
    })
  }
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: 'Synthetic stage stream', context: { contextWindow: 64000 } } }
    async *stream(input) {
      const tools = new Set((input.tools || []).map(tool => tool.name))
      const blocks = input.messages.flatMap(message => message.content || [])
      const text = blocks.map(block => block.text || '').join('\n')
      let block
      if (tools.has('stage_update')) {
        if (tools.size !== 1) throw Error('Director must expose only its submission tool')
        const note = JSON.parse(text.split('\n').findLast(line => /^\{"(window|state)":/.test(line)))
        const results = input.messages.slice(input.messages.findLastIndex(message => message.role === 'user') + 1)
          .filter(message => message.role === 'tool').flatMap(message => message.content || [])
        const window = note.window || { sequence: 1, first: 1, through: 7 }
        requests.push({ sessionId: input.sessionId, mode, window, reference: note.reference, bytes: {
          system: Buffer.byteLength(input.messages.filter(message => message.role === 'system').flatMap(message => message.content || []).map(block => block.text || '').join('\n')),
          context: Buffer.byteLength(JSON.stringify(note)), reference: Buffer.byteLength(JSON.stringify(note.reference || {})),
          toolSchemaBytes: Buffer.byteLength(JSON.stringify(input.tools.find(tool => tool.name === 'stage_update').parameters)) } })
        receipts.push(...results)
        if (mode === 'late') { await wait('late'); late++ }
        const { first, ...seal } = note.window || {}
        const bad = window.sequence === 2 && results.length === 0
        block = { type: 'tool-call', id: 'stage-' + requests.length, name: 'stage_update', arguments: JSON.stringify({ ...seal,
          ...(mode === 'late' || bad ? { music: null } : {}), performances: [{ at: bad ? 1 : window.first, op: 'screen.play', effect: 'shake-1' }] }) }
      } else if (tools.has('candidate_submit_choices')) {
        block = { type: 'text', text: 'Done.' }
      } else if (text.includes('C07B_FLOW') || text.includes('C07B_CANCEL')) {
        foreground++
        const prefix = 'First sealed page.\nSecond page.\nThird page.\nFourth page.\nFifth page.\n'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: prefix }
        await wait('body', input.signal)
        if (input.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted' } }; return }
        const tail = 'Sixth page.\nSeventh page.'
        yield { type: 'text-delta', index: 0, text: tail }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: prefix + tail } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      } else block = { type: 'text', text: 'Done.' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['stage-stream-fixture'], new Model())
}
