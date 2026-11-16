import { readFileSync, statSync } from 'node:fs'

export const SYSTEM_PROMPT_DEFINITIONS = Object.freeze([
  ['system-append', 'system附加指令', '默认开启，可按需关闭。内容会添加到前台、后台及卡片 Agent 的 system 提示词最前面（位于酒馆预设之前），修改后从下一次请求生效。'],
  ['story', '正文 Agent 核心提示词', '控制普通游玩正文的续写规则。'],
  ['script-story', '剧本模式正文补充', '控制绑定剧本时追加给正文 Agent 的规则。'],
  ['style-reference-recall', '文风联想选段', '开启「文风联想」后，前台写正文前按这段要求联想一段笔调参考。可在这里调整选书范围（如偏好轻小说、某类题材），修改后下一次选段生效。'],
  ['style-reference', '文风联想正文补充', '开启「文风联想」后，与前台文风选段要求一起提供，告诉正文 Agent 怎样借鉴。'],
  ['polish', '正文精修原则', '重写面板点「精修」时使用：模型按这份标准审读最后一轮正文，列出修改并直接替换，前后对比在「精修对比」页。可以改审稿标准；精修 Agent 通过工具逐处提交修改，程序会校验原文定位后应用。修改后下一次精修生效。'],
  ['polish-guidance', '精修按意见修改', '重写面板填了意见再点「精修」时使用：先按「正文精修原则」改完，再按这份要求只照玩家的意见改一次。精修 Agent 通过工具逐处提交修改。修改后下一次精修生效。'],
  ['candidate-story', '普通剧情候选项', '控制普通剧情候选项的数量、类型和输出格式。'],
  ['candidate-script', '剧本候选项', '控制剧本模式候选项及剧本推进规则。'],
  ['posture-settlement', '姿势状态结算', '控制后台姿势结算的工具提交。'],
  ['story-compaction', '前台上下文压缩', '用于前台手动和自动压缩：把更早的剧情写成摘要，最近 10 轮原文原样附在摘要后。修改后下次压缩生效；后台仍使用 DSH 内置压缩提示词。'],
  ['card-workspace', '卡片 Agent 工作区说明', '仅注入卡片 Agent 的 system。可编辑完整说明；{{resourceRoot}} 自动替换为当前资源根目录，{{projectionPaths}} 自动替换为当前会话的投影文件路径。保存后下一次请求生效。'],
].map(function (item) { return Object.freeze({ name: item[0], label: item[1], description: item[2] }) }))

export const SYSTEM_PROMPT_NAMES = Object.freeze(SYSTEM_PROMPT_DEFINITIONS.map(function (item) { return item.name }))

const knownNames = new Set([...SYSTEM_PROMPT_NAMES,
  'dice', 'bubble-format', 'bubble-voice-format', 'phone-call', 'card-reference', 'card-task-edit', 'card-task-extract', 'card-task-script',
  'card-task-worldbook', 'card-task-preset', 'card-task-debug-play'
])

function promptVersion(file) {
  const info = statSync(file, { bigint: true })
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

// 应用内更新会整目录换掉源码：正在跑的旧进程随后可能读到一个已经被新版删掉的
// 提示词文件（#388 的 tavern-plugin/prompts/card-system.md、#328 的同一现象）。
// 有上一次读到的正文就继续用，不要因为一次 ENOENT 让正在进行的对话失败。
function missingPrompt(name, error) {
  if (error?.code !== 'ENOENT') return null
  const wrapped = new Error(`提示词文件 ${name}.md 不存在（${error.message}）。可能是酒馆正在更新或更新后尚未重启，重启酒馆后重试。`)
  wrapped.code = 'ENOENT'
  return wrapped
}

export function createPromptCatalog(directory = new URL('../prompts/', import.meta.url), { read = readFileSync, version = promptVersion } = {}) {
  const cache = new Map()
  return function promptFromFile(name) {
    if (!knownNames.has(name)) throw new Error('未知提示词: ' + String(name))
    const file = new URL(name + '.md', directory)
    const previous = cache.get(name)
    let stamp
    try { stamp = version(file) } catch (error) {
      const wrapped = missingPrompt(name, error)
      if (wrapped && previous) return previous.text
      throw wrapped || error
    }
    if (previous?.stamp === stamp) return previous.text
    let text
    try { text = read(file, 'utf8').trim() } catch (error) {
      const wrapped = missingPrompt(name, error)
      if (wrapped && previous) return previous.text
      throw wrapped || error
    }
    if (text === '' && name !== 'system-append') throw new Error('提示词文件不能为空: ' + name + '.md')
    // 读完之后再确认版本；文件在这期间被换掉就当没读到，不写进缓存。
    let current = false
    try { current = version(file) === stamp } catch (error) { if (!missingPrompt(name, error)) throw error }
    if (current) cache.set(name, { stamp, text })
    return text
  }
}

export const prompt = createPromptCatalog()

// Built-in 卡片工作台性格; the library itself lives in domain/card-personas.js.
export const CARD_PERSONA_DEFINITIONS = Object.freeze([
  ['zhumi', '猫娘助手 · 煮米'],
  ['editor', '冷静专业编辑'],
  ['roaster', '毒舌吐槽役 · 阿刺'],
].map(function (item) { return Object.freeze({ id: item[0], label: item[1] }) }))

export function cardPersonas(directory = new URL('../prompts/card-personas/', import.meta.url), read = readFileSync) {
  return CARD_PERSONA_DEFINITIONS.map(function (item) { return { id: item.id, label: item.label, text: read(new URL(item.id + '.md', directory), 'utf8').trim() } })
}
