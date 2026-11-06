import { settlementTurn } from './chat-session-state.js'
import { collectMvuHelperContext } from './mvu-background-settlement.js'
import { applyMvuSettlementEffect } from './mvu-settlement-effect.js'
import { projectAgentMessageText } from './runtime-content-projection.js'
import { pendingMvuTarget } from './settlement-turn.js'
import { normalizeBackgroundTasks } from './tavern-settings.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Everything one settlement turn knows about official MVU variables
// (Wiki「设计：background-task-pipeline」, engine 1): which reply waits for
// them, the run with its durable delivery and deferral, what the commit and a
// failure write into that reply, and when a retry may restart them. The main
// settlement only asks these questions; it never reads MVU fields itself.
// `deps` is read on each call, so a test may swap a service after creation.
export function createMvuSettlementEngine(deps) {
  // A variable retry settles the variables alone, whatever the game's switches say.
  function settings(snapshot) {
    const variableRetry = snapshot.messages?.some(message => message.mvu?.pending && message.mvu?.variableRetry === true)
    return normalizeBackgroundTasks(variableRetry ? { variables: true, posture: false, characterDesign: false } : { ...snapshot.backgroundTasks, variables: true })
  }

  function target(snapshot) {
    return snapshot.mvu && snapshot.mvu.enabled === true && snapshot.mvu.owner === 'official'
      ? pendingMvuTarget(snapshot)
      : null
  }

  // Official MVU targets always settle; retired user switches cannot suppress them.
  function runs(mvuTarget) {
    return mvuTarget !== null
  }

  // The posture rides along in the same model call. Returns { deferred: true } when
  // the card runtime must apply the submission first, or { text, posture, mvuResult }.
  async function run({ snapshot, taskRun, card, signal, trace, backgroundTasksSettings, mvuTarget }) {
    const { mvuSettlement, mvuUpdateRules, backgroundModelSelection, postureItem, tavernScriptDispatch } = deps
    if (!mvuTarget.message.mvuBaseline || mvuTarget.message.mvuBaseline.swipeId !== mvuTarget.swipeId) {
      mvuTarget.message.mvuBaseline = { swipeId: mvuTarget.swipeId, variables: structuredClone(mvuTarget.variables) }
      await taskRun.checkpointMessage(mvuTarget.messageId, function (draft, target) {
        if (!target || Number(target.swipeId || 0) !== mvuTarget.swipeId
          || Number(draft.tavernHelperLifecycleRevision || 0) !== Number(snapshot.tavernHelperLifecycleRevision || 0)) throw new Error('MVU 任务目标已过期')
        target.mvuBaseline = structuredClone(mvuTarget.message.mvuBaseline)
      })
    }
    const saveDelivery = async function (submission, prepared) {
      signal?.throwIfAborted()
      await taskRun.checkpointMessage(mvuTarget.messageId, function (draft, target) {
        if (!target || Number(target.swipeId || 0) !== mvuTarget.swipeId
          || Number(draft.tavernHelperLifecycleRevision || 0) !== Number(snapshot.tavernHelperLifecycleRevision || 0)) throw new Error('MVU 任务目标已过期')
        target.mvu.pendingSubmission = structuredClone(submission)
        target.mvu.delivery = {
          version: 1, taskId: target.mvu.delivery?.taskId || taskRun.operationId, operationId: taskRun.operationId,
          branchId: taskRun.basedOn.branchId, revision: taskRun.basedOn.revision,
          lifecycleRevision: Number(snapshot.tavernHelperLifecycleRevision || 0),
          swipeId: mvuTarget.swipeId,
          posture: prepared?.posture ?? target.mvu.delivery?.posture,
          ...(providerOwner ? { provider: { owner: providerOwner }, auxiliaryPending: prepared ? false : providerAuxiliaryPending } : {}),
          ...(prepared ? { prepared: structuredClone({ submission: prepared.submission, receipt: prepared.receipt, effect: prepared.effect, posture: prepared.posture, ...(providerOwner ? { providerOwner } : {}) }) } : {})
        }
      })
    }
    const settlementInput = {
      onSubmission: submission => saveDelivery(submission),
      onPrepared: prepared => saveDelivery(prepared.submission, prepared),
      guidance: mvuTarget.message.mvu.guidance || '',
      onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
      backgroundTasks: backgroundTasksSettings,
      operationId: taskRun.operationId,
      chatId: snapshot.id,
      branchId: taskRun.basedOn.branchId,
      basedOnRevision: taskRun.basedOn.revision,
      sessionId: snapshot.sessionId,
      turn: settlementTurn(snapshot),
      messageId: mvuTarget.messageId,
      swipeId: mvuTarget.swipeId,
      expectedLifecycleRevision: Math.max(0, Number(snapshot.tavernHelperLifecycleRevision) || 0),
      storyText: projectAgentMessageText(mvuTarget.message, { charName: card && card.name, macroState: snapshot.macroState }),
      currentVariables: mvuTarget.variables,
      helperContext: collectMvuHelperContext(snapshot.messages, mvuTarget.messageId),
      guides: Array.isArray(snapshot.guides) ? snapshot.guides : [],
      variableSchema: mvuTarget.variables.schema,
      charName: card && card.name,
      macroState: snapshot.macroState,
      updateRules: await mvuUpdateRules(snapshot, card, mvuTarget),
      webSearchEnabled: snapshot.webSearchEnabled === true
    }
    const pendingSubmission = mvuTarget.message.mvu && mvuTarget.message.mvu.pendingSubmission
    const delivery = mvuTarget.message.mvu?.delivery
    let providerOwner = delivery?.provider?.owner || null
    let providerAuxiliaryPending = delivery?.auxiliaryPending === true
    if (delivery && (delivery.branchId !== taskRun.basedOn.branchId || delivery.revision !== taskRun.basedOn.revision
      || delivery.lifecycleRevision !== Number(snapshot.tavernHelperLifecycleRevision || 0) || delivery.swipeId !== mvuTarget.swipeId)) throw new Error('MVU 任务目标已过期，旧任务未执行')
    async function assertProviderActive(owner, stage) {
      if (!owner) return
      const active = await deps.pluginApi?.mvuProviderActive?.({ gameId: snapshot.sessionId, owner })
      if (active !== true) throw new Error('MVU provider 已卸载、停用或不再绑定当前卡，' + stage + '已取消')
    }
    async function finishProviderAuxiliary(result, { runAuxiliary = true } = {}) {
      if (['pending', 'stale', 'error', 'partial'].includes(result.receipt?.status)) return result
      await assertProviderActive(providerOwner, '结算提交')
      let posture
      let auxiliaryText = ''
      if (runAuxiliary && (backgroundTasksSettings.posture || backgroundTasksSettings.characterDesign)) {
        const selection = backgroundModelSelection(snapshot)
        if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
        const auxiliary = await mvuSettlement.settleAuxiliary({
          ...settlementInput, system: backgroundTasksSettings.posture ? postureItem.requirement() : '',
          selection, persistentSessionId: trace.sessionId, signal
        })
        posture = auxiliary.posture
        auxiliaryText = auxiliary.text
        trace.sessionId = auxiliary.traceSessionId || trace.sessionId
        trace.boundary = auxiliary.traceBoundary
      }
      await assertProviderActive(providerOwner, 'prepared 保存')
      result.posture = posture
      result.text = auxiliaryText
      if (providerOwner) result.providerOwner = providerOwner
      if (settlementInput.onPrepared) await settlementInput.onPrepared(structuredClone({ ...result, posture }))
      return result
    }
    let mvuResult
    if (delivery?.prepared) {
      if (delivery.provider) await assertProviderActive(delivery.provider.owner, '已准备的操作提交')
      mvuResult = structuredClone(delivery.prepared)
      if (!mvuResult.providerOwner && delivery.provider?.owner) mvuResult.providerOwner = delivery.provider.owner
    } else if (pendingSubmission && typeof pendingSubmission === 'object') {
      if (delivery?.provider) await assertProviderActive(delivery.provider.owner, '已保存的操作投递')
      mvuResult = await mvuSettlement.resumeVariables({
        ...settlementInput,
        ...(delivery?.provider ? { onPrepared: undefined } : {}),
        submission: pendingSubmission
      })
      if (delivery?.provider) mvuResult = await finishProviderAuxiliary(mvuResult, { runAuxiliary: delivery.auxiliaryPending === true })
    } else {
      const provider = deps.pluginApi?.mvuProvider
      let provided = null
      if (typeof provider === 'function') {
        const playerMessage = snapshot.messages.slice(0, mvuTarget.messageId).findLast(message => message?.role === 'user')
        const playerInput = playerMessage ? projectAgentMessageText(playerMessage, { charName: card?.name, macroState: snapshot.macroState }) : ''
        provided = await provider({
          gameId: snapshot.sessionId, turn: settlementInput.turn,
          input: playerInput, storyText: settlementInput.storyText,
          currentVariables: settlementInput.currentVariables, variableSchema: settlementInput.variableSchema,
          swipe: mvuTarget.swipeId, branch: taskRun.basedOn.branchId,
          lifecycleRevision: settlementInput.expectedLifecycleRevision,
          storageRevision: taskRun.basedOn.revision, signal
        })
      }
      if (provided !== null && provided !== false) {
        if (!provided || !Array.isArray(provided.operations)) throw new Error('MVU provider 返回值无效')
        if (typeof mvuSettlement.resumeProviderVariables !== 'function') throw new Error('MVU provider 缺少官方事务恢复入口')
        providerOwner = provided.owner
        providerAuxiliaryPending = backgroundTasksSettings.posture === true || backgroundTasksSettings.characterDesign === true
        await assertProviderActive(providerOwner, '官方事务派发')
        // onSubmission saves before dispatch. Delay onPrepared until auxiliary work
        // finishes so a restart resumes the durable submission without rerunning provider.
        mvuResult = await mvuSettlement.resumeProviderVariables({
          ...settlementInput,
          onPrepared: undefined,
          submission: { operations: provided.operations }
        })
        mvuResult = await finishProviderAuxiliary(mvuResult)
      } else {
        const selection = backgroundModelSelection(snapshot)
        if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
        mvuResult = await mvuSettlement.settleVariables({
          ...settlementInput,
          system: backgroundTasksSettings.posture ? postureItem.requirement() : '',
          selection,
          persistentSessionId: trace.sessionId,
          signal
        })
      }
    }
    if (mvuResult.posture === undefined && delivery?.posture !== undefined) mvuResult.posture = delivery.posture
    const text = str(mvuResult.text) || JSON.stringify({ posture: mvuResult.posture })
    trace.sessionId = str(mvuResult.traceSessionId) || trace.sessionId
    trace.boundary = Number.isSafeInteger(mvuResult.traceBoundary) ? mvuResult.traceBoundary : null
    if (mvuResult.receipt?.status === 'pending') {
      const runtimeState = tavernScriptDispatch.status(snapshot.sessionId)
      if (runtimeState.initializationError) throw new Error(runtimeState.initializationError)
      await taskRun.defer({
        participant: taskRun.participant({ sessionId: trace.sessionId, boundary: trace.boundary }),
        apply(draft) {
          const target = draft.messages[mvuTarget.messageId]
          target.mvu.pendingSubmission = structuredClone(mvuResult.submission || pendingSubmission)
          target.mvu.receipt = structuredClone(mvuResult.receipt)
          if (target.mvu.delivery && mvuResult.posture !== undefined) target.mvu.delivery.posture = mvuResult.posture
          draft.settleStatus = 'pending'
          draft.settleError = null
        }
      })
      return { deferred: true }
    }
    if (['error', 'partial'].includes(mvuResult.receipt?.status)) {
      const error = new Error(mvuResult.receipt.summary || mvuResult.receipt.failures?.[0]?.message || '变量结算失败，请重试结算')
      error.mvuReceipt = mvuResult.receipt
      throw error
    }
    return { text, posture: mvuResult.posture, mvuResult }
  }

  // The commit's MVU share: which messages it touches, whether the game state moved, and
  // what it writes into the reply.
  function completion({ mvuTarget, mvuResult }) {
    const changes = mvuResult?.effect?.changes || []
    return {
      messageIndices: mvuTarget && changes.every(c => c.path[0] !== 'messages' || Number.isInteger(c.path[1]))
        ? [mvuTarget.messageId, ...changes.filter(c => c.path[0] === 'messages').map(c => c.path[1])] : null,
      stateChanged: Boolean(changes.length) || Boolean(mvuResult && mvuResult.receipt && mvuResult.receipt.status === 'updated'),
      apply(draft, scope) {
        if (mvuResult?.providerOwner && deps.pluginApi?.mvuProviderRegistered?.(mvuResult.providerOwner) !== true) {
          throw new Error('MVU provider 已卸载，拒绝提交其变量效果')
        }
        if (mvuResult && mvuResult.effect) applyMvuSettlementEffect(draft, mvuResult.effect, scope)
        if (mvuResult !== null) {
          const target = draft.messages[mvuTarget.messageId]
          if (target && target.role === 'assistant' && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
            const receipt = structuredClone(mvuResult.receipt)
            target.mvu = {
              pending: false,
              modified: receipt.status === 'updated',
              diagnostics: receipt.status === 'stale' ? [{ message: receipt.summary }] : [],
              events: receipt.status === 'stale' ? [] : ['MESSAGE_RECEIVED'],
              receipt
            }
          }
        }
      }
    }
  }

  // A failed settlement closes the waiting reply's variables with an error receipt.
  // Returns whether the save had such a reply.
  function recordFailure(latest, error, message) {
    const mvuTarget = pendingMvuTarget(latest)
    if (mvuTarget === null) return false
    mvuTarget.message.mvu = {
      pending: false,
      modified: false,
      diagnostics: [{ message }],
      events: [],
      receipt: error?.mvuReceipt ? structuredClone(error.mvuReceipt) : { version: 1, status: 'error', summary: '', changes: [], failures: [{ command: '', message }] }
    }
    return true
  }

  // The player retries the latest reply's settlement. Not an official MVU game: 'none'.
  // A waiting delivery is sent again as it was ('redeliver'); otherwise the reply's
  // variables restart from their baseline ('reset', written into target.message.mvu).
  function prepareRetry({ chat, target, guidance, activity }) {
    if (!(chat.mvu && chat.mvu.enabled === true && chat.mvu.owner === 'official')) return 'none'
    if (!target.message.mvu) throw new Error('当前最新正文没有可重试的变量结算')
    if (target.message.mvu.receipt?.status === 'pending') {
      if (str(guidance).trim()) throw new Error('等待中的任务只能重新投递，不能追加指导意见重新生成变量计划')
      if (!target.message.mvu.pendingSubmission && !target.message.mvu.delivery?.prepared) throw new Error('当前任务尚未保存可重新投递的变量操作，请等待或停止后台任务')
      if (activity.phase !== 'pending') throw new Error('等待中的结算状态已经变化，请刷新后重试')
      // Reuse the durable submission/effect and the existing per-chat job.
      // Never reset MVU state or request another model plan on redelivery.
      return 'redeliver'
    }
    const swipeId = Math.max(0, Number(target.message.swipeId) || 0)
    if (!target.message.mvuBaseline || target.message.mvuBaseline.swipeId !== swipeId) {
      if (['updated', 'unchanged', 'partial'].includes(target.message.mvu.receipt?.status)) {
        throw new Error('这轮旧记录没有结算前快照，无法安全重新结算变量')
      }
    }
    target.message.mvu = { pending: true, variableRetry: true, guidance: guidance === undefined ? str(target.message.mvu?.guidance).trim() : str(guidance).trim(), modified: false, diagnostics: [], events: [] }
    return 'reset'
  }

  return Object.freeze({ settings, target, runs, run, completion, recordFailure, prepareRetry })
}
