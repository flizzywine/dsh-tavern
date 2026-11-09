function installTavernHostChatFlow(slots, renderFlow) {
	const key = 'conversation.chat.flow'
	return slots.inject(key, function () {
		let activeEntry = null, dispose = null, installing = false, stopped = false
		function detach() {
			const current = dispose
			dispose = null
			activeEntry = null
			if (current) current()
		}
		function install() {
			if (stopped || installing || (activeEntry && slots.entries(key).includes(activeEntry))) return
			installing = true
			try {
				detach()
				const entries = slots.entries(key).filter(entry => entry.component)
				const native = entries.find(entry => entry.children && entry.children['conversation.chat.node']) || entries[0]
				if (!native) return
				const original = native.component
				function TavernHostChatFlow(props) {
					return renderFlow(props, () => React.createElement(original, props))
				}
				if (native.children !== undefined) {
					// renderSlot belongs to the host entry that declares the child slots.
					if (!Object.getOwnPropertyDescriptor(native, 'component')?.writable) return
					native.component = TavernHostChatFlow
					dispose = () => { if (native.component === TavernHostChatFlow) native.component = original }
				} else {
					const registration = { name: key, priority: -1, registrant: 'dsh-tavern' }
					for (const field of ['inject', 'store', 'locale']) if (native[field] !== undefined) registration[field] = native[field]
					dispose = slots.register(registration, TavernHostChatFlow)
				}
				activeEntry = native
			} finally { installing = false }
		}
		const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe(key, install) : () => {}
		function stop() {
			if (stopped) return
			stopped = true
			try { unsubscribe() } finally { detach() }
		}
		try { install() } catch (error) { stop(); throw error }
		return stop
	})
}
