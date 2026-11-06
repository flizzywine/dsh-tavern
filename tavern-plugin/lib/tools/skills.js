import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerSkillTools({
  chatForSession,
  skillEnabledFor,
  skillRoleFor,
  tavernSkills,
  tools,
}) {
  tools.register(defineTool({
    name: 'tavern_read_skill_reference',
    description: '按需读取当前 Agent 可用 Skill 内的 references/*.md。先用原生 skill 工具读取入口，再按入口指引读取相关参考文件。',
    parameters: { name: { type: 'string', required: true }, path: { type: 'string', required: true, description: 'Skill 内的相对路径，例如 references/dialogue.md' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.content }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const role = await skillRoleFor(exec.agent)
      const skill = await tavernSkills.read(args.name)
      if (!role || !skill?.modelInvocable || !skill.agents.includes(role) || !await skillEnabledFor(skill, exec.agent)) throw new Error('此 Skill 未分配给当前 Agent')
      return { content: await tavernSkills.readReference(args.name, args.path) }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_save_skill',
    description: '仅当用户明确要求创建或修改 Tavern Skill 时，把结构化内容安全保存到用户 Skill 目录。不能覆盖内置 Skill；修改同名用户 Skill 必须明确 overwrite=true。',
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
