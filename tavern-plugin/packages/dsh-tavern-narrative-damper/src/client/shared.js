/* ------------------------------------------------------------------ *
 * shared.js —— 面板与宿主之间的常量和小工具（纯函数，方便单测）。
 *
 * 这里的字段名与宿主 lib/domain/narrative-damper.js 的配置逐字一致；面板只发用户真正
 * 改动的那几个字段，校验仍在宿主，非法值会带着 DAMPER_INVALID_CONFIG 回来。
 * ------------------------------------------------------------------ */

const TND_PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini Decisions', defaultModel: 'gemini-decision-1', defaultKeyName: 'GEMINI_API_KEY' },
  { value: 'gemini-compatible', label: 'Gemini Decisions 兼容接口', defaultModel: 'gemini-decision-1', defaultKeyName: 'GEMINI_API_KEY', customUrl: true },
  { value: 'jev', label: 'Typesafe JEV', defaultModel: 'jev-1.13.0', defaultKeyName: 'TYPESAFE_API_KEY' },
  { value: 'openai', label: 'OpenAI Decisions', defaultModel: 'gpt-6-luna', defaultKeyName: 'OPENAI_API_KEY' },
  { value: 'openai-compatible', label: 'OpenAI Decisions 兼容接口', defaultModel: 'gpt-6-luna', defaultKeyName: 'OPENAI_API_KEY', customUrl: true }
]

const TND_KEY_PATTERN = /^[\x21-\x7e]{1,4096}$/

function tndProviderMeta(provider) {
  return TND_PROVIDERS.find(item => item.value === provider) || TND_PROVIDERS[0]
}

// 服务方换掉时三件绑定一起换：模型名、键名、以及只对兼容接口有意义的自定义地址。
function tndProviderPatch(config, provider) {
  const meta = tndProviderMeta(provider)
  return {
    provider: meta.value,
    model: meta.defaultModel,
    keyName: meta.defaultKeyName,
    baseUrl: meta.customUrl ? String(config?.baseUrl || '') : ''
  }
}

function tndKeyError(value) {
  const text = String(value ?? '').trim()
  if (!text) return '请填写 API Key 或已生效的环境变量名'
  return TND_KEY_PATTERN.test(text) ? '' : 'API Key 须为不含空格或中文的可见字符'
}

// 阈值与超时按宿主的边界收紧，避免出现「界面填了 2 却被静默改成 0.5」的落差。
function tndThreshold(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0.72
  return Math.min(0.95, Math.max(0.5, Math.round(num * 100) / 100))
}

function tndTimeout(value) {
  const num = Number(value)
  if (!Number.isSafeInteger(num)) return 2500
  return Math.min(30000, Math.max(300, num))
}

function tndCredentialText(credential) {
  if (!credential || credential.configured !== true) return '未配置'
  return credential.source === 'stored' ? '已配置（安全存储）' : '已配置 · 环境变量 ' + (credential.keyName || '')
}

// 保存成功后喊一声：宿主自己的显示偏好（楼层胶囊的显隐）就是从同一个页面事件重读的。
// 事件名是宿主设置页在用的那个，插件在这里只是第三个作者，不新造一套。
function tndNotifySettingsChanged() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed'))
  } catch {}
}

// 面板只认 JSON；宿主返回 null 时按「空」处理，而不是当成功。
function tndCall(ui, name, args) {
  return ui.callHost(name, args === undefined ? {} : args)
}
