import path from 'node:path'
import { existingTransferFolder, folderZipName, importFolderZip, namedFolderBase, packFolderZip, readFolderFiles } from './transfer-folder.js'

// 导出/导入里的写作 Skill 子模块：只负责 zip 与文件读写，Skill 目录本身仍归 tavern-skills 管。
function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 「写作 Skill」后面的用途后缀，有 agents 就拼上去。 */
function metaOf(skill) {
  const agents = Array.isArray(skill && skill.agents) ? skill.agents.map(str).filter(Boolean) : []
  return agents.length ? '写作 Skill · ' + agents.join('/') : '写作 Skill'
}

/**
 * deps.skillsDir 是用户 Skill 根目录（真实实现 <dataRoot>/skills），
 * deps.listSkills() 返回 Skill 列表（真实实现 tavernSkills.list()）。
 */
export function createTransferSkills(deps) {
  const { skillsDir, listSkills } = deps
  if (!skillsDir) fail('缺少 Skill 目录')

  async function installed() {
    try {
      const rows = await listSkills()
      return Array.isArray(rows) ? rows : []
    } catch { return [] }
  }

  async function list() {
    const skills = await installed()
    const rows = []
    for (const skill of skills) {
      const name = str(skill && skill.name)
      if (!name) continue
      const files = await readFolderFiles(path.join(skillsDir, name))
      // 目录不存在或没有可打包的文件就当没有这个 Skill。
      if (!files.length) continue
      rows.push({
        key: name,
        title: name,
        meta: metaOf(skill),
        bytes: files.reduce((total, file) => total + file.content.length, 0)
      })
    }
    return rows
  }

  async function collect(names) {
    const wanted = (Array.isArray(names) ? names : [names]).map(str).filter(Boolean)
    const items = []
    for (const name of wanted) {
      const dir = existingTransferFolder(skillsDir, name, 'Skill')
      const entries = await readFolderFiles(dir)
      if (!entries.length) fail('Skill 不存在：' + name)
      const content = packFolderZip(entries, { kind: 'Skill', title: name })
      items.push({ key: name, title: name, fileName: folderZipName(name), content })
    }
    return items
  }

  function importOne(payload) {
    return importFolderZip(skillsDir, payload, {
      label: 'Skill 包', zipLabel: '写作 Skill 包', baseName: (key, title) => namedFolderBase(str(key) || str(title), 'skill'), suffixed: (base, index) => base + '-' + index
    })
  }

  return Object.freeze({ list, collect, importOne })
}
