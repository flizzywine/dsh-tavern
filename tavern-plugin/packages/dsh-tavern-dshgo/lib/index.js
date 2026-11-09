// dsh-go 上的酒馆启动器（只读版）：面板与状态条都是 App 原生画的 JSON，
// 逻辑跑在 DSH 引擎里。真正的启停与预检在 lib/bundles.js、lib/preflight.js（P2）。
import { readStatus, resolveDshHome } from './status.js'

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

function panelView(status, zh) {
  const children = [
    { type: 'text', text: phaseText(status, zh) },
    { type: 'text', text: `${zh ? '配置目录' : 'Profile'} ${status.profileDir}` },
    {
      type: 'metric',
      label: zh ? 'bundle' : 'bundles',
      value: `${status.installed.length}/${status.installed.length + status.missing.length}`,
    },
  ]
  if (status.missing.length > 0) {
    children.push({ type: 'text', text: (zh ? '缺：' : 'Missing: ') + status.missing.join(', ') })
  }
  if (status.error !== null) {
    children.push({ type: 'text', text: status.error })
  }
  children.push({ type: 'actions', items: [{ label: zh ? '刷新' : 'Refresh', action: 'refresh' }] })
  return { v: 2, type: 'stack', children }
}

export function apply(ctx) {
  const home = resolveDshHome()
  // 只有装了 dsh-go 桥接的主机才进这个回调；网页版看不到 dshGo。
  ctx.inject(['dshGo'], (ctx) => {
    const snapshot = () => readStatus({ home })

    ctx.dshGo.strip('tavern-status', (scope, emit, caps) => {
      const zh = !String(caps?.locale ?? 'zh').startsWith('en')
      return emit({ text: stripText(snapshot(), zh) })
    })

    ctx.dshGo.panel('tavern', {
      view: (scope, caps) => {
        const zh = !String(caps?.locale ?? 'zh').startsWith('en')
        return panelView(snapshot(), zh)
      },
      actions: {
        refresh: () => ({ refresh: 'tavern' }),
      },
    })
  })
}

