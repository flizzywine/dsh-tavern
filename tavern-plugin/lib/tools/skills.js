import { defineTool } from '@deepseek-ai/dsh-tools'
import { USE_SKILL_TOOL } from '../domain/foreground-tools.js'

const textOutput = {
  schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
  render: (_args, value) => [{ type: 'text', text: value.content }]
}

export function registerSkillTools({
  chatForSession,
  playSkillAvailable = () => false,
  skillEnabledFor,
  skillRoleFor,
  tavernSkills,
  tools,
}) {
  async function modelSkill(name, agent) {
    const role = await skillRoleFor(agent)
    const skill = await tavernSkills.read(name)
    if (!role || !skill?.modelInvocable || !skill.agents.includes(role) || !await skillEnabledFor(skill, agent)) throw new Error('此 Skill 未分配给当前 Agent')
    return skill
  }

  async function readReference({ name, path }, { agent }) {
    const skill = await modelSkill(name, agent)
    return { content: await tavernSkills.readReference(skill.name, path) }
  }

  tools.register(defineTool({
    name: USE_SKILL_TOOL,
    description: '加载或查阅当前游玩的 Skill。load 按目录里的准确名称加载正文；read_reference 按正文指引读取 references/*.md（旧 Skill 中的 tavern_read_skill_reference 指同一操作）。',
    parameters: {
      action: { type: 'string', enum: ['load', 'read_reference'], required: true },
      name: { type: 'string', required: true, description: 'Skill 的准确名称' },
      path: { type: 'string', description: 'read_reference 必填，例如 references/dialogue.md' }
    },
    output: textOutput,
    isConcurrencySafe: ({ action }) => action === 'read_reference',
    async execute(args, exec) {
      if (!await playSkillAvailable(exec.agent)) throw new Error('本局未开放「使用 Skill」')
      if (args.action === 'read_reference') {
        if (!args.path?.trim()) throw new Error('读取 Skill 参考需要填写 path')
        return readReference(args, exec)
      }
      const skill = await modelSkill(args.name, exec.agent)
      const native = typeof tools.executable === 'function' ? tools.executable('skill', exec.agent) : tools.get('skill', exec.agent)
      if (!native) throw new Error('当前 Agent 没有可用的 DSH Skill 加载器')
      const input = { name: skill.name }
      const value = await native.execute(input, exec)
      return { content: native.output.render(input, value).filter(block => block.type === 'text').map(block => block.text).join('') }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_read_skill_reference',
    description: '按需读取当前 Agent 可用 Skill 内的 references/*.md。先用原生 skill 工具读取入口，再按入口指引读取相关参考文件。',
    parameters: { name: { type: 'string', required: true }, path: { type: 'string', required: true, description: 'Skill 内的相对路径，例如 references/dialogue.md' } },
    output: textOutput,
    isConcurrencySafe: () => true,
    execute: readReference
  }))

  tools.register(defineTool({
    name: 'tavern_read_skill',
    description: '卡片工作台编辑已有用户 Skill 时使用。按名称读取当前 SKILL.md 和参考文件，省略名称则列出可编辑的用户 Skill。',
    parameters: { name: { type: 'string', description: '要编辑的 Skill 名称' } },
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (await skillRoleFor(exec.agent) !== 'card') throw new Error('请在卡片工作台读取待编辑的 Skill')
      if (args.name === undefined) {
        const skills = (await tavernSkills.list()).filter(skill => skill.source === 'user')
        return { content: skills.map(skill => '- ' + skill.name + ' · ' + skill.purpose + ' · ' + skill.description).join('\n') || 'Skill 库中没有自建 Skill。' }
      }
      const skill = await tavernSkills.read(args.name)
      if (skill?.source !== 'user') throw new Error('未找到可编辑的用户 Skill：' + args.name)
      const references = await tavernSkills.referenceFiles(skill.name)
      return { content: ['待编辑的 SKILL.md\n' + skill.content, ...references.map(ref => ref.path + '\n' + ref.content)].join('\n\n') }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_save_skill',
    description: '仅当用户明确要求创建或修改 Tavern Skill 时，把结构化内容安全保存到用户 Skill 目录。不能覆盖内置 Skill；修改同名用户 Skill 时传 overwrite=true。',
    parameters: {
      name: { type: 'string', required: true, description: 'kebab-case Skill 名称' },
      description: { type: 'string', required: true, description: '用于 Skill 自动发现的一句话简介，说明做什么以及何时使用' },
      body: { type: 'string', required: true, description: '不含 YAML frontmatter 的完整 Markdown 指令正文' },
      purpose: { type: 'string', enum: ['card', 'writing', 'background', 'image'], description: '用途：卡片制作、前台写作、后台任务、文生图；默认卡片制作' },
      agents: { type: 'array', items: { type: 'string', enum: ['card', 'foreground', 'background', 'image'] }, description: '分配给哪些 Agent；省略时按用途默认分配' },
      references: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, content: { type: 'string', required: true } } }, description: 'Skill 自带的参考资料副本，路径为 references/名称.md；省略保留旧文件，传数组替换整套文件' },
      modelInvocable: { type: 'boolean', description: '是否允许 Agent 自动发现，默认 true' },
      userInvocable: { type: 'boolean', description: '是否允许用户显式调用，默认 true' },
      overwrite: { type: 'boolean', description: '同名用户 Skill 已存在且用户明确要求修改时设为 true' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          chars: { type: 'integer', required: true },
          overwritten: { type: 'boolean', required: true },
          saved: { type: 'boolean', required: true }
        }
      },
      render: function (_args, value) {
        return [{ type: 'text', text: 'Tavern Skill 已' + (value.overwritten ? '更新' : '创建') + '：' + value.name + ' · ' + value.chars + ' 字；已进入 Skill 目录，不会自动执行。' }]
      }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('Tavern Skill 只能在卡片工作台中创建或修改')
      const saved = await tavernSkills.write(args)
      return { name: saved.name, chars: saved.chars, overwritten: saved.overwritten, saved: true }
    }
  }))
}
