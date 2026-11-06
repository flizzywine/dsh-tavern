import { readdir } from 'node:fs/promises'

// 故事楼层（[data-story-row]）写操作的 E2E：编辑正文/输入后刷新仍在、按 assistant
// messageIndex 分叉、在分叉里删除最后一轮。只读磁盘 Chat（data/chats）区分每一局，
// 不假定 savedChat() 分叉后仍然只有一局，也不复用原生路径的选择器。
//
// context:
//   page, assert, join, data, createChatJournalStore          —— 必填
//   output, step, pause, report, waitForVisibleStoryText      —— 可选；output 用于截图/JSON
// 返回值：写入 report.storyWriteOperations（若给了 report）。
export async function storyWriteOperationChecks(context) {
	const { page, assert, join, data, createChatJournalStore } = context || {}
	if (!page || !assert || !data || typeof createChatJournalStore !== 'function') {
		throw new Error('storyWriteOperationChecks 需要 context { page, assert, data, createChatJournalStore }')
	}
	const step = typeof context.step === 'function' ? context.step : async function (_name, action) { await action() }
	const pause = typeof context.pause === 'function' ? context.pause : function (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
	const report = context.report || {}
	const output = context.output || ''
	const assistantMark = 'E2E_SWO_ASSISTANT_EDITED'
	const userMark = 'E2E_SWO_USER_EDITED'
	const summary = report.storyWriteOperations = {}

	function failure(label, error) {
		return Object.assign(new Error(label + (error && error.message ? '：' + error.message : '')), { fatal: true })
	}
	async function until(label, probe, limit = 120000) {
		const deadline = Date.now() + limit
		let last = null
		while (Date.now() < deadline) {
			let value
			try { value = await probe() } catch (error) {
				if (error && error.fatal) throw error
				last = error
			}
			if (value) return value
			await pause(200)
		}
		throw new Error('等待超时：' + label + (last && last.message ? '（最后错误：' + last.message + '）' : ''))
	}
	async function shot(name) {
		if (!output) return
		try { await page.screenshot({ path: join(output, 'story-write-' + name + '.png'), fullPage: true }) } catch (_) {}
	}
	async function visibleStoryText(text) {
		if (typeof context.waitForVisibleStoryText === 'function') return context.waitForVisibleStoryText(text)
		await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 30000 })
	}

	// ---------- 磁盘 Chat：按 id 读，不假定只有一局 ----------
	function openStore() { return createChatJournalStore({ dataRoot: data }) }
	async function readChat(id) {
		if (!id) return null
		try { return await openStore().read(id) } catch (_) { return null }
	}
	async function diskGames() {
		const store = openStore()
		const ids = await readdir(join(data, 'chats'))
		const chats = []
		for (const id of ids) {
			try {
				const chat = await store.read(id)
				if (chat && chat.mode !== 'card') chats.push(chat)
			} catch (_) { /* 损坏或正在写入的存档不参与本次选择 */ }
		}
		return chats.sort(function (left, right) { return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0) })
	}
	const textOf = row => {
		const value = row ? (row.role === 'user' ? row.text : (row.sourceText ?? row.text)) : ''
		return String(value ?? '')
	}
	const prose = chat => (chat && Array.isArray(chat.messages) ? chat.messages : []).map(row => [row && row.role, textOf(row)])
	const goldOf = variables => {
		const value = variables && variables.stat_data ? variables.stat_data.gold : undefined
		return Number.isFinite(Number(value)) ? Number(value) : null
	}
	const rounds = chat => (chat && Array.isArray(chat.messages) ? chat.messages : []).filter(row => row && row.role === 'assistant' && row.greeting !== true)
	const assistantFloors = chat => (chat && Array.isArray(chat.messages) ? chat.messages : []).filter(row => row && row.role === 'assistant')
	const assistantPositions = chat => (chat && Array.isArray(chat.messages) ? chat.messages : [])
		.map(function (row, index) { return row && row.role === 'assistant' ? index : null })
		.filter(index => index !== null)
	// 存档把每条的变量按 swipe 存在 variables[swipeId]；旧存档可能直接存状态对象。
	const variablesAt = row => {
		const variables = row && row.variables
		if (!variables || typeof variables !== 'object') return null
		const swipe = Math.max(0, Number(row.swipeId) || 0)
		const value = Array.isArray(variables) ? variables[swipe] : variables[swipe]
		return value === undefined ? variables : value
	}

	// ---------- DOM ----------
	const storyRows = () => page.locator('[data-story-row]')
	const assistantRows = () => page.locator('[data-story-row][data-role="assistant"]')
	const userRows = () => page.locator('[data-story-row][data-role="user"]')
	const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
	async function ensureStoryRows() {
		if (await storyRows().count()) return
		const toggle = page.getByRole('button', { name: /切换到故事楼层/ })
		if (await toggle.count()) await toggle.first().click().catch(() => {})
		await storyRows().first().waitFor({ timeout: 30000 })
	}
	async function sidebarFailure() {
		const error = page.locator('.dsh-tavern-dock-error[role="alert"]')
		if (await error.count() && await error.first().isVisible().catch(() => false)) {
			throw failure('侧栏报错', await error.first().innerText().catch(() => ''))
		}
		return null
	}
	async function waitSettled(limit = 180000) {
		return until('本轮生成与结算完成', async () => {
			const chat = (await diskGames())[0]
			if (!chat) return null
			if (chat.settleStatus !== 'done') return null
			const streaming = await page.locator('[data-story-row].dsh-tavern-story-streaming').count().catch(() => 0)
			return streaming === 0 ? chat : null
		}, limit)
	}
	async function sendRound(text) {
		const chat = (await diskGames())[0]
		const before = rounds(chat).length
		await composer().click()
		await composer().fill(text)
		await composer().press('Enter')
		await until('第 ' + (before + 1) + ' 轮正文写入', async () => {
			await sidebarFailure()
			const next = (await diskGames())[0]
			return next && rounds(next).length > before ? next : null
		}, 180000)
		await waitSettled()
	}

	// ---------- 编辑 ----------
	async function openEditor(row, label) {
		await row.scrollIntoViewIfNeeded().catch(() => {})
		await row.hover()
		const button = row.locator('button[aria-label="' + label + '"]').first()
		await button.waitFor({ state: 'visible', timeout: 15000 })
		await button.click()
		const region = page.locator('[role="region"][aria-label="' + label + '"]').last()
		await region.waitFor({ state: 'visible', timeout: 15000 })
		return region
	}
	async function saveEditor(region, text) {
		const textarea = region.locator('textarea').first()
		await textarea.waitFor({ state: 'visible', timeout: 10000 })
		await textarea.fill(text)
		await region.getByRole('button', { name: '保存', exact: true }).click()
		await until('编辑面板保存并关闭', async () => {
			if (!await region.count() || !await region.isVisible().catch(() => false)) return true
			const alert = region.locator('[role="alert"]')
			if (await alert.count()) throw failure('保存正文', await alert.first().innerText().catch(() => ''))
			return false
		}, 60000)
	}
	async function writeUnrelatedHeader(chatId, sessionId, userName) {
		const before = await readChat(chatId)
		await page.evaluate(async ({ sessionId, userName }) => {
			const response = await fetch('/api/dsh-tavern/setPlayerName', { method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, userName }) })
			const value = await response.json()
			if (!response.ok || !value || !value.ok) throw new Error(value && value.error ? value.error : 'setPlayerName HTTP ' + response.status)
		}, { sessionId, userName })
		await until('编辑面板打开时无关表头写入', async () => {
			const chat = await readChat(chatId)
			return chat && chat._storageRevision > before._storageRevision ? chat : null
		}, 30000)
	}
	async function waitText(id, marker, role) {
		return until('编辑文本落盘（' + role + '）', async () => {
			const chat = await readChat(id)
			if (!chat || !Array.isArray(chat.messages)) return null
			const index = role === 'assistant'
				? chat.messages.findLastIndex(row => row && row.role === 'assistant')
				: chat.messages.findLastIndex(row => row && row.role === 'user')
			if (index < 0) return null
			return textOf(chat.messages[index]).includes(marker) ? chat : null
		}, 60000)
	}

	// ---------- 删除 ----------
	async function enterDeleteMode() {
		const dock = page.locator('section[aria-label="删除消息"]')
		if (await dock.count()) return dock.first()
		const input = composer()
		await input.click()
		await input.fill('').catch(() => {})
		await input.pressSequentially('/', { delay: 40 })
		const menu = page.getByRole('listbox').first()
		await menu.waitFor({ timeout: 10000 })
		await input.pressSequentially('delete', { delay: 40 })
		const option = menu.getByRole('option').filter({ hasText: /delete|删除/ }).first()
		if (!await option.count()) {
			await input.fill('')
			throw new Error('命令菜单里没有 delete 条目')
		}
		await option.click()
		await dock.first().waitFor({ timeout: 20000 })
		return dock.first()
	}
	async function clickConfirmIfAny() {
		const dialog = page.locator('dialog[aria-label="确认操作"]')
		try { await dialog.waitFor({ state: 'visible', timeout: 3000 }) } catch (_) { return false }
		await dialog.getByRole('button', { name: '删除', exact: true }).click()
		await dialog.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
		return true
	}
	// 行内删除按钮（主线程若有）优先；现有 UI 是 /delete 批量选择。
	async function deleteLastRound(chatId, expectedLength) {
		let mode = ''
		const inline = assistantRows().locator('button[aria-label="删除正文"], button[aria-label="删除输入"]')
		if (await inline.count()) {
			mode = 'inline'
			for (const label of ['删除正文', '删除输入']) {
				const before = (await readChat(chatId)).messages.length
				const row = label === '删除正文' ? assistantRows().last() : userRows().last()
				if (!await row.count()) break
				await row.hover()
				const button = row.locator('button[aria-label="' + label + '"]')
				if (!await button.count()) break
				await button.first().click()
				await clickConfirmIfAny()
				await until('行内删除落盘（' + label + '）', async () => {
					const chat = await readChat(chatId)
					return chat && chat.messages.length < before ? chat : null
				}, 60000)
				// 下一次行内删除要用刷新后的 revision 与重新排序的行。
				await pause(500)
			}
		} else {
			mode = 'selection'
			const dock = await enterDeleteMode()
			const assistantRow = assistantRows().last()
			const userRow = userRows().last()
			const assistantCheckbox = assistantRow.locator('input[type="checkbox"][aria-label="选择这条 AI 输出"]')
			const userCheckbox = userRow.locator('input[type="checkbox"][aria-label="选择这条用户输入"]')
			await assistantRow.locator('.dsh-tavern-story-body').click()
			await until('点按 AI 楼层选中', async () => await assistantCheckbox.isChecked() ? true : null, 5000)
			const selectedStyle = await assistantRow.evaluate(row => ({ cursor: getComputedStyle(row).cursor, shadow: getComputedStyle(row).boxShadow }))
			assert.equal(selectedStyle.cursor, 'pointer', '删除模式必须显示楼层点按光标')
			assert.notEqual(selectedStyle.shadow, 'none', 'AI 楼层选中后必须显示高亮描边')
			await userRow.locator('.dsh-tavern-story-body').click()
			await until('点按用户楼层选中', async () => await userCheckbox.isChecked() ? true : null, 5000)
			await dock.getByText('已选 2 条', { exact: true }).waitFor({ timeout: 15000 })
			await dock.getByRole('button', { name: '删除', exact: true }).click()
			const confirmed = await clickConfirmIfAny()
			if (!confirmed) throw new Error('删除缺少确认对话框')
		}
		await until('删除落盘', async () => {
			const alert = page.locator('.dsh-tavern-message-deletion-error[role="alert"]')
			if (await alert.count()) throw failure('删除消息', await alert.first().innerText().catch(() => ''))
			const chat = await readChat(chatId)
			return chat && chat.messages.length === expectedLength ? chat : null
		}, 60000)
		return mode
	}

	// ---------- 开始 ----------
	await ensureStoryRows()
	await step('准备两轮已结算的故事正文', async () => {
		await waitSettled(60000).catch(() => {})
		const chat = (await diskGames())[0]
		if (!chat) throw new Error('找不到当前故事存档')
		// 固定模型的第二轮会写 gold=20；分叉点的变量因此与最新变量不同，才能验证未来变量没被带进分叉。
		if (rounds(chat).length === 0) await sendRound('领取任务奖励')
		if (rounds(await readChat(chat.id)).length < 2) await sendRound('再次领取奖励')
		const ready = await readChat(chat.id)
		if (rounds(ready).length < 2) throw new Error('至少需要两轮正文才能验证分叉前缀')
		summary.rounds = rounds(ready).length
	})

	let edited = null
	const editedStep = await step('编辑正文与玩家输入并保存', async () => {
		const source = (await diskGames())[0]
		if (!source) throw new Error('找不到当前故事存档')
		const before = await readChat(source.id)
		const assistantRow = assistantRows().last()
		const region = await openEditor(assistantRow, '编辑正文')
		await writeUnrelatedHeader(source.id, source.sessionId, 'E2E 正文编辑期间后台改名')
		await saveEditor(region, assistantMark + ' 这是编辑后的正文。')
		await waitText(source.id, assistantMark, 'assistant')
		await visibleStoryText(assistantMark)
		const afterAssistant = await readChat(source.id)
		await shot('after-assistant-edit')
		const userRow = userRows().last()
		await openEditor(userRow, '编辑这条输入')
		const userRegion = page.locator('[role="region"][aria-label="编辑这条输入"]').last()
		await writeUnrelatedHeader(source.id, source.sessionId, 'E2E 输入编辑期间后台改名')
		await saveEditor(userRegion, userMark + ' 编辑后的输入。')
		const chat = await waitText(source.id, userMark, 'user')
		await until('页面显示编辑后的输入', async () => {
			const rows = userRows()
			const count = await rows.count()
			if (!count) return false
			return (await rows.nth(count - 1).innerText()).includes(userMark)
		}, 30000)
		const result = { chatId: source.id, sessionId: source.sessionId, revisionBefore: source._storageRevision,
			revisionAfter: chat._storageRevision, messages: (chat.messages || []).length,
			assistantEdited: textOf(chat.messages[chat.messages.findLastIndex(row => row && row.role === 'assistant')]).includes(assistantMark),
			assistantRevisionMoved: afterAssistant._storageRevision !== before._storageRevision,
			survivedUnrelatedHeaderWrites: true }
		edited = result
		return result
	})
	// step 目前不返回 action 结果；主线程改成返回后这里也能直接用。
	if (editedStep && typeof editedStep === 'object' && editedStep.chatId) edited = editedStep
	summary.edit = edited
	await shot('after-edit')

	await step('刷新后正文与输入编辑仍保留', async () => {
		const saved = await readChat(edited.chatId)
		await page.reload({ waitUntil: 'domcontentloaded' })
		await storyRows().first().waitFor({ timeout: 60000 })
		await visibleStoryText(assistantMark)
		await until('刷新后输入编辑仍在', async () => {
			const rows = userRows()
			const count = await rows.count()
			return count > 0 && (await rows.nth(count - 1).innerText()).includes(userMark)
		}, 30000)
		const after = await readChat(edited.chatId)
		assert.ok(after, '刷新后仍应能读到这一局存档')
		// 刷新可能做 display/adoption 维护并推进 revision；正文与输入必须逐字不变。
		assert.deepEqual(prose(after), prose(saved), '刷新不能改动已保存的编辑')
		assert.ok(textOf(after.messages.findLast(row => row && row.role === 'assistant')).includes(assistantMark), '刷新后正文编辑必须在磁盘上')
		assert.ok(textOf(after.messages.findLast(row => row && row.role === 'user')).includes(userMark), '刷新后输入编辑必须在磁盘上')
		summary.editAfterReload = { revisionBefore: saved._storageRevision, revisionAfter: after._storageRevision, rows: await storyRows().count() }
		await shot('after-reload')
	})

	let forked = null
	const forkStep = await step('按 assistant messageIndex 分叉', async () => {
		const source = await readChat(edited.chatId)
		const positions = assistantPositions(source)
		const domCount = await assistantRows().count()
		if (positions.length < 2) throw new Error('存档里至少需要两条正文才能验证分叉前缀')
		// 楼层可能只渲染 [from..] 窗口；data-from 是窗口的绝对消息下标，用它把 DOM 行对齐到
		// messageIndex，而不是假定窗口从 0 开始。
		const fromAttr = await assistantRows().first().getAttribute('data-from')
		const from = fromAttr !== null && Number.isSafeInteger(Number(fromAttr)) && Number(fromAttr) >= 0 ? Number(fromAttr) : 0
		const windowPositions = positions.filter(index => index >= from)
		if (windowPositions.length !== domCount) {
			throw new Error('故事楼层与存档窗口不一致：' + domCount + ' / ' + windowPositions.length + '（from=' + from + '）')
		}
		if (windowPositions.length < 2) throw new Error('窗口里至少需要两条正文才能取到带未来的分叉点')
		// 取倒数第二条正文：前缀之外还有玩家输入与编辑后的正文，能验证未来变量不会跟着分叉走。
		const ordinal = domCount - 2
		const messageIndex = windowPositions[windowPositions.length - 2]
		// 分叉本体、精确正文前缀与变量快照会在下方逐项验证。
		const row = assistantRows().nth(ordinal)
		await row.scrollIntoViewIfNeeded().catch(() => {})
		await row.hover()
		const beforeUrl = page.url()
		await row.locator('button[aria-label="从这里分叉"], button[aria-label="从这一轮分叉"]').first().click()
		const fork = await until('分叉存档写入磁盘', async () => {
			await sidebarFailure()
			const chats = await diskGames()
			// 同一源存档可能已有旧分叉；按前段长度与 forkedFrom.messageIndex 认这一次。
			return chats.find(chat => chat.forkedFrom && chat.forkedFrom.chatId === source.id
				&& chat.forkedFrom.messageIndex === messageIndex && chat.messages.length === messageIndex + 1) || null
		}, 180000)
		await until('页面切到分叉会话', async () => {
			const rows = await storyRows().count()
			return rows === (fork.messages || []).length ? true : false
		}, 120000)

		// 前缀逐行相等，且分叉的世界变量停在该消息，不是源存档的最新变量。
		assert.equal(fork.messages.length, messageIndex + 1, '分叉正文必须精确等于源前缀')
		for (let index = 0; index <= messageIndex; index++) {
			const expected = source.messages[index], actual = fork.messages[index]
			assert.equal(actual && actual.role, expected && expected.role, '分叉第 ' + index + ' 条角色不一致')
			assert.equal(textOf(actual), textOf(expected), '分叉第 ' + index + ' 条正文必须与源前缀一致')
		}
		assert.equal(fork.forkedFrom && fork.forkedFrom.chatId, source.id, '分叉必须记录源 Chat')
		assert.equal(fork.forkedFrom && fork.forkedFrom.messageIndex, messageIndex, '分叉必须记录 messageIndex')
		assert.notEqual(fork.id, source.id, '分叉必须是新的 Chat')
		assert.notEqual(fork.sessionId, source.sessionId, '分叉必须是新的 Session')
		const prefixVariables = variablesAt(source.messages[messageIndex])
		const forkVariables = variablesAt(fork.messages[fork.messages.length - 1])
		assert.deepEqual(forkVariables, prefixVariables, '分叉最后一条必须带着分叉点的变量')
		const headVariables = variablesAt(source.messages[source.messages.length - 1])
		const gold = { prefix: goldOf(prefixVariables), head: goldOf(headVariables), fork: goldOf(forkVariables) }
		if (JSON.stringify(headVariables) !== JSON.stringify(prefixVariables)) {
			assert.notDeepEqual(forkVariables, headVariables, '分叉不能带上后续回合的变量')
		}
		// 固定模型的「领取任务奖励 → 再次领取奖励」会写 gold 10 → 20；两轮变量必须真的不同，
		// 否则这次分叉证明不了未来变量没有进入分叉。
		if (gold.prefix !== null && gold.head !== null) {
			if (gold.prefix === gold.head) {
				throw new Error('分叉点与最新一轮的变量没有差异（gold ' + gold.prefix + '），无法验证未来变量没有进入分叉')
			}
			assert.equal(gold.fork, gold.prefix, '分叉最后一条必须是分叉点的 gold')
			assert.notEqual(gold.fork, gold.head, '分叉不能带上最新一轮的 gold')
		}
		const afterUrl = page.url()
		const urlSession = url => (String(url).match(/session-[0-9a-fA-F-]{20,}/) || [''])[0]
		if (urlSession(beforeUrl) || urlSession(afterUrl)) {
			assert.equal(urlSession(afterUrl), fork.sessionId, 'URL 必须指向分叉会话')
		}
		// DSH 目前可能不把 Session 写进地址栏；页面切到分叉（楼层数与分叉正文一致）同样是可读证据。
		assert.ok(afterUrl !== beforeUrl || urlSession(afterUrl) || (await storyRows().count()) === fork.messages.length,
			'分叉后页面必须切到新的长会话')
		await shot('after-fork')
		const result = { chatId: fork.id, sessionId: fork.sessionId, messageIndex, messages: fork.messages.length,
			beforeUrl, afterUrl, urlChanged: afterUrl !== beforeUrl, urlCarriesSession: Boolean(urlSession(afterUrl)),
			prefixMatches: true, variablesAtPrefix: forkVariables !== null, gold }
		forked = result
		return result
	})
	if (forkStep && typeof forkStep === 'object' && forkStep.chatId) forked = forkStep
	summary.fork = forked

	await step('在分叉中删除这一轮的正文与输入', async () => {
		const fork = await readChat(forked.chatId)
		if (!fork) throw new Error('找不到分叉存档')
		if (rounds(fork).length < 1) throw new Error('分叉里没有可删除的正文：' + rounds(fork).length)
		const expected = fork.messages.length - 2
		const deletedAssistantText = textOf(fork.messages[fork.messages.length - 1])
		const mode = await deleteLastRound(forked.chatId, expected)
		const after = await readChat(forked.chatId)
		assert.ok(after, '删除后应仍能读到分叉存档')
		assert.equal(after.messages.length, expected, '删除必须同时移除正文与输入')
		assert.ok(!JSON.stringify(after.messages).includes(deletedAssistantText.slice(0, 40)), '被删除的正文不能留在存档里')
		await until('界面移除已删除的行', async () => {
			return (await userRows().count()) === 0 && (await assistantRows().count()) === assistantFloors(after).length
		}, 30000)
		summary.delete = { mode, messagesBefore: fork.messages.length, messagesAfter: after.messages.length, revision: after._storageRevision }
		await shot('after-delete')
	})

	await step('刷新后删除仍然生效', async () => {
		const saved = await readChat(forked.chatId)
		await page.reload({ waitUntil: 'domcontentloaded' })
		await storyRows().first().waitFor({ timeout: 60000 })
		const after = await readChat(forked.chatId)
		assert.ok(after, '刷新后仍应能读到分叉存档')
		assert.equal(after.messages.length, saved.messages.length, '刷新不能让已删除的消息回来')
		assert.deepEqual(prose(after), prose(saved), '刷新不能把已删除的正文或输入写回来')
		assert.equal(await userRows().count(), 0, '刷新后已删除的输入不能再出现')
		assert.equal(await assistantRows().count(), assistantFloors(after).length, '刷新后的正文楼层数必须与存档一致')
		summary.deleteAfterReload = { messages: after.messages.length, revisionBefore: saved._storageRevision, revisionAfter: after._storageRevision }
		await shot('after-delete-reload')
	})

	if (output) {
		try {
			const { writeFile } = await import('node:fs/promises')
			await writeFile(join(output, 'story-write-ops.json'), JSON.stringify(summary, null, 2))
		} catch (_) { /* 报告写盘失败不影响断言结果 */ }
	}
	return summary
}
