/* ------------------------------------------------------------------ *
 * tab-checks.js —— 页签 1「检定与能力」（默认页）
 * 设计原则：玩家零手填。骰制只选风格，能力加减值全部由决策模型
 * 依据【角色卡/人设 + 世界书 + MVU 变量 + 近期正文】实时评定。
 * ------------------------------------------------------------------ */

const FD_PROFILE_SOURCE_TONE = {
  '角色卡': 'ok',
  '世界书': 'ok',
  'MVU': 'warn',
  '正文': 'off'
}

function fdProfileBonusText(bonus) {
  const value = fdNumber(bonus, 0)
  if (value > 0) return '+' + value
  if (value < 0) return String(value)
  return '±0'
}

function fdProfileToneOf(trait) {
  const tone = trait && trait.tone
  if (tone === 'good' || tone === 'bad' || tone === 'neutral') return tone
  const bonus = fdNumber(trait && trait.bonus, 0)
  if (bonus > 0) return 'good'
  if (bonus < 0) return 'bad'
  return 'neutral'
}

function ProfileTraitCard(props) {
  const { trait } = props || {}
  if (!trait) return null
  const tone = fdProfileToneOf(trait)
  const sourceTone = FD_PROFILE_SOURCE_TONE[trait.source] || 'off'
  return h('div', { className: 'fd-profile-trait is-' + tone },
    h('div', { className: 'fd-profile-trait-head' },
      h('span', { className: 'fd-profile-trait-label' }, trait.label),
      h('span', { className: 'fd-profile-trait-bonus is-' + tone }, fdProfileBonusText(trait.bonus))),
    h('div', { className: 'fd-profile-trait-meta' },
      h(FdBadge, { tone: sourceTone, title: '该条能力的判定来源' }, trait.source || '正文'),
      trait.hidden ? h(FdBadge, { tone: 'off', title: '暗骰：不向玩家展示具体骰面' }, '暗骰') : null),
    trait.reason ? h('span', { className: 'fd-profile-trait-reason' }, trait.reason) : null
  )
}

function ContextSourceCell(props) {
  const { title, on, value, sub, children } = props || {}
  return h('div', { className: 'fd-ctx-cell ' + (on ? 'is-on' : 'is-off') },
    h('span', { className: 'fd-ctx-title' }, title),
    h('span', { className: 'fd-ctx-value' }, value),
    sub ? h('span', { className: 'fd-ctx-sub' }, sub) : null,
    children || null
  )
}

function ChecksTab(props) {
  const { ui, gameId, hasGame, view, actions, notify, checking, onRecheck, onOpenSettings } = props || {}
  const judge = view.judgeStatus || { available: false }
  const damper = view.damper || { available: false, linkage: false }
  const fate = fdNormalizeFate(view.fate)
  const settings = view.settings || FD_DEFAULT_SETTINGS
  const rule = view.rule || '2d6'
  const meta = fdRuleMeta(rule)
  const profile = view.characterProfile || fdEmptyCharacterProfile()
  const context = view.contextSources || fdEmptyContextSources()
  const traits = Array.isArray(profile.traits) ? profile.traits : []
  const highlights = Array.isArray(profile.mvuHighlights) ? profile.mvuHighlights : []
  const stats = view.stats || { total: 0, good: 0, bad: 0 }
  const recent = (view.recent || []).slice(0, 8)
  const [refreshing, setRefreshing] = useState(false)
  const [noteDraft, setNoteDraft] = useState(profile.customNote || '')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setNoteDraft(profile.customNote || '')
  }, [profile.customNote])

  const switchRule = nextRule => {
    if (actions && typeof actions.setRule === 'function') actions.setRule(nextRule)
    fdSaveProfileNote(ui, gameId, { rule: nextRule, customNote: noteDraft }).then(res => {
      if (res && res.ok && res.data && res.data.characterProfile && actions && typeof actions.setProfile === 'function') {
        actions.setProfile(fdNormalizeCharacterProfile(res.data.characterProfile), null)
      }
    })
  }

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    fdRefreshProfile(ui, gameId)
      .then(res => {
        if (res && res.ok && res.characterProfile) {
          if (actions && typeof actions.setProfile === 'function') {
            actions.setProfile(res.characterProfile, res.contextSources)
          }
          if (notify) notify('✨ 已根据角色卡 / 世界书 / MVU / 正文更新角色能力画像')
        } else if (notify) {
          notify((res && res.error) || '宿主暂未返回画像：进入对话完成一轮回复后会自动建立')
        }
      })
      .catch(() => { if (notify) notify('提取失败：请确认决策模型已配置') })
      .finally(() => setRefreshing(false))
  }

  const saveNote = () => {
    if (savingNote) return
    setSavingNote(true)
    fdSaveProfileNote(ui, gameId, { customNote: noteDraft })
      .then(res => {
        if (actions && typeof actions.setProfile === 'function') {
          actions.setProfile({ ...profile, customNote: noteDraft }, null)
        }
        if (notify) notify(fdToastResult(res, '备注已保存，下次检定会一并参考'))
      })
      .catch(() => { if (notify) notify('备注已保存在本地') })
      .finally(() => setSavingNote(false))
  }

  const hasProfile = Boolean(traits.length)
  const nameText = profile.characterName || context.cardName || context.playerName || '主角'

  return h(Fragment, null,
    !settings.enabled
      ? h('div', { className: 'fd-guide-banner', role: 'note' },
        h('div', { className: 'fd-guide-banner-head' },
          h('span', { className: 'fd-guide-banner-title' }, '命运之骰当前已关闭'),
          h('div', { className: 'fd-btn-row', style: { marginLeft: 'auto' } },
            h(FdBtn, {
              small: true,
              primary: true,
              onClick: () => {
                if (actions && typeof actions.persistSettings === 'function') {
                  actions.persistSettings({ enabled: true })
                  if (notify) notify('已开启命运之骰')
                }
              }
            }, '立即开启'),
            typeof onOpenSettings === 'function'
              ? h(FdChip, { onClick: onOpenSettings }, '检定设置')
              : null)),
        h('div', { className: 'fd-guide-banner-meta' }, '默认关闭，不会在对话中自动触发检定或注入提示词；已有记录与能力画像会保留。'))
      : null,
    /* ---------------- 0. 状态徽章行 + 未配模型引导 ---------------- */
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: judge.available ? 'ok' : (settings.allowHeuristicFallback ? 'off' : 'warn') },
        judge.available
          ? `⚡ 决策模型：${judge.provider || '已就绪'}`
          : (settings.allowHeuristicFallback ? '🧭 本地关键词兜底' : '⚠️ 待配置阻尼决策模型')),
      h(FdBadge, { tone: damper.available ? (damper.linkage ? 'ok' : 'warn') : 'off' },
        damper.available
          ? (damper.linkage ? '⛓ 叙事阻尼器双向联动' : '⛓ 阻尼器可用 · 未联动')
          : '⛓ 未检测到叙事阻尼器'),
      view.source === 'local' ? h(FdBadge, { tone: 'off' }, '🖥 本地配置模式') : null),
    h(DecisionModelGuideBanner, { view, onRecheck, checking }),

    /* ---------------- 0.5 命运点与逆命重投醒目卡片 ---------------- */
    h(FdSection, {
      title: '✦ 命运点与逆命重投',
      note: fate.points > 0 ? `当前可用 ${fate.points}/${fate.max} 点` : '命运点已耗尽 · 仅可孤注一掷',
      help: [
        '为什么需要命运点？如果点击酒馆「重新生成」就能无限重掷骰子，真骰检定就会退化成刷到满意为止的假随机。因此本插件默认锁死同楼层骰点（未改写行动直接点「重新生成正文」将 100% 复用首次真骰结果）。',
        '什么时候允许重投？必须同时满足 4 条铁律：① 仅限当前最新一轮楼层（历史楼层已锁定）；② 仅限非暗骰（感知/洞察类暗骰严禁看底牌悔棋）；③ 首次检定未达成成功（仅「代价成功 / 失败 / 大失败」可重投，已成功不可刷大成功）；④ 每个楼层最多重投 1 次。',
        '方式一【✦ 逆命重投（耗 1 点命运点）】：每局开局自带 2 点命运点（上限 3 点）。消耗 1 点即可无任何额外惩罚重掷一次真骰，适合关键剧情稳妥改命。',
        '方式二【🔥 孤注一掷（耗 0 点，高危搏命）】：当命运点用光，或你想省下命运点留给决战时，仍可强行搏命重投 1 次——但代价极重：① 若重投仍失败，普通失败将【强制恶化升级为大失败】并收紧叙事阻尼器配额；② 就算重投逆转成功，最高封顶为普通【成功】（不出无伤大成功），且系统会向正文强制注入挂彩负伤、体力/魔力透支或暴露行踪的实质代价！',
        '命运点怎么恢复（厄运回充）？只有当你【不重投、坦然接受坏结果落盘结算】时才会回充：接受 1 次「大失败」立刻恢复 +1 点；或累计接受 2 次普通「失败」自动恢复 +1 点（最多存满 3 点）。',
        '操作步骤：在本卡片下方或聊天楼层顶栏点开检定胶囊 → 点击「✦ 逆命重投」或「🔥 孤注一掷」掷出新点数 → 再点击聊天框下方的「重新生成正文」，AI 就会按新骰点重写本轮剧情。'
      ].join('\n')
    },
      /* 顶部大号星芒点数槽 + 厄运蓄力进度 */
      h('div', { className: 'fd-fate-hero' + (fate.points <= 0 ? ' is-empty' : '') },
        h('div', { className: 'fd-fate-main' },
          h('span', { className: 'fd-fate-eyebrow' }, '当前可用命运点（每局初始 2 点 · 上限 3 点）'),
          h('div', { className: 'fd-fate-meter-row' },
            h('div', { className: 'fd-fate-orbs', 'aria-label': `命运点 ${fate.points}/${fate.max}` },
              Array.from({ length: fate.max }).map((_, idx) => h('span', {
                key: idx,
                className: 'fd-fate-orb' + (idx < fate.points ? ' is-lit' : ''),
                'aria-hidden': 'true'
              }, idx < fate.points ? '✦' : '✧'))),
            h('span', { className: 'fd-fate-num' }, `${fate.points} / ${fate.max}`)),
          h('span', { className: 'fd-fate-status' },
            fate.points > 0
              ? `✨ 可用 ${fate.points} 次无惩罚逆命重投 · 请在下方「当前最新回合操作」点击按钮触发`
              : '🔥 命运点已耗尽：本轮若需重投，请在下方点击高风险「孤注一掷」')),
        h('div', { className: 'fd-fate-charge' },
          h('div', { className: 'fd-fate-charge-head' },
            h('span', null, '厄运回充进度'),
            h('span', null, fate.points >= fate.max ? '已满额 (3/3)' : `受挫累计 ${Math.min(2, fate.failCount)} / 2`)),
          h('div', { className: 'fd-fate-pips', 'aria-hidden': 'true' },
            [0, 1].map(idx => h('span', {
              key: idx,
              className: 'fd-fate-pip' + (idx < fate.failCount ? ' is-lit' : '')
            }))),
          h('span', { className: 'fd-hint' }, '不重投认栽：1 次大失败 或 累计 2 次失败 → 自动 +1 ✦'))),

      /* 当前最新一轮检定胶囊与高对比实心重投按钮（紧贴命运点槽下方，操作区置顶） */
      hasGame && (fdNumber(view.lastTurn, 0) > 0 || (recent[0] && recent[0].turn > 0))
        ? h('div', { className: 'fd-fate-latest-box' },
          h('div', { className: 'fd-fate-latest-head' },
            h('span', { className: 'fd-fate-latest-title' },
              `🎯 当前最新回合操作（第 ${Math.max(fdNumber(view.lastTurn, 0), fdNumber(recent[0] && recent[0].turn, 0))} 轮）`)),
          h(TurnRollCapsule, {
            ui,
            gameId,
            turn: Math.max(fdNumber(view.lastTurn, 0), fdNumber(recent[0] && recent[0].turn, 0)),
            defaultOpen: true,
            emptyFallback: h('div', { className: 'fd-hint' }, '当前最新回合为免检定（或无待重投骰点）；发出下一条触发检定的行动后，可在此或楼层顶栏直接点击按钮重投。')
          }))
        : h('div', { className: 'fd-fate-latest-box' },
          h('span', { className: 'fd-fate-latest-title' }, '🎯 当前最新回合操作'),
          h('div', { className: 'fd-hint' }, hasGame
            ? '发送一条行动消息触发检定后，若未达成功，将在此出现「✦ 逆命重投 / 🔥 孤注一掷」操作按钮。'
            : '进入对话后将在此展示最新回合检定结果与重投操作按钮。')),

      /* 静态规则附注：纯文本左竖线引注，彻底去除易误认为按钮的三宫格卡片外观 */
      h('div', { className: 'fd-fate-footnote', role: 'note' },
        h('span', { className: 'fd-fate-footnote-title' }, '📖 锁骰与重投规则说明'),
        h('p', { className: 'fd-fate-footnote-item' }, '• 锁骰防刷：未改行动直接点「重新生成正文」必锁原骰；仅【最新楼层 · 非暗骰 · 首次未成功】开放 1 次重投，认栽吃瘪才能攒回命运点。'),
        h('p', { className: 'fd-fate-footnote-item' }, '• 两种改命：耗 1 点命运点可无惩罚「逆命重投」；0 点「孤注一掷」若败强制恶化为大失败，就算翻盘也封顶普通成功且正文必写挂彩代价。'))),

    /* ---------------- 1. 自动行动检定 ---------------- */
    h(FdSection, {
      title: '⚡ 自动行动检定',
      note: '发送前定难并投掷真骰',
      help: [
        '你在主聊天框照常发送一行行动描述后，插件会在生成正文前把它交给叙事阻尼器的决策模型评估本次行动的不确定性。',
        '模型会结合【角色卡/玩家人设 + 启用世界书 + 当前 MVU 变量 + 近期正文】实时评定主角在该行动上的能力加减值（−2 ~ +3），并按处境裁定 5 档难度（极难 / 困难 / 普通 / 容易 / 极易）——无需任何手填技能表。',
        '随后由密码学真随机数投骰，把骰面、总计、档位结论注入本轮上下文，再交还给宿主继续生成正文——整个过程不额外消耗一次主模型对话轮次。',
        '防刷与重投规则：同一楼层未改写行动时，点「重新生成」强制复用首次真骰结果。仅最新楼层、非暗骰、且首次未成功时允许重投 1 次——可花 1 点「✦ 命运点」稳妥逆命重投（坦然接受 1 次大失败或累计 2 次失败不重投自动回充 +1 点），或选「🔥 孤注一掷」（重投成功必带挂彩/透支代价，若仍失败则直接恶化为大失败）。',
        '关闭本开关后不再自动检定：正文照常生成，只是没有骰子与难度裁定。'
      ].join('\n')
    },
      h(FdRow, {
        plain: true,
        title: '自动行动检定',
        sub: '发送行动前毫秒定难并投掷密码学真骰，不额外占用对话轮次'
      },
      h(FdSwitch, {
        on: Boolean(view.autoCheck),
        label: '自动行动检定',
        onChange: next => (actions && actions.setAutoCheck ? actions.setAutoCheck(next) : undefined)
      }),
      h('div', { className: 'fd-hint' },
        settings.alwaysRoll
          ? '已开启「每轮必检定」：每次发送行动都会投骰'
          : '想每轮都看到骰子？到「检定设置 › 每轮必检定」打开开关'))),

    /* ---------------- 2. 检定骰制 ---------------- */
    h(FdSection, {
      title: '🎲 检定骰制',
      note: meta.hint,
      help: [
        '这里只决定「骰点如何换算成结果档位」，不涉及任何能力数值——所有加减值都由 AI 自动评定，你不需要手填任何表格。',
        '2d6 叙事渐进（默认）：两枚六面相加再加 AI 评定的加减值。合计 ≥10 成功、7~9 代价成功、≤6 失败；双 6 或合计 ≥12 大成功，双 1 大失败。曲线居中、失败温和，适合长线文字 RP。',
        'd10 轻量阶梯：单骰 1~10，档位少、节奏快，适合轻量日常与快节奏互动。',
        'd20 经典跑团：单骰 1~20，天然 20 必大成功、天然 1 必大失败，与桌面 DC 判定思维一致，适合规则化跑团与战斗。',
        'd100 百分阈值：百分制阈值判定，出点 ≤ 目标即成功，适合硬核拟真与技能树。',
        '切换骰制时，AI 评定的能力档位（−2 ~ +3）会自动按比例折算成对应骰制的检定加减值（例如 d20 的 +4 量级、d100 的 +10 量级），完全无需手改任何数值。'
      ].join('\n')
    },
      h('div', { className: 'fd-chip-group' },
        FD_RULES.map(item => h(FdChip, {
          key: item.id,
          active: rule === item.id,
          onClick: () => switchRule(item.id)
        }, item.label))),
      h('div', { className: 'fd-hint' }, '切换即同步宿主与后台画像，下方能力加值由 AI 自动重算')),

    /* ---------------- 3. AI 动态角色能力画像 ---------------- */
    h(FdSection, {
      title: '🤖 AI 动态角色能力画像',
      note: hasProfile ? `已识别 ${traits.length} 条能力` : '尚未建档',
      help: [
        '本页没有任何需要你填写的数字表格：主角在每项行动上的能力加减值，全部由决策模型在「发送前检定」时实时评定。',
        '评定依据是四类上下文：① 角色卡 / 玩家人设；② 当前启用的世界书条目；③ MVU 实时变量（属性、状态、装备等）；④ 近期正文记忆。模型据此判断这次行动属于主角的强项、普通还是短板，并给出 −2 ~ +3 的能力档位。',
        '下方画像由后台在每轮结算时自动演进：受伤、突破、装备更替、关系变化都会让特长与短板随之增减，无需手动维护。',
        '「✨ 从本局设定与正文重新提取」会立刻让 AI 重新通读一遍上下文并重建画像，适合刚导入角色卡、刚改过世界书、或剧情发生重大转折后手动刷新一次。',
        '画像只是给 AI 的参考快照，即使尚未建档，每轮发前检定依然会实时读取人设与 MVU 自动定加值——所以这里空着也完全不影响游玩。'
      ].join('\n')
    },
      h('div', { className: 'fd-profile-bar' },
        h(FdBtn, {
          small: true,
          primary: true,
          disabled: !hasGame || refreshing,
          onClick: refresh
        }, refreshing ? '提取中…' : '✨ 从本局设定与正文重新提取'),
        hasProfile && profile.updatedTurn
          ? h(FdBadge, { tone: 'off' }, `更新于第 ${profile.updatedTurn} 轮`)
          : null,
        !hasGame ? h('span', { className: 'fd-hint' }, '进入对话后可用') : null),

      /* 四源上下文接入小卡片 */
      h('div', { className: 'fd-ctx-grid' },
        h(ContextSourceCell, {
          title: '角色卡 / 人设',
          on: Boolean(context.hasCard),
          value: context.hasCard ? (context.cardName || '已接入角色卡') : '待进局',
          sub: context.playerName ? `玩家：${context.playerName}` : '未检测到玩家名'
        }),
        h(ContextSourceCell, {
          title: '激活世界书',
          on: fdNumber(context.loreCount, 0) > 0,
          value: fdNumber(context.loreCount, 0) > 0 ? `${context.loreCount} 条规则` : '暂无启用条目',
          sub: '关键词命中后注入判定'
        }),
        h(ContextSourceCell, {
          title: 'MVU 实时变量',
          on: fdNumber(context.mvuKeyCount, 0) > 0,
          value: fdNumber(context.mvuKeyCount, 0) > 0 ? `自动识别 ${context.mvuKeyCount} 项指标` : '暂无变量',
          sub: '受伤/突破/装备变化会实时反映'
        },
          highlights.length
            ? h('div', { className: 'fd-mvu-preview' },
              highlights.slice(0, 4).map((item, idx) => h('span', {
                key: (item && item.key) || idx,
                className: 'fd-mvu-pill'
              }, `${(item && item.key) || ''}${item && item.value !== '' ? '：' + item.value : ''}`)))
            : null),
        h(ContextSourceCell, {
          title: '近期正文',
          on: fdNumber(context.historyTurns, 0) > 0,
          value: fdNumber(context.historyTurns, 0) > 0 ? `最近 ${context.historyTurns} 轮` : '暂无正文',
          sub: context.backgroundModelReady ? '后台结算模型已就绪' : '后台结算模型待配置'
        })),

      /* 特长 / 短板卡片网格 */
      hasProfile
        ? h(Fragment, null,
          h('div', { className: 'fd-profile-head' },
            h('span', { className: 'fd-profile-name' }, nameText),
            profile.archetype ? h('span', { className: 'fd-profile-arch' }, profile.archetype) : null),
          h('div', { className: 'fd-profile-grid' },
            traits.map(item => h(ProfileTraitCard, { key: item.id || item.label, trait: item }))))
        : h('div', { className: 'fd-hint' },
          '进入对话完成首轮回复后后台将自动建立角色能力画像；即使尚未建档，每轮发前检定仍会实时读取人设与 MVU 自动定加值。'),

      /* 可选单行补充备注：默认折叠 */
      h(FdCollapse, {
        title: '补充角色背景备注（可选，默认无需填写）',
        sub: '仅补卡面未写明的设定',
        right: h(FdHelp, {
          title: '补充角色背景备注',
          text: [
            '这一栏完全可选：只有当角色卡与世界书里没写、但你又希望 AI 在判定时参考的设定，才需要填一句。',
            '例如「主角左眼失明但听觉极敏锐」「右手旧伤，长时间挥剑会脱力」——这类细节写进备注后，AI 在评定相关行动的能力加减值时会一并参考。',
            '备注只保存一句话，不涉及任何数字表格；留空即表示完全依赖角色卡 / 世界书 / MVU / 正文自动推演。',
            '点「保存备注」后会同步宿主（宿主未实现该接口时保存在本地浏览器），下次检定立即生效。'
          ].join('\n')
        })
      },
      h('div', { className: 'fd-field' },
        h(FdText, {
          value: noteDraft,
          placeholder: '例如：主角左眼失明但听觉极敏锐',
          maxLength: 120,
          onChange: setNoteDraft
        })),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { small: true, primary: true, disabled: savingNote, onClick: saveNote }, savingNote ? '保存中…' : '保存备注'),
        h(FdBtn, { small: true, onClick: () => setNoteDraft('') }, '清空')))),

    /* ---------------- 4. 本局检定统计与最近记录 ---------------- */
    h(FdSection, {
      title: '📊 本局检定统计与最近记录',
      note: hasGame ? '最近 8 轮' : '需要进入对话',
      help: [
        '统计口径：累计检定 = 本局自动检定与自由骰投掷的总次数；大成功+成功 = 档位 critical 与 success 之和；代价+失手 = costly、failure 与 fumble 之和。',
        '最近记录保留最近 8 轮，每行显示轮次、所用技能、是否经过叙事阻尼器联动，以及总计骰值与档位标签；暗骰只显示「暗骰」标签不暴露骰面。',
        '数据按本局 gameId 分别统计，切换对话不会串局。'
      ].join('\n')
    },
      h('div', { className: 'fd-stat-grid' },
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.total || 0)),
          h('span', { className: 'fd-stat-lbl' }, '累计检定')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.good || 0)),
          h('span', { className: 'fd-stat-lbl' }, '大成功/成功')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.bad || 0)),
          h('span', { className: 'fd-stat-lbl' }, '代价/失手'))),
      recent.length
        ? h('div', { className: 'fd-list' },
          recent.map(item => h('div', { key: `${item.turn}-${item.rolledAt}`, className: 'fd-list-item' },
            h('span', null, `第 ${item.turn} 轮 · ${item.check}`),
            h('span', { className: 'fd-btn-row' },
              item.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null,
              h('span', { className: 'fd-hint' }, item.hidden ? '暗骰' : `${item.total} ${item.tierLabel}`)))))
        : h('div', { className: 'fd-hint' }, '本局尚无检定记录，发送一轮行动后开始记录')),

    /* ---------------- 5. 自由骰 / 局势奇遇骰（默认折叠） ---------------- */
    h(FreeRollCard, {
      ui,
      gameId,
      notify,
      animation: settings.animation,
      pendingEncounter: view.pendingEncounter || null,
      onEncounterChange: enc => (actions && actions.setPendingEncounter ? actions.setPendingEncounter(enc) : undefined)
    }))
}
