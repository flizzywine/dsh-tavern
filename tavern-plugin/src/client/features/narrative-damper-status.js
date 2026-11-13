// 游玩楼层「叙事阻尼器」生效状态胶囊、可展开裁定详情面板与 MVU 变量回执钳制摘要。

const TAVERN_DAMPER_TIERS = Object.freeze({
	scene_shift: Object.freeze({
		tone: 'scene',
		short: '场景放行',
		title: '显式场景转换放行',
		showScore: false,
		desc: '识别到场景转换标记，放行镜头与时空切换，同时保留既有记忆与关系防线锚点。'
	}),
	strip_delusion: Object.freeze({
		tone: 'strip',
		short: '越权剥离',
		title: '越权剥离',
		showScore: false,
		desc: '检测到越权指定 NPC 反应、凭空捏造设定或使用场外天眼，已剥离自封结果，仅保留受控角色单方面言行并触发客观反制。'
	}),
	resist_pushback: Object.freeze({
		tone: 'resist',
		short: '防线受阻',
		title: '防线受阻',
		showScore: true,
		desc: '行动尺度超出当前关系与心理防线阈值且筹码铺垫不足，角色依人设表现错愕、回绝或收紧防备。'
	}),
	costly_advance: Object.freeze({
		tone: 'costly',
		short: '带代价推进',
		title: '带代价推进',
		showScore: true,
		desc: '冒险试探勉强奏效，但伴随相应代价（引发警惕怀疑、消耗把柄筹码或留下疏离隐患）。'
	}),
	conflicted_half_step: Object.freeze({
		tone: 'half',
		short: '半步拉扯',
		title: '有效筹码 · 半步拉扯',
		showScore: true,
		desc: '筹码或铺垫有效，允许实质推进半步，但受心理防线或羞耻约束，角色保留嘴硬、抗拒或身心拉扯感。'
	}),
	full_accept: Object.freeze({
		tone: 'accept',
		short: '顺势成立',
		title: '顺势成立',
		showScore: true,
		desc: '行动尺度与当前关系、气氛及状态指标匹配，顺畅达成预期互动。'
	}),
	legacy_plain: Object.freeze({
		tone: 'accept',
		short: '状态已记录',
		title: '四维惯性状态已记录',
		showScore: false,
		desc: '本轮已维护通用四维惯性锚点。'
	})
})

// 写作模式（作者=全知）没有「受控角色」概念，同一批档位改用写作侧语义。
const TAVERN_DAMPER_AUTHOR_TIERS = Object.freeze({
	scene_shift: TAVERN_DAMPER_TIERS.scene_shift,
	strip_delusion: Object.freeze({
		tone: 'strip',
		short: '设定冲突',
		title: '设定冲突',
		showScore: false,
		desc: '新增内容与既有正史直接矛盾（吃书），未追认为既成事实；可改写为伏笔、传闻、误记，或显式改写既有段落并交代改动。'
	}),
	resist_pushback: Object.freeze({
		tone: 'resist',
		short: '节奏失配',
		title: '节奏失配',
		showScore: true,
		desc: '推进跨度超出当前情境承载，需要补写过渡与动机，而不是直接跳到结果。'
	}),
	costly_advance: Object.freeze({
		tone: 'costly',
		short: '带代价推进',
		title: '带代价推进',
		showScore: true,
		desc: '推进成立，但须在正文里落下合理后效（时间、资源、关系裂痕、暴露风险或欠下的承诺）。'
	}),
	conflicted_half_step: Object.freeze({
		tone: 'half',
		short: '有效推进',
		title: '铺垫成立 · 有效推进',
		showScore: true,
		desc: '铺垫成立，允许实质推进；转折须保留可追溯的动机与过程。'
	}),
	full_accept: Object.freeze({
		tone: 'accept',
		short: '顺势成立',
		title: '顺势成立',
		showScore: true,
		desc: '与既有设定和当前状态自洽，按既定节奏自然延展。'
	}),
	legacy_plain: TAVERN_DAMPER_TIERS.legacy_plain
})

const TAVERN_DAMPER_BYPASS_COPY = Object.freeze({
	DAMPER_NO_KEY: Object.freeze({
		short: '未配密钥',
		title: '未生效 · 尚未配置 API Key',
		hint: '请前往「设置 › 叙事阻尼器」填写决策模型 API Key 并点击测试连接。本轮已自动静默放行，未阻塞正文生成。'
	}),
	DAMPER_AUTH_ERROR: Object.freeze({
		short: '密钥无效',
		title: '未生效 · 密钥鉴权失败',
		hint: '当前配置的决策模型 API Key 无效或无权访问目标模型，请在「设置 › 叙事阻尼器」更换后测试连接。本轮已静默放行。'
	}),
	DAMPER_TIMEOUT: Object.freeze({
		short: '超时放行',
		title: '未生效 · 决策请求超时',
		hint: '决策模型在超时上限内未返回结果，已自动静默放行以保证正文生成流畅。若网络较慢可在设置中调高超时上限。'
	}),
	DAMPER_RATE_LIMIT: Object.freeze({
		short: '限流放行',
		title: '未生效 · 触发速率限制',
		hint: '决策模型接口返回 429 速率限制，本轮已自动静默放行。'
	}),
	DAMPER_SAFETY_BLOCKED: Object.freeze({
		short: '拦截放行',
		title: '未生效 · 送审内容被远端拦截',
		hint: '三级送审降级（全量脱敏 → 骨架 → 结构摘要）均被远端决策接口输入过滤拒绝，本轮已自动静默放行，主写作模型提示词不受影响。若长期出现可改用兼容端点或在「设置 › 叙事阻尼器」关闭 R18 送审脱敏后自查。'
	}),
	DAMPER_INACTIVE: Object.freeze({
		short: '地址未配',
		title: '未生效 · 接口地址无效',
		hint: '自定义决策接口地址未配置或格式无效，本轮已静默放行。'
	})
})

const TAVERN_DAMPER_PLAIN_AXES = Object.freeze([
	Object.freeze({ key: 'intimacy_trust', label: '亲密信任' }),
	Object.freeze({ key: 'psychological_guard', label: '心理防线', inverse: true }),
	Object.freeze({ key: 'arousal_or_tension', label: '情绪张力' }),
	Object.freeze({ key: 'leverage_depth', label: '筹码深度' })
])

function tavernDamperBudgetLabel(deltaBudget, mode) {
	const strict = mode === 'strict'
	if (deltaBudget === 'backfire') return '反弹收紧（正向禁涨）'
	if (deltaBudget === 'frozen') return '防线冻结（±1）'
	if (deltaBudget === 'breakthrough') return '阶段突破（±' + (strict ? '8' : '12') + '）'
	return '渐进微调（±' + (strict ? '3' : '5') + '）'
}

function tavernDamperSignedNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num === 0) return '0'
	return (num > 0 ? '+' : '−') + String(Math.abs(num))
}

function tavernDamperPathLabel(rawPath) {
	const segments = String(rawPath || '').split('/').slice(1).map(function (seg) {
		return seg.replace(/~1/g, '/').replace(/~0/g, '~')
	}).filter(Boolean)
	if (segments[0] === 'stat_data') segments.shift()
	if (!segments.length) return '状态变量'
	if (segments.length <= 3) return segments.join(' › ')
	return [segments[0], '…', segments[segments.length - 2], segments[segments.length - 1]].join(' › ')
}

function tavernDamperOutcomeForMessage(message) {
	if (!message || typeof message !== 'object' || message.greeting === true) return null
	const swipeId = Math.max(0, Number(message.swipeId) || 0)
	const raw = Array.isArray(message.narrativeDamper)
		? (message.narrativeDamper[swipeId] || message.narrativeDamper[0] || null)
		: (message.narrativeDamper && typeof message.narrativeDamper === 'object' ? message.narrativeDamper : null)
	if (raw && typeof raw === 'object') return raw
	const legacyPlain = Array.isArray(message.damperState)
		? (message.damperState[swipeId] || message.damperState[0] || null)
		: (message.damperState && typeof message.damperState === 'object' ? message.damperState : null)
	if (legacyPlain && typeof legacyPlain === 'object') {
		return {
			status: 'applied',
			source: 'legacy-plain',
			rulingTier: 'legacy_plain',
			plainState: { after: legacyPlain }
		}
	}
	const receiptDamper = message.mvu && message.mvu.receipt && message.mvu.receipt.damper
	if (receiptDamper && typeof receiptDamper === 'object') {
		return {
			status: 'applied',
			source: 'receipt',
			mode: receiptDamper.mode || 'balanced',
			rulingTier: receiptDamper.rulingTier || 'full_accept',
			deltaBudget: receiptDamper.deltaBudget || 'micro_step',
			leverageScore: Number(receiptDamper.leverageScore) || 1,
			explicitSceneShift: receiptDamper.explicitSceneShift === true,
			clampMvuDelta: receiptDamper.clampEnabled !== false
		}
	}
	return null
}

const TAVERN_DAMPER_PROJECTION_LABELS = Object.freeze({
	skeleton: '送审降级 · 骨架',
	digest: '送审降级 · 结构摘要'
})

function tavernDamperProjectionTag(outcome) {
	if (!outcome || outcome.status === 'bypassed') return ''
	const tier = String(outcome.judgeTier || '')
	if (TAVERN_DAMPER_PROJECTION_LABELS[tier]) return TAVERN_DAMPER_PROJECTION_LABELS[tier]
	return outcome.retriedSafetyFallback ? '骨架脱敏重试' : ''
}

function tavernDamperTierTable(outcome) {
	return outcome && outcome.judgeMode === 'author' ? TAVERN_DAMPER_AUTHOR_TIERS : TAVERN_DAMPER_TIERS
}

function tavernDamperMetaOf(outcome) {
	if (!outcome || typeof outcome !== 'object') return null
	if (outcome.status === 'bypassed') {
		const copy = TAVERN_DAMPER_BYPASS_COPY[outcome.code] || {
			short: '未生效',
			title: '未生效 · ' + String(outcome.message || '决策请求失败'),
			hint: (outcome.message ? String(outcome.message) + '。' : '') + '本轮已自动静默放行，未阻塞正文生成。'
		}
		return {
			bypassed: true,
			tone: 'bypassed',
			pillText: '阻尼 · ' + copy.short,
			title: copy.title,
			desc: copy.hint
		}
	}
	const table = tavernDamperTierTable(outcome)
	const key = outcome.explicitSceneShift === true ? 'scene_shift' : (table[outcome.rulingTier] ? outcome.rulingTier : 'full_accept')
	const tier = table[key]
	const score = Number(outcome.leverageScore)
	const scoreText = tier.showScore && Number.isFinite(score) ? ' ' + score.toFixed(1) : ''
	const judgePrefix = outcome.judgeMode === 'author' ? '写作 · ' : ''
	return {
		bypassed: false,
		tone: tier.tone,
		pillText: '阻尼 · ' + judgePrefix + tier.short + scoreText,
		title: (outcome.judgeMode === 'author' ? '写作模式 · ' : '') + tier.title,
		desc: tier.desc,
		showMetrics: !outcome.explicitSceneShift && outcome.rulingTier !== 'legacy_plain'
	}
}

function useTavernFloorDamperReceipt(sessionId, turn, fallbackReceipt, visibility) {
	const validTurn = Number.isInteger(turn) && turn > 0 && Boolean(sessionId)
	const live = validTurn && typeof useLiveTavernView === 'function'
		? useLiveTavernView(sessionId, 'story-damper:' + String(turn),
			[['$mvuReceiptTurn', String(turn)], ['$settlementOwner', String(turn)], ['$receiptBusy']])
		: null
	const liveReceipt = validTurn && live && live.view && typeof tavernMvuReceiptForTurn === 'function'
		? tavernMvuReceiptForTurn(live.view, turn)
		: null
	const raw = liveReceipt || fallbackReceipt || null
	if (!raw) return null
	const vis = (live && live.view && live.view.mvuVisibility) || visibility || null
	return vis && typeof maskMvuReceipt === 'function' ? maskMvuReceipt(raw, vis) : raw
}

function TavernDamperClampedList(props) {
	const h = React.createElement
	const items = Array.isArray(props.items) ? props.items : []
	if (!items.length) return null
	return h('ul', { className: 'dsh-tavern-damper-clamped-list' }, items.map(function (item, idx) {
		const pathLabel = tavernDamperPathLabel(item.path)
		let detailText = ''
		if (item.hidden === true) {
			detailText = item.dropped ? '越界增长已拦截（数值隐藏）' : '跳变幅度已按配额截断（数值隐藏）'
		} else if (item.dropped === true) {
			detailText = '原提交 ' + tavernDamperSignedNumber(item.requestedDelta)
				+ (item.requestedAfter !== undefined ? '（→ ' + String(item.requestedAfter) + '）' : '')
				+ ' → 已拦截，保持 ' + String(item.before ?? '')
		} else {
			detailText = String(item.before ?? '') + ' → ' + String(item.after ?? '')
				+ '（' + tavernDamperSignedNumber(item.clampedDelta)
				+ '，原提交 ' + tavernDamperSignedNumber(item.requestedDelta) + '）'
		}
		return h('li', { key: String(item.path || '') + ':' + idx, className: 'dsh-tavern-damper-clamped-row', title: String(item.path || '') },
			h('span', { className: 'dsh-tavern-damper-clamped-key' }, pathLabel),
			h('span', { className: 'dsh-tavern-damper-clamped-val', 'data-dropped': item.dropped === true ? 'true' : undefined }, detailText))
	}))
}

function StoryFloorDamperPill(props) {
	const h = React.createElement
	const outcome = props.outcome
	const meta = tavernDamperMetaOf(outcome)
	const receipt = useTavernFloorDamperReceipt(props.sessionId, props.turn, props.fallbackReceipt, props.visibility)
	if (!meta) return null
	const clampedList = receipt && receipt.damper && Array.isArray(receipt.damper.clamped) ? receipt.damper.clamped : []
	const clampedCount = clampedList.length
	const label = meta.pillText + (!meta.bypassed && clampedCount > 0 ? ' · 钳制 ' + String(clampedCount) + ' 项' : '')
	const tooltip = meta.title + (clampedCount > 0 ? ' · 已钳制 ' + String(clampedCount) + ' 项变量跳变' : '') + '（点击展开裁定详情）'
	return h('button', {
		type: 'button',
		className: 'dsh-tavern-damper-pill',
		'data-tone': meta.tone,
		'data-expanded': props.expanded ? 'true' : undefined,
		'aria-expanded': Boolean(props.expanded),
		title: tooltip,
		onClick: props.onToggle
	},
		h('span', { className: 'dsh-tavern-damper-dot', 'aria-hidden': 'true' }),
		h('span', { className: 'dsh-tavern-damper-pill-text' }, label))
}

function StoryFloorDamperPanel(props) {
	const h = React.createElement
	const outcome = props.outcome
	const meta = tavernDamperMetaOf(outcome)
	const receipt = useTavernFloorDamperReceipt(props.sessionId, props.turn, props.fallbackReceipt, props.visibility)
	if (!meta) return null

	const modeLabel = outcome.mode === 'strict' ? '慢热严苛' : '标准拉扯'
	const authorMode = outcome.judgeMode === 'author'
	const judgeLabel = authorMode ? '写作模式' : '角色扮演'
	const latencyText = outcome.source === 'cache'
		? '命中缓存'
		: outcome.source === 'scene-shift'
			? '标记直通'
			: (Number.isFinite(Number(outcome.latencyMs)) && Number(outcome.latencyMs) > 0 ? Math.round(Number(outcome.latencyMs)) + ' ms' : '')

	if (meta.bypassed) {
		return h('section', { className: 'dsh-tavern-damper-panel', 'data-tone': 'bypassed', 'aria-label': '叙事阻尼器本轮状态' },
			h('div', { className: 'dsh-tavern-damper-panel-head' },
				h('strong', { className: 'dsh-tavern-damper-panel-title' }, '叙事阻尼器 · ' + meta.title),
				h('div', { className: 'dsh-tavern-damper-tags' },
					outcome.model ? h('span', { className: 'dsh-tavern-damper-tag' }, String(outcome.model)) : null,
					latencyText ? h('span', { className: 'dsh-tavern-damper-tag' }, latencyText) : null)),
			h('p', { className: 'dsh-tavern-damper-desc' }, meta.desc))
	}

	const threshold = Number.isFinite(Number(outcome.godmodeThreshold)) ? Number(outcome.godmodeThreshold) : (outcome.mode === 'strict' ? 0.64 : 0.72)
	const score = Number.isFinite(Number(outcome.leverageScore)) ? Number(outcome.leverageScore) : 1
	const scorePct = Math.min(100, Math.max(0, Math.round((score / 3) * 100)))
	const riskItems = [
		{ key: 'godmode', label: authorMode ? '角色失真' : '越权代笔', value: Number(outcome.godmode) || 0 },
		{ key: 'retcon', label: authorMode ? '设定冲突' : '无据篡改', value: Number(outcome.retcon) || 0 },
		{ key: 'epistemic', label: authorMode ? '视角穿帮' : '场外天眼', value: Number(outcome.epistemic) || 0 }
	]

	const mvuActive = Boolean(receipt || props.hasMvu)
	const mvuStatus = receipt ? receipt.status : (props.streaming || props.mvuPending ? 'pending' : '')
	const damperReport = receipt && receipt.damper ? receipt.damper : null
	const clampedList = damperReport && Array.isArray(damperReport.clamped) ? damperReport.clamped : []
	const plainState = outcome.plainState && outcome.plainState.after ? outcome.plainState : null

	let effectFooter = null
	if (mvuActive) {
		if (props.streaming) {
			effectFooter = h('div', { className: 'dsh-tavern-damper-state-note' }, '正文生成完成后将按本轮配额钳制后台 MVU 变量结算。')
		} else if (mvuStatus === 'pending') {
			effectFooter = h('div', { className: 'dsh-tavern-damper-state-note' }, '后台变量结算进行中，完成后将显示数值钳制结果…')
		} else if (outcome.clampMvuDelta === false || (damperReport && damperReport.clampEnabled === false)) {
			effectFooter = h('div', { className: 'dsh-tavern-damper-state-note' }, '后台 MVU 数值涨跌钳制开关当前已关闭。')
		} else if (clampedList.length > 0) {
			effectFooter = h('div', { className: 'dsh-tavern-damper-clamped-box' },
				h('div', { className: 'dsh-tavern-damper-subhead' }, '已硬性钳制 ' + String(clampedList.length) + ' 项超限数值变动'),
				h(TavernDamperClampedList, { items: clampedList }))
		} else if (receipt && (receipt.status === 'updated' || receipt.status === 'unchanged')) {
			effectFooter = h('div', { className: 'dsh-tavern-damper-state-note' },
				Array.isArray(receipt.changes) && receipt.changes.length > 0
					? '本轮后台提交的 ' + String(receipt.changes.length) + ' 项变量变动均符合配额上限，未触发硬性截断。'
					: '本轮无核心数值跳变。')
		}
	} else if (plainState) {
		const before = plainState.before || null
		const after = plainState.after || {}
		effectFooter = h('div', { className: 'dsh-tavern-damper-plain-box' },
			h('div', { className: 'dsh-tavern-damper-subhead' }, '通用四维惯性状态演进'),
			h('div', { className: 'dsh-tavern-damper-plain-grid' }, TAVERN_DAMPER_PLAIN_AXES.map(function (axis) {
				const cur = Number(after[axis.key])
				const prev = before && Number.isFinite(Number(before[axis.key])) ? Number(before[axis.key]) : null
				if (!Number.isFinite(cur)) return null
				const delta = prev === null ? 0 : cur - prev
				const signTone = delta === 0 ? 'flat' : ((axis.inverse ? delta < 0 : delta > 0) ? 'up' : 'down')
				return h('div', { key: axis.key, className: 'dsh-tavern-damper-plain-cell' },
					h('span', { className: 'dsh-tavern-damper-plain-label' }, axis.label),
					h('span', { className: 'dsh-tavern-damper-plain-val' },
						prev !== null && prev !== cur ? String(prev) + ' → ' + String(cur) : String(cur),
						delta !== 0 ? h('em', { className: 'dsh-tavern-damper-plain-delta', 'data-sign': signTone }, tavernDamperSignedNumber(delta)) : null))
			})))
	}

	return h('section', { className: 'dsh-tavern-damper-panel', 'data-tone': meta.tone, 'aria-label': '叙事阻尼器裁定详情' },
		h('div', { className: 'dsh-tavern-damper-panel-head' },
			h('strong', { className: 'dsh-tavern-damper-panel-title' }, '叙事阻尼裁定 · ' + meta.title),
			h('div', { className: 'dsh-tavern-damper-tags' },
				outcome.rulingTier !== 'legacy_plain' ? h('span', { className: 'dsh-tavern-damper-tag' }, judgeLabel) : null,
				outcome.rulingTier !== 'legacy_plain' ? h('span', { className: 'dsh-tavern-damper-tag' }, modeLabel) : null,
				outcome.deltaBudget ? h('span', { className: 'dsh-tavern-damper-tag', 'data-budget': outcome.deltaBudget },
					'配额：' + tavernDamperBudgetLabel(outcome.deltaBudget, outcome.mode)) : null,
				tavernDamperProjectionTag(outcome) ? h('span', { className: 'dsh-tavern-damper-tag' }, tavernDamperProjectionTag(outcome)) : null,
				outcome.safetyEscalated ? h('span', { className: 'dsh-tavern-damper-tag', 'data-safety': 'escalated' }, '输入过滤降级') : null,
				latencyText ? h('span', { className: 'dsh-tavern-damper-tag' }, latencyText) : null)),
		h('p', { className: 'dsh-tavern-damper-desc' }, meta.desc),
		meta.showMetrics ? h('div', { className: 'dsh-tavern-damper-metrics' },
			h('div', { className: 'dsh-tavern-damper-leverage' },
				h('span', { className: 'dsh-tavern-damper-metric-label' }, '筹码铺垫'),
				h('span', { className: 'dsh-tavern-damper-bar', 'aria-hidden': 'true' },
					h('span', { className: 'dsh-tavern-damper-bar-fill', style: { width: String(scorePct) + '%' } })),
				h('span', { className: 'dsh-tavern-damper-metric-score' }, score.toFixed(2) + ' / 3.00')),
			h('div', { className: 'dsh-tavern-damper-risks' }, riskItems.map(function (risk) {
				const flagged = risk.value >= threshold || (outcome.rulingTier === 'strip_delusion' && risk.value >= 0.6)
				return h('span', {
					key: risk.key,
					className: 'dsh-tavern-damper-risk',
					'data-alert': flagged ? 'true' : undefined,
					title: (authorMode ? '设定冲突判定阈值 ' : '越权判定阈值 ') + Math.round(threshold * 100) + '%'
				}, risk.label + ' ' + String(Math.round(risk.value * 100)) + '%')
			}))) : null,
		effectFooter)
}

function DamperReceiptSummary(props) {
	const h = React.createElement
	const damper = props.damper
	if (!damper || typeof damper !== 'object') return null
	const clamped = Array.isArray(damper.clamped) ? damper.clamped : []
	const budgetLabel = tavernDamperBudgetLabel(damper.deltaBudget, damper.mode)
	return h('section', {
		className: 'fork-var-damper',
		'data-clamped': clamped.length > 0 ? 'true' : undefined
	},
		h('div', { className: 'fork-var-damper-head' },
			h('strong', null, '叙事阻尼配额 · ' + budgetLabel),
			h('span', { className: 'fork-var-damper-badge' },
				damper.clampEnabled === false
					? '数值钳制已关闭'
					: clamped.length > 0
						? '已钳制 ' + String(clamped.length) + ' 项跳变'
						: '符合配额')),
		clamped.length > 0 ? h(TavernDamperClampedList, { items: clamped }) : null)
}
