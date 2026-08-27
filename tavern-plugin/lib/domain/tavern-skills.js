import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

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
    '---'
  ]
  return frontmatter.join('\n') + '\n\n' + body + '\n'
}

export function createTavernSkillModule(options = {}) {
  const directory = path.resolve(str(options.directory))
  const builtInDirectory = path.resolve(str(options.builtInDirectory))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  if (str(options.directory) === '' || str(options.builtInDirectory) === '') throw new Error('Tavern Skill Module 缺少目录')

  function target(root, name) {
    return path.join(root, normalizeTavernSkillName(name), 'SKILL.md')
  }

  async function read(name) {
    const normalized = normalizeTavernSkillName(name)
    for (const source of [
      { kind: 'builtin', path: target(builtInDirectory, normalized) },
      { kind: 'user', path: target(directory, normalized) }
    ]) {
      try {
        const content = await readFile(source.path, 'utf8')
        return { name: normalized, source: source.kind, content, path: source.path }
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    return null
  }

  async function write(input = {}) {
    const name = normalizeTavernSkillName(input.name)
    if (await exists(target(builtInDirectory, name))) throw new Error('内置 Skill 不可覆盖: ' + name)
    const destination = target(directory, name)
    const present = await exists(destination)
    if (present && input.overwrite !== true) throw new Error('Skill 已存在；确认修改后请明确覆盖: ' + name)
    const content = renderSkill({
      name,
      description: input.description,
      body: input.body,
      modelInvocable: input.modelInvocable,
      userInvocable: input.userInvocable
    })
    await files.write(destination, content)
    return { name, source: 'user', path: destination, content, chars: content.length, overwritten: present }
  }

  return Object.freeze({ read, write })
}
