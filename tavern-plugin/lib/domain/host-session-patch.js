// In-memory host/client patch. Official package files stay unchanged.
// Version-independent by design: it is gated on its anchors (each must match
// exactly once) and a startup self-test, never on a DSH version or file hash,
// so a DSH release that leaves these validators alone needs no Tavern change.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, sep } from 'node:path'
import { hostRequireCandidates } from './host-package-resolution.js'

export async function prepareExpandedPatch(runtime) {
  const marker = 'dsh-tavern/required-session-patch-v1'
  const require = createRequire(join(runtime, 'package.json'))
  const originals = new Map()
  const urls = new Map()
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  // Tavern rollback preserves the original provider, so provider allowlists
  // cannot represent ownership. This experimental profile-wide fix permits
  // citations on replacement only, for every provider; append stays native.
  const own = "(event.surfaceOp?.op === 'replace')"
  async function source(name) {
    const path = require.resolve(name)
    const text = await readFile(path, 'utf8')
    originals.set(path, text)
    return { path, text }
  }
  function once(text, before, after) {
    assert.equal(text.split(before).length, 2, '补丁锚点已变化（DSH 改动了这段校验代码）：' + before)
    return text.replace(before, after)
  }
  async function compile(name, transform = text => text) {
    const { path, text } = await source(name)
    const localRequire = createRequire(path)
    function resolveSpecifier(specifier) {
      if (urls.has(specifier)) return urls.get(specifier)
      if (/^(node:|file:|data:)/.test(specifier)) return specifier
      return pathToFileURL(localRequire.resolve(specifier)).href
    }
    // data: modules cannot resolve bare specifiers. Rewrite both static and
    // dynamic imports (Windows persistence lazily `import("koffi")`).
    let modified = transform(text)
    modified = modified.replace(/\bfrom\s+"([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(resolveSpecifier(specifier)))
    modified = modified.replace(/\bfrom\s+'([^']+)'/g, (_, specifier) => 'from ' + JSON.stringify(resolveSpecifier(specifier)))
    modified = modified.replace(/\bimport\s*\(\s*"([^"]+)"\s*\)/g, (_, specifier) => 'import(' + JSON.stringify(resolveSpecifier(specifier)) + ')')
    modified = modified.replace(/\bimport\s*\(\s*'([^']+)'\s*\)/g, (_, specifier) => 'import(' + JSON.stringify(resolveSpecifier(specifier)) + ')')
    modified = modified.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href))
    const url = 'data:text/javascript;base64,' + Buffer.from(modified).toString('base64')
    urls.set(name, url)
    return import(url)
  }
  function facade(name, selectedExports) {
    const text = `export * from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)};\nexport { ${selectedExports.join(', ')} } from ${JSON.stringify(urls.get(name))};`
    urls.set(name, 'data:text/javascript;base64,' + Buffer.from(text).toString('base64'))
  }
  const pkg = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
  const { Session } = await load('@deepseek-ai/dsh-session')
  const patchedSurface = await compile('@deepseek-ai/dsh-session/surface', text => once(text,
    "if (event.type === 'assistant/message' && raw !== undefined) {",
    `if (event.type === 'assistant/message' && raw !== undefined && !${own}) {`))
  const surfacePrototype = Object.getPrototypeOf(Session.create('patch-prototype-probe').surface)
  const surfaceDescriptors = Object.fromEntries(['validateNext', '_processDelta'].map(key => [key, Object.getOwnPropertyDescriptor(surfacePrototype, key)]))
  // Append admission, coverage validation, and system-head protection stay native.
  for (const key of Object.keys(surfaceDescriptors)) Object.defineProperty(surfacePrototype, key, Object.getOwnPropertyDescriptor(patchedSurface.SurfaceManager.prototype, key))
  const originalAppend = Session.prototype.append
  const markedSessions = new WeakSet()
  Session.prototype.append = function (type, data, ...args) {
    if (type === 'assistant/message' && args[0]?.surfaceOp?.op === 'replace' && !markedSessions.has(this)) {
      if (!this.snapshotEvents().some(event => event.type === marker)) {
        originalAppend.call(this, marker, { version: 1, hostVersion: pkg.version })
      }
      markedSessions.add(this)
    }
    return originalAppend.call(this, type, data, ...args)
  }
  const restoreSurface = () => {
    Session.prototype.append = originalAppend
    Object.defineProperties(surfacePrototype, surfaceDescriptors)
  }
  try {
    // Stored-event adoption has another bundled copy of the local validator.
    // Cloned storage modules use this copy; the already-live Session service
    // keeps its original identity and the prototype patch above.
    const patchedSession = await compile('@deepseek-ai/dsh-session', text => once(text,
      'if (event.type === "assistant/message" && raw !== void 0) throw',
      `if (event.type === "assistant/message" && raw !== void 0 && !${own}) throw`))
    // Only the in-memory cloned vocabulary understands this required marker.
    // Stock readers refuse the archive instead of treating the edit as a torn tail.
    patchedSession.KNOWN_SESSION_EVENT_TYPES.add(marker)
    // Preserve public class identities: service owners and error consumers
    // imported those classes before this patch. Only validation is replaced.
    facade('@deepseek-ai/dsh-session', ['adoptSessionEvent', 'snapshotSessionEvent', 'foldSurface', 'KNOWN_SESSION_EVENT_TYPES'])
    const patchedPersistence = await compile('@deepseek-ai/dsh-session-persistence', text =>
      `import * as NativeErrors from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence')).href)};\n` +
      text.replace(/\bnew (Session\w+Error)\(/g, 'new NativeErrors.$1(').replace(/\binstanceof (Session\w+Error)\b/g, 'instanceof NativeErrors.$1'))
    facade('@deepseek-ai/dsh-session-persistence', ['validateStoredEvents'])
    await compile('@deepseek-ai/dsh-session-format-v2-to-v3', text => once(text,
      'if (event.type === "assistant/message" && sources !== void 0) throw',
      `if (event.type === "assistant/message" && sources !== void 0 && !${own}) throw`))
    const migration = await compile('@deepseek-ai/dsh-session-format-v3-to-v4')
    migration.RELEASED_V3_EVENT_TYPES.add(marker)
    const catalogs = await compile('@deepseek-ai/dsh-session-format-catalog')
    const { sessionFormatCatalog: catalog } = catalogs
    // 0.2.1 exposes the plugin apply() rather than the backend class.
    // Export the pinned internal class only from our in-memory module.
    const { JsonlSessionPersistence: PatchedPersistence } = await compile('@deepseek-ai/dsh-session-persistence-jsonl',
      text => text + '\nexport { JsonlSessionPersistence };')
    // Guard #74: Windows create/rename path does `await import("koffi")`. If the
    // bare specifier survived into the data: module, new chats fail immediately.
    {
      const encoded = urls.get('@deepseek-ai/dsh-session-persistence-jsonl')
      const decoded = Buffer.from(String(encoded).slice(String(encoded).indexOf(',') + 1), 'base64').toString('utf8')
      assert.doesNotMatch(decoded, /\bimport\s*\(\s*["']koffi["']\s*\)/)
      if (decoded.includes('koffi')) assert.match(decoded, /\bimport\s*\(\s*"file:[^"]*koffi[^"]*"\s*\)/)
    }
    const query = await compile('@deepseek-ai/dsh-session-query', text =>
      `import { SessionQueryError as NativeQueryError } from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-query')).href)};\n` +
      text.replace(/\bnew SessionQueryError\(/g, 'new NativeQueryError(').replace(/\binstanceof SessionQueryError\b/g, 'instanceof NativeQueryError') +
      '\nexport { SessionCorpus, SessionObservationReader };')
    const { text: originalClient } = await source('@deepseek-ai/dsh-api-session-controller/client')
    const clientSource = once(originalClient,
      'if (event.type === "assistant/message" && raw !== void 0) throw',
      `if (event.type === "assistant/message" && raw !== void 0 && !${own}) throw`)
    const undoPersistence = []
    // Prove the relaxation end to end before any live instance is touched: an
    // in-memory session replaces an assistant reply while citing it, and the
    // patched stored-event validator accepts the result.
    function selfTest() {
      const id = 'dsh-tavern-patch-self-test'
      const probe = Session.create(id, undefined, { id, version: 4, createdAt: 0, isSeeded: false, delegationDepth: 0 })
      const reply = text => ({ turn: 1, step: 1, stream: [], message: { id: 'probe-' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' } } })
      probe.append('turn/start', { turn: 1 })
      probe.append('step/start', { turn: 1, step: 1 })
      probe.append('user/message', { id: 'probe-input', role: 'user', content: [{ type: 'text', text: 'input' }], source: { kind: 'user' }, turn: 1, step: 1 }, { surfaceOp: 'append' })
      const original = probe.append('assistant/message', reply('original'), { surfaceOp: 'append' })
      probe.append('assistant/message', reply('edited'), { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
      probe.append('step/end', { turn: 1, step: 1 })
      probe.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const text = probe.deriveMessages().at(-1)?.content?.find(part => part.type === 'text')?.text
      assert.equal(text, 'edited', '会话补丁自检失败：替换后的回复没有生效')
      patchedPersistence.validateStoredEvents({ id }, structuredClone(probe.snapshotEvents()))
    }
    return {
      catalog, patchedSurface, clientSource, marker, selfTest,
      migration: { ...catalogs, historicalChildCatalogSource: migration.historicalChildCatalogSource },
      patchQuery(instance) {
        assert.equal(instance._observations.cache.size, 0, 'Install before querying Session history')
        for (const [target, prototype] of [
          [instance, query.SessionQueryEngine.prototype],
          [instance._corpus, query.SessionCorpus.prototype],
          [instance._observations, query.SessionObservationReader.prototype],
        ]) {
          const keys = Reflect.ownKeys(prototype).filter(key => key !== 'constructor')
          const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(target, key)]))
          for (const key of keys) Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(prototype, key))
          undoPersistence.push(() => {
            for (const [key, descriptor] of descriptors) {
              if (descriptor) Object.defineProperty(target, key, descriptor)
              else delete target[key]
            }
          })
        }
      },
      patchPersistence(instance) {
        // Existing handles must be closed before this experimental installation.
        // Install own methods on ONE backend instance, not its shared prototype.
        assert.equal(instance.tracker.openHandles.size, 0, 'Install before opening Session handles')
        assert.equal(instance.tracker.writers.size, 0, 'Install before acquiring Session writers')
        const keys = Reflect.ownKeys(PatchedPersistence.prototype).filter(key => key !== 'constructor')
        const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(instance, key)]))
        const format = instance.generationFormat
        for (const key of keys) Object.defineProperty(instance, key, Object.getOwnPropertyDescriptor(PatchedPersistence.prototype, key))
        instance.generationFormat = {
          ...format,
          currentVersion: catalog.currentVersion,
          createRestore: header => catalog.createRestore(header, { recovery: 'strict', validation: 'current' }),
          encodeHeader: (header, count) => catalog.encodeCurrentHeader(header, count),
          encodeEvent: event => catalog.encodeCurrentEvent(event),
        }
        instance.coldLogMemo.clear()
        undoPersistence.push(() => {
          for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(instance, key, descriptor)
            else delete instance[key]
          }
          instance.generationFormat = format
          instance.coldLogMemo.clear()
        })
      },
      async verifyFilesUnchanged() {
        const hashes = []
        for (const [path, text] of originals) {
          assert.equal(await readFile(path, 'utf8'), text)
          hashes.push({ packageFile: path.split('/node_modules/').at(-1), sha256: createHash('sha256').update(text).digest('hex') })
        }
        return hashes
      },
      dispose() {
        for (const undo of undoPersistence.reverse()) undo()
        restoreSurface()
      },
    }
  } catch (error) {
    restoreSurface()
    throw error
  }
}

export const SESSION_PATCH_PROTOCOL = 1
const INSTALLED = Symbol.for('dsh-tavern.host-session-patch.v1')

// 0.2.1-rc.2 适配：一个宿主安装根里必须能解析出补丁用到的全部包，否则「解析到的宿主包与
// 正在运行的会话存储不是同一份」只是碰运气。表里的包全部来自同一个 @deepseek-ai 目录。
const HOST_PATCH_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-session-format-catalog',
  '@deepseek-ai/dsh-session-format-v2-to-v3',
  '@deepseek-ai/dsh-api-session-controller/client',
])

// 宿主安装根按固定优先级挑选（见 host-package-resolution.js）：
//   1. 归档宿主根 <resources>\app.asar\dsh\package.json —— 与宿主进程自己的模块加载器同源
//      （真机日志的 service.starting.entry 就在同一棵树下），实测解析结果逐字相同、模块命名
//      空间全等，因此补丁作用在宿主正在使用的那一份单例上；
//   2. 启动器入口（0.1.5 的 <resources>\app 真目录布局，或 DSH_DESKTOP_DSH_BOOTSTRAP）；
//   3. 插件自己的 node_modules —— 只在没有桌面宿主时（CLI / 测试夹具）才会命中。
// tavern-plugin 的 node_modules 里只有 5 个 @deepseek-ai 包的 npm 副本，且缺
// dsh-session-persistence；0.2.0 桌面下那个候选必然不完整，所以它排在最后，绝不作为回退
// 拼出第二份 dsh-session。
export async function defaultHostRequire(persistence, options = {}) {
  const { resolvable } = hostRequireCandidates({ names: HOST_PATCH_PACKAGES, env: options.env, argv: options.argv })
  if (!resolvable.length) throw new Error('无法解析宿主 DSH 包')
  if (!persistence) return resolvable[0].require
  for (const candidate of resolvable) {
    const loaded = await import(pathToFileURL(candidate.require.resolve('@deepseek-ai/dsh-session-persistence')).href)
    if (Object.values(loaded).some(exported => typeof exported === 'function' && persistence instanceof exported)) return candidate.require
  }
  throw new Error('解析到的宿主包与正在运行的会话存储不是同一份')
}

function runtimeRoot(sessionFile) {
  const parts = sessionFile.split(sep)
  const index = parts.lastIndexOf('node_modules')
  if (index <= 0) throw new Error('无法从宿主包路径定位安装根目录')
  return parts.slice(0, index).join(sep)
}

function createHandle(fields) {
  const handle = {
    protocol: SESSION_PATCH_PROTOCOL,
    status: fields.status,
    serverReady: fields.status === 'ready',
    clientReady: false,
    hostVersion: fields.hostVersion || '',
    reason: fields.reason || '',
    clientReason: '',
    clientSource: fields.clientSource || '',
    confirmClient(report = {}) {
      if (this.status !== 'ready') return
      if (report.protocol !== SESSION_PATCH_PROTOCOL || report.installed !== true) {
        this.clientReady = false
        this.clientReason = report.reason || '客户端会话补丁没有装上'
        return
      }
      this.clientReady = true
      this.clientReason = ''
    },
    replacementAllowed() {
      // 补丁没装上时宿主 dsh-session 仍会拒绝 assistant/message + sourceEventSeqs 的
      // replace 写入；只有服务端补丁装好且页面完成握手才算就绪。
      return this.serverReady && this.clientReady
    },
    blockReason() {
      if (this.status === 'failed') return this.reason
      if (this.serverReady && !this.clientReady) return this.clientReason || '页面尚未完成会话补丁握手，请刷新后再试'
      return this.reason || '会话补丁未就绪'
    },
    view() {
      const waitingForClient = this.serverReady && !this.clientReady
      return {
        protocol: this.protocol,
        status: this.status,
        ready: this.replacementAllowed(),
        serverReady: this.serverReady,
        clientReady: this.clientReady,
        hostVersion: this.hostVersion,
        reason: waitingForClient ? this.blockReason() : this.reason,
      }
    },
  }
  return handle
}

export async function installHostSessionPatch({ hostRequire, persistence, query } = {}) {
  let require
  try { require = hostRequire || await defaultHostRequire(persistence) }
  catch (error) {
    return createHandle({ status: 'failed', reason: '无法解析宿主 DSH 包：' + (error.message || error) })
  }
  let hostVersion = ''
  try {
    hostVersion = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8')).version || ''
  } catch (error) {
    return createHandle({ status: 'failed', reason: '无法读取宿主 Session 版本：' + (error.message || error) })
  }
  const loadSessionCatalog = async () => {
    const loaded = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href)
    return loaded.sessionFormatCatalog
  }
  const finish = fields => Object.assign(createHandle(fields), { loadSessionCatalog })
  if (persistence?.[INSTALLED]) {
    const installed = persistence[INSTALLED]
    if (!installed.loadSessionCatalog) installed.loadSessionCatalog = loadSessionCatalog
    return installed
  }
  if (!persistence?.tracker?.openHandles || !persistence?.tracker?.writers) {
    return finish({ status: 'failed', hostVersion, reason: '宿主没有 JSONL 会话存储，不能安装补丁' })
  }
  if (persistence.tracker.openHandles.size || persistence.tracker.writers.size) {
    return finish({ status: 'failed', hostVersion, reason: '会话已经打开，不能热替换。请重启后再使用正文编辑、回退和重新生成。' })
  }
  if (!query?._observations?.cache || !query?._corpus) {
    return finish({ status: 'failed', hostVersion, reason: '宿主会话查询尚未就绪，不能安装补丁' })
  }
  if (query._observations.cache.size) {
    return finish({ status: 'failed', hostVersion, reason: '会话查询缓存已经建立，不能安装补丁。请重启后再试。' })
  }
  let patch
  try {
    patch = await prepareExpandedPatch(runtimeRoot(require.resolve('@deepseek-ai/dsh-session')))
    patch.selfTest()
    patch.patchPersistence(persistence)
    patch.patchQuery(query)
  } catch (error) {
    try { patch?.dispose() } catch { /* The installer already restored what it changed. */ }
    return finish({ status: 'failed', hostVersion, reason: '会话补丁安装失败：' + (error.message || error) })
  }
  const handle = finish({ status: 'ready', hostVersion, clientSource: patch.clientSource })
  handle.loadSessionCatalog = async () => patch.catalog
  handle.loadSessionMigration = async () => patch.migration
  handle.dispose = () => patch.dispose()
  Object.defineProperty(persistence, INSTALLED, { value: handle })
  return handle
}
