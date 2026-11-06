import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerUserProfileTools({
  chatForSession,
  tools,
  userPreferenceProfile,
}) {
  tools.register(defineTool({
    name: 'tavern_user_profile_read',
    description: '读取当前用户画像及待确认的修改。画像始终作为同一份资料维护，revision 仅供工具校验，不向用户展示编号。建立、复查或修改用户画像时先调用；草案不等于已确认偏好。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        profileName: { type: 'string', required: true },
        hasDraft: { type: 'boolean', required: true },
        hasConfirmed: { type: 'boolean', required: true },
        draftRevision: { type: 'integer', required: true },
        confirmedRevision: { type: 'integer', required: true },
        draftJson: { type: 'string', required: true },
        confirmedJson: { type: 'string', required: true }
      } },
      render: function (_args, value) {
        if (!value.hasDraft && !value.hasConfirmed) return [{ type: 'text', text: '画像“' + value.profileName + '”尚未建立。' }]
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      }
    },
    isConcurrencySafe: function () { return true },
    async execute(_args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
      const value = await userPreferenceProfile.read(chat.userProfileManagementId || chat.userProfileId || 'default')
      return {
        profileName: value.name,
        hasDraft: value.hasDraft,
        hasConfirmed: value.hasConfirmed,
        draftRevision: value.hasDraft ? Number(value.draft.revision) || 0 : 0,
        confirmedRevision: value.hasConfirmed ? Number(value.confirmed.profileRevision) || 0 : 0,
        draftJson: value.hasDraft ? JSON.stringify(value.draft, null, 2) : '',
        confirmedJson: value.hasConfirmed ? JSON.stringify(value.confirmed, null, 2) : ''
      }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_user_profile_save',
    description: '将整理好的长期偏好直接保存到当前用户画像，更新同一份资料。用户要求建立或修改画像即授权保存，无需额外确认；保存后简短报告，用户可随时要求修改。不会自动启用画像。',
    parameters: {
      content: { type: 'string', required: true, description: '完整 Markdown 用户画像正文，最多 3000 字；保存内容与启用内容相同' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        saved: { type: 'boolean', required: true },
        hasConfirmed: { type: 'boolean', required: true }
      } },
      render: function (_args, value) {
        return [{ type: 'text', text: '用户画像已保存。用户提出修改时继续更新当前画像。' }]
      }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
      const value = await userPreferenceProfile.save({ content: args.content, profileId: chat.userProfileManagementId || chat.userProfileId || 'default' })
      return { saved: true, hasConfirmed: value.hasConfirmed }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_user_profile_confirm',
    description: '将用户已核对并明确同意的当前内容保存到同一份画像。用户已确认时直接调用，不重复询问。不得把沉默、继续回答、模糊认可或 Agent 自己的判断当作确认。',
    parameters: {
      draftRevision: { type: 'integer', required: true, description: '工具返回的内部校验值，不向用户展示' },
      confirmation: { type: 'string', required: true, enum: ['确认保存用户画像'], description: '只有用户明确确认保存后才能填写此固定文本' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        confirmedRevision: { type: 'integer', required: true }
      } },
      render: function (_args, value) {
        return [{ type: 'text', text: '用户画像已保存。可在用户画像面板为当前游戏或新游戏启用。' }]
      }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
      const value = await userPreferenceProfile.confirm({ ...args, profileId: chat.userProfileManagementId || chat.userProfileId || 'default' })
      return { confirmedRevision: Number(value.confirmed.profileRevision) || 0 }
    }
  }))
}
