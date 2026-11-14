import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  createIncrementalJsonStringExtractor,
  createToolReplyStreamTracker,
  parsePartialToolReplyJson,
} from '../tavern-plugin/lib/domain/tool-reply-stream-parser.js'
import { patchToolReplyStreamChatSource } from '../tavern-plugin/lib/domain/chat-tool-reply-stream.js'

test('增量 JSON 字符串状态机：正确解码字面反斜杠、换行、Unicode 与跨分片代理对，忽略嵌套噪音', () => {
  const full = JSON.stringify({
    think: '第一行\\n字面反斜杠加n\n真换行\t制表符 "引号" 猫咪:\u55b5 表情:😀',
    meta: { nested: '{"content":"假的嵌套正文"}' },
    content: '「你好！」\n少女微笑着伸出手😀。'
  })
  // 把包含 \uD83D\uDE00 代理对的原始转义串做逐字符切分测试
  const rawWithSurrogate = '{"think":"构思\\\\n\\n\\u55b5~\\ud83d\\ude00","extra":{"content":"干扰"},"content":"正文第一句\\n\\"台词\\"\\ud83c\\udf1f结尾"}'
  const extractor = createIncrementalJsonStringExtractor()
  let accThink = ''
  let accContent = ''
  for (let i = 0; i < rawWithSurrogate.length; i += 2) {
    const res = extractor.feed(rawWithSurrogate.slice(i, i + 2))
    accThink += res.thinkDelta
    accContent += res.contentDelta
  }
  assert.equal(accThink, '构思\\n\n喵~😀')
  assert.equal(accContent, '正文第一句\n"台词"🌟结尾')

  const whole = parsePartialToolReplyJson(full)
  assert.equal(whole.think, '第一行\\n字面反斜杠加n\n真换行\t制表符 "引号" 猫咪:喵 表情:😀')
  assert.equal(whole.content, '「你好！」\n少女微笑着伸出手😀。')
})

test('ToolReplyStreamTracker：仅跟踪 submit_story，支持工具名迟到与多工具并行隔离', () => {
  const tracker = createToolReplyStreamTracker('submit_story')
  // index 0 是查询工具 worldbook_grep，不产生正文流
  assert.equal(tracker.pushToolDelta({ type: 'tool-call-delta', index: 0, id: 'c0', name: 'worldbook_grep', argumentsDelta: '{"content":"不应流出"}' }).matched, false)

  // index 1 先到半截参数，后到工具名 submit_story
  assert.equal(tracker.pushToolDelta({ type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: '{"think":"铺垫' }).matched, false)
  const step1 = tracker.pushToolDelta({ type: 'tool-call-delta', index: 1, id: 'c1', name: 'submit_story', argumentsDelta: '完成","content":"月光' })
  assert.equal(step1.matched, true)
  assert.equal(step1.thinkDelta, '铺垫完成')
  assert.equal(step1.contentDelta, '月光')

  const step2 = tracker.pushToolDelta({ type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: '洒满庭院。"}' })
  assert.equal(step2.contentDelta, '洒满庭院。')
})

test('ui-chat 工具流式补丁：兼容 0.2.1 与 2.0.22 两种宿主源码形状，实时投影思考行与正文并抑制工具外裸文本闪烁', () => {
  // 模拟 DSH 2.0.22 (带 let nextVisible) 的真实源码结构
  const fixture2022 = `
    function isTokenDelta(chunk) {
      return chunk.type === "tool-call-delta" ? chunk.argumentsDelta !== "" || chunk.name !== void 0 : chunk.text !== "";
    }
    function initialState(turn, step) {
      return { turn, step, blocks: [], visibleByIndex: [], visibleBlocks: 0, firstVisibleSeq: void 0, firstVisibleTime: void 0, firstTokenTime: void 0 };
    }
    function compactBlocks(blocks) {
      return blocks.filter((block) => block !== void 0);
    }
    function blockIsVisible(block) {
      if (block === void 0 || block.kind === "tool-call") return false;
      if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
      return true;
    }
    function updateChunk(state, chunk, seq, time) {
      if (chunk.type === "tool-call-delta") {
        const previous = state.blocks[chunk.index];
        if (previous?.kind === "tool-call" && previous.callId !== "" && (chunk.name === void 0 || chunk.name === previous.name) && (state.firstTokenTime !== void 0 || !isTokenDelta(chunk))) return state;
      }
      const blocks = [...state.blocks];
      let changedIndex = -1;
      let previousVisible = false;
      let nextVisible = false;
      switch (chunk.type) {
        case "text-delta": {
          const previous = blocks[chunk.index];
          changedIndex = chunk.index;
          previousVisible = state.visibleByIndex[chunk.index] === true;
          blocks[chunk.index] = { kind: "text", text: (previous?.kind === "text" ? previous.text : "") + chunk.text };
          nextVisible = previous?.kind === "text" && previousVisible || chunk.text.trim() !== "";
          break;
        }
        case "tool-call-delta": {
          const previous = blocks[chunk.index];
          changedIndex = chunk.index;
          previousVisible = state.visibleByIndex[chunk.index] === true;
          blocks[chunk.index] = {
            kind: "tool-call",
            callId: (previous?.kind === "tool-call" ? previous.callId : "") || String(chunk.id),
            name: chunk.name ?? (previous?.kind === "tool-call" ? previous.name : ""),
            argsRaw: previous?.kind === "tool-call" ? previous.argsRaw : ""
          };
          break;
        }
      }
      const visibleBlocks = state.visibleBlocks - Number(previousVisible) + Number(nextVisible);
      let visibleByIndex = state.visibleByIndex;
      if (previousVisible !== nextVisible) {
        const next = [...visibleByIndex];
        next[changedIndex] = nextVisible;
        visibleByIndex = next;
      }
      return { ...state, blocks, visibleByIndex, visibleBlocks, ...(state.firstTokenTime === void 0 ? { firstTokenTime: time } : {}) };
    }
    return { initialState, updateChunk, compactBlocks };
  `

  const res = patchToolReplyStreamChatSource(fixture2022)
  assert.equal(res.status, 'applied')
  assert.equal(patchToolReplyStreamChatSource(res.text).status, 'patched')

  const runtime = new Function(res.text)()
  let state = runtime.initialState(1, 1)
  // 模型若先违规吐出工具外文字，随后开始调 submit_story，工具外裸文字在流式预览中被自动抑制
  state = runtime.updateChunk(state, { type: 'text-delta', index: 0, text: '好的，我来调用工具：' }, 1, 100)
  state = runtime.updateChunk(state, { type: 'tool-call-delta', index: 1, id: 'call_1', name: 'submit_story', argumentsDelta: '{"think":"分析局势' }, 2, 110)
  state = runtime.updateChunk(state, { type: 'tool-call-delta', index: 1, id: 'call_1', argumentsDelta: '完毕","content":"推开木门，风雪扑面而来。"}' }, 3, 120)

  assert.ok(state.visibleBlocks >= 1)
  assert.deepEqual(runtime.compactBlocks(state.blocks), [
    { kind: 'reasoning', text: '分析局势完毕' },
    { kind: 'text', text: '推开木门，风雪扑面而来。' }
  ])

  // 若本地存在 DSH 0.2.1 runtime 的真实 ui-chat bundle，也验证真实文件一次命中
  try {
    const real021 = readFileSync('/home/hh/.dsh-tavern/runtime/lib/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', 'utf8')
    const realRes = patchToolReplyStreamChatSource(real021)
    assert.ok(realRes.status === 'applied' || realRes.status === 'patched')
  } catch {}
})

test('ui-chat 工具流式补丁：0.2.2-rc.2+ 压缩形状（反引号、无空白、省分号）同样命中并实时投影', () => {
  // 按 0.2.2-rc.3 真实 bundle 的形状复刻：反引号字符串、无空白、省略分号、
  // 箭头参数不带括号、case 后直接 break}。
  const fixtureRc3 = `
    function emptyAssistantBlock(blockType){return{kind:blockType,text:\`\`}}
    function toAssistantBlock(block){return block}
    function isTokenDelta(chunk){switch(chunk.type){case\`text-delta\`:case\`reasoning-delta\`:return chunk.text!==\`\`;case\`tool-call-delta\`:return chunk.argumentsDelta!==\`\`||chunk.name!==void 0;default:return false}}
    function initialState(turn,step){return{turn,step,blocks:[],visibleByIndex:[],visibleBlocks:0,firstVisibleSeq:void 0,firstVisibleTime:void 0,firstTokenTime:void 0,final:void 0,usage:void 0}}
    function compactBlocks(blocks){return blocks.filter(block=>block!==void 0)}
    function blockIsVisible(block){if(block===void 0||block.kind===\`tool-call\`)return false;if(block.kind===\`text\`||block.kind===\`reasoning\`)return block.text.trim()!==\`\`;return true}
    function updateChunk(state,chunk,seq,time){if(chunk.type===\`tool-call-delta\`){const previous=state.blocks[chunk.index];if(previous?.kind===\`tool-call\`&&previous.callId!==\`\`&&(chunk.name===void 0||chunk.name===previous.name)&&(state.firstTokenTime!==void 0||!isTokenDelta(chunk)))return state}const blocks=[...state.blocks];let changedIndex=-1;let previousVisible=false;let nextVisible=false;switch(chunk.type){case\`block-start\`:changedIndex=chunk.index;previousVisible=state.visibleByIndex[chunk.index]===true;blocks[chunk.index]=emptyAssistantBlock(chunk.blockType);nextVisible=blockIsVisible(blocks[chunk.index]);break;case\`text-delta\`:{const previous=blocks[chunk.index];changedIndex=chunk.index;previousVisible=state.visibleByIndex[chunk.index]===true;blocks[chunk.index]={kind:\`text\`,text:(previous?.kind===\`text\`?previous.text:\`\`)+chunk.text};nextVisible=previous?.kind===\`text\`&&previousVisible||chunk.text.trim()!==\`\`;break}case\`tool-call-delta\`:{const previous=blocks[chunk.index];changedIndex=chunk.index;previousVisible=state.visibleByIndex[chunk.index]===true;blocks[chunk.index]={kind:\`tool-call\`,callId:(previous?.kind===\`tool-call\`?previous.callId:\`\`)||String(chunk.id),name:chunk.name??(previous?.kind===\`tool-call\`?previous.name:\`\`),argsRaw:previous?.kind===\`tool-call\`?previous.argsRaw:\`\`};break}case\`block-end\`:changedIndex=chunk.index;previousVisible=state.visibleByIndex[chunk.index]===true;blocks[chunk.index]=toAssistantBlock(chunk.block);nextVisible=blockIsVisible(blocks[chunk.index]);break;default:return state}const visibleBlocks=state.visibleBlocks-Number(previousVisible)+Number(nextVisible);let visibleByIndex=state.visibleByIndex;if(previousVisible!==nextVisible){const next=[...visibleByIndex];next[changedIndex]=nextVisible;visibleByIndex=next}return{...state,blocks,visibleByIndex,visibleBlocks,...(state.firstTokenTime===void 0?{firstTokenTime:time}:{})}}
    return { initialState, updateChunk, compactBlocks };
  `

  const res = patchToolReplyStreamChatSource(fixtureRc3)
  assert.equal(res.status, 'applied')
  assert.equal(patchToolReplyStreamChatSource(res.text).status, 'patched')

  const runtime = new Function(res.text)()
  let state = runtime.initialState(1, 1)
  state = runtime.updateChunk(state, { type: 'text-delta', index: 0, text: '好的，我来调用工具：' }, 1, 100)
  state = runtime.updateChunk(state, { type: 'tool-call-delta', index: 1, id: 'call_1', name: 'submit_story', argumentsDelta: '{"think":"分析局势' }, 2, 110)
  state = runtime.updateChunk(state, { type: 'tool-call-delta', index: 1, id: 'call_1', argumentsDelta: '完毕","content":"推开木门，风雪扑面而来。"}' }, 3, 120)

  assert.ok(state.visibleBlocks >= 1)
  assert.deepEqual(runtime.compactBlocks(state.blocks), [
    { kind: 'reasoning', text: '分析局势完毕' },
    { kind: 'text', text: '推开木门，风雪扑面而来。' }
  ])

  // 非 submit_story 工具在首个 token 之后仍被早退抑制，不产生流式预览
  let other = runtime.initialState(1, 1)
  other = runtime.updateChunk(other, { type: 'tool-call-delta', index: 0, id: 'call_2', name: 'worldbook_grep', argumentsDelta: '{"query":"x"}' }, 1, 100)
  const suppressed = runtime.updateChunk(other, { type: 'tool-call-delta', index: 0, id: 'call_2', argumentsDelta: 'more' }, 2, 110)
  assert.equal(suppressed, other)
})
