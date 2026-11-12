import { defineTool } from '@deepseek-ai/dsh-tools'
import { VALIDATION_SCHEMA, validationText } from './card-validation-check.js'
import { planCardTextReplace } from '../domain/card-text-replace.js'
import { planMvuApply, surveyMvuCard, surveyText } from '../domain/mvu-card-apply.js'
import { searchCardRaw } from '../domain/card-reading.js'
import { normalizeResourcePath } from '../domain/file-resources.js'

export function registerCardEditingTools({
  activeTurnOf,
  cardPreparation,
  chatForSession,
  checkCard,
  readCardWorkspace,
  restoreCurrentCard,
  str,
  tools,
  turnOrchestrator,
  worldBooks,
}) {
  tools.register(defineTool({
    name: 'tavern_update_card',
    description: '仅当用户明确要求或确认修改时，立即保存最小的人物卡变更；保存后自动校验磁盘文件并在结果中返回，无需再调用 tavern_validate_card；有错误时修正后再保存。path 可指定任意人物卡，省略时改当前打开的卡；无需事先挂载或引用。空白工作台会直接创建并绑定正式人物卡文件，必须同时具备角色名和玩家身份。另存为副本时先调用 tavern_copy_card，由工具保留源卡 PNG。只讨论时不要调用。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡路径，如 cards/角色 v2.json；省略时修改当前打开的人物卡' },
      fields: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          scenario: { type: 'string' },
          first_mes: { type: 'string' },
          mes_example: { type: 'string' },
          system_prompt: { type: 'string' },
          post_history_instructions: { type: 'string' },
          creator_notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          alternate_greetings: { type: 'array', items: { type: 'string' } },
          player: { type: 'string', description: '新建人物卡时用于约束 {{user}} 视角的玩家身份' }
        }
      },
      rawOperations: {
        type: 'array',
        description: '仅用于标准字段和专用资源工具无法覆盖的扩展字段；不能修改世界书。按 JSON Pointer 对完整工作 raw 做最小 set/delete 修改',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            op: { type: 'string', required: true, enum: ['set', 'delete'] },
            path: { type: 'string', required: true, description: 'JSON Pointer，例如 /data/extensions/regex_scripts/0/disabled' },
            value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
          }
        }
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          saved: { type: 'boolean', required: true },
          path: { type: 'string' },
          mode: { type: 'string', required: true, enum: ['card'] },
          changed: { type: 'boolean', required: true },
          createsCard: { type: 'boolean', required: true },
          changedFields: { type: 'array', required: true, items: { type: 'string' } },
          validation: VALIDATION_SCHEMA
        }
      },
      render: function (_args, value) {
        const detail = value.changedFields.length > 0 ? '：' + value.changedFields.join('、') : ''
        const where = value.path ? '（' + value.path + '）' : ''
        const check = value.validation ? '\n' + validationText(value.validation) : ''
        if (value.createsCard) return [{ type: 'text', text: '已创建并绑定正式人物卡' + detail + check }]
        if (!value.changed) return [{ type: 'text', text: '提交内容与当前设定相同，无需改动' + where + check }]
        return [{ type: 'text', text: '已保存人物卡变更' + where + detail + check }]
      }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const result = await turnOrchestrator.saveChanges({
        sessionId,
        turn: activeTurnOf(exec),
        path: args.path,
        fields: args.fields,
        rawOperations: args.rawOperations
      })
      const chat = await chatForSession(sessionId)
      const cardPath = result.path || (chat && chat.cardPath) || ''
      return cardPath ? { ...result, validation: await checkCard(chat, cardPath) } : result
    }
  }))

  tools.register(defineTool({
    name: 'tavern_replace_card_text',
    description: '仅当用户明确要求修改时，在整张人物卡里批量替换文字并立即保存：标准字段、开场、内置世界书条目（标题、关键词、正文）、正则和脚本一次改完，保存后自动校验。结果列出每个位置替换了几处、全卡剩余几处，以此为准，无需再搜索或用脚本复核。只想改部分位置时用 pointers 限定（可填 tavern_search_card 返回的 pointer 或其上级，如 /data/character_book/entries/8）；填 expectedCount 时实际处数不符则不改。不处理绑定的独立世界书。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡路径；省略时修改当前人物卡' },
      find: { type: 'string', required: true, description: '要替换的文字；默认按字面匹配，不区分大小写' },
      replace: { type: 'string', required: true, description: '替换成的文字；regex 为 true 时可用 $1 等引用分组' },
      regex: { type: 'boolean', description: '为 true 时把 find 当作 JavaScript 正则' },
      pointers: { type: 'array', items: { type: 'string' }, description: '可选，只替换这些 JSON Pointer 位置及其下级' },
      expectedCount: { type: 'integer', description: '可选，预期替换的总处数；不符时不保存并返回实际分布' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          replaced: { type: 'integer', required: true },
          remaining: { type: 'integer', required: true },
          locations: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            pointer: { type: 'string', required: true }, label: { type: 'string', required: true }, count: { type: 'integer', required: true } } } },
          skipped: { type: 'array', required: true, items: { type: 'string' } },
          validation: VALIDATION_SCHEMA
        }
      },
      render: function (_args, value) {
        const lines = ['已在 ' + value.path + ' 替换 ' + value.replaced + ' 处，全卡剩余 ' + value.remaining + ' 处：']
        for (const item of value.locations) lines.push('- ' + item.pointer + (item.label ? ' · ' + item.label : '') + ' · ' + item.count + ' 处')
        if (value.skipped.length) lines.push('未自动替换（请用对应工具单独处理）：' + value.skipped.join('、'))
        if (value.validation) lines.push(validationText(value.validation))
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('人物卡替换只能在卡片工作台中使用')
      const requested = str(args.path).trim() || str(chat.cardPath)
      if (requested === '') throw new Error('空白工作台还没有正式人物卡')
      const cardPath = normalizeResourcePath(requested, 'card')
      const workspace = await readCardWorkspace(cardPath)
      if (workspace === undefined) throw new Error('人物卡资源不存在: ' + cardPath)
      const plan = planCardTextReplace(cardPreparation.raw(workspace), args)
      if (plan.occurrences === 0) throw new Error('人物卡中没有找到「' + str(args.find) + '」' + (plan.skipped.length ? '（仅在不支持自动替换的位置出现：' + plan.skipped.map(item => item.pointer).join('、') + '）' : ''))
      if (Number.isInteger(args.expectedCount) && args.expectedCount !== plan.occurrences) {
        throw new Error('预期 ' + args.expectedCount + ' 处，实际 ' + plan.occurrences + ' 处，未修改。分布：' + plan.locations.map(item => item.pointer + '×' + item.count).join('、'))
      }
      if (Object.keys(plan.fields).length || plan.rawOperations.length) {
        await turnOrchestrator.saveChanges({ sessionId, turn: activeTurnOf(exec), path: cardPath, fields: plan.fields, rawOperations: plan.rawOperations })
      }
      if (plan.worldbook.length) await worldBooks.update({ kind: 'card', cardPath }, { operations: plan.worldbook })
      const saved = await readCardWorkspace(cardPath)
      const left = searchCardRaw(cardPreparation.raw(saved), { query: args.find, regex: args.regex === true, limit: 1 })
      return {
        path: cardPath, replaced: plan.occurrences, remaining: left.occurrences,
        locations: plan.locations, skipped: plan.skipped.map(item => item.pointer), validation: await checkCard(chat, cardPath)
      }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_mvu_overview',
    description: '只读：一次列出人物卡里与加 MVU 相关的全貌——设定字段长度、每个开场（位置、长度、开头、是否已有 <initvar>/<mvu-status/>）、现有变量、内置世界书每条（编号、标题、触发方式、长度）、正则和脚本，并按关键词标出可能的旧状态栏、变量、候选项协议。转 MVU 或改 MVU 卡时先调用它，再按需读具体内容，不必用命令行遍历卡片文件。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡路径；省略时读当前人物卡' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, text: { type: 'string', required: true } } },
      render: function (_args, value) { return [{ type: 'text', text: value.path + '\n' + value.text }] }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      const requested = str(args.path).trim() || str(chat && chat.cardPath)
      if (requested === '') throw new Error('空白工作台还没有正式人物卡')
      const cardPath = normalizeResourcePath(requested, 'card')
      const workspace = await readCardWorkspace(cardPath)
      if (workspace === undefined) throw new Error('人物卡资源不存在: ' + cardPath)
      return { path: cardPath, text: surveyText(surveyMvuCard(cardPreparation.raw(workspace))) }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_apply_mvu',
    description: '把 MVU 结构一次写进人物卡并保存：你给出变量、各开场的不同值、更新规则和面板，工具负责机械部分——在每个开场末尾写入 <initvar>（自动加 $meta.strictSet，替换旧的）和 <mvu-status/>，新增或更新世界书 [mvu_update]（常驻，自动补提交说明）与 [initvar]（禁用）条目，新增或更新状态面板正则和隐藏入口正则；可用 remove 在同一次保存里删掉开场里的旧状态块、旧状态说明条目和旧正则；其他内容不动。省略的部分保持卡里现有内容，可反复调用只改其中一部分。保存后自动校验，结果就是已保存的内容，无需再读文件核对。之后仍可用其他工具细调。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡路径；省略时改当前人物卡' },
      variables: { type: 'json', description: '变量默认初值对象（stat_data 结构），各开场共用；省略时保留各开场现有初值' },
      openings: { type: 'array', items: { type: 'json' }, description: '可选，按开场顺序（first_mes、alternate_greetings…）给出与默认值不同的字段，只写不同的部分，深合并到 variables；某个开场无差异写 null' },
      rules: { type: 'string', description: '[mvu_update] 规则正文：每个字段在什么剧情事实下怎么变；省略时保留现有规则' },
      remove: {
        type: 'object', additionalProperties: false,
        description: '可选，同一次保存里清理旧状态协议',
        properties: {
          fromOpenings: { type: 'string', description: 'JavaScript 正则源码，从每个开场删除匹配内容（如旧状态块 "\\n*<状态>[\\s\\S]*?</状态>"）；都不匹配时报错不保存' },
          entries: { type: 'array', items: { type: 'string' }, description: '要删除的内置世界书条目编号，如 entry:3' },
          regex: { type: 'array', items: { type: 'string' }, description: '要删除的正则：序号、JSON Pointer 或 id' }
        }
      },
      panel: {
        type: 'object', additionalProperties: false,
        description: '状态面板。给 html 用你写的完整 HTML（美元符号照常写，工具会转义）；不给 html 时按 title/sections/accent 生成标准面板；省略整个 panel 时保留已有面板，没有则按变量自动生成',
        properties: {
          html: { type: 'string' },
          title: { type: 'string' },
          accent: { type: 'string', description: '主色，如 #8b3a2e' },
          sections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            title: { type: 'string' },
            fields: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              path: { type: 'string', required: true, description: '变量路径，如 /状态/体力' },
              label: { type: 'string' },
              kind: { type: 'string', enum: ['text', 'bar', 'list'] },
              max: { type: 'number', description: 'bar 的满值，默认 100' },
              yes: { type: 'string', description: '布尔值为 true 时显示的词，如 在线；默认 是' },
              no: { type: 'string', description: '布尔值为 false 时显示的词，如 离线；默认 否' }
            } } }
          } } }
        }
      },
      visibility: {
        type: 'json',
        description: '可选，隐藏属性规则映射（键为相对 stat_data 的路径或含 * 通配符路径，如 "/人物/*/好感度"）。每项支持 mode: "masked"（纯迷雾，默认显示 ？？？、回执仅提示已发生变化）、"trend"（迷雾+趋势，回执显示上升 ↑ / 下降 ↓ 不透具体数值）、"tiered"（模糊档位，配合 tiers: [[0,"戒备"],[60,"信赖"]] 显示阶段词，默认带趋势与跨档提示），可选 placeholder、largeDelta 及预留字段 revealWhen；传 {} 清空隐藏规则'
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          openings: { type: 'integer', required: true },
          variables: { type: 'array', required: true, items: { type: 'string' } },
          rules: { type: 'string', required: true },
          panel: { type: 'string', required: true },
          removed: { type: 'object', required: true, additionalProperties: false, properties: {
            openings: { type: 'integer', required: true }, entries: { type: 'integer', required: true }, regex: { type: 'integer', required: true } } },
          visibility: { type: 'array', items: { type: 'string' } },
          validation: VALIDATION_SCHEMA
        }
      },
      render: function (_args, value) {
        const words = { kept: '保留', updated: '已更新', added: '已新增', custom: '使用你写的 HTML', generated: '已生成标准面板' }
        const lines = ['已写入 MVU（' + value.path + '）：' + (value.openings ? value.openings + ' 个开场的初值' : '开场初值未改') + '；规则' + words[value.rules] + '；面板' + words[value.panel],
          '变量：' + value.variables.join('、')]
        if (Array.isArray(value.visibility)) lines.push('隐藏属性：' + (value.visibility.length ? value.visibility.join('、') : '已清空'))
        const removed = value.removed
        if (removed.openings || removed.entries || removed.regex) lines.push('已清理旧协议：' + [removed.openings && removed.openings + ' 个开场', removed.entries && removed.entries + ' 条世界书', removed.regex && removed.regex + ' 条正则'].filter(Boolean).join('、'))
        if (value.validation) lines.push(validationText(value.validation))
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('MVU 写入只能在卡片工作台中使用')
      const requested = str(args.path).trim() || str(chat.cardPath)
      if (requested === '') throw new Error('空白工作台还没有正式人物卡')
      const cardPath = normalizeResourcePath(requested, 'card')
      const workspace = await readCardWorkspace(cardPath)
      if (workspace === undefined) throw new Error('人物卡资源不存在: ' + cardPath)
      const plan = planMvuApply(cardPreparation.raw(workspace), args)
      if (Object.keys(plan.fields).length || plan.rawOperations.length) {
        await turnOrchestrator.saveChanges({ sessionId, turn: activeTurnOf(exec), path: cardPath, fields: plan.fields, rawOperations: plan.rawOperations })
      }
      if (plan.worldbook.length) await worldBooks.update({ kind: 'card', cardPath }, { operations: plan.worldbook })
      return { path: cardPath, ...plan.summary, validation: await checkCard(chat, cardPath) }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_restore_card',
    description: '灾难恢复工具：仅当用户明确要求将当前正式人物卡从 originals 原版整体恢复、已获知会覆盖全部工作版修改，并再次明确确认后使用。普通编辑、撤销、不确定或空白工作台严禁调用。恢复前会自动备份当前工作版。',
    parameters: {
      confirmation: {
        type: 'string',
        required: true,
        enum: ['确认从原版恢复'],
        description: '只能在用户已经明确确认整体覆盖后填写固定文本“确认从原版恢复”；不得由 Agent 代替用户确认'
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
          originalPath: { type: 'string', required: true },
          backupPath: { type: 'string', required: true }
        }
      },
      render: function (_args, value) {
        return [{ type: 'text', text: '人物卡《' + value.name + '》已从原版恢复并立即生效。恢复前工作版已备份到 ' + value.backupPath }]
      }
    },
    async execute(args, exec) {
      if (str(args && args.confirmation) !== '确认从原版恢复') throw new Error('原版恢复缺少明确确认')
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const turn = activeTurnOf(exec)
      if (turn > 0) await turnOrchestrator.discard({ sessionId: sessionId, turn: turn })
      return await restoreCurrentCard(sessionId)
    }
  }))
}
