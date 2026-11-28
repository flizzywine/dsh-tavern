const mark = stage => `console.log('[settlement-perf]'+JSON.stringify({stage:${JSON.stringify(stage)},at:performance.timeOrigin+performance.now()}));`
export async function load(url, context, next) {
  const result = await next(url, context)
  if (!url.includes('/tavern-plugin/lib/domain/')) return result
  let source = String(result.source)
  const replace = (from, to) => { if (!source.includes(from)) throw Error('Performance probe seam changed: ' + url + ' ' + from); source = source.replace(from, to) }
  if (url.endsWith('/request-performance.js')) {
    replace("['getSession', 'syncSession', 'getCardOpenings'", "['getSession', 'syncSession', 'hydrateTavernHelperMessages', 'getTavernHelperContext', 'recordMvuRuntimeDiagnostic', 'recordTavernCompatibilityCalls', 'getFullPromptTemplateState', 'saveFullPromptTemplateState', 'getCardOpenings'")
    replace('        append(recent, row, 120)', "        console.log('[settlement-perf]'+JSON.stringify({stage:'view-request',...row}));\n        append(recent, row, 120)")
  } else if (url.endsWith('/mvu-background-settlement.js')) {
    replace("      await record('submitted', { operations: submission.operations })", mark('submitted') + "\n      await record('submitted', { operations: submission.operations })")
    replace('    const applied = await options.runtime.settleMvuUpdate({', mark('runtime-start') + '\n    const applied = await options.runtime.settleMvuUpdate({')
    replace('    if (applied.deferred === true || applied.stale === true)', mark('runtime-return') + '\n    if (applied.deferred === true || applied.stale === true)')
    replace("    await record('finished', { status: result.receipt.status })", mark('settlement-return') + "\n    await record('finished', { status: result.receipt.status })")
  } else if (url.endsWith('/native-conversation-storage.js')) {
    replace('  const loading=(async()=>{', "console.log('[settlement-perf]'+JSON.stringify({stage:'summary-history-read',at:performance.timeOrigin+performance.now(),caller:new Error().stack.split('\\n').slice(2,12)}));" + '\n  const loading=(async()=>{')
    replace(' async function readIndexedSceneState(id,options){', " async function readIndexedSceneState(id,options){\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'scene-point-read',at:performance.timeOrigin+performance.now(),count:options.turns.length}));")
    replace('  return projectSceneImageState({...chat,messages})', mark('scene-full-read') + '\n  return projectSceneImageState({...chat,messages})')
    replace('  async function ensure(indices){', "  async function ensure(indices){\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'settlement-history-load',at:performance.timeOrigin+performance.now(),full:indices===undefined,count:indices?.length??count,revision:view.state.chatRevision}));")
    replace(' async function readHelperContext(id,range){', " async function readHelperContext(id,range){\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'helper-context-read',at:performance.timeOrigin+performance.now(),from:range?.from,to:range?.to,full:!range,caller:new Error().stack.split('\\n').slice(2,11)}));")
  } else if (url.endsWith('/tavern-script-host-adapter.js')) {
    replace('    const chat = scoped?.chat || resourceHeader?.chat || fallbackChat || await mutationChat(sessionId, eventId)', "    console.log('[settlement-perf]'+JSON.stringify({stage:'variable-write-scope',at:performance.timeOrigin+performance.now(),type:option?.type,scoped:Boolean(scoped),baselineRevision:contextBaseline?.stateRevision}));\n    const chat = scoped?.chat || resourceHeader?.chat || fallbackChat || await mutationChat(sessionId, eventId)")
    replace('      async function executionContext(baseline) {', "      async function executionContext(baseline) {\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'context-baseline',at:performance.timeOrigin+performance.now(),baseline,currentRevision:current._storageRevision,currentMessages:current.messages.length}));")
    replace("            const changed = await options.resolveChangedChatSlice?.(sessionId, baseline.stateRevision, 'settlement')", "            const changed = await options.resolveChangedChatSlice?.(sessionId, baseline.stateRevision, 'settlement')\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'context-changes',at:performance.timeOrigin+performance.now(),available:Boolean(changed),layoutChanged:changed?.layoutChanged,layoutFrom:changed?.layoutFrom,count:changed?.indices?.length,baseRevision:changed?.baseRevision,revision:changed?.chat?._storageRevision}));")
    replace('        if (!indices) return projected', "console.log('[settlement-perf]'+JSON.stringify({stage:'execution-context',at:performance.timeOrigin+performance.now(),compact:Boolean(indices),messages:projected.messages.length,total:current.messages.length}));\n        if (!indices) return projected")
    replace("      const dispatched = await options.scriptDispatch.dispatch(sessionId, 'MESSAGE_RECEIVED'", "console.log('[settlement-perf]'+JSON.stringify({stage:'dispatch-start',at:performance.timeOrigin+performance.now(),eventId:transaction.eventId}));\n      const dispatched = await options.scriptDispatch.dispatch(sessionId, 'MESSAGE_RECEIVED'")
    replace("    const chat = window?.chat || (reuse ? selected.chat : changed ? changed.chat : await resolveChat(sessionId))", "    console.log('[settlement-perf]'+JSON.stringify({stage:'template-read',at:performance.timeOrigin+performance.now(),windowed,window:Boolean(window),reuse:Boolean(reuse),changed:Boolean(changed),hasCursor:Boolean(cursor)}));\n    const chat = window?.chat || (reuse ? selected.chat : changed ? changed.chat : await resolveChat(sessionId))")
    replace("  async function saveTemplatePatch(sessionId, request) {", "  async function saveTemplatePatch(sessionId, request) {\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'template-save',at:performance.timeOrigin+performance.now(),stateRevision:request?.stateRevision,changes:Array.isArray(request?.changes)?request.changes.slice(0,6).map(c=>({path:c.path,op:c.op,value:JSON.stringify(c.value)?.slice(0,120)})):null}));")
    replace("    const patch = Array.isArray(request?.changes)\n    if (!patch) validateFullPromptTemplateSave(request)", "    console.log('[settlement-perf]'+JSON.stringify({stage:'template-save-full',at:performance.timeOrigin+performance.now(),patch:Array.isArray(request?.changes),paths:Array.isArray(request?.changes)?[...new Set(request.changes.map(c=>c.path.slice(0,3).map(p=>typeof p==='number'?'#':p).join('.')))].slice(0,20):null,stateRevision:request?.stateRevision}));\n    const patch = Array.isArray(request?.changes)\n    if (!patch) validateFullPromptTemplateSave(request)")
  } else if (url.endsWith('/foreground-handoff.js')) {
    // Each wait the next turn's preparation goes through, to see which one holds a send.
    replace('    await options.waitReconcile?.(input.sessionId)', mark('prepare-start') + '\n    await options.waitReconcile?.(input.sessionId)')
    replace('    if (chat !== undefined) await options.beforeNextTurn?.(chat)', '    if (chat !== undefined) await options.beforeNextTurn?.(chat)\n' + mark('prepare-background-waited'))
    replace('    if (chat !== undefined) await options.syncWorldBook?.(chat)', '    if (chat !== undefined) await options.syncWorldBook?.(chat)\n' + mark('prepare-worldbook-synced'))
  } else if (url.endsWith('/background-task-coordinator.js')) {
    replace('      async commit(input = {}) {', '      async commit(input = {}) {\n' + mark('commit-start') + '\ntry {')
    replace('      },\n      async fail(trace)', '} finally {' + mark('commit-return') + '}\n      },\n      async fail(trace)')
  } else if (url.endsWith('/chat-journal-store.js')) {
    replace('  async function read(chatId) {', "  async function read(chatId) {\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'full-read',at:performance.timeOrigin+performance.now(),caller:new Error().stack.split('\\n').slice(2,11).map(line=>line.replace(/file:.*?\\/tavern-plugin\\//,'tavern-plugin/'))}));")
    replace('  async function cachedState(chatId) {', "  async function cachedState(chatId) {\nconst perfCaller=new Error().stack.split('\\n').slice(2,11).map(line=>line.replace(/file:.*?\\/tavern-plugin\\//,'tavern-plugin/'));")
    replace('    const load = { stamp }', "    console.log('[settlement-perf]'+JSON.stringify({stage:'full-read-miss',at:performance.timeOrigin+performance.now(),caller:perfCaller}));\n    const load = { stamp }")
    replace('        const saved = await native.patch(chatId,expectedRevision,normalized,metadata.assertCurrent,metadata.returnProjection)', "        const saved = await native.patch(chatId,expectedRevision,normalized,metadata.assertCurrent,metadata.returnProjection)\nif(saved)console.log('[settlement-perf]'+JSON.stringify({stage:'native-head-published',at:performance.timeOrigin+performance.now(),source:metadata.source,revision:saved.revision}));")
    for (const state of ['state','currentState']) {
      const seam=`        const saved=await native.write(chatId,${state},next,changes,metadata.assertCurrent)`
      replace(seam,seam+"\nconsole.log('[settlement-perf]'+JSON.stringify({stage:'native-head-published',at:performance.timeOrigin+performance.now(),source:metadata.source,revision:saved.revision}));")
    }
    replace('    if (bytes > cacheMaxBytes) return', "    if (bytes > cacheMaxBytes) { console.log('[settlement-perf]'+JSON.stringify({stage:'cache-oversized',at:performance.timeOrigin+performance.now(),bytes,limit:cacheMaxBytes,revision:state.revision})); return }")
    replace("    await appendFile(openPath, encodeFrame(frame), 'utf8')", "    await appendFile(openPath, encodeFrame(frame), 'utf8')\n" + "console.log('[settlement-perf]'+JSON.stringify({stage:'journal-appended',at:performance.timeOrigin+performance.now(),source:frame.source,revision:frame.revision}));")
  }
  return { ...result, source }
}
