import { access, readFile, readdir, lstat, realpath, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from 'yaml'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

const RENAMED_BUILTIN_SKILLS = new Set(['character-design', 'user-profile', 'create-skill', 'create-writing-skill', 'advanced-capabilities', 'card-to-mvu', 'gentle-rewrite'])
export function canonicalTavernSkillName(name) {
  return typeof name === 'string' && name.startsWith('tavern-') && RENAMED_BUILTIN_SKILLS.has(name.slice(7)) ? name.slice(7) : name
}

export const SKILL_AGENTS = ['card', 'foreground', 'background']
export function normalizeSkillAgents(value) {
  // 'image' named the retired scene-image Agent; older assignments drop it.
  if (Array.isArray(value)) value = value.filter(role => role !== 'image')
  if (!Array.isArray(value) || value.some(role => !SKILL_AGENTS.includes(role))) throw new Error('Skill 用途必须是卡片、前台或后台 Agent')
  return [...new Set(value)]
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

export function normalizeTavernSkillName(value) {
  const name = str(value).trim().normalize('NFC')
  if (!SKILL_NAME.test(name) || name.length > 64) throw new Error('Skill 名称只允许小写字母、数字和连字符，且不能超过 64 个字符')
  return name
}

function renderSkill(input) {
  const description = str(input.description).trim()
  const body = str(input.body).trim()
  if (description === '') throw new Error('Skill 简介不能为空')
  if (description.length > 500) throw new Error('Skill 简介不能超过 500 个字符')
  if (body === '') throw new Error('Skill 正文不能为空')
  if (body.length > 100000) throw new Error('Skill 正文不能超过 100000 个字符')
  const frontmatter = [
    '---',
    'name: ' + input.name,
    'description: ' + JSON.stringify(description),
    ...(input.modelInvocable === false ? ['disable-model-invocation: true'] : []),
    ...(input.userInvocable === false ? ['user-invocable: false'] : []),
    'metadata:',
    '  tavern:',
    '    purpose: ' + JSON.stringify(input.purpose || 'card'),
    '---'
  ]
  return frontmatter.join('\n') + '\n\n' + body + '\n'
}

export function createTavernSkillModule(options = {}) {
  const directory = path.resolve(str(options.directory))
  const builtInDirectory = path.resolve(str(options.builtInDirectory))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  if (str(options.directory) === '' || str(options.builtInDirectory) === '') throw new Error('Tavern Skill Module 缺少目录')

  // Searched in order, the first match wins: Tavern's own, then plugins' (read-only), then the player's.
  const roots = [{ kind: 'builtin', path: builtInDirectory, role: 'card' }, ...(options.backgroundDirectory ? [{ kind: 'builtin', path: path.resolve(options.backgroundDirectory), role: 'background' }] : []), { kind: 'user', path: directory, role: 'card' }]
  const listeners = new Set()
  function changed() { for (const listener of listeners) listener() }
  /** A plugin's skills directory, after Tavern's own and before the player's; returns its removal. */
  function addRoot({ path: root, role = 'card', owner = '' }) {
    const entry = { kind: 'plugin', path: path.resolve(str(root)), role: role === 'background' ? 'background' : 'card', owner: str(owner) }
    roots.splice(roots.findIndex(item => item.kind === 'user'), 0, entry)
    changed()
    return () => { const at = roots.indexOf(entry); if (at >= 0) { roots.splice(at, 1); changed() } }
  }
  const configPath = path.join(directory, '.assignments.json')
  let pending = Promise.resolve()
  function mutate(operation) {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result.then(value => { for (const listener of listeners) listener(); return value })
  }
  async function assignments() {
    try {
      const current = JSON.parse((await files.read(configPath))?.toString('utf8') || '{}')
      for (const [name, value] of Object.entries(current)) {
        const canonical = canonicalTavernSkillName(name)
        if (canonical !== name && !Object.hasOwn(current, canonical)) current[canonical] = value
      }
      return current
    } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }

  function target(root, name) {
    return path.join(root, normalizeTavernSkillName(name), 'SKILL.md')
  }

  const editPath = name => path.join(directory, '.edits', normalizeTavernSkillName(name) + '.json')
  async function override(name) {
    try { return JSON.parse((await files.read(editPath(name)))?.toString('utf8') || 'null') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function edit(input) {
    const skill = await read(input.name)
    if (!skill) throw new Error('Skill 不存在')
    const content = typeof input.content === 'string' ? input.content.replace(/^\uFEFF/, '') : input.content
    if (typeof content !== 'string' || content.length > 100000) throw new Error('Skill 内容不能超过 100000 个字符')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    const meta = match ? parse(match[1]) : null
    if (!meta || meta.name !== skill.name || typeof meta.description !== 'string' || !meta.description.trim() || !content.slice(match[0].length).trim()) throw new Error('请保留同名 name、非空 description 和正文')
    const references = input.references ?? await referenceFiles(skill.name)
    if (!Array.isArray(references) || references.length > 30) throw new Error('参考文件数量无效')
    const seen = new Set()
    for (const ref of references) {
      validateReference(ref.path)
      if (seen.has(ref.path) || typeof ref.content !== 'string' || ref.content.length > 100000) throw new Error('参考文件重复或内容无效')
      seen.add(ref.path)
    }
    await files.write(editPath(skill.name), JSON.stringify({ content, references }))
    return await read(skill.name)
  }

  async function read(name) {
    const normalized = normalizeTavernSkillName(canonicalTavernSkillName(name))
    for (const root of roots) {
      const source = { kind: root.kind, path: target(root.path, normalized) }
      try {
        if ((await lstat(path.dirname(source.path))).isSymbolicLink() || (await lstat(source.path)).isSymbolicLink()) throw new Error('Skill 入口不能是符号链接')
        const content = ((await override(normalized))?.content ?? await readFile(source.path, 'utf8')).replace(/^\uFEFF/, '')
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
        const meta = match ? parse(match[1]) || {} : {}
        const purpose = meta.metadata?.tavern?.purpose || root.role
        const configuration = await assignments()
        const assigned = Object.hasOwn(configuration, normalized) ? configuration[normalized] : undefined
        if (assigned === null) return null
        const agents = assigned === undefined ? [purpose === 'writing' ? 'foreground' : purpose === 'background' || purpose === 'image' ? 'background' : root.role] : normalizeSkillAgents(assigned)
        return { name: normalized, source: source.kind, content, path: source.path, description: meta.description || '', purpose, agents, modelInvocable: meta['disable-model-invocation'] !== true, userInvocable: meta['user-invocable'] !== false }
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    return null
  }

  async function write(input = {}) {
    const name = normalizeTavernSkillName(canonicalTavernSkillName(input.name))
    for (const root of roots.filter(item => item.kind !== 'user')) {
      if (await exists(target(root.path, name))) throw new Error((root.kind === 'plugin' ? '插件自带的' : '内置') + ' Skill 不可覆盖: ' + name)
    }
    const destination = target(directory, name)
    const present = await exists(destination)
    if (present && input.overwrite !== true) throw new Error('Skill 已存在；确认修改后请明确覆盖: ' + name)
    const previous = present ? await read(name) : null
    const content = renderSkill({
      name,
      purpose: input.purpose ?? previous?.purpose,
      description: input.description,
      body: input.body,
      modelInvocable: input.modelInvocable ?? previous?.modelInvocable,
      userInvocable: input.userInvocable ?? previous?.userInvocable
    })
    if (input.purpose !== undefined && !['card', 'writing', 'background'].includes(input.purpose)) throw new Error('未知 Skill 用途')
    const agents = input.agents === undefined ? undefined : normalizeSkillAgents(input.agents)
    const references = input.references ?? (present ? await referenceFiles(name) : [])
    if (!Array.isArray(references) || references.length > 30) throw new Error('Skill 最多附带 30 个参考文件')
    const seen = new Set()
    for (const ref of references) {
      validateReference(ref.path)
      if (seen.has(ref.path)) throw new Error('重复的参考文件')
      seen.add(ref.path)
      if (typeof ref.content !== 'string' || ref.content.length > 100000) throw new Error('参考文件正文不能超过 100000 个字符')
    }
    const bundle = path.dirname(destination)
    if (await exists(bundle) && (await lstat(bundle)).isSymbolicLink()) throw new Error('Skill 目录不能是符号链接')
    const staging = path.join(directory, '.stage-' + randomUUID())
    const backup = path.join(directory, '.backup-' + randomUUID())
    await mkdir(staging, { recursive: true })
    let moved = false
    try {
      await files.write(path.join(staging, 'SKILL.md'), content)
      for (const ref of references) await files.write(path.join(staging, ref.path), ref.content)
      if (await exists(bundle)) { await rename(bundle, backup); moved = true }
      try { await rename(staging, bundle) } catch (error) { if (moved) await rename(backup, bundle); throw error }
    } finally { await rm(staging, { recursive: true, force: true }) }
    if (moved) await rm(backup, { recursive: true, force: true })
    if (agents !== undefined) await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [name]: agents }))

    await files.remove(editPath(name))
    return { name, source: 'user', path: destination, content, chars: content.length, overwritten: present }
  }

  // Import a skill folder (SKILL.md plus references/*.md) given as relative path → text.
  // Accepts the folder at the archive root or as its single top-level directory.
  async function importBundle({ files: entries, overwrite = false } = {}) {
    const paths = Object.keys(entries || {})
    const entry = paths.filter(item => /(^|\/)SKILL\.md$/i.test(item)).sort((a, b) => a.split('/').length - b.split('/').length)
    if (!entry.length) throw new Error('没有找到 SKILL.md：请导入 Skill 的 SKILL.md，或包含它的 Skill 文件夹压缩包')
    if (entry.length > 1 && entry[0].split('/').length === entry[1].split('/').length) throw new Error('压缩包里有多个 SKILL.md，请每次导入一个 Skill')
    const base = entry[0].slice(0, entry[0].length - 'SKILL.md'.length)
    const content = str(entries[entry[0]]).replace(/^\uFEFF/, '')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!match) throw new Error('SKILL.md 开头缺少 --- 包围的 name 与 description')
    let meta
    try { meta = parse(match[1]) || {} } catch (error) { throw new Error('SKILL.md 开头的 YAML 无法解析：' + str(error && error.message || error)) }
    const name = normalizeTavernSkillName(canonicalTavernSkillName(str(meta.name)))
    const purpose = meta.metadata?.tavern?.purpose
    const references = [], skipped = []
    for (const item of paths) {
      if (item === entry[0] || !item.startsWith(base)) continue
      const relative = item.slice(base.length)
      if (/^references\/[a-zA-Z0-9_./-]+\.md$/.test(relative) && !relative.split('/').some(part => part === '..' || part === '.' || !part)) references.push({ path: relative, content: str(entries[item]) })
      else skipped.push(relative)
    }
    if (!overwrite && await exists(target(directory, name))) return { conflict: true, name }
    const written = await write({
      name, description: meta.description, body: content.slice(match[0].length),
      ...(['card', 'writing', 'background', 'image'].includes(purpose) ? { purpose } : {}),
      modelInvocable: meta['disable-model-invocation'] !== true, userInvocable: meta['user-invocable'] !== false,
      references, overwrite
    })
    return { skill: written, skipped }
  }

  async function list() {
    const names = new Set()
    for (const root of roots) {
      let entries
      try { entries = await readdir(root.path, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      for (const entry of entries) if (entry.isDirectory() && SKILL_NAME.test(entry.name)) names.add(entry.name)
    }
    const result = []
    for (const name of [...names].sort()) { const skill = await read(name); if (skill) result.push(skill) }
    return result
  }
  function validateReference(relative) {
    if (typeof relative !== 'string' || !/^references\/[a-zA-Z0-9_./-]+\.md$/.test(relative) || relative.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('参考文件必须位于 references/ 内，使用相对 Markdown 路径')
  }
  async function readReference(name, relative) {
    validateReference(relative)
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    const edited = await override(skill.name)
    if (edited) { const ref = edited.references.find(ref => ref.path === relative); if (!ref) throw new Error('参考文件不存在'); return ref.content }
    const base = await realpath(path.dirname(skill.path))
    const resolved = await realpath(path.join(base, relative))
    if (!resolved.startsWith(base + path.sep)) throw new Error('参考文件不能指向 Skill 目录之外')
    return await readFile(resolved, 'utf8')
  }
  async function referenceFiles(name) {
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    const edited = await override(skill.name)
    if (edited) return edited.references
    let entries
    try { entries = await readdir(path.join(path.dirname(skill.path), 'references'), { recursive: true, withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const result = []
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const relative = path.relative(path.dirname(skill.path), path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      validateReference(relative)
      result.push({ path: relative, content: await readReference(name, relative) })
    }
    return result
  }
  async function assign(name, agents) {
    const normalized = normalizeTavernSkillName(canonicalTavernSkillName(name))
    const roles = normalizeSkillAgents(agents)
    if (!await read(normalized)) throw new Error('Skill 不存在')
    await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [normalized]: roles }))
    return await read(normalized)
  }
  async function remove(name) {
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    if (skill.source === 'builtin' || skill.source === 'plugin') {
      await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [skill.name]: null }))
      return
    }
    await files.remove(editPath(skill.name))
    await rm(path.dirname(skill.path), { recursive: true })
    await files.update(configPath, raw => { const data = raw ? JSON.parse(raw) : {}; delete data[skill.name]; return JSON.stringify(data) })
  }
  return Object.freeze({ addRoot, edit: input => mutate(() => edit(input)), read, list, readReference, referenceFiles, write: input => mutate(() => write(input)), importBundle: input => mutate(() => importBundle(input)), assign: (name, agents) => mutate(() => assign(name, agents)), remove: name => mutate(() => remove(name)), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } })
}
