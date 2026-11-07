// Story mode keeps the native event/location/timeline model, but does not
// materialize expensive Chat nodes for already-closed older turns. The logical
// story transcript owns those rows. The latest and open native turns stay live
// for partial/runningCalls/composer, and legacy mode rebuilds the full projection.
function tavernStoryNativeTurnOfLocation(location) {
	if (!location || (location.kind !== 'turn' && location.kind !== 'step')) return null
	const turn = Number(location.turn && location.turn.turn)
	return Number.isSafeInteger(turn) && turn >= 0 ? turn : null
}

function installTavernStoryExternalHistory(options) {
	let conversationModule
	try { conversationModule = options.require('@deepseek-ai/dsh-client-ui-conversation/client') }
	catch (_) { return { refresh: function () {}, dispose: function () {} } }
	const proto = conversationModule && conversationModule.UiConversation && conversationModule.UiConversation.prototype
	if (!proto) return { refresh: function () {}, dispose: function () {} }
	if (proto.__dshTavernStoryExternalHistory) {
		const existing = proto.__dshTavernStoryExternalHistory
		existing.uiConversation = options.uiConversation
		existing.isEnabled = options.isEnabled
		return existing.attach()
	}

	const records = new WeakMap()
	const active = new Set()
	const controller = {
		uiConversation: options.uiConversation,
		isEnabled: options.isEnabled,
		alive: true,
		owners: 0,
		attach: null,
		refresh: null,
		dispose: null
	}

	function installBinding(binding, sessionId) {
		const assembler = binding && binding.assembler
		if (!assembler || records.has(assembler)) return records.get(assembler)
		const originalBuild = assembler.buildNode
		const originalDispose = typeof binding.dispose === 'function' ? binding.dispose : null
		const record = { binding: binding, assembler: assembler, sessionId: sessionId, originalBuild: originalBuild,
			originalDispose: originalDispose, lastEnabled: assembler.activeTargets && assembler.activeTargets.has('chat') ? undefined : controller.isEnabled(sessionId) }
		function filteredBuild(context, target) {
			if (controller.alive && target === 'chat' && controller.isEnabled(record.sessionId)
				&& (context.current == null || context.current.get(target) == null)) {
				const turn = tavernStoryNativeTurnOfLocation(context.start && context.start.location)
				const timeline = this.locationIndex && this.locationIndex.snapshot()
				const order = timeline && Array.isArray(timeline.turnOrder) ? timeline.turnOrder : []
				const latest = order.length ? Number(order[order.length - 1]) : null
				const open = typeof this.openTurn === 'function' ? this.openTurn() : undefined
				// Unknown locations stay native. Older turns that were never materialized
				// are safe to skip: context.current remains null, so later upserts do not
				// violate the host's no-withdrawal contract.
				if (turn !== null && Number.isSafeInteger(latest) && turn < latest && turn !== open) return null
			}
			return originalBuild.call(this, context, target)
		}
		record.filteredBuild = filteredBuild
		assembler.buildNode = filteredBuild
		if (originalDispose) {
			binding.dispose = function () {
				active.delete(record)
				if (assembler.buildNode === filteredBuild) assembler.buildNode = originalBuild
				binding.dispose = originalDispose
				return originalDispose.apply(binding, arguments)
			}
		}
		records.set(assembler, record)
		active.add(record)
		return record
	}

	controller.refresh = function (sessionId, refreshOptions) {
		if (!controller.alive || !sessionId || !controller.uiConversation) return
		let binding
		try { binding = controller.uiConversation.binding(sessionId) }
		catch (_) { return }
		const record = installBinding(binding, String(sessionId))
		if (!record) return
		const enabled = controller.isEnabled(record.sessionId)
		const force = refreshOptions === true || refreshOptions && refreshOptions.force === true
		if (!force && record.lastEnabled === enabled) return
		record.lastEnabled = enabled
		if (record.assembler.activeTargets && record.assembler.activeTargets.has('chat')) record.binding.rebuild()
	}

	const originalBinding = proto.binding
	const patchedBinding = function (source) {
		const binding = originalBinding.call(this, source)
		const sessionId = String(typeof source === 'string' ? source : source && source.sessionId || '')
		if (controller.alive && sessionId) installBinding(binding, sessionId)
		return binding
	}
	proto.binding = patchedBinding
	Object.defineProperty(proto, '__dshTavernStoryExternalHistory', { value: controller, configurable: true })

	controller.attach = function () {
		controller.owners++
		let disposed = false
		return {
			refresh: controller.refresh,
			dispose: function () {
				if (disposed) return
				disposed = true
				controller.owners = Math.max(0, controller.owners - 1)
				if (controller.owners === 0) controller.dispose()
			}
		}
	}
	controller.dispose = function () {
		if (!controller.alive) return
		controller.alive = false
		if (proto.binding === patchedBinding && proto.__dshTavernStoryExternalHistory === controller) {
			proto.binding = originalBinding
			delete proto.__dshTavernStoryExternalHistory
		}
		for (const record of active) {
			const assembler = record.assembler
			if (assembler.activeTargets && assembler.activeTargets.has('chat')) {
				try { record.binding.rebuild() }
				catch (_) {}
			}
			if (assembler.buildNode === record.filteredBuild) assembler.buildNode = record.originalBuild
			if (record.originalDispose) record.binding.dispose = record.originalDispose
		}
		active.clear()
	}
	return controller.attach()
}
