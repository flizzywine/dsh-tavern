function evaluatePatchedSessionClient(source, require) {
	let exports
	const previous = window.__ModuleLoader__
	window.__ModuleLoader__ = {
		load: function (descriptor) {
			exports = descriptor.factory(require)
		}
	}
	try { (0, eval)(source) }
	finally { window.__ModuleLoader__ = previous }
	return exports
}

function installTavernSessionHistoryPatch(require, rpc) {
	let live
	try { live = require("@deepseek-ai/dsh-api-session-controller/client") }
	catch (error) {
		void Promise.resolve().then(function () { return rpc("confirmSessionPatch", { protocol: 1, installed: false, reason: "客户端没有拿到会话历史模块：" + (error && error.message || error) }); }).catch(function () {})
		return
	}
	const proto = live && live.SessionEventStream && live.SessionEventStream.prototype
	if (!proto || typeof proto.readPage !== "function" || typeof proto.follow !== "function") {
		void Promise.resolve().then(function () { return rpc("confirmSessionPatch", { protocol: 1, installed: false, reason: "客户端会话历史模块没有可安装的读取方法" }); }).catch(function () {})
		return
	}
	if (proto.__dshTavernSessionPatch) return
	const originalRead = proto.readPage
	const originalFollow = proto.follow
	let patched = null
	const ready = rpc("getSessionPatchStatus").then(function (result) {
		const patch = result && result.patch
		if (!patch || patch.status === "skipped" || patch.serverReady !== true) return null
		return rpc("getSessionPatchClient").then(function (client) {
			if (!client || !client.source) throw new Error(client && client.reason || "服务端没有提供会话历史补丁")
			const evaluated = evaluatePatchedSessionClient(client.source, require)
			if (!evaluated || !evaluated.SessionEventStream) throw new Error("会话历史补丁没有导出读取类")
			patched = evaluated.SessionEventStream.prototype
			return rpc("confirmSessionPatch", { protocol: 1, installed: true })
		})
	}).catch(function (error) {
		return rpc("confirmSessionPatch", { protocol: 1, installed: false, reason: String(error && error.message || error) }).catch(function () {})
	})
	proto.readPage = function () {
		const self = this
		const args = arguments
		return ready.then(function () {
			return (patched ? patched.readPage : originalRead).apply(self, args)
		})
	}
	proto.follow = async function* () {
		await ready
		yield* (patched ? patched.follow : originalFollow).apply(this, arguments)
	}
	Object.defineProperty(proto, "__dshTavernSessionPatch", { value: true })
}
