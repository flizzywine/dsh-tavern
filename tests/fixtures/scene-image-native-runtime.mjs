// Real installed DSH Agent loop/tools/attachments; scripted model and local image API.
// No paid requests, credentials, or user chats are accessed.
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createBackgroundAgentRunner } from '../../tavern-plugin/lib/background-agent-runner.js'
import { createSceneIllustrations, IMAGE_CREDENTIAL } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { imageZip } from './scene-image-zip.mjs'
import { createSceneWorldbooks, bindSceneWorldbook, sceneWorldbookBinding } from '../../tavern-plugin/lib/domain/scene-worldbook.js'
import { createSceneImageDiagnostics } from '../../tavern-plugin/lib/domain/scene-image-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { assertImageToolSchema } from './assert-image-tool-schema.mjs'

export async function createSceneImageNativeRuntime(bootPath, { unifiedPlugin = false } = {}) {
  const bootUrl = pathToFileURL(bootPath)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-scene-native-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-token-meter', 'dsh-agent-loop', 'dsh-attachment-local']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + (name === 'dsh-attachment-local' ? '\n  config:\n    dshHome: ' + root : name === 'dsh-session-persistence-jsonl' ? '\n  config:\n    root: ' + join(root, 'sessions') + '\n    compression: none' : '') + '\n').join(''))
  const ctx = await boot('scene-image-native-test', config)
  ctx.baseUrl = bootUrl.href
  const requests = [], imageRequests = []
  let referenceQuery = ''
  let characterQuery = ''
  let useVisualState = false
  let useMultiplePeople = false
  const comfyTasks = new Map()
  const sharp = createRequire(new URL('../../dsh-attachment-local/lib/index.js', bootUrl))('sharp')
  const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#789aab' } }).png().toBuffer()
  class FixtureModel extends LlmAdapter {
    async *stream(input) {
      requests.push(structuredClone({ system: input.system, messages: input.messages, tools: input.tools }))
      for (const tool of input.tools || []) assertImageToolSchema(tool)
      const currentMessages = input.messages.slice(Math.max(0, input.messages.findLastIndex(message => message.source?.kind === 'plugin')))
      const referenceResult = currentMessages.flatMap(message => message.content || []).find(block => block.type === 'tool-result' && block.toolCallId === 'reference-call')
      const referenceTool = !referenceResult && (characterQuery
        ? input.tools?.find(item => item.name === 'character_design_read')
        : referenceQuery && input.tools?.find(item => item.name === 'read_scene_reference'))
      const tool = referenceTool || input.tools?.find(item => ['submit_scene_plan', 'submit_image_adjustment'].includes(item.name))
      const plan = { description: '窗边单幅画面', subjects: [], characters: [], continuity: 'uncertain', scene: { composition: { text: '窗边单幅画面', tags: 'A woman standing beside a rain-streaked window, left hand on the frame, quiet evening light.', evidence: [] } } }
      if (useVisualState && tool?.name === 'submit_scene_plan') {
        const material = currentMessages.flatMap(message => message.content || []).filter(block => block.type === 'text').flatMap(block => block.text.split('\n')).map(line => {
          try { return JSON.parse(line) } catch { return null }
        }).find(value => Array.isArray(value?.sources))
        const source = material?.sources.find(item => item.origin?.kind === 'mvu-state' && item.text.includes('衣着：青色外套'))
        if (source) {
          const known = material.characters?.find(person => person.name === '林岚')
          const person = known ? { id: known.id } : { id: 'state-person', name: '林岚', identity: { source: 'target', quote: '林岚' } }
          plan.subjects = [person.id]
          plan.characters = [{ ...person, fields: {
            clothing: { text: '青色外套', tags: 'blue coat', evidence: [{ source: source.id, quote: '青色外套' }] }
          } }]
        }
      }
      if (useMultiplePeople && tool?.name === 'submit_scene_plan') {
        const material = currentMessages.flatMap(message => message.content || []).filter(block => block.type === 'text').flatMap(block => block.text.split('\n')).map(line => {
          try { return JSON.parse(line) } catch { return null }
        }).find(value => Array.isArray(value?.sources))
        plan.characters = ['林岚', '林雨'].map((name, index) => {
          const known = material?.characters?.find(person => person.name === name)
          const person = known ? { id: known.id } : { id: 'multi-person-' + index, name, identity: { source: 'target', quote: name } }
          const position = index ? '右侧' : '左侧'
          return { ...person, fields: { position: { text: position, tags: index ? 'on the right' : 'on the left', evidence: [{ source: 'target', quote: name + '站在' + position }] } } }
        })
        plan.subjects = plan.characters.map(person => person.id)
      }
      if (referenceResult) {
        const source = JSON.parse(referenceResult.content.filter(block => block.type === 'text').map(block => block.text).join('')).sources[0]
        if (source) {
          plan.subjects = ['local-reference-person']
          plan.characters = [{ id: 'local-reference-person', name: '林岚', identity: { source: source.id, quote: '林岚' }, fields: {
            appearance: { text: '黑色短发', tags: 'short black hair', evidence: [{ source: source.id, quote: '黑色短发' }] }
          } }]
        }
      }
      const update = JSON.stringify(input.messages).includes('仅这张改成胶片风格')
        ? { description: '仅这张胶片风格', patches: [], style: { text: '胶片', tags: 'film grain' } }
        : { description: '改为雨夜近景', patches: [{ owner: 'scene', field: 'composition', text: '雨夜近景', tags: 'rainy night, close-up at the window' }] }
      const args = referenceTool ? (characterQuery ? { name: characterQuery } : { query: referenceQuery }) : tool?.name === 'submit_image_adjustment' ? { update } : { plan }
      const block = tool ? { type: 'tool-call', id: referenceTool ? 'reference-call' : 'image-call', name: tool.name, arguments: JSON.stringify(args) } : { type: 'text', text: '方案已提交。' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: tool ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['scene-fixture'], new FixtureModel())
  const parent = await ctx.agents.create({ sessionId: 'scene-parent', agentOptions: { provider: 'scene-fixture', model: 'fixture-text' } })
  const runnerOptions = { agents: ctx.agents, flushSession: session => ctx.sessions.flush(session) }
  let runner = createBackgroundAgentRunner(runnerOptions)
  const chat = { id: 'scene-chat', sessionId: 'scene-parent', mode: 'story', posture: '站在窗边，左手扶窗', messages: [{ role: 'assistant', turn: 1, greeting: true, sourceText: '她站在窗边看雨，左手轻轻搭着窗框。', swipes: ['她站在窗边看雨，左手轻轻搭着窗框。', '她坐在椅子上。'], swipeId: 0 }] }
  const before = JSON.stringify(chat)
  const keys = new Map([[IMAGE_CREDENTIAL, 'fixture-key']])
  let failNext = false, holdNext = false
  const imageServer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (process.env.SCENE_BROWSER_PLUGIN === '1' && url.pathname === '/plugins/dsh-image-gen/studio') {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        res.end(JSON.stringify({ activeProvider: 'openai', providers: [{ provider: 'openai', model: 'fixture-plugin-image', configured: true, defaultRatio: '1:1', defaultQuality: 'standard', ratioOptions: [{ value: '1:1' }], qualityOptions: [{ value: 'standard' }] }] }))
      } else {
        let body = ''; for await (const chunk of req) body += chunk
        imageRequests.push(JSON.parse(body))
        const attachment = await ctx.attachments.saveImage({ data: png, mediaType: 'image/png', name: 'plugin-fixture' })
        res.end(JSON.stringify({ provider: 'openai', model: 'fixture-plugin-image', attachment }))
      }
      return
    }
    if (req.method === 'GET' && url.pathname.endsWith('/view')) { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    if (req.method === 'GET' && url.pathname.includes('/history/')) {
      const id = url.pathname.split('/').pop()
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(comfyTasks.has(id) ? { [id]: comfyTasks.get(id) } : {})); return
    }
    if (req.method === 'GET' && req.url === '/picture') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    let body = ''; for await (const chunk of req) body += chunk
    imageRequests.push(JSON.parse(body))
    if (holdNext) { holdNext = false; return }
    if (failNext) { failNext = false; res.writeHead(503).end('test failure'); return }
    if (url.pathname.endsWith('/prompt')) {
      const data = JSON.parse(body), outputNode = Object.keys(data.prompt).find(id => data.prompt[id].class_type === 'SaveImage')
      comfyTasks.set(data.prompt_id, { status: { status_str: 'success', completed: true }, outputs: { [outputNode]: { images: [{ filename: 'fixture.png', subfolder: '', type: 'output' }] } } })
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ prompt_id: data.prompt_id, number: 0, node_errors: {} })); return
    }
    if (req.url.endsWith('/ai/generate-image')) { res.writeHead(200, { 'Content-Type': 'application/zip' }).end(imageZip(png, { compressed: true })); return }
    const payload = req.url.endsWith('/txt2img') ? { images: [png.toString('base64')], info: JSON.stringify({ seed: 42, sd_model_name: 'fixture-server-model' }) }
      : req.url.endsWith('/interactions') ? { steps: [{ type: 'model_output', content: [{ type: 'image', data: png.toString('base64') }] }] }
      : req.url.endsWith('/chat/completions') ? { choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } }] } }] }
        : req.url.includes('/multimodal-generation/') ? { output: { choices: [{ message: { content: [{ image: 'http://127.0.0.1:' + imageServer.address().port + '/picture' }] } }] } }
          : { data: [{ b64_json: png.toString('base64') }] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
  })
  await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve))
  let failSave = false
  const store = createProfileDataStore({ dataRoot: root })
  const worldbooks = createSceneWorldbooks({ store })
  const deps = {
    webServer: () => process.env.SCENE_BROWSER_PLUGIN === '1' ? { port: imageServer.address().port } : undefined,
    store, chatForSession: async () => structuredClone(chat),
    worldbookAtTarget: (chat, target) => worldbooks.read(sceneWorldbookBinding(chat, target)),
    selection: () => ({ provider: 'scene-fixture', model: 'fixture-text' }),
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }), set: async (ref, value) => { keys.set(ref, value) } }),
    attachments: () => ({
      imageLimits: ctx.attachments.imageLimits,
      async saveImage(image) { if (failSave) { failSave = false; throw new Error('fixture attachment storage unavailable') } return ctx.attachments.saveImage(image) },
      readImage: ref => ctx.attachments.readImage(ref)
    }), runAgent: input => runner.run(input)
  }
  let service = createSceneIllustrations(deps)
  const endpoint = 'http://127.0.0.1:' + imageServer.address().port + '/v1'
  await service.configure({ model: 'fixture-image', baseURL: endpoint, apiKey: keys.get(IMAGE_CREDENTIAL) })
  await service.configure({ enabled: true })
  return { get service() { return service }, chat, before, requests, imageRequests, parent, endpoint,
    failNext() { failNext = true },
    failNextSave() { failSave = true },
    holdNextImage() { holdNext = true },
    lookupReferences(query) { referenceQuery = query },
    lookupCharacterDesigns(name) { characterQuery = name },
    useVisualState() { useVisualState = true },
    useMultiplePeople() { useMultiplePeople = true },
    async exportLogs() {
      return createMvuDiagnosticExport({ sessionId: 'scene-parent', store: createMvuDiagnosticStore(store),
        sceneDiagnostics: await createSceneImageDiagnostics(store).read(chat.id),
        sessions: ctx.sessions, persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery'), attachments: ctx.attachments })
    },
    async archiveWorldbook(worldBook, turn = 1) {
      const ref = await worldbooks.capture({ worldBook, chat, card: { name: '林岚' } })
      bindSceneWorldbook(chat.messages.find(message => message.role === 'assistant' && message.turn === turn), ref)
      return ref
    },
    async restart() { await service.dispose(); await runner.dispose(); runner = createBackgroundAgentRunner(runnerOptions); service = createSceneIllustrations(deps) },
    async dispose() { await service.dispose(); await runner.dispose(); await parent.dispose(); await ctx.fiber.dispose(); await new Promise(resolve => imageServer.close(resolve)); await rm(root, { recursive: true, force: true }) }
  }
}
