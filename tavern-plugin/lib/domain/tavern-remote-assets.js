function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

const execFile = promisify(execFileCallback)
const JSD_GH_URL = /https:\/\/(?:cdn|testingcf)\.jsdelivr\.net\/gh\/([^/\s"'<>]+)\/([^/@\s"'<>]+)(?:@([^/\s"'<>]+))?(\/[^\s"'<>]*)?/g
const FIXED_COMMIT = /^[0-9a-f]{40}$/i

function validGitHubPart(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

function validGitRef(value) {
  return value === 'HEAD' || (/^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith('-') && !value.includes('..') && !value.includes('@{'))
}

async function resolveWithGit(reference) {
  if (!validGitHubPart(reference.owner) || !validGitHubPart(reference.repo) || !validGitRef(reference.ref)) throw new Error('远程 Git 引用格式不安全')
  const repoUrl = 'https://github.com/' + reference.owner + '/' + reference.repo + '.git'
  const patterns = reference.ref === 'HEAD' ? ['HEAD'] : ['refs/heads/' + reference.ref, 'refs/tags/' + reference.ref, 'refs/tags/' + reference.ref + '^{}']
  const result = await execFile('git', ['ls-remote', '--refs', repoUrl].concat(patterns), { timeout: 20000, maxBuffer: 1024 * 1024 })
  const commits = str(result.stdout).split(/\r?\n/).map(function (line) { return line.trim().split(/\s+/)[0] }).filter(function (commit) { return FIXED_COMMIT.test(commit) })
  if (commits.length === 0) throw new Error('Git 未返回可锁定的提交号')
  return commits[commits.length - 1]
}

export function inspectMutableJsDelivrUrls(text) {
  const urls = []
  for (const match of str(text).matchAll(JSD_GH_URL)) {
    if (FIXED_COMMIT.test(match[3])) continue
    urls.push({ url: match[0], owner: match[1], repo: match[2], ref: match[3] || 'HEAD', explicitRef: match[3] !== undefined, path: match[4] || '' })
  }
  return urls
}

/** Resolve mutable jsDelivr GitHub references once and persist the commit pin. */
export function createTavernRemoteAssetPinStore(options = {}) {
  const readJson = options.readJson
  const updateJson = options.updateJson
  const request = options.fetch || globalThis.fetch
  const gitResolver = options.resolveGitRef || resolveWithGit
  const storagePath = str(options.storagePath) || 'tavern-remote-asset-pins.json'
  const memory = new Map()
  let loaded = false
  let mutationTail = Promise.resolve()

  async function load() {
    if (loaded) return
    const saved = typeof readJson === 'function' ? await readJson(storagePath) : null
    const pins = saved && saved.pins && typeof saved.pins === 'object' ? saved.pins : {}
    for (const [key, value] of Object.entries(pins)) {
      if (value && FIXED_COMMIT.test(str(value.commit))) memory.set(key, clone(value))
    }
    loaded = true
  }

  async function persist(key, value) {
    if (typeof updateJson !== 'function') return
    mutationTail = mutationTail.then(async function () {
      await updateJson(storagePath, function (current) {
        const next = current && typeof current === 'object' ? Object.assign({}, current) : {}
        next.version = 1
        next.pins = next.pins && typeof next.pins === 'object' ? Object.assign({}, next.pins) : {}
        next.pins[key] = clone(value)
        next.updatedAt = Date.now()
        return next
      })
    })
    await mutationTail
  }

  async function resolvePin(reference) {
    await load()
    const key = reference.owner + '/' + reference.repo + '@' + reference.ref
    if (memory.has(key)) return memory.get(key)
    if (typeof request !== 'function') throw new Error('当前运行环境不能解析远程脚本提交')
    let commit = ''
    let apiError = ''
    try {
      const endpoint = 'https://api.github.com/repos/' + encodeURIComponent(reference.owner) + '/' + encodeURIComponent(reference.repo) + '/commits/' + encodeURIComponent(reference.ref)
      const response = await request(endpoint, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-tavern' } })
      if (!response || response.ok !== true) throw new Error('HTTP ' + str(response && response.status))
      const body = await response.json()
      commit = str(body && body.sha)
    } catch (error) {
      apiError = str(error && error.message || error)
    }
    if (!FIXED_COMMIT.test(commit)) {
      try {
        commit = await gitResolver(reference)
      } catch (error) {
        throw new Error('GitHub API 解析失败（' + (apiError || '无效提交号') + '）；Git 后备解析失败（' + str(error && error.message || error) + '）')
      }
    }
    if (!FIXED_COMMIT.test(commit)) throw new Error('GitHub 返回了无效提交号')
    const value = { owner: reference.owner, repo: reference.repo, ref: reference.ref, commit, resolvedAt: Date.now() }
    memory.set(key, value)
    await persist(key, value)
    return value
  }

  async function pinText(text) {
    const source = str(text)
    const references = inspectMutableJsDelivrUrls(source)
    if (references.length === 0) return { text: source, pins: [], diagnostics: [] }
    let result = source
    const pins = []
    const diagnostics = []
    const unique = new Map(references.map(function (item) { return [item.owner + '/' + item.repo + '@' + item.ref, item] }))
    for (const reference of unique.values()) {
      try {
        const pin = await resolvePin(reference)
        const mutable = reference.owner + '/' + reference.repo + (reference.explicitRef ? '@' + reference.ref : '')
        const fixed = reference.owner + '/' + reference.repo + '@' + pin.commit
        result = result.split(mutable).join(fixed)
        pins.push(clone(pin))
      } catch (error) {
        diagnostics.push({ status: 'unresolved-remote-asset', url: reference.url, message: str(error && error.message || error) })
      }
    }
    return { text: result, pins, diagnostics }
  }

  async function pinExtensions(extensions) {
    const helperScripts = []
    const regexScripts = []
    const diagnostics = []
    const pins = []
    for (const script of Array.isArray(extensions && extensions.helperScripts) ? extensions.helperScripts : []) {
      const resolved = await pinText(script.content)
      helperScripts.push(Object.assign({}, script, {
        content: resolved.text,
        enabled: resolved.diagnostics.length === 0 ? script.enabled : false
      }))
      diagnostics.push(...resolved.diagnostics.map(function (item) { return Object.assign({ asset: 'helper', name: str(script.name) }, item) }))
      pins.push(...resolved.pins)
    }
    for (const script of Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : []) {
      const resolved = await pinText(script.replaceString)
      regexScripts.push(Object.assign({}, script, {
        replaceString: resolved.text,
        enabled: resolved.diagnostics.length === 0 ? script.enabled : false
      }))
      diagnostics.push(...resolved.diagnostics.map(function (item) { return Object.assign({ asset: 'regex', name: str(script.name) }, item) }))
      pins.push(...resolved.pins)
    }
    const uniquePins = Array.from(new Map(pins.map(function (pin) { return [pin.owner + '/' + pin.repo + '@' + pin.ref, pin] })).values())
    return { helperScripts, regexScripts, diagnostics, pins: uniquePins }
  }

  return Object.freeze({ pinText, pinExtensions, inspect: function () { return Array.from(memory.values()).map(clone) } })
}
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
