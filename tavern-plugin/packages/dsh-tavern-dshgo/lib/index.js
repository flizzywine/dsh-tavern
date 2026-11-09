// dsh-go 上的酒馆启动器：面板与状态条都是 App 原生画的 JSON，逻辑跑在 DSH 引擎里。
// 这里只改 web profile 的 bundle 列表；profile 切换与重启由 App 负责。
import { planDisable, planEnable, updateProfile } from './bundles.js'
import { dataHomeHint, ensureDataHome, inspectDataHome } from './data-home.js'
import { checkBundles, preflightHint } from './preflight.js'
import { TAVERN_BUNDLES, readStatus, resolveDshHome } from './status.js'

export const name = 'dsh-tavern-dshgo'

function phaseText(status, zh) {
  if (status.phase === 'unreadable') return zh ? '读不到 profile' : 'Profile unreadable'
  if (status.phase === 'ready') {
    const version = status.tavernVersion === null ? '' : ` ${status.tavernVersion}`
    return `${zh ? '已启用' : 'Enabled'}${version}`
  }
  if (status.phase === 'partial') return zh ? `缺 ${status.missing.length} 个 bundle` : `${status.missing.length} bundles missing`
  return zh ? '未启用' : 'Not enabled'
}

function stripText(status, zh) {
  if (status.phase === 'ready') {
    const version = status.tavernVersion === null ? '' : ` ${status.tavernVersion}`
    return `${zh ? '酒馆' : 'Tavern'}${version}`.trim().slice(0, 24)
  }
  if (status.phase === 'unreadable') return zh ? '酒馆 · 读不到配置' : 'Tavern · unreadable'
  return zh ? '酒馆未启用' : 'Tavern off'
}

function toggleText(status, zh) {
  if (status.phase === 'ready') return zh ? '停用酒馆' : 'Disable Tavern'
  if (status.phase === 'unreadable') return zh ? '读不到配置' : 'Unreadable'
  return zh ? '启用酒馆' : 'Enable Tavern'
}

function panelView(status, home, zh) {
  const children = [
    { type: 'text', text: phaseText(status, zh) },
    { type: 'text', text: `${zh ? '配置目录' : 'Profile'} ${status.profileDir}` },
    { type: 'metric', label: zh ? 'bundle' : 'bundles', value: `${status.installed.length}/${TAVERN_BUNDLES.length}` },
  ]
  if (status.missingModules.length > 0) {
    children.push({ type: 'text', text: (zh ? '未安装：' : 'Not installed: ') + status.missingModules.join(', ') })
  } else if (status.missing.length > 0) {
    children.push({ type: 'text', text: (zh ? '待写入：' : 'Pending: ') + status.missing.join(', ') })
  }
  children.push({ type: 'callout', text: dataHomeHint(inspectDataHome(home), zh) })
  if (status.error !== null) children.push({ type: 'text', text: status.error })
  children.push({
    type: 'actions',
    items: [
      { label: toggleText(status, zh), action: 'toggle' },
      { label: zh ? '检查加载' : 'Check load', action: 'check' },
      { label: zh ? '刷新' : 'Refresh', action: 'refresh' },
    ],
  })
  return { v: 2, type: 'stack', children }
}

function toggle(home, zh) {
  const status = readStatus({ home })
  if (status.phase === 'ready') {
    updateProfile({ home, apply: planDisable })
    return zh ? '已停用，去「引擎」页重启后恢复普通会话库' : 'Disabled; restart the engine to get normal sessions back'
  }
  if (status.phase === 'unreadable') {
    return zh ? '读不到 web profile 的 package.json' : 'Cannot read the web profile package.json'
  }
  if (status.missingModules.length > 0) {
    const names = status.missingModules.slice(0, 2).join('、')
    const more = status.missingModules.length > 2 ? ' 等' : ''
    return zh ? `还缺 ${status.missingModules.length} 个包，先装 ${names}${more}` : `${status.missingModules.length} packages are not installed yet`
  }
  // 存档目录没挂到 dsh-go 下就先别启用：一旦开玩，重置引擎会把 profile-data 整个删掉。
  const data = ensureDataHome(home)
  if (data.state !== 'linked') {
    return zh
      ? '存档目录已是实体目录或指向别处，先手动迁移再启用'
      : 'Move the data directory under dsh-go/tavern-data first'
  }
  // 写进 bundle 列表和「宿主真的会加载」是两件事：先问一遍宿主自己的 loader，
  // 免得装完重启停在 waiting for service。
  const check = checkBundles({ home })
  if (check.state === 'fatal') {
    const first = check.fatal[0]
    return zh
      ? `宿主会跳过 ${first.packageName}，先解决依赖再启用`
      : `The host would skip ${first.packageName}`
  }
  updateProfile({ home, apply: planEnable, beforeFirstChange: true })
  if (check.state === 'unknown') return zh ? '已启用（加载未验证），去引擎页重启' : 'Enabled (load unchecked); restart the engine'
  return zh ? '已启用，去「引擎」页重启后生效' : 'Enabled; restart the engine from its page'
}

export function apply(ctx) {
  const home = resolveDshHome()
  // 只有装了 dsh-go 桥接的主机才进这个回调；网页版看不到 dshGo。
  ctx.inject(['dshGo'], (ctx) => {
    const snapshot = () => readStatus({ home })
    const zhOf = caps => !String(caps?.locale ?? 'zh').startsWith('en')

    ctx.dshGo.strip('tavern-status', (scope, emit, caps) => emit({ text: stripText(snapshot(), zhOf(caps)) }))

    ctx.dshGo.panel('tavern', {
      view: (scope, caps) => panelView(snapshot(), home, zhOf(caps)),
      actions: {
        refresh: () => ({ refresh: 'tavern' }),
        toggle: (scope, event) => {
          try {
            return { toast: toggle(home, zhOf(event)).slice(0, 40) }
          } catch (error) {
            return { toast: String(error?.message ?? error).slice(0, 40) }
          }
        },
        check: (scope, event) => ({ toast: preflightHint(checkBundles({ home }), zhOf(event)).slice(0, 40) }),
      },
    })
  })
}
