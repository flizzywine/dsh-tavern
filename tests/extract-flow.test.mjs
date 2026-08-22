import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('卡片模式从空白工作台直接进入 Agent 对话', () => {
  const flow = between(clientSource, 'async function newCardConversation', 'function formatTime')

  assert.doesNotMatch(flow, /window\.prompt/)
  assert.match(flow, /call\("getResourceWorkspace"\)/)
  assert.match(serverSource, /case 'getResourceWorkspace': return \{ path: base \+ '\/data\/resources' \}/)
  assert.match(flow, /props\.workspaces\.create\(\{ path: resourceRoot\.path \}\)/)
  assert.match(flow, /props\.workspaces\.connectWorkspace\(resourceWorkspace\.workspaceId\)/)
  assert.doesNotMatch(flow, /connectWorkspace\(workspaceId\)/)
  assert.match(flow, /call\("startChat", \{ path: card && card\.path \? card\.path : "", sessionId: sessionId, mode: "card" \}\)/)
  assert.match(flow, /publishSessionMode\(sessionId, "card"\)/)
  assert.match(flow, /props\.openCardLibraryTab\(sessionId\)/)
  assert.match(flow, /props\.openResourcesTab\(sessionId\)/)
  assert.ok(flow.indexOf('props.openCardLibraryTab(sessionId)') < flow.indexOf('props.openResourcesTab(sessionId)'))
})

test('新建对话不会重复切换已经是 Tavern preset 的 Session', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')
  const guard = between(sidebar, 'async function ensureTavernPreset', 'async function newConversation')
  const playFlow = between(sidebar, 'async function newConversation', 'async function importCard')
  const cardFlow = between(sidebar, 'async function newCardConversation', 'function formatTime')

  assert.match(guard, /props\.sessions\.list\.getSnapshot\(\)\.byId\[sessionId\]/)
  assert.match(guard, /if \(summary && summary\.agentPreset === "tavern"\) return;/)
  assert.match(guard, /agentPresets\.select/)
  assert.match(playFlow, /await ensureTavernPreset\(sessionId\)/)
  assert.match(cardFlow, /await ensureTavernPreset\(sessionId\)/)
  assert.doesNotMatch(playFlow, /agentPresets\.select/)
  assert.doesNotMatch(cardFlow, /agentPresets\.select/)
})

test('新开游玩在创建 Session 前选择开场白，创建后不提供切换器', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')
  const prepareFlow = between(sidebar, 'async function preparePlayConversation', 'async function importCard')

  assert.match(sidebar, /getCardOpenings/)
  assert.match(sidebar, /选择开场白/)
  assert.match(sidebar, /上一条开场白/)
  assert.match(sidebar, /下一条开场白/)
  assert.match(sidebar, /以此开场/)
  assert.match(sidebar, /preparePlayConversation\(card\)/)
  assert.doesNotMatch(prepareFlow, /connectWorkspace|startChat/)
  assert.match(sidebar, /newConversation\(openingPicker\.card, null, selectedOpening\.id\)/)
  assert.match(sidebar, /openingId: openingId \|\| ""/)
  assert.match(sidebar, /dsh-tavern-picker-overlay/)
  assert.match(sidebar, /role: "dialog"/)
  assert.doesNotMatch(clientSource, /OpeningSwitcher|OpeningTurnTail|switchOpening|dsh-tavern-opening|createPortal|MutationObserver/)
})

test('卡片模式通过修改、抽取人物卡、抽取破甲和空白四个入口进入同一个 Agent', () => {
  const flow = between(clientSource, 'async function newCardConversation', 'function formatTime')

  assert.match(clientSource, /"修改人物卡"/)
  assert.match(clientSource, /"从资料新建人物卡"/)
  assert.match(clientSource, /"从预设提取破甲"/)
  assert.match(clientSource, /"空白开始"/)
  assert.match(flow, /mode: "card"/)
  assert.match(flow, /if \(task\) await props\.injectTaskPrompt\(sessionId, task, label, card, \(selectedResources \|\| \[\]\)\.length > 0\)/)
  assert.doesNotMatch(clientSource, /startExtract|newExtractSession|"revision"|mode: "extract"/)
  assert.doesNotMatch(clientSource, /attachSourcesToCurrent|attachCardToCurrent/)
  assert.match(clientSource, /return values\[sessionId\] \|\| "";/)
})

test('人物卡抽取使用资料库，破甲抽取使用预设库，并自动追加引用', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')
  const flow = between(sidebar, 'async function newCardConversation', 'function formatTime')

  assert.match(sidebar, /async function openResourcePicker\(task\)/)
  assert.match(sidebar, /task === "boundary" \? "listPresets" : "listResources"/)
  assert.match(sidebar, /kind: task === "boundary" \? "preset" : "source"/)
  assert.match(sidebar, /initialResourceGroup\(cardEntry === "boundary" \? "预设" : "资料", initialResources\)/)
  assert.doesNotMatch(sidebar, /initialResourceGroup\("素材"/)
  assert.doesNotMatch(sidebar, /initialResourceGroup\("已绑定剧本"/)
  assert.match(sidebar, /disabled: busy \|\| !chosenInitialResources\.length/)
  assert.match(sidebar, /newCardConversation\(null, "extract", "从资料新建人物卡", chosenInitialResources\)/)
  assert.match(sidebar, /newCardConversation\(null, "boundary", "从预设提取破甲", chosenInitialResources\)/)
  assert.match(flow, /\(selectedResources \|\| \[\]\)\.forEach/)
  assert.match(flow, /props\.appendMention\(sessionId, resource\.kind, resource\.path, resource\.title\)/)
  assert.match(sidebar, /先选择至少一项预设，再进入工作台/)
  assert.doesNotMatch(sidebar, /newCardConversation\(null, "extract", "从素材新建人物卡"\);/)
})

test('卡片任务只在创建对话时追加提示词，不占用输入框上方区域', () => {
  assert.match(clientSource, /rpc\("getCardTaskPrompt", \{ task: task \}, sessionId\)/)
  assert.match(clientSource, /【目标人物卡】/)
  assert.match(clientSource, /card && card\.path/)
  assert.match(clientSource, /@\\"/)
  assert.match(clientSource, /input\.setDraft\(taskText \+ supplement\)/)
  assert.match(clientSource, /task === "boundary" \? "\\n\\n【初始预设】\\n" : "\\n\\n【初始资料】\\n"/)
  assert.doesNotMatch(clientSource, /【补充要求】/)
  assert.doesNotMatch(clientSource, /function CardTaskDockActions/)
  assert.doesNotMatch(clientSource, /id: "dsh-tavern-card-tasks"/)
  assert.doesNotMatch(clientSource, /choose\("bindScript"/)
})

test('空白工作台确认后自动创建人物卡，不再提供二次保存按钮', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')

  assert.doesNotMatch(clientSource, /CardDraftPanel|finalizeCard|保存为新人物卡|写入草稿/)
  assert.doesNotMatch(serverSource, /case 'finalizeCard'/)
  assert.match(sidebar, /const currentSummary = current \? summaries\[current\] : null;/)
  assert.match(sidebar, /if \(!currentSummary \|\| currentSummary\.blank\) return;\s*notifyDataChanged\(\);/)
})

test('Tavern 只接管会话区域，保留 DSH 原生设置与模型配置入口', () => {
  assert.match(clientSource, /slots\.inject\("sidebar\.workspaces"/)
  assert.doesNotMatch(clientSource, /slots\.inject\("sidebar",/)
})

test('游玩不提供多开场白切换器', () => {
  assert.doesNotMatch(clientSource, /OpeningSwitcher|OpeningTurnTail|switchOpening|dsh-tavern-opening|createPortal|MutationObserver/)
})

test('酒馆状态页注册到 Better Sidebar，不再接管 DSH details', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function CardFieldsPanel')

  assert.match(sidebar, /readyTavernSession/)
  assert.match(sidebar, /summaries\[current\]\.blank === false/)
  assert.match(sidebar, /history\.some\(function \(entry\) \{ return entry\.sessionId === current && isPlayMode\(entry\.mode\); \}\)/)
  assert.match(sidebar, /props\.openStatusTab\(readyTavernSession\)/)
  assert.match(clientSource, /ctx\.betterSidebar\.registerTab\(\{/)
  assert.match(clientSource, /id: "dsh-tavern:status"/)
  assert.match(clientSource, /ctx\.betterSidebar\.openTab\(\{ type: "dsh-tavern:status" \}/)
  assert.doesNotMatch(clientSource, /slots\.inject\("details"|openDetails|ensureDetailsOpen/)
})

test('破甲侧栏只负责文件查看、选择、删除和当前会话开关', () => {
  const panel = between(clientSource, 'function BoundaryPromptTab', 'function TavernStatusPanel')

  assert.match(clientSource, /id: "dsh-tavern:boundary-prompts"/)
  assert.match(clientSource, /title: "破甲库"/)
  assert.match(panel, /rpc\("listBoundaryPrompts"/)
  assert.match(panel, /rpc\("selectBoundaryPrompt"/)
  assert.match(panel, /rpc\("deleteBoundaryPrompt"/)
  assert.match(panel, /当前会话的所有模型任务/)
  assert.match(panel, /制作、提取和修改请进入卡片工作台/)
  assert.doesNotMatch(panel, /saveBoundaryPrompt|inspectBoundaryPreset|importBoundaryPreset|导入酒馆预设/)
  assert.doesNotMatch(panel, /人物卡.*写入|updateCard/)
})

test('预设库独立导入并按原始顺序只读展示提示词条目', () => {
  const panel = between(clientSource, 'function PresetLibraryTab', 'function CardLibraryTab')

  assert.match(clientSource, /id: "dsh-tavern:presets"/)
  assert.match(clientSource, /title: "预设库"/)
  assert.match(panel, /rpc\("listPresets"/)
  assert.match(panel, /rpc\("getPreset"/)
  assert.match(panel, /rpc\("importPreset"/)
  assert.match(panel, /rpc\("deletePreset"/)
  assert.match(panel, /SYSTEM|role\.toUpperCase/)
  assert.match(panel, /占位/)
  assert.match(panel, /已启用|已关闭/)
  assert.match(panel, /正则脚本/)
  assert.match(panel, /regexScripts/)
  assert.match(panel, /查找正则/)
  assert.match(panel, /替换内容/)
  assert.match(serverSource, /regexCount: preset\.regexCount/)
  assert.match(serverSource, /enabledRegexCount: preset\.enabledRegexCount/)
  assert.match(panel, /props\.appendMention\("preset", item\.path, item\.title\)/)
  assert.doesNotMatch(panel, /updatePreset|exportPreset|dragstart|draggable/)
})

test('卡片模式预加载四个库，并让资料库保持选中', () => {
  assert.match(clientSource, /readyCardSession/)
  assert.match(clientSource, /props\.openCardLibraryTab\(readyCardSession\)/)
  assert.match(clientSource, /props\.openResourcesTab\(readyCardSession\)/)
  assert.match(clientSource, /props\.openPresetLibraryTab\(readyCardSession\)/)
  assert.match(clientSource, /props\.openBoundaryLibraryTab\(readyCardSession\)/)
  assert.ok(clientSource.indexOf('props.openCardLibraryTab(readyCardSession)') < clientSource.indexOf('props.openResourcesTab(readyCardSession)'))
  assert.match(clientSource, /openCardLibraryTab: function \(sessionId\) \{ ctx\.betterSidebar\.openTab\(\{ type: "dsh-tavern:cards" \}/)
  assert.match(clientSource, /ctx\.betterSidebar\.updateTab\("dsh-tavern:cards", \{ meta: null \}\)/)
  assert.match(clientSource, /registerTab\(\{\s*id: "dsh-tavern:resources"/)
  assert.match(clientSource, /id: "dsh-tavern:resources",\s*title: "资料库"/)
  assert.match(clientSource, /function reconcileLibraryTabTitles\(\)/)
  assert.match(clientSource, /"dsh-tavern:resources": "资料库"/)
  assert.match(clientSource, /subscribeState\(reconcileLibraryTabTitles\)/)
  assert.match(clientSource, /openTab\(\{ type: "dsh-tavern:resources" \}/)
  assert.doesNotMatch(clientSource, /openTab\(\{ type: "editor", id: "dsh-tavern:files"/)
  assert.match(clientSource, /group\("资料", "source", resources\.resources/)
  assert.doesNotMatch(clientSource, /group\("素材", "source"/)
  assert.doesNotMatch(clientSource, /group\("剧本", "script"/)
  assert.match(clientSource, /const mention = "@\\\"" \+ safePath \+ "\\\""/)
  assert.doesNotMatch(clientSource, /const mention = "@\["/)
  assert.match(clientSource, /body\.dsh-tavern-shell-active \[data-ref-chip="file"\].*max-width: calc\(100% - 4px\).*text-overflow: ellipsis/s)
  assert.match(clientSource, /rpc\("importSource"/)
  assert.match(clientSource, /已绑定：/)
  assert.match(clientSource, /未绑定/)
  assert.match(clientSource, /ctx\.betterSidebar\.openFile\(\{ sessionId: props\.scope\.sessionId \}, path, title\)/)
  assert.match(clientSource, /props\.openResource\(item\.previewPath, label\)/)
  assert.match(clientSource, /function parseTextResourceFile/)
  assert.match(clientSource, /\.txt,\.md,\.json,\.epub/)
  assert.match(clientSource, /application\/epub\+zip/)
})

test('人物卡库可以查看详情，并在当前卡片对话中引用人物卡', () => {
  const library = between(clientSource, 'function CardLibraryTab', 'function CardFieldsPanel')

  assert.match(library, /loadCard\(item\.path\)/)
  assert.match(library, /在对话中引用/)
  assert.match(library, /props\.appendMention\(item\.path, item\.name\)/)
  assert.match(clientSource, /在对话中引用/)
  assert.match(clientSource, /requestedPath/)
  assert.match(clientSource, /loadCard\(requestedPath\)/)
})

test('人物卡库通过列表进入详情并复用基本信息、剧本和世界书编辑', () => {
  assert.match(clientSource, /id: "dsh-tavern:cards",\s*title: "人物卡库"/)
  assert.match(clientSource, /function CardLibraryTab/)
  assert.match(clientSource, /rpc\("getCard", \{ path: path \}\)/)
  assert.match(clientSource, /"基本信息"/)
  assert.match(clientSource, /"选择已有资料"/)
  assert.match(clientSource, /call\("bindScript"/)
  assert.match(clientSource, /"导入新资料并绑定"/)
  assert.match(serverSource, /Object\.assign\(\{\}, info, \{ path: script\.path \}\)/)
  assert.match(clientSource, /className: "dsh-tavern-script-hero"/)
  assert.match(clientSource, /绑定剧本后，新开的游玩对话会自动进入剧本模式/)
  assert.match(clientSource, /更换或解绑会影响所有使用这张人物卡的剧本对话/)
  assert.match(clientSource, /"世界书 · " \+ activeWorldBookEntries\.length/)
  assert.match(clientSource, /"重命名文件"/)
  assert.match(clientSource, /"导出"/)
  assert.match(clientSource, /"删除"/)
})

test('人物卡全部字段合并在默认展开的基本信息中，并位于世界书上方', () => {
  const panel = between(clientSource, 'function CardFieldsPanel', 'function TavernStatusPanel')
  const basic = panel.indexOf('h("summary", null, "基本信息")')
  const alternateGreetings = panel.indexOf('F("alternate_greetings"')
  const creatorNotes = panel.indexOf('F("creator_notes"')
  const worldBook = panel.indexOf('h("summary", null, "世界书 · "')

  assert.ok(basic >= 0)
  assert.ok(alternateGreetings > basic)
  assert.ok(creatorNotes > alternateGreetings)
  assert.ok(worldBook > creatorNotes)
  assert.doesNotMatch(panel, /h\("summary", null, "高级字段"\)/)
})

test('常驻世界书条目不显示无效的名称输入框', () => {
  assert.doesNotMatch(clientSource, /名称（常驻条目）/)
  assert.match(clientSource, /entry\.constant === true \? null : editingWorldBookKey === index/)
})

test('非常驻条目按需展开触发词编辑并省略内容标签', () => {
  assert.match(clientSource, /"触发：" \+ entry\.keysText : "＋ 设置触发词（未设置不加载）"/)
  assert.match(clientSource, /setEditingWorldBookKey\(index\)/)
  assert.match(clientSource, /placeholder: "触发词，逗号分隔"/)
  assert.doesNotMatch(clientSource, /h\("label", null, "内容"\)/)
})

test('世界书按展示顺序排列并说明 DSH 常驻上限', () => {
  assert.match(clientSource, /extensions && a\.entry\.extensions\.display_index/)
  assert.match(clientSource, /常驻每轮自动加载，DSH 按展示顺序最多加载 10 条/)
  assert.match(clientSource, /worldBookGroup\("常驻", constantEntries, constantEntries\.length > 10 \? "按展示顺序加载前 10 条"/)
  assert.match(clientSource, /worldBookGroup\("非常驻", triggeredEntries\)/)
  assert.doesNotMatch(clientSource, /关键词触发/)
})

test('酒馆状态页等待会话绑定就绪后自动刷新', () => {
  const statusTab = between(clientSource, 'function TavernStatusTab', 'const candidatePanel')

  assert.match(statusTab, /props\.sessions\.list\.subscribe/)
  assert.match(statusTab, /props\.sessions\.binding\(props\.sessionId\)/)
})

test('酒馆状态只服务游玩模式，卡片工作台面板暂不复用该侧栏', () => {
  const status = between(clientSource, 'function TavernStatusPanel', 'function TavernStatusTab')
  assert.match(status, /if \(view\.mode === "card"\) return null;/)
})

test('剧本预览只显示当前召回和后续块', () => {
  assert.match(clientSource, /index === 0 \? "当前召回" : "后续"/)
  assert.doesNotMatch(clientSource, /上一块（已召回）|当前待召回|scriptPreview\.previous/)
})
