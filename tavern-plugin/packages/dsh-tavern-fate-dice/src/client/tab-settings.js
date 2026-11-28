/* ------------------------------------------------------------------ *
 * tab-settings.js —— 页签 2「检定设置」：检定参数
 * 每一项都即时生效并自动保存（无草稿、无保存按钮），? 就地展开详细说明。
 * ------------------------------------------------------------------ */

function SettingsTab(props) {
  const { view, actions } = props || {}
  const settings = (view && view.settings) || FD_DEFAULT_SETTINGS
  /* 单一事实源：控件值直接来自 view.settings；改动立刻写回并落盘 */
  const apply = patch => {
    if (!actions || typeof actions.persistSettings !== 'function') return
    return actions.persistSettings(patch)
  }

  return h(Fragment, null,
    h(FdSection, {
      title: '⚙️ 检定设置',
      note: '改动即时生效 · 自动保存',
      help: [
        '这一屏是全局检定设置：每改一项就立即生效并对全部对话生效，不需要再点保存。',
        '改动会同时写进酒馆的插件数据与本地缓存，重开面板、切换对话都保持你改后的值。',
        '每项标题右侧的 ? 可展开详细说明，收起后界面保持清爽单列布局。'
      ].join('\n')
    },
      h(FdField, {
        label: '触发灵敏度',
        help: [
          '决定「什么时候该自动发起一次检定」的门槛，越高越少打扰、越低越积极。',
          '积极：只要尝试本身有不确定性就可能触发，主动尝试、探查、交涉几乎都会进检定，检定密度最高，适合想用骰子驱动细节的硬核跑团。',
          '适中（默认）：有明确动作意图或冲突时才触发，日常寒暄与纯情绪对话不掷骰，节奏最平衡。',
          '谨慎：只有高风险关键节点（生死、暴露、重大抉择）才触发，正文更连贯、骰子更稀有，适合重叙事的沉浸式长文。'
        ].join('\n')
      },
      h(FdSelect, { value: settings.sensitivity, options: FD_SENSITIVITY_OPTIONS, onChange: value => apply({ sensitivity: value }) })),

      h(FdRow, {
        plain: true,
        title: '每轮必检定',
        sub: '默认关闭：AI 判为日常动作时不掷骰',
        help: [
          '开启后，只要你在聊天框发送行动，本轮就一定投一次真骰，不再受「触发概率」门槛限制——适合想看骰子驱动每一段剧情的玩法。',
          '拨动开关即刻生效并自动保存，无需点任何保存按钮；下次打开面板仍是开启状态。',
          '关闭（默认）时按「触发灵敏度」的门槛判定：模型认为这次行动没有真实不确定性（纯寒暄、内省、必定成功的日常动作）就跳过投骰，正文照常生成，只在输入框上方留一行「本轮无需检定」的浅提示。',
          '两种情况即使开启本开关也不会投骰：① 本轮被判定为场景切换过渡；② 叙事阻尼器判定为越权结果宣告且没有动作尝试。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(settings.alwaysRoll), label: '每轮必检定', onChange: next => apply({ alwaysRoll: next }) })),

      h(FdField, {
        label: '叙事基调修正',
        help: [
          '在所有检定目标值上加一个统一偏置，用来整体调故事的宽容度，不改角色能力加值。',
          '平衡（+0，默认）：按骰制原始概率走，成功与失败大致对半。',
          '英雄（+1 宽容）：目标值整体放宽，角色更容易成功、失败更像插曲，适合爽文、冒险与轻喜剧。',
          '严苛（-1 险境）：目标值整体收紧，同样的能力在险境里更容易翻车，适合恐怖、悬疑、末日生存这类需要压迫感的题材。'
        ].join('\n')
      },
      h(FdSelect, { value: settings.toneBias, options: FD_TONE_OPTIONS, onChange: value => apply({ toneBias: value }) })),

      h(FdField, {
        label: '掷骰动画与皮肤',
        help: [
          '骰子结果的呈现方式与媒介质感，纯表现层，不影响任何密码学真骰判定结果。',
          '6 款「典藏」跨媒介皮肤：默认「绅士赌桌」（胡桃木托盘与手工车削黄铜/骨瓷），并提供 16-Bit 黄金像素地牢、达芬奇羊皮纸铜版钢笔排线、京都镜面黑漆螺钿、包豪斯哑光白瓷信号橙与威尼斯折射海琉璃，各自配备独立光学/像素管线与材质声学。',
          '6 款「幻想」高能视效皮肤：星穹秘法、时停棱镜、焚天熔炉、赛博超频、水墨剑心与虚空星噬；所有 3D 皮肤共享单一离屏 GPU 管线，落定后自动 0% GPU 休眠省电。',
          '手动重投或自由投掷时，长按「✦ 逆命重投」「🔥 孤注一掷」或「🎲 投掷」按钮即可激活 3D 悬停蓄力，松手甩出（移出按钮可无损取消）。',
          '2D 极简闪现 / 关闭动画：不渲染 3D 舞台，仅展示紧凑结果，适合批量推剧情或低功耗设备。'
        ].join('\n')
      },
      h(FdSelect, { value: settings.animation, options: FD_ANIMATION_OPTIONS, onChange: value => apply({ animation: value }) })),

      h(FdField, {
        label: '结果揭晓时机',
        help: [
          '决定 3D 投骰剧场什么时候拉开帷幕。',
          '判定即播（默认）：点发送后决策模型一出结果立刻全宽甩骰，最爽快直观。',
          '随正文落定揭晓：发送后先保持悬念静默生成正文，等这一轮正文流式写完落定后再揭晓骰面，避免还没读剧情先被大成功/大失败剧透。开启「失败时暂停发送」并在本轮命中拦截时仍会照常发前弹出。'
        ].join('\n')
      },
      h(FdSelect, { value: settings.revealTiming || 'immediate', options: FD_REVEAL_TIMING_OPTIONS, onChange: value => apply({ revealTiming: value }) })),

      h(FdRow, {
        plain: true,
        title: '实力碾压免骰直通',
        sub: '默认开启：能力稳压常规难度时直接达成，杜绝满级翻车',
        help: [
          '开启后，当行动难度为「极易」或「容易」，且角色能力加值 + 环境修正即便掷出最低骰面也稳跨目标值时，系统会直接判为「⚡ 稳妥达成（免骰直通）」。',
          '可彻底避免高阶高手做寻常小事却骰出双 1 滑稽大失败的违和感；困难及以上或双骰对抗仍正常投骰。'
        ].join('\n')
      },
      h(FdSwitch, { on: settings.autoSuccessEnabled !== false, label: '实力碾压免骰直通', onChange: next => apply({ autoSuccessEnabled: next }) })),

      h(FdRow, {
        plain: true,
        title: '正面交锋双骰对抗',
        sub: '默认开启：战斗拼刀/追逃/迎战时双边同台对撞掷骰',
        help: [
          '开启后，识别到战斗挥砍、格挡、追击、决斗等正面交锋行动时，我方与对手各掷一组真骰在 3D 舞台左右迎面对撞，按净差值 z 裁定胜负：',
          'z > 0 我方占优压制；z = 0 势均力敌胶着僵持；z < 0 对手化解攻势并立即反击抢先手。'
        ].join('\n')
      },
      h(FdSwitch, { on: settings.contestEnabled !== false, label: '正面交锋双骰对抗', onChange: next => apply({ contestEnabled: next }) })),

      h(FdRow, {
        plain: true,
        title: '感知类动作自动暗骰',
        sub: '观察 / 察觉类行动默认盖罩',
        help: [
          '开启后，察觉、侦查、识破谎言、微表情洞察这类感知型检定会自动走「暗骰」：正文只写角色主观能感知到的表象（「你总觉得他的笑有点用力」），不写骰点与成败结论，避免玩家读到「侦查 4 失败」就直接判断屋里没人。',
          '想看真实点数时点楼层里的检定胶囊即可偷看，属于「事后复核」而非「实时剧透」。',
          '关闭后这些检定照常明骰，成功/失败结论与点数都会出现在正文。单条能力的明骰/暗骰由 AI 在生成角色能力画像时自动标注（带「暗骰」标记），无需手动逐个勾选。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(settings.autoHidden), label: '感知类动作自动暗骰', onChange: next => apply({ autoHidden: next }) })),

      h(FdRow, {
        plain: true,
        title: '叙事阻尼器双向联动',
        sub: '检定与阻尼配额互通，双向反馈',
        help: [
          '开启后本面板与酒馆「叙事阻尼器」的判定合并成单趟请求：一次调用同时拿到检定结果与阻尼器档位，省掉第二次往返的等待（关掉则各走各的）。',
          '读取方向（改难度）：阻尼器的铺陈分（leverage）折算成额外边缘加值；心理防线 ≥75 时社交/洞察难度 +1 档，亲密信任 ≥70 时社交/洞察难度 −1 档，张力高压 ≥75 时体能与对抗类 +1 档。这些档位会直接进入本次检定的修正。',
          '回写方向（改后续容量）：真骰出点后把结果回传给阻尼器，成功则放宽推进档位、增加 MVU 变量配额，失败则收紧档位、压低配额——让骰子结果真的改变后续能推进的剧情量。',
          '阻尼器未安装或未配置时，读取与回写都自动跳过，检定本身照常进行。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(settings.damperLinkage), label: '叙事阻尼器双向联动', onChange: next => apply({ damperLinkage: next }) })),

      h(FdRow, {
        plain: true,
        title: '无决策模型时使用本地关键词兜底',
        sub: '默认关闭：未配决策模型时不自动检定',
        help: [
          '默认关闭。关闭时，AI 自动检定必须先在酒馆「设置 › 叙事阻尼器」里配好决策模型与 API Key 才会执行——没有模型就安静地不掷骰，正文干净、也不会出现瞎判。',
          '开启后，在纯离线环境、或暂时不想消耗 API Key 时，改用内置的本地动词规则做粗略检定：从玩家输入里提取动作动词与技能名做关键词匹配，命中即按该技能加值掷骰；匹配不上或语义模糊时直接跳过，绝不硬编结果。',
          '本地兜底的判定明显不如决策模型精细（不懂上下文、不辨语气、容易把「假装要打」当成「打」），只适合试玩、离线演示或临时救急；一旦配好 API Key 建议关回默认。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(settings.allowHeuristicFallback), label: '无决策模型时使用本地关键词兜底', onChange: next => apply({ allowHeuristicFallback: next }) })),

      h(FdRow, {
        plain: true,
        title: '无决策模型时启用宿命序列真骰带',
        sub: '默认关闭：每轮预掷 6 组真骰随主正文按需顺位取用',
        help: [
          '未配置决策模型且未开本地关键词兜底时生效：每轮发送行动前用密码学真随机预掷 6 组（①~⑥）骰点注入上下文，由主模型仅在遇到不确定性或连续事件时按顺序取骰并在末尾静默回传标记。',
          '零小模型 API 消耗、且能在一个楼层内自然支撑连续多段检定；日常无阻力对话时主模型会自动跳过取骰。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(settings.tapeFallbackEnabled), label: '无决策模型时启用宿命序列真骰带', onChange: next => apply({ tapeFallbackEnabled: next }) }))),

    h(FdSection, {
      title: '🎲 单回合多判定',
      note: settings.multiCheckEnabled ? '已开启 · 支持一回合多次检定' : '默认关闭 · 每回合仅裁定 1 项主检定',
      help: [
        '默认关闭时，每回合只对最核心的 1 个行动投一次真骰，节奏最紧凑。',
        '开启后，当玩家一条输入里同时干了多件事（如“边稳住守卫边偷钥匙顺便听动静”），或剧情展开中突发次生危机时，系统可在一回合内完成最多 2~3 次独立真骰裁定。',
        '提供 3 种可随时切换的方式：发前条件拆解（最稳且防偷看）、Agent 实时真骰工具（支持写到一半突发判定）、主骰 + 备用宿命序列（零额外延迟且兼容所有模型）。',
        '多判定下每回合仍限重投 1 次，可自选重投其中任意失败项；叙事阻尼器联动按短板优先聚合档位，防止成功项洗白失败项。'
      ].join('\n')
    },
    h(FdRow, {
      plain: true,
      title: '开启单回合多判定',
      sub: settings.multiCheckEnabled
        ? `当前方式：${(FD_MULTI_CHECK_MODE_DETAILS[settings.multiCheckMode] || FD_MULTI_CHECK_MODE_DETAILS.decompose).title}`
        : '开启后可一回合裁定多个行动，并自由切换 3 种实现方式',
      help: [
        '开启后即可在下方选择多判定方式与单回合上限（2 次或 3 次）。',
        '关闭后立刻恢复为单回合单次主检定，不产生任何额外调用或工具开销。'
      ].join('\n')
    },
    h(FdSwitch, {
      on: Boolean(settings.multiCheckEnabled),
      label: '开启单回合多判定',
      onChange: next => apply({ multiCheckEnabled: next })
    })),

    settings.multiCheckEnabled
      ? h(Fragment, null,
        h(FdField, {
          label: '多判定方式',
          help: [
            '「发前条件拆解」作为共同底座已融入全部三种方式（先在发前拆解玩家输入里的多个独立动作），下方区别在于如何处理生成中突发的次生判定：',
            '1. 仅发前条件拆解：只做发前拆解，正文生成中不再追加新骰。防偷看、支持连招前置失败短路、完美兼容发前逆命与阻尼器。',
            '2. 发前拆解 + Agent 实时真骰工具：发前先拆解多动作，剩余配额开放 fate_dice_roll 工具给主模型在写到一半遇到突发陷阱/伏兵时现掷真骰。最贴近跑团 DM，需主模型支持工具调用。',
            '3. 发前拆解 + 备用宿命序列：发前先拆解多动作，剩余配额顺延编号（②/③）附带备用真骰列，遇到突发风险顺位取用并在文末静默回传。零额外延迟、兼容所有模型。'
          ].join('\n')
        },
        h(FdSelect, {
          value: settings.multiCheckMode || 'decompose',
          options: FD_MULTI_CHECK_MODE_OPTIONS,
          onChange: value => apply({ multiCheckMode: value })
        })),

        (() => {
          const activeKey = FD_MULTI_CHECK_MODE_DETAILS[settings.multiCheckMode] ? settings.multiCheckMode : 'decompose'
          const detail = FD_MULTI_CHECK_MODE_DETAILS[activeKey]
          return h('div', { className: 'fd-mode-card', role: 'note' },
            h('div', { className: 'fd-mode-card-head' },
              h('span', { className: 'fd-mode-badge' }, detail.badge),
              h('strong', { className: 'fd-mode-title' }, detail.title)),
            h('p', { className: 'fd-mode-line' }, detail.summary),
            h('p', { className: 'fd-mode-line' }, h('strong', null, '适用场景：'), detail.scene),
            h('p', { className: 'fd-mode-line' }, h('strong', null, '运作方式：'), detail.flow),
            h('p', { className: 'fd-mode-line' }, h('strong', null, '主要优势：'), detail.pros),
            h('p', { className: 'fd-mode-line is-note' }, h('strong', null, '注意点：'), detail.note),
            activeKey === 'agent-tool' && view && view.agentToolAvailable === false
              ? h('p', { className: 'fd-mode-warn' }, '⚠️ 当前宿主环境未检测到前台工具通道，切换后仍会保留主检定；若需发前多动作拆解建议改用「发前条件拆解」。')
              : null)
        })(),

        h(FdField, {
          label: '单回合判定上限',
          help: [
            '限制同一回合内最多允许的真骰判定总数（含主检定），避免一回合塞入过多骰子导致叙事碎片化或拖慢生成。',
            '最多 2 次：节奏更紧凑，适合轻度多动作或一次主动作 + 一次突发判定。',
            '最多 3 次（默认）：兼顾复杂连招与多线行动的经典上限。'
          ].join('\n')
        },
        h(FdSelect, {
          value: String(settings.multiCheckMax || 3),
          options: FD_MULTI_CHECK_MAX_OPTIONS,
          onChange: value => apply({ multiCheckMax: Number(value) || 3 })
        })),

        h(FdCollapse, {
          title: '📖 三种方案完整详解与横向对比',
          sub: '点击展开查看全部方案差异，随时按需切换'
        },
        ['decompose', 'agent-tool', 'hybrid-tape'].map(key => {
          const item = FD_MULTI_CHECK_MODE_DETAILS[key]
          const isCurrent = (settings.multiCheckMode || 'decompose') === key
          return h('div', {
            key,
            className: 'fd-mode-card is-compact' + (isCurrent ? ' is-current' : '')
          },
          h('div', { className: 'fd-mode-card-head' },
            h('span', { className: 'fd-mode-badge' }, isCurrent ? `${item.badge} · 当前` : item.badge),
            h('strong', { className: 'fd-mode-title' }, item.title)),
          h('p', { className: 'fd-mode-line' }, h('strong', null, '适用：'), item.scene),
          h('p', { className: 'fd-mode-line' }, h('strong', null, '机制：'), item.flow),
          h('p', { className: 'fd-mode-line' }, h('strong', null, '优势：'), item.pros),
          h('p', { className: 'fd-mode-line is-note' }, h('strong', null, '注意：'), item.note))
        })))
      : null),

    h(FdSection, {
      title: '✦ 失败时暂停发送',
      note: '默认关闭 · 开启后失败先问你要不要逆命',
      help: [
        '开启后，每一次自动检定只要掷出「失败」或「大失败」，正文请求会先被按住不发送：屏幕中央弹出「骰已落定 · 正文还没发送」小窗，让你当场决定 ✦ 消耗 1 点命运点逆命重投、🔥 零消耗孤注一掷，或者接受这次的坏运气照常推进。',
        '和楼层胶囊里的重投按钮不同：胶囊是正文写完之后再重投（要再点一次重新生成），这里是发送前就拦下来，所以重投结果会直接决定这一段正文怎么写，不会白写一段再推翻。',
        '暂停期间宿主请求处在等待状态，最多等 10~24 秒（见下方「暂停等待时长」）；倒计时结束会自动按原骰点发送，绝不会把正文卡死。',
        '暗骰（感知/洞察类）不参与暂停：提前拦截会剧透成败，所以仍按原有规则只在正文里给主观感受。每轮最多重投 1 次的硬限制不变，孤注一掷失败照样会恶化为大失败。'
      ].join('\n')
    },
    h(FdRow, {
      plain: true,
      title: '失败 / 大失败时暂停正文发送',
      sub: '发送前弹窗询问：✦ 逆命重投 / 🔥 孤注一掷 / 接受命运',
      help: [
        '开启后，检定结果一落定为失败或大失败，就把这一轮的正文请求按住，先弹窗问你怎么处理：掷骰面板里那颗失败骰已经看得见，但字还没开始写。',
        '选择「✦ 逆命重投」会立刻消耗 1 点命运点重新掷骰，新结果直接进入这一次正文生成；选择「🔥 孤注一掷」不耗命运点，但失败会强制恶化成大失败、翻盘成功也要背负挂彩代价；选择「接受命运」则按原骰点照常生成。',
        '适合不想让「一段失败的正文」先写出来再推翻的玩法；如果你更喜欢读完整段再决定，保持关闭即可，楼层胶囊里的重投按钮随时可用。'
      ].join('\n')
    },
    h(FdSwitch, { on: Boolean(settings.preSendPause), label: '失败 / 大失败时暂停正文发送', onChange: next => apply({ preSendPause: next }) })),

    settings.preSendPause
      ? h(FdField, {
        label: '暂停触发范围',
        help: [
          '「失败与大失败都暂停」：只要没打出成功或代价成功，就停下来问你一次，最容易接住坏运气。',
          '「仅大失败时暂停」：普通失败照常推进，只有骰子最狠的那种翻车才拦下来，正文节奏更连贯、打断更少。',
          '代价成功算成功，不会触发暂停。'
        ].join('\n')
      },
      h(FdSelect, { value: settings.preSendScope, options: FD_PRE_SEND_SCOPE_OPTIONS, onChange: value => apply({ preSendScope: value }) }))
      : null,

    settings.preSendPause
      ? h(FdField, {
        label: '暂停等待时长',
        help: [
          '弹窗最多等你多久，倒计时归零就按原骰点自动发送，不会让正文一直卡着。',
          '宿主给插件组装提示词的时间上限是 30 秒，所以这里最长只到 24 秒，剩下的时间留给「重投后重新判难 + 阻尼器同步」。',
          '拿不定主意时按默认 18 秒即可；手速党选 10 秒，边想剧情边决定选 24 秒。'
        ].join('\n')
      },
      h(FdSelect, {
        value: String(settings.preSendWait || 18),
        options: FD_PRE_SEND_WAIT_OPTIONS,
        onChange: value => apply({ preSendWait: Number(value) || 18 })
      }))
      : null),

    h('div', { className: 'fd-hint' }, '以上改动即时生效并自动保存，无需手动提交；面板重新打开或切换对话都会保留。'))
}
