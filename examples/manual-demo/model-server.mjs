// Optional local screenshot fixture. Never proxies to a real provider.
// Scripted responses exercise the real UI; they are NOT model-quality evidence.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { demoImage } from './image-fixture.mjs'
import { characterDesign } from './character-design.mjs'
let imageMode = 'success', imageVersion = 0, settlementError = false

const actions = ['我翻开旧地址簿，寻找蓝色鸢尾花的记录。', '我问林澄，她最后一次见到花店主人是什么时候。', '我把信放进防水邮袋，邀请林澄一起去旧花店。', '我先去码头向邻居打听旧花店的地址。']
const story = '### 第二章 · 石板路上的灯\n\n你把旧地址簿翻到花店那一页。纸角夹着一张开放日照片：林澄站在灯塔下，身旁的人别着蓝色鸢尾花。\n\n“是周姨。”林澄轻轻点了点照片，“她的花店就在石板路尽头。先去看看？雨已经小了。”\n\n你们沿着屋檐走到旧花店。门旁的铜牌仍在，花盆里长出了新芽。林澄收好伞，站在门口等你决定要不要敲门。'
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/__fixture/settlement/')) { settlementError = req.url.endsWith('/error'); return res.end('Local settlement fixture: ' + (settlementError ? 'error' : 'success')) }
  if (req.method === 'POST' && req.url?.startsWith('/__fixture/image/')) {
    const mode = req.url.split('/').at(-1)
    if (!['success', 'pending', 'error'].includes(mode)) { res.writeHead(400); return res.end() }
    imageMode = mode; return res.end('Local image fixture: ' + mode)
  }
  if (req.method === 'POST' && ['/v1/images/generations', '/v1/images/edits'].includes(req.url)) {
    for await (const chunk of req) { /* consume only; never retain credentials or submitted image data */ }
    if (imageMode === 'pending') await new Promise(resolve => setTimeout(resolve, 20000))
    res.setHeader('Content-Type', 'application/json')
    if (imageMode === 'error') { res.writeHead(503); return res.end(JSON.stringify({ error: { message: '本地样例：模拟图片服务暂时不可用，未调用外部供应商。' } })) }
    return res.end(JSON.stringify({ created: Math.floor(Date.now()/1000), data: [{ b64_json: demoImage(imageVersion++).toString('base64') }] }))
  }
  if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'lighthouse-demo', object: 'model', owned_by: 'local-fixture' }] }))
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('Local documentation fixture only') }
  let text = ''
  for await (const chunk of req) { text += chunk; if (text.length > 2_000_000) { res.writeHead(413); return res.end() } }
  try {
    const input = JSON.parse(text), messages = input.messages || [], tools = (input.tools || []).map(t => t.function?.name), last = messages.at(-1), recent = messages.slice(-4).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
    const system = messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
    const mvu = system.includes('必须调用 mvu_submit_update') || recent.includes('【当前变量快照】')
    const posture = !mvu && recent.includes('【上一轮结算姿势】')
    console.log(JSON.stringify({ model: input.model, tools, mvu, posture, lastRole: last?.role, heads: messages.slice(-3).map(m => ({ role: m.role, head: String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0,300) })) }))
    let content = story, calls = []
    const call = (name, args) => calls.push({ id: 'demo-' + randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const previousTools = messages.at(-2)?.tool_calls?.map(t => t.function?.name) || []
    const updates = [{ op: 'replace', path: '/当前位置', value: '旧花店门口' }, { op: 'replace', path: '/当前线索', value: '开放日照片中的周姨可能认识收件人。' }]
    if (messages.some(m => m.tool_calls?.some(t => t.function?.name === 'character_design_save'))) updates.push({ op: 'replace', path: characterDesign.mvuPath, value: characterDesign.mvuFields })
    if (tools.includes('submit_scene_plan')) {
      if (last?.role === 'tool' && previousTools.includes('submit_scene_plan')) content = '本地示例图片已交给应用保存；这是原创示意图，不是真实模型生成效果。'
      else if (last?.role === 'tool' && previousTools.includes('submit_scene_layout')) call('submit_scene_plan', {})
      else if (last?.role === 'tool' && previousTools.includes('submit_scene_character')) call('submit_scene_layout', { description: '文档示意：灯塔镇与林澄', subjects: ['lin-cheng'], continuity: 'changed', scene: { environment: { text: '海边小镇、灯塔与花店。', tags: 'seaside town, lighthouse, flower shop' }, composition: { text: '横向全景，人物站在路边。', tags: 'wide composition, figure by the road' } } })
      else call('submit_scene_character', { id: 'lin-cheng', name: '林澄', fields: { appearance: { text: '成年灯塔管理员，短发。', tags: 'adult lighthouse keeper, short hair' }, clothing: { text: '深蓝外套。', tags: 'navy jacket' }, action: { text: '站在路边。', tags: 'standing beside road' } } })
    }
    else if (tools.includes('submit_image_adjustment') && last?.role !== 'tool') call('submit_image_adjustment', { update: { description: '文档样例：调整为傍晚色调。', patches: [{ owner: 'scene', field: 'environment', text: '傍晚的海边小镇。', tags: 'seaside town at dusk' }] } })
    else if (mvu && tools.includes('character_design_save') && last?.role !== 'tool' && recent.includes('"人物":')) call('character_design_save', characterDesign)
    else if (last?.role === 'tool' && previousTools.includes('character_design_save')) call('posture_submit', { posture: '林澄站在邮局柜台旁，手中拿着雨伞；玩家正在阅读旧地址簿。' })
    else if (!mvu && tools.includes('tavern_recall_history') && last?.role !== 'tool' && /帮我回忆/.test(recent)) call('tavern_recall_history', { query: '鸢尾', limit: 3 })
    else if (last?.role === 'tool' && previousTools.includes('tavern_recall_history')) content = '【本地模拟回复】开场时，林澄带来没有署名的信，蓝色鸢尾花印章指向旧花店。请以检索工具返回的原文为准。'
    else if (tools.includes('mvu_submit_update') && last?.role === 'tool' && previousTools.includes('posture_submit')) call('mvu_submit_update', { operations: settlementError ? [{ op: 'replace', path: '/不存在的样例字段', value: '模拟无效路径，展示错误恢复' }] : updates })
    else if (last?.role === 'tool') content = '文档样例任务已提交。'
    else if ((mvu || posture) && tools.includes('posture_submit')) call('posture_submit', { posture: recent.includes('第二章') ? '林澄站在旧花店门口，收拢深蓝色雨伞；玩家拿着旧地址簿，信件放在防水邮袋里。' : '林澄站在邮局柜台旁，拿着深蓝色雨伞；玩家面前放着旧地址簿和未署名的信。' })
    else if (tools.includes('candidate_submit_choices')) call('candidate_submit_choices', { actions, scene: '雨停了，花店二楼亮起一盏灯。' })
    else if (/修改人物卡|文风|Skill|工具|插件|恢复原版/.test(recent) && !tools.includes('posture_submit')) content = '这是本地文档样例回复，不是真实模型建议。\n\n我会先保留海边小镇、邮递员与旧信的主线，只调整你指定的部分。你可以说明希望保留的设定和修改范围，确认后再写入工作版。'
    if (system.includes('Create a concise title')) content = '雨夜来信 · 文档样例'
    const id = 'chatcmpl-demo-' + randomUUID(), reason = calls.length ? 'tool_calls' : 'stop'
    if (!input.stream) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ id, object: 'chat.completion', model: input.model, choices: [{ index: 0, message: { role: 'assistant', content: calls.length ? null : content, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: reason }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })) }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', model: input.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n')
    chunk({ role: 'assistant' })
    if (calls.length) chunk({ tool_calls: calls.map((c, index) => ({ index, ...c })) })
    else { chunk({ reasoning_content: '文档演示：参考已提供的旧信线索，保留玩家下一步选择。此段为预写模拟内容。' }); chunk({ content }) }
    chunk({}, reason); res.end('data: [DONE]\n\n')
  } catch { res.writeHead(400); res.end('Invalid fixture request') }
})
server.listen(3183, '127.0.0.1', () => console.log('Documentation-only local fixture: http://127.0.0.1:3183/v1'))
