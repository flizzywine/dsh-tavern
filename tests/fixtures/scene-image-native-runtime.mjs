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

export async function createSceneImageNativeRuntime(bootPath) {
  const bootUrl = pathToFileURL(bootPath)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-scene-native-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-loop', 'dsh-attachment-local']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + (name === 'dsh-attachment-local' ? '\n  config:\n    dshHome: ' + root : '') + '\n').join(''))
  const ctx = await boot('scene-image-native-test', config)
  ctx.baseUrl = bootUrl.href
  const requests = [], imageRequests = []
  const sharp = createRequire(new URL('../../dsh-attachment-local/lib/index.js', bootUrl))('sharp')
  const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#789aab' } }).png().toBuffer()
  class FixtureModel extends LlmAdapter {
    async *stream(input) {
      requests.push(structuredClone({ system: input.system, messages: input.messages, tools: input.tools }))
      const tool = input.tools?.find(item => ['submit_scene_plan', 'submit_image_adjustment'].includes(item.name))
      const plan = { description: '窗边单幅画面', subjects: [], characters: [], continuity: 'uncertain', scene: { composition: { text: '窗边单幅画面', tags: 'A woman standing beside a rain-streaked window, left hand on the frame, quiet evening light.', evidence: [] } } }
      const update = JSON.stringify(input.messages).includes('仅这张改成胶片风格')
        ? { description: '仅这张胶片风格', patches: [], style: { text: '胶片', tags: 'film grain' } }
        : { description: '改为雨夜近景', patches: [{ owner: 'scene', field: 'composition', text: '雨夜近景', tags: 'rainy night, close-up at the window' }] }
      const args = tool?.name === 'submit_image_adjustment' ? { update } : { plan }
      const block = tool ? { type: 'tool-call', id: 'image-call', name: tool.name, arguments: JSON.stringify(args) } : { type: 'text', text: '方案已提交。' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: tool ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['scene-fixture'], new FixtureModel())
  const parent = await ctx.agents.create({ sessionId: 'scene-parent', agentOptions: { provider: 'scene-fixture', model: 'fixture-text' } })
  const runner = createBackgroundAgentRunner({ agents: ctx.agents })
  const chat = { id: 'scene-chat', sessionId: 'scene-parent', mode: 'story', posture: '站在窗边，左手扶窗', messages: [{ role: 'assistant', turn: 1, greeting: true, sourceText: '她站在窗边看雨，左手轻轻搭着窗框。', swipes: ['她站在窗边看雨，左手轻轻搭着窗框。', '她坐在椅子上。'], swipeId: 0 }] }
  const before = JSON.stringify(chat)
  const keys = new Map([[IMAGE_CREDENTIAL, 'fixture-key']])
  let failNext = false
  const imageServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/picture') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    let body = ''; for await (const chunk of req) body += chunk
    imageRequests.push(JSON.parse(body))
    if (failNext) { failNext = false; res.writeHead(503).end('test failure'); return }
    const payload = req.url.endsWith('/interactions') ? { steps: [{ type: 'model_output', content: [{ type: 'image', data: png.toString('base64') }] }] }
      : req.url.endsWith('/chat/completions') ? { choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } }] } }] }
        : req.url.includes('/multimodal-generation/') ? { output: { choices: [{ message: { content: [{ image: 'http://127.0.0.1:' + imageServer.address().port + '/picture' }] } }] } }
          : { data: [{ b64_json: png.toString('base64') }] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
  })
  await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve))
  const deps = {
    store: createProfileDataStore({ dataRoot: root }), chatForSession: async () => structuredClone(chat),
    selection: () => ({ provider: 'scene-fixture', model: 'fixture-text' }),
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }), set: async (ref, value) => { keys.set(ref, value) } }),
    attachments: () => ctx.attachments, runAgent: runner.run
  }
  let service = createSceneIllustrations(deps)
  const endpoint = 'http://127.0.0.1:' + imageServer.address().port + '/v1'
  await service.configure({ model: 'fixture-image', baseURL: endpoint, apiKey: keys.get(IMAGE_CREDENTIAL) })
  await service.configure({ enabled: true })
  return { get service() { return service }, chat, before, requests, imageRequests, parent, endpoint,
    failNext() { failNext = true },
    async restart() { await service.dispose(); service = createSceneIllustrations(deps) },
    async dispose() { await service.dispose(); await runner.dispose(); await parent.dispose(); await ctx.fiber.dispose(); await new Promise(resolve => imageServer.close(resolve)); await rm(root, { recursive: true, force: true }) }
  }
}
