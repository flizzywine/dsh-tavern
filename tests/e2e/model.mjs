import { recoveryBlocks } from './recovery-model.mjs'
import { compactionStream, modelCapacity } from './compaction-model.mjs'
// The only substituted boundary: fixed provider output. Tools execute normally.
import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { LlmAdapter } = await import(pathToFileURL(process.env.TAVERN_E2E_LLM_MODULE))
export const inject = ['llm']
export function apply(ctx) {
  class Model extends LlmAdapter {
    async resolveModel(provider, id) {
      return { provider, id, name: 'E2E fixed model', ...(process.env.TAVERN_E2E_COMPACTION_DIR ? { defaultMaxTokens: 8192 } : {}), context: { contextWindow: process.env.TAVERN_E2E_COMPACTION_DIR ? await modelCapacity() : 64000 } }
    }
    async *stream(input) {
      if (process.env.TAVERN_E2E_COMPACTION_DIR) { yield* compactionStream(input); return }
      const tools = new Set((input.tools || []).map(tool => tool.name))
      if(process.env.TAVERN_E2E_DIRECTOR_DIR && (tools.has('stage_update')||tools.has('submit_direction'))) {
        const directory=process.env.TAVERN_E2E_DIRECTOR_DIR
        const control=JSON.parse(await readFile(directory+'/director-control.json','utf8'))
        await appendFile(directory+'/director-attempts.jsonl',JSON.stringify({mode:control.mode,tools:[...tools]})+'\n')
        if(control.mode==='fail')throw new Error('E2E stage director unavailable')
        const parts=input.messages.flatMap(message=>message.content||[])
        const objects=parts.filter(block=>block.type==='text').flatMap(block=>embeddedObjects(block.text))
        const reply=objects.findLast(value=>Array.isArray(value.reply))?.reply||[]
        const through=Math.max(...reply.map(row=>row.at))
        if(!Number.isInteger(through)||through<1)throw new Error('E2E director reply fixture is missing')
        const tool=tools.has('stage_update')?'stage_update':'submit_direction'
        const block={type:'tool-call',id:'e2e-stage-'+Date.now(),name:tool,arguments:JSON.stringify(tool==='stage_update'?{sequence:objects.findLast(value=>value.progress)?.progress.nextSequence||1,through,done:true,beats:[]}:{beats:[]})}
        yield {type:'block-start',index:0,blockType:'tool-call'}
        yield {type:'block-end',index:0,block}
        yield {type:'finish',reason:{kind:'tool-calls'}}
        return
      }

      // Every settlement request verbatim, to compare refactors of the background pipeline.
      if (process.env.TAVERN_E2E_SETTLEMENT_DUMP && JSON.stringify(input.messages || []).includes('任务类型：状态结算')) {
        await appendFile(process.env.TAVERN_E2E_SETTLEMENT_DUMP, JSON.stringify({ system: input.system, tools: (input.tools || []).map(tool => tool.name), messages: input.messages }) + '\n')
      }
      // Every background request (settlement, posture, candidates) verbatim.
      if (process.env.TAVERN_E2E_BACKGROUND_DUMP && (tools.has('posture_submit') || tools.has('mvu_submit_update') || tools.has('candidate_submit_choices'))) {
        await appendFile(process.env.TAVERN_E2E_BACKGROUND_DUMP, JSON.stringify({ at: Date.now(), system: input.system, tools: [...tools], messages: input.messages }) + '\n')
      }
      if (process.env.TAVERN_E2E_MEMORY_AUDIT) {
        await appendFile(process.env.TAVERN_E2E_MEMORY_AUDIT, JSON.stringify({ system: input.system, messages: input.messages, tools: input.tools }) + '\n')
        if (tools.has('tavern_memory_search')) {
          const text = JSON.stringify(input.messages)
          const done = input.messages.some(message => (message.content || []).some(block => block.type === 'tool-result' && block.toolCallId === 'memory-preference-save'))
          const block = text.includes('E2E_MEMORY_NEXT') ? { type: 'text', text: '已读取改卡偏好。' }
            : text.includes('E2E_MEMORY_SAVE') && !done ? { type: 'tool-call', id: 'memory-preference-save', name: 'tavern_memory_preference', arguments: JSON.stringify({ action: 'add', content: '保留原卡结构，不重写开场白' }) }
            : { type: 'text', text: done ? '改卡偏好已保存。' : '卡片工作台就绪。' }
          yield { type: 'block-start', index: 0, blockType: block.type }
          yield { type: 'block-end', index: 0, block }
          yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
          return
        }
      }
      // Scene planning: draft the layout, confirm the plan, then report. An added
      // picture (its input carries `addition`) gets a different scene.
      if (tools.has('submit_scene_layout')) {
        const latest = input.messages.findLastIndex(message => message.role === 'user' && (message.content || []).some(block => block.type === 'text'))
        const request = JSON.stringify(input.messages[latest]?.content || [])
        const after = input.messages.slice(latest + 1).flatMap(message => message.content || [])
        const called = name => after.some(block => block.type === 'tool-call' && block.name === name)
        const addition = request.includes('\\"addition\\"')
        const id = 'e2e-scene-' + latest
        const block = !called('submit_scene_layout') ? { type: 'tool-call', id: id + '-layout', name: 'submit_scene_layout', arguments: JSON.stringify({ description: addition ? '柜台上的金币' : '领取奖励', subjects: [], continuity: 'uncertain', moment: 'end', orientation: 'square', anchor: '',
          scene: { composition: addition ? { text: '柜台上的金币特写', tags: 'gold coins on a wooden counter, close-up' } : { text: '酒馆柜台前领取奖励', tags: 'tavern counter, receiving a reward' } } }) }
          : !called('submit_scene_plan') ? { type: 'tool-call', id: id + '-plan', name: 'submit_scene_plan', arguments: '{}' }
          : { type: 'text', text: '插图已完成。' }
        yield { type: 'block-start', index: 0, blockType: block.type }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
        return
      }
      // Native repair scenario: record what each foreground body request lets the model read.
      if (process.env.TAVERN_E2E_CONTEXT_AUDIT && !tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')) {
        await appendFile(process.env.TAVERN_E2E_CONTEXT_AUDIT, JSON.stringify({ at: Date.now(), messages: input.messages.map(message => ({ role: message.role,
          text: (Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'text').map(block => block.text).join('') })) }) + '\n')
      }
      // Truncation scenario: only the latest user input decides, so later turns answer normally.
      const latestUser = JSON.stringify(input.messages.slice(input.messages.findLastIndex(message => message.role === 'assistant') + 1))
      if (process.env.E2E_TRUNCATE_LOG) await appendFile(process.env.E2E_TRUNCATE_LOG, JSON.stringify({ at: Date.now(), tools: [...tools], tail: input.messages.slice(-4).map(m => ({ role: m.role, content: JSON.stringify(m.content).slice(0, 160) })) }) + '\n')
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && /E2E_TRUNCATE_(TEXT|THINK|LOOP)/.test(latestUser)) {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' }
        yield { type: 'text-delta', index: 0, text: '构思正文。' }
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '构思正文。' } }
        if (!latestUser.includes('E2E_TRUNCATE_THINK')) {
          // LOOP models a degenerate repetition that only stops at the provider output limit.
          const text = latestUser.includes('E2E_TRUNCATE_LOOP') ? '<content>\n' + '雨水顺着屋檐落下，她又说了一遍。'.repeat(Number(process.env.E2E_TRUNCATE_LOOP_REPEAT) || 40000) : '<content>\n你推开酒馆的门，雨水顺着'
          yield { type: 'block-start', index: 1, blockType: 'text' }
          for (let offset = 0; offset < text.length; offset += 64) yield { type: 'text-delta', index: 1, text: text.slice(offset, offset + 64) }
        }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      const latestInput = JSON.stringify(input.messages.slice(input.messages.findLastIndex(message => message.role === 'assistant') + 1))
      // Slow reply: streams for ~20 s so the player can press stop mid-reply.
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && latestInput.includes('E2E_SLOW')) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        for (let i = 0; i < 40; i++) {
          if (input.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }; return }
          yield { type: 'text-delta', index: 0, text: (i ? '' : '<content>\n') + '雨一直下，' }
          await new Promise(resolve => { const timer = setTimeout(resolve, 500); input.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '<content>\n' + '雨一直下，'.repeat(40) } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      // Tool round trips before the story (#222): two steps that only think and read variables, then the text.
      // This round so far: everything after the last reply that was not a tool step.
      const sinceUser = input.messages.slice(input.messages.findLastIndex(message => message.role === 'assistant' && !(message.content || []).some(block => block.type === 'tool-call')) + 1)
      if (tools.has('tavern_read_variables') && JSON.stringify(sinceUser).includes('E2E_TOOL_STEPS')) {
        const since = sinceUser
        const reads = since.flatMap(message => message.content || []).filter(block => block.type === 'tool-result' && String(block.toolCallId).startsWith('e2e-read-')).length
        if (reads < 2) {
          const block = { type: 'tool-call', id: 'e2e-read-' + reads + '-' + Date.now(), name: 'tavern_read_variables', arguments: JSON.stringify({ action: 'list' }) }
          // Reasoning models think before each call, so the step has an Assistant node of its own.
          yield { type: 'block-start', index: 0, blockType: 'reasoning' }
          yield { type: 'text-delta', index: 0, text: '先查一下数值。' }
          yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先查一下数值。' } }
          yield { type: 'block-start', index: 1, blockType: 'tool-call' }
          yield { type: 'block-end', index: 1, block }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
      }
      // Ordinary provider failure (not moderation): the round fails before any text.
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && latestInput.includes('E2E_PROVIDER_ERROR')) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: '503 Service Unavailable', code: 'PI_AI_ERROR' } } }
        return
      }
      // Mid-stream filter: part of the body already streamed, then the provider cuts it off.
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && latestInput.includes('E2E_FILTER_MIDSTREAM')) {
        const text = '<content>\n你推开酒馆的门，她抬起头，'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        // Real providers cut the stream after the text has already rendered; the
        // pause lets the browser materialize the streaming turn before the error.
        await new Promise(resolve => { const timer = setTimeout(resolve, 1500); input.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
        if (input.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }; return }
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: content_filter', code: 'PI_AI_ERROR' } } }
        return
      }
      // Poisoned history: a committed round's content trips the filter on every later request.
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && JSON.stringify(input.messages).includes('E2E_POISON') && !latestInput.includes('E2E_POISON')) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '<content>\n她抬起头，' }
        await new Promise(resolve => { const timer = setTimeout(resolve, 1500); input.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: content_filter', code: 'PI_AI_ERROR' } } }
        return
      }
      // Refusal scenario: the latest marker decides; settlement and candidate tasks are unaffected.
      const marked = JSON.stringify(input.messages)
      if (!tools.has('mvu_submit_update') && !tools.has('candidate_submit_choices') && !tools.has('posture_submit')
        && (marked.includes('E2E_CONTENT_FILTER') || marked.includes('E2E_REFUSE_TEXT'))) {
        if (marked.lastIndexOf('E2E_CONTENT_FILTER') > marked.lastIndexOf('E2E_REFUSE_TEXT')) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: content_filter', code: 'PI_AI_ERROR' } } }
          return
        }
        const block = { type: 'text', text: '我无法协助生成涉及这类露骨内容的描写。\n\n如果您希望继续推进后续剧情，可以换一个方向。' }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: block.text }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const recovery = await recoveryBlocks(input, tools)
      if (recovery) {
        for (const [index, block] of recovery.entries()) {
          yield { type: 'block-start', index, blockType: block.type }
          yield { type: 'block-end', index, block }
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      let heldAttempt
      if (process.env.TAVERN_E2E_BACKGROUND_DIR && tools.has('mvu_submit_update')) {
        const file = process.env.TAVERN_E2E_BACKGROUND_DIR + '/background-control.json'
        const control = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
        if (control.mode === 'fail') throw new Error('E2E background model unavailable')
        if (control.mode === 'hold') {
          heldAttempt = control.attempt
          await appendFile(process.env.TAVERN_E2E_BACKGROUND_DIR + '/background-attempts.jsonl', JSON.stringify({attempt:control.attempt})+'\n')
          // Deliberately ignore cancellation: the host must reject any late tool call.
          const deadline=Date.now()+60000
          while(Date.now()<deadline && JSON.parse(await readFile(file,'utf8')).mode==='hold') await new Promise(resolve=>setTimeout(resolve,50))
        }
      }
      const done = new Set(input.messages.flatMap(message => message.content || [])
        .filter(block => block.type === 'tool-result').map(block => block.toolCallId))
      const text = JSON.stringify(input.messages)
      const presetRound = [70, 60, 55, 50].find(value => text.includes(`E2E 预设验收 ${value}`) || text.includes(`预设切换后继续游玩，金币 ${value}。`))
      const cardUpdate = (text.includes('E2E 更新后继续') || text.includes('更新后的世界中，你又获得十枚金币'))
      const perf = process.env.TAVERN_E2E_PERFORMANCE_DIR ? JSON.parse(await readFile(process.env.TAVERN_E2E_PERFORMANCE_DIR + '/performance-control.json', 'utf8').catch(() => 'null')) : null
      const gold = perf?.gold ?? (cardUpdate ? 20 : presetRound || (text.includes('E2E 修正金币为四十') ? 40 : (text.includes('雨夜重写') || text.includes('雨夜里')) ? 30 : (text.includes('再次领取奖励') || text.includes('金币累计二十枚')) ? 20 : 10))
      const goldId = perf ? 'perf-gold-' + perf.id : 'e2e-gold-' + gold, postureId = 'e2e-posture-' + gold
      const blocks = []
      if (tools.has('candidate_submit_choices')) blocks.push({ type: 'tool-call', id: 'e2e-choices', name: 'candidate_submit_choices', arguments: JSON.stringify({ actions: ['再次领取奖励', '向店主道谢', '查看任务告示', '清点背包'], scene: '夜幕降临酒馆' }) })
      // The 大肥鱼 card plugin (examples/dafeiyu-card): direct the stage from the listed scenes and music.
      const directorNote = /【舞台导演】[^【]*/.exec(input.messages.flatMap(message => message.content || []).map(block => block.text || '').filter(item => item.includes('【舞台导演】')).at(-1) || '')?.[0]
      if (tools.has('galgame_direct') && directorNote && !done.has('e2e-direct-' + gold)) blocks.push({
        type: 'tool-call', id: 'e2e-direct-' + gold, name: 'galgame_direct',
        arguments: JSON.stringify({ scene: /可选场景（[^）]*）：([^：；\n]+)：/.exec(directorNote)?.[1], time: 'night', outfit: 'claude', music: /音乐（[^）]*）：([^：；\n]+)：/.exec(directorNote)?.[1] })
      })
      if (tools.has('mvu_submit_update') && !done.has(goldId)) blocks.push({
        type: 'tool-call', id: goldId, name: 'mvu_submit_update',
        arguments: JSON.stringify({ operations: [{ op: 'replace', path: cardUpdate ? '/stat_data/coins' : '/stat_data/gold',
          valueJson: process.env.TAVERN_E2E_WRONG_GOLD === '1' ? '9' : String(gold) }] })
      })
      if (tools.has('posture_submit') && !done.has(postureId)) blocks.push({
        type: 'tool-call', id: postureId, name: 'posture_submit',
        arguments: JSON.stringify({ posture: '站在柜台前，收下奖励。' })
      })
      if (!blocks.length) blocks.push({ type: 'text', text: (process.env.TAVERN_E2E_CAST === '1' ? (text.includes('<dialogue_format>') ? '店主笑着迎上来。\n@bubble:shopkeeper|店主|开心|[欢迎回来，这是你的奖励。]\n你接过钱袋。\n@bubble:ni|你|感激|[谢谢。]\n' : '店主笑着说：“欢迎回来，这是你的奖励。”\n你接过钱袋：「谢谢。」\n') : '') + (cardUpdate ? '更新后的世界中，你又获得十枚金币。' : presetRound ? `预设切换后继续游玩，金币 ${gold}。` : gold === 30 ? '雨夜里，你重新领取了奖励。' : gold === 20 ? '你再次领取了奖励，金币累计二十枚。' : '你获得了十枚金币。') + (process.env.TAVERN_E2E_PERFORMANCE_DIR && process.env.TAVERN_PERF_HISTORY_READY === '1' ? '\n' + '这是性能测试的合成剧情，不对应真实存档。'.repeat(Number(process.env.TAVERN_PERF_BODY_REPEATS || 60)) : '') + '\n\n<StatusPlaceHolderImpl/>' })
      if (cardUpdate && process.env.TAVERN_E2E_REQUEST_AUDIT) await appendFile(process.env.TAVERN_E2E_REQUEST_AUDIT, JSON.stringify({cardUpdate:true,newWorldbook:text.includes(tools.has('mvu_submit_update') ? 'E2E_LIVE_MVU_RULES_V2' : 'E2E_LIVE_WORLDBOOK_V2'),settlement:tools.has('mvu_submit_update') || tools.has('posture_submit')})+'\n')
      if (presetRound && blocks.some(block => block.type === 'text') && process.env.TAVERN_E2E_REQUEST_AUDIT) {
        await appendFile(process.env.TAVERN_E2E_REQUEST_AUDIT, JSON.stringify({ gold,
          presetA: text.includes('E2E_PRESET_A_ACTIVE'), presetB: text.includes('E2E_PRESET_B_ACTIVE'),
          settlement: tools.has('mvu_submit_update') || tools.has('posture_submit') }) + '\n')
      }
      // Story submitted through submit_story: the body travels as the tool argument.
      if (tools.has('submit_story') && blocks.length === 1 && blocks[0].type === 'text') {
        const content = process.env.TAVERN_E2E_STORY_TOOL_LONG ? blocks[0].text + '\n\n' + Array.from({ length: Number(process.env.TAVERN_E2E_STORY_TOOL_LONG) || 60 }, (_, index) => `第 ${index + 1} 段验收正文：雨声落在窗台上，掌柜把铜币一枚枚推过来。`).join('\n\n') : blocks[0].text
        blocks[0] = { type: 'tool-call', id: 'e2e-story-' + input.messages.length + '-' + Date.now(), name: 'submit_story', arguments: JSON.stringify({ content }) }
        if (process.env.TAVERN_E2E_STORY_TOOL_LOG) await appendFile(process.env.TAVERN_E2E_STORY_TOOL_LOG, JSON.stringify({ content }) + '\n')
      }
      // Put the state-changing call first so cancellation is tested against an MVU write.
      if (heldAttempt !== undefined) blocks.sort((a, b) => Number(b.name === 'mvu_submit_update') - Number(a.name === 'mvu_submit_update'))
      for (const [index, block] of blocks.entries()) {
        if (heldAttempt !== undefined && block.type === 'tool-call') await appendFile(process.env.TAVERN_E2E_BACKGROUND_DIR + '/background-late.jsonl', JSON.stringify({attempt:heldAttempt, tool:block.name})+'\n')
        yield { type: 'block-start', index, blockType: block.type }
        // Real providers stream text before closing the block; helper generation reads deltas.
        if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
        yield { type: 'block-end', index, block }
      }
      yield { type: 'finish', reason: { kind: blocks.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['tavern-e2e'], new Model())
}

// Background sessions combine request blocks with explanatory prose. Read the
// embedded JSON objects without assuming one provider text block per object.
function embeddedObjects(text) {
  const values=[]
  for(let start=0;start<text.length;start++) {
    if(text[start]!=='{')continue
    let depth=0,quoted=false,escaped=false
    for(let end=start;end<text.length;end++) {
      const char=text[end]
      if(quoted) {
        if(escaped)escaped=false
        else if(char==='\\')escaped=true
        else if(char==='"')quoted=false
      } else if(char==='"')quoted=true
      else if(char==='{')depth++
      else if(char==='}'&&!--depth) {
        try {values.push(JSON.parse(text.slice(start,end+1)));start=end} catch {}
        break
      }
    }
  }
  return values
}
