import { generateSchema, cleanUpMetadata } from './mvu-schema.generated.js'
import { createHash, randomUUID } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { createServerTemplateRuntime } from './server-template-runtime.js'
import { projectFullPromptTemplateState } from './full-prompt-template-state.js'
import { applyTemplateStateChanges } from './template-state-patch.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { inspectWorldBookDocument, exportSillyTavernWorldBook } from './worldbook-resource.js'
import { statusViewDeclaration } from './status-view-declaration.js'
import { projectTavernHelperWorldbook } from './tavern-helper-worldbook.js'
import { projectPersistentStatusView } from './persistent-status-view.js'

const clone = value => structuredClone(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function pointer(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/') throw Error('变量迁移路径必须是 /字段 形式')
  const parts = value.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (parts.some(part => !part || forbidden.has(part))) throw Error('变量迁移路径无效')
  return parts
}
function location(root, path, create = false) {
  const parts = pointer(path), key = parts.pop()
  let parent = root
  for (const part of parts) {
    if (Array.isArray(parent)) throw Error('数组内字段迁移需要单独的迁移方案：' + path)
    if (create && object(parent) && !Object.hasOwn(parent, part)) parent[part] = {}
    if (!object(parent) || !Object.hasOwn(parent, part)) return {}
    parent = parent[part]
  }
  if (Array.isArray(parent)) throw Error('数组内字段迁移需要单独的迁移方案：' + path)
  return object(parent) ? { parent, key } : {}
}
function migrate(data, operations) {
  for (const op of operations) {
    if (!['move', 'remove', 'convert'].includes(op.op)) throw Error('变量迁移仅支持 move、remove、convert')
    const source = location(data, op.op === 'move' ? op.from : op.path)
    pointer(op.path)
    if (!source.parent || !Object.hasOwn(source.parent, source.key)) continue // field may not exist in an earlier turn
    const value = source.parent[source.key]
    if (op.op === 'move') {
      if (op.path === op.from || op.path.startsWith(op.from + '/')) throw Error('变量迁移目标不能位于原字段内部')
      const target = location(data, op.path, true)
      if (!target.parent || Object.hasOwn(target.parent, target.key)) throw Error('变量迁移目标已存在：' + op.path)
      target.parent[target.key] = value; delete source.parent[source.key]
    } else if (op.op === 'remove') delete source.parent[source.key]
    else {
      let next
      if (op.type === 'string' && ['string', 'number', 'boolean'].includes(typeof value)) next = String(value)
      else if (op.type === 'number' && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))) next = Number(value)
      else if (op.type === 'boolean' && [true, false, 'true', 'false'].includes(value)) next = value === true || value === 'true'
      else throw Error('变量无法无损转换：' + op.path + ' → ' + op.type)
      source.parent[source.key] = next
    }
  }
}
function fillMissing(current, defaults, path = '') {
  for (const [key, value] of Object.entries(defaults)) {
    if (forbidden.has(key)) throw Error('初始变量包含不支持的字段：' + key)
    if (key === '$meta') { current[key] = clone(value); continue }
    const next = path + '/' + key
    if (!Object.hasOwn(current, key)) current[key] = clone(value)
    else if (object(value) && object(current[key])) fillMissing(current[key], value, next)
    else if (value !== null && (Array.isArray(value) !== Array.isArray(current[key]) || typeof value !== typeof current[key] || (object(value) && !object(current[key])))) {
      throw Error('变量类型已变化，请在人物卡 stateMigrations 中声明迁移：' + next)
    }
  }
}
function validatePlans(plans) {
  if (!Array.isArray(plans) || plans.length > 100) throw Error('stateMigrations 必须是数组，最多 100 项')
  const ids = new Set()
  for (const plan of plans) {
    if (!object(plan) || !plan.id || typeof plan.id !== 'string' || forbidden.has(plan.id) || ids.has(plan.id) || !Array.isArray(plan.operations)) throw Error('每项变量迁移需要唯一 id 和 operations')
    ids.add(plan.id)
    for (const operation of plan.operations) {
      if (!object(operation) || !['move','remove','convert'].includes(operation.op)) throw Error('变量迁移仅支持 move、remove、convert')
      pointer(operation.path)
      if (operation.op === 'move') pointer(operation.from)
      if (operation.op === 'convert' && !['string','number','boolean'].includes(operation.type)) throw Error('不支持的变量转换类型')
    }
  }
}
/** Only card-authored, declarative migrations execute; arbitrary JS never rewrites saves. */
export function migrateCardSnapshots(chat, defaults, plans = [], removedPaths = []) {
  validatePlans(plans)
  let count = 0
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (object(value.stat_data) && Object.hasOwn(value, 'schema')) {
      const beforeData = hash(value.stat_data)
      const done = value.dshCardMigrations || {}
      if (plans.length) value.dshCardMigrations = done
      for (const plan of plans) {
        const digest = hash(plan)
        if (done[plan.id]) { if (done[plan.id] !== digest) throw Error('已执行的迁移不可修改，请使用新 id：' + plan.id); continue }
        migrate(value.stat_data, plan.operations)
        // Move/remove schema paths in parallel; conversion replaces the affected schema only.
        const schemaPath = path => '/' + pointer(path).flatMap(key => ['properties', key.replace(/~/g, '~0').replace(/\//g, '~1')]).join('/')
        for (const op of plan.operations) {
          if (op.op === 'convert') {
            const target = location(value.schema, schemaPath(op.path))
            if (target.parent) target.parent[target.key] = { ...target.parent[target.key], type: op.type }
          } else migrate(value.schema, [{ ...op, path: schemaPath(op.path), ...(op.from ? {from: schemaPath(op.from)} : {}) }])
        }
        done[plan.id] = digest
      }
      // Only remove fields deleted from the previous definition, never dynamic save-only data.
      migrate(value.stat_data, removedPaths.map(path => ({op: 'remove', path})))
      fillMissing(value.stat_data, defaults)
      value.schema = {...value.schema,...generateSchema(clone(value.stat_data), value.schema)}
      for (const key of ['strictTemplate','concatTemplateArray','strictSet']) if (Object.hasOwn(defaults.$meta || {},key)) value.schema[key] = defaults.$meta[key]
      cleanUpMetadata(value.stat_data)
      if (hash(value.stat_data) !== beforeData) {
        value.display_data = clone(value.stat_data)
        value.delta_data = {}
      }
      count++; return
    }
    for (const child of Object.values(value)) visit(child)
  }
  // Include timeline checkpoints and undo data so rollback keeps compatible snapshots.
  for (const key of ['messages', 'timeline', 'rollbackUndo', 'variables', 'promptTemplateInput']) visit(chat[key])
  return count
}

// Refresh initialization metadata only; authored story text and earned state remain intact.
function refreshOpeningInitvar(chat, states) {
  const rewrite=(text,index)=>{
    if(typeof text!=='string'||!/<initvar>[\s\S]*?<\/initvar>/i.test(text))return text
    const state=states[index]
    if(!state)return text
    const block='<initvar>\n'+JSON.stringify(state,null,2).replace(/</g,'\\u003c')+'\n</initvar>'
    return text.replace(/<initvar>[\s\S]*?<\/initvar>/gi,()=>block)
  }
  function visit(value) {
    if(!value||typeof value!=='object')return
    if(value.greeting===true){
      const index=value.swipeId||0
      for(const key of ['text','sourceText','projectionText','displayText','templateInputSource'])if(typeof value[key]==='string')value[key]=rewrite(value[key],index)
      if(Array.isArray(value.swipes))value.swipes=value.swipes.map((text,index)=>rewrite(text,index))
      return
    }
    for(const child of Object.values(value))visit(child)
  }
  for(const key of ['messages','timeline','rollbackUndo','promptTemplateInput'])visit(chat[key])
}

/** Preview executes with detached state and an RPC allowlist, never the live session. */
export function createLiveCardUpdate({readGlobals = async () => ({}), readWorldBook} = {}) {
  const previews = new Map(), cache = new Map()
  const runtime = createServerTemplateRuntime({ readOnly: true, maxSessions: 2, timeoutMs: 15000, rpc: async (method, args) => {
    const snapshot = previews.get(args.sessionId)
    if (!snapshot) throw Error('人物卡更新预览已结束')
    if (method === 'getFullPromptTemplateState') return clone(snapshot)
    if (method === 'saveFullPromptTemplateState') {
      snapshot.state = Array.isArray(args.state?.changes) ? applyTemplateStateChanges(snapshot.state, args.state.changes) : clone(args.state)
      return { updated: true, state: clone(snapshot.state) }
    }
    if (method === 'saveFullPromptTemplateSettings') { snapshot.environment.extension_settings.EjsTemplate = clone(args.settings); return {updated:true,settings:args.settings} }
    if (method === 'saveFullPromptTemplateGlobals') { snapshot.environment.extension_settings.variables.global = clone(args.variables); return {updated:true,variables:args.variables} }
    if (method === 'countFullTemplateTokens') return {tokens: Math.ceil(args.text.length / 3)}
    if (method === 'getFullTemplateWorldbook') {
      const books = snapshot.environment.worldbooks, book = books[args.name] || (args.name === 'current' ? Object.values(books)[0] : undefined)
      if (!book) throw Error('预览中未绑定此世界书：' + args.name)
      return {worldbook:projectTavernHelperWorldbook(inspectWorldBookDocument(book))}
    }
    throw Error('更新预览不能执行外部写入或命令：' + method)
  } })
  // A game that keeps no copy reads the live library; only a frozen game uses its own.
  async function worldbookDocument(chat, card) {
    if (chat.openingWorldbookSnapshot?.document !== undefined) return chat.openingWorldbookSnapshot.document
    if (typeof readWorldBook !== 'function' || !chat.cardPath) return card.character_book
    const record = await readWorldBook(chat, card).catch(() => null)
    return record?.document ?? record?.view?.raw ?? card.character_book
  }

  async function preview(chat, card, action, globals = undefined) {
    globals ??= await readGlobals()
    const id = 'card-update:' + randomUUID(), world = card.name || 'card'
    const document = await worldbookDocument(chat, card)
    const state = projectFullPromptTemplateState(chat)
    state.sessionId = id
    const snapshot = { state, environment: {
      characters: [{...clone(card),data:{...clone(card),extensions:{...card.extensions,world}}}],this_chid:'0',name1:chat.macroState?.userName || '你',name2:card.name,
      world_names:[world],selected_world_info:[],worldbooks:{[world]:document ? exportSillyTavernWorldBook(document) : {entries:{}}},
      extension_settings:{EjsTemplate:{enabled:true},variables:{global:clone(globals)}},dsh:{regexScripts:[],settling:false}
    } }
    previews.set(id, snapshot)
    try {
      const engine = runtime.forSession(id)
      const scopes = {global:clone(globals),local:clone(chat.variables || {}),initial:clone(chat.promptTemplateInitialVariables || {}),message:lastTavernHelperVariables(chat.messages) || {}}
      return await action(async template => {
        const result = await engine.renderProjection(template, {scopes,runType:'render'})
        if (!result.ok) throw Error('人物卡模板预检失败：' + result.error)
        return result.text
      })
    } finally { runtime.cancel(id); previews.delete(id) }
  }
  async function initialDefaults(chat, card) {
    const document = await worldbookDocument(chat, card)
    const entries = document ? inspectWorldBookDocument(document).entries.filter(entry => entry.enabled && /\[initvar\]/i.test(entry.comment || entry.title)) : []
    // Match the selected opening, not necessarily first_mes.
    const greeting = chat.messages.find(message => message.greeting)
    const openings = [card.first_mes, ...(card.alternate_greetings || [])]
    const opening = openings[greeting?.swipeId || 0] || card.first_mes || ''
    const block = String(opening).match(/<initvar>([\s\S]*?)<\/initvar>/i)
    const sources = block ? [block[1]] : entries.map(entry => entry.content)
    return await preview(chat, card, async render => {
      let value = {}
      for (let source of sources) {
        if (source.includes('<%')) source = await render(source)
        source = source.replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').trim()
        if (!source) continue
        const parsed = parseYaml(source, {maxAliasCount:50})
        if (!object(parsed)) throw Error('人物卡初始变量必须为对象')
        value = {...value,...parsed}
      }
      return value
    })
  }
  async function prepare(chat, card, previous) {
    const defaults = await initialDefaults(chat, card)
    const plans = card.extensions?.dsh_tavern?.stateMigrations || []
    validatePlans(plans)
    let unchanged = false
    const removedPaths = []
    // Older saves may lack the full card definition but still retain the opening
    // worldbook. Use that historical definition, never the edited library, as baseline.
    const oldDefinition = previous?.cardDefinitionSnapshot || (previous?.openingWorldbookSnapshot?.document
      ? {...card,first_mes:previous.messages.find(message => message.greeting)?.sourceText || '',alternate_greetings:[]} : null)
    if (oldDefinition) {
      const oldDefaults = previous.cardStateDefaults || await initialDefaults(previous, oldDefinition)
      unchanged = hash(oldDefaults) === hash(defaults) && hash(previous.cardDefinitionSnapshot?.extensions?.dsh_tavern?.stateMigrations || []) === hash(plans)
      const oldShape = clone(oldDefaults)
      for (const plan of plans) if (!previous.cardStateMigrationIds?.includes(plan.id)) migrate(oldShape, plan.operations)
      function collectRemoved(old, next, path = '') {
        for (const [key, value] of Object.entries(old)) {
          if (key === '$meta') continue
          const childPath = path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')
          if (!Object.hasOwn(next, key)) removedPaths.push(childPath)
          else if (object(value) && object(next[key])) collectRemoved(value, next[key], childPath)
        }
      }
      collectRemoved(oldShape, defaults)
    }
    const migrated = clone(chat)
    // Explicit resource reload refreshes ordinary display formatting. Keep real
    // template output and processing markers: replaying EJS could repeat effects.
    for (const message of migrated.messages || []) {
      if (typeof message.tavernPluginData?.template_display?.formattingText === 'string') {
        delete message.tavernPluginData.template_display
      }
    }
    migrated.cardStateDefaults = clone(defaults)
    migrated.cardStateMigrationIds = plans.map(plan => plan.id)
    const selected=chat.messages.find(message=>message.greeting)?.swipeId||0
    const states=[];states[selected]=defaults
    const greeting=chat.messages.find(message=>message.greeting)
    for(let index=0;index<(greeting?.swipes?.length||0);index++)if(index!==selected){
      states[index]=await initialDefaults({...chat,messages:[{greeting:true,swipeId:index}]},card)
    }
    refreshOpeningInitvar(migrated,states)
    if (unchanged) return migrated
    const count = migrateCardSnapshots(migrated, defaults, plans, removedPaths)
    if ((Object.keys(defaults).length && chat.mvu?.enabled || plans.length || removedPaths.length) && !count) throw Error('当前存档缺少可迁移的 MVU 快照，未应用更新')
    return migrated
  }
  const liveStatusRule = rule => rule.enabled !== false && !rule.disabled && statusViewDeclaration(rule) && /<%/.test(rule.replaceString)
  const needsHistory = (chat, options) => !!chat.cardContextRevision && (options.regexScripts || []).some(liveStatusRule)
  async function project(chat, card, display, options) {
    const rules = options.regexScripts || []
    if (!needsHistory(chat, options)) return display
    const vars = lastTavernHelperVariables(chat.messages)
    const globals = await readGlobals()
    const key = hash([globals,chat.id,chat.cardContextRevision,rules,vars,chat.variables,chat.openingWorldbookSnapshot,chat.messages.at(-1)?.turn])
    let pending = cache.get(key)
    if (!pending) {
      pending = preview(chat, card, async render => {
        const rendered = []
        for (const rule of rules) rendered.push(liveStatusRule(rule) ? {...rule,replaceString:await render(rule.replaceString)} : rule)
        return rendered
      }, globals)
      cache.set(key,pending)
      pending.catch(() => cache.delete(key))
      while(cache.size > 8) cache.delete(cache.keys().next().value)
    }
    const rendered = await pending
    // Remove the authored status fragment before projecting its rendered form.
    // Their contents differ for EJS; matching only rendered HTML leaks raw EJS into prose.
    const cleaned = projectPersistentStatusView(chat.messages, display.projections, {...options,allowStaticStatus:true})
    return {...display,...projectPersistentStatusView(chat.messages, cleaned.projections, {...options,regexScripts:rendered,allowStaticStatus:true})}
  }
  return {prepare,project,needsHistory,dispose:()=>runtime.dispose()}
}
