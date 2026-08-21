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

test('新开游玩直接进入对话，不提供多开场白切换器', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')

  assert.doesNotMatch(sidebar, /getCardOpenings|openingChoices|openingCard|选择开场白/)
  assert.match(sidebar, /onClick: function \(\) \{ newConversation\(card\); \}/)
  assert.doesNotMatch(clientSource, /OpeningSwitcher|OpeningTurnTail|switchOpening|dsh-tavern-opening|createPortal|MutationObserver/)
})

test('卡片模式通过修改、抽取和空白三个入口进入同一个 Agent', () => {
  const flow = between(clientSource, 'async function newCardConversation', 'function formatTime')

  assert.match(clientSource, /"修改人物卡"/)
  assert.match(clientSource, /"从资料新建人物卡"/)
  assert.match(clientSource, /"空白开始"/)
  assert.match(flow, /mode: "card"/)
  assert.match(flow, /if \(task\) await props\.injectTaskPrompt\(sessionId, task, label, \(selectedResources \|\| \[\]\)\.length > 0\)/)
  assert.doesNotMatch(clientSource, /startExtract|newExtractSession|"revision"|mode: "extract"/)
  assert.doesNotMatch(clientSource, /添加文件到当前对话|attachSourcesToCurrent|attachCardToCurrent/)
  assert.match(clientSource, /return values\[sessionId\] \|\| "";/)
})

test('从资料新建人物卡选择统一资料并自动追加全部引用', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')
  const flow = between(sidebar, 'async function newCardConversation', 'function formatTime')

  assert.match(sidebar, /async function openSourcePicker\(\)/)
  assert.match(sidebar, /call\("listResources"\)/)
  assert.match(sidebar, /resources\.resources \|\| \[\]/)
  assert.match(sidebar, /kind: "source"/)
  assert.match(sidebar, /initialResourceGroup\("资料", initialResources\)/)
  assert.doesNotMatch(sidebar, /initialResourceGroup\("素材"/)
  assert.doesNotMatch(sidebar, /initialResourceGroup\("已绑定剧本"/)
  assert.match(sidebar, /disabled: busy \|\| !chosenInitialResources\.length/)
  assert.match(sidebar, /newCardConversation\(null, "extract", "从资料新建人物卡", chosenInitialResources\)/)
  assert.match(flow, /\(selectedResources \|\| \[\]\)\.forEach/)
  assert.match(flow, /props\.appendMention\(sessionId, resource\.kind, resource\.path, resource\.title\)/)
  assert.match(sidebar, /先选择至少一项资料，再进入工作台/)
  assert.doesNotMatch(sidebar, /newCardConversation\(null, "extract", "从素材新建人物卡"\);/)
})

test('卡片任务只在创建对话时追加提示词，不占用输入框上方区域', () => {
  assert.match(clientSource, /rpc\("getCardTaskPrompt", \{ task: task \}, sessionId\)/)
  assert.match(clientSource, /input\.setDraft\(taskText \+ supplement\)/)
  assert.match(clientSource, /hasInitialResources \? "\\n\\n【初始资料】\\n" : ""/)
  assert.doesNotMatch(clientSource, /【补充要求】/)
  assert.doesNotMatch(clientSource, /function CardTaskDockActions/)
  assert.doesNotMatch(clientSource, /id: "dsh-tavern-card-tasks"/)
  assert.doesNotMatch(clientSource, /choose\("bindScript"/)
})

test('空白工作台确认后自动创建人物卡，不再提供二次保存按钮', () => {
  const draftPanel = between(clientSource, 'function CardDraftPanel', 'function TavernStatusPanel')
  const sidebar = between(clientSource, 'function TavernSidebar', 'function TavernResourcesTab')

  assert.match(draftPanel, /确认后自动创建人物卡文件/)
  assert.doesNotMatch(draftPanel, /finalizeCard|保存为新人物卡|写入草稿/)
  assert.match(sidebar, /const currentSummary = current \? summaries\[current\] : null;/)
  assert.match(sidebar, /if \(!currentSummary \|\| currentSummary\.blank\) return;\s*notifyDataChanged\(\);/)
})

test('Tavern 只接管会话区域，保留 DSH 原生设置与模型配置入口', () => {
  assert.match(clientSource, /slots\.inject\("sidebar\.workspaces"/)
  assert.doesNotMatch(clientSource, /slots\.inject\("sidebar",/)
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

test('卡片模式预加载人物卡库和资源库，并让资源库保持选中', () => {
  assert.match(clientSource, /readyCardSession/)
  assert.match(clientSource, /props\.openCardLibraryTab\(readyCardSession\)/)
  assert.match(clientSource, /props\.openResourcesTab\(readyCardSession\)/)
  assert.ok(clientSource.indexOf('props.openCardLibraryTab(readyCardSession)') < clientSource.indexOf('props.openResourcesTab(readyCardSession)'))
  assert.match(clientSource, /openCardLibraryTab: function \(sessionId\) \{ ctx\.betterSidebar\.openTab\(\{ type: "dsh-tavern:cards" \}/)
  assert.match(clientSource, /ctx\.betterSidebar\.updateTab\("dsh-tavern:cards", \{ meta: null \}\)/)
  assert.match(clientSource, /registerTab\(\{\s*id: "dsh-tavern:resources"/)
  assert.match(clientSource, /id: "dsh-tavern:resources",\s*title: "资源库"/)
  assert.match(clientSource, /openTab\(\{ type: "dsh-tavern:resources" \}/)
  assert.doesNotMatch(clientSource, /openTab\(\{ type: "editor", id: "dsh-tavern:files"/)
  assert.match(clientSource, /group\("人物卡", "card"/)
  assert.match(clientSource, /group\("资料", "source", resources\.resources/)
  assert.doesNotMatch(clientSource, /group\("素材", "source"/)
  assert.doesNotMatch(clientSource, /group\("剧本", "script"/)
  assert.match(clientSource, /const mention = "@\\\"" \+ safePath \+ "\\\""/)
  assert.doesNotMatch(clientSource, /const mention = "@\["/)
  assert.match(clientSource, /body\.dsh-tavern-shell-active \[data-ref-chip="file"\].*max-width: calc\(100% - 4px\).*text-overflow: ellipsis/s)
  assert.match(clientSource, /rpc\("importCard"/)
  assert.match(clientSource, /rpc\("importSource"/)
  assert.match(clientSource, /call\("importScript"/)
  assert.match(clientSource, /已绑定：/)
  assert.match(clientSource, /未绑定/)
  assert.match(clientSource, /ctx\.betterSidebar\.openFile\(\{ sessionId: props\.scope\.sessionId \}, path, title\)/)
  assert.match(clientSource, /props\.openResource\(item\.previewPath, label\)/)
  assert.match(clientSource, /function parseTextResourceFile/)
  assert.match(clientSource, /\.txt,\.md,\.epub/)
  assert.match(clientSource, /application\/epub\+zip/)
})

test('资源库点击人物卡名称会打开对应人物详情', () => {
  const resources = between(clientSource, 'function TavernResourcesTab', 'function CardLibraryTab')

  assert.match(resources, /title: "查看人物卡详情：" \+ label/)
  assert.match(resources, /props\.openCard\(path\)/)
  assert.match(clientSource, /openTab\(\{ type: "dsh-tavern:cards", meta: \{ cardPath: path \} \}, \{ sessionId: props\.scope\.sessionId \}\)/)
  assert.match(clientSource, /updateTab\("dsh-tavern:cards", \{ meta: \{ cardPath: path \} \}\)/)
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
