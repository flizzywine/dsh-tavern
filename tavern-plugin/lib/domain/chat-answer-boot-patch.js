// 桌面版把 DSH 的对话界面（@deepseek-ai/dsh-client-ui-chat）打进 app.asar（只读归档），
// bin/chat-answer-step-patch.mjs 那种安装期改文件的做法在桌面上用不了：酒馆结算后改写正文
// 时，替换落在只含 surface/replace 的编辑步骤里，界面组装 assistant-step 时只认
// surfaceOp === "append"，于是这一步没有 finalNode；latestAnswer 又只看最后一步，
// 整轮就被当成过程收起——折叠「对话过程」会把正文一起收走，打开「隐藏上下文注入和
// 思考过程」更是整条回复都不见了。
//
// 这里在页面启动前注入一小段脚本：包住 window.__ModuleLoader__.load，在对话界面模块
// 注册工厂的那一刻把 latestAnswer 改成「取最后一个有回复内容的步骤」——改写落在末尾的
// 编辑步骤上时，整轮照样被认成有最终回复，不再当成过程收起。
//
// 注意不要顺手让步骤匹配也接受 surfaceOp 为 replace：那会给改写步骤再建一个 assistant-step
// 节点，同一段正文在原步骤和改写步骤各渲染一遍（重复正文）。
// 与安装期补丁同一处逻辑，但不需要写宿主的只读归档，CLI 与桌面两种宿主都适用。
export const CHAT_UI_MODULE_ID = '@deepseek-ai/dsh-client-ui-chat'

const MARKER = '/* dsh-tavern:answer-step */'

/**
 * 启动前注入的脚本正文。它必须在任何插件 bundle 注册之前执行，因此调用方用
 * table.unshift 把它放在首位；此时 window.__ModuleLoader__ 还不存在，脚本先用
 * 属性访问器占位，等宿主队列脚本赋值时再包住 load。
 */
export function chatAnswerBootScript() {
  return String.raw`(function () {
  var ID = ${JSON.stringify(CHAT_UI_MODULE_ID)}
  var MARKER = ${JSON.stringify(MARKER)}
  var LATEST_ANSWER = /function\s+latestAnswer\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g

  function answerStep(turn) {
    return MARKER + '((steps) => { if (!Array.isArray(steps)) return steps.at(-1); '
      + 'for (let index = steps.length - 1; index > 0; index--) { '
      + 'if (steps[index]?.data?.get?.("assistant-step")?.blocks?.length > 0) return steps[index]; } '
      + 'return steps[0]; })(' + turn + '.steps)'
  }

  // 与 bin/chat-answer-step-patch.mjs 同一套匹配：只认 latestAnswer 里读最后一步的写法，
  // 其余形状原样放过，绝不抛错影响页面启动。
  function patchSource(text) {
    if (typeof text !== 'string' || text.indexOf(MARKER) !== -1) return null
    var matches = []
    var match
    LATEST_ANSWER.lastIndex = 0
    while ((match = LATEST_ANSWER.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length, turn: match[1] })
    }
    var patched = text
    var applied = 0
    for (var position = matches.length - 1; position >= 0; position--) {
      var item = matches[position]
      var bodyStart = item.index + item.length
      var head = text.slice(bodyStart, bodyStart + 600)
      var stop = head.search(/\n\s*function\s/)
      var target = new RegExp('(?<![\\w$])' + item.turn.replace(/\$/g, '\\$') + '\\.steps\\.at\\(\\s*-1\\s*\\)')
      var found = target.exec(stop === -1 ? head : head.slice(0, stop))
      if (!found) continue
      var at = bodyStart + found.index
      patched = patched.slice(0, at) + answerStep(item.turn) + patched.slice(at + found[0].length)
      applied++
    }
    return applied ? patched : null
  }

  function patchFactory(factory) {
    if (typeof factory !== 'function') return factory
    var source
    try { source = String(factory) } catch (error) { return factory }
    var patched = patchSource(source)
    if (!patched) return factory
    try {
      var rebuilt = new Function('return (' + patched + ')')()
      if (typeof rebuilt === 'function') return rebuilt
    } catch (error) {
      console.warn('[dsh-tavern] 回复步骤补丁无法重建对话界面工厂：', error)
    }
    return factory
  }

  function wrap(loader) {
    if (!loader || typeof loader.load !== 'function' || loader.__dshTavernAnswerPatch === true) return loader

    function installed(load) {
      return function (registration) {
        try {
          if (registration && registration.id === ID && typeof registration.factory === 'function') {
            var factory = patchFactory(registration.factory)
            if (factory !== registration.factory) {
              registration = Object.assign({}, registration, { factory: factory })
              console.info('[dsh-tavern] 已修正对话界面的最终回复判定：整理过正文的回合不再被当作过程收起。')
            }
          }
        } catch (error) {
          console.warn('[dsh-tavern] 回复步骤补丁失败：', error)
        }
        return load.call(this, registration)
      }
    }

    var currentLoad = installed(loader.load)
    // 宿主把队列 loader 换成 live loader 时会重新给 load 赋值（load = (registration) => this.register(registration)），
    // 只包一次赋值会把补丁丢掉；把 load 换成访问器，之后每次赋值都重新包住。
    try {
      Object.defineProperty(loader, 'load', {
        configurable: true,
        enumerable: true,
        get: function () { return currentLoad },
        set: function (value) { currentLoad = typeof value === 'function' ? installed(value) : value }
      })
    } catch (error) {
      loader.load = currentLoad
    }
    try { Object.defineProperty(loader, '__dshTavernAnswerPatch', { value: true }) } catch (error) {}
    return loader
  }

  var current
  try {
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true,
      get: function () { return current },
      set: function (value) { current = wrap(value) }
    })
  } catch (error) {
    console.warn('[dsh-tavern] 回复步骤补丁未能安装：', error)
  }
})()`
}

/**
 * 把补丁脚本放进页面 index.html 的 head 首位：必须早于任何插件 bundle 注册工厂。
 * 每个宿主只装一次；重复注入用行上的标记挡住。
 */
export function installChatAnswerBootPatch(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], webCtx => {
    webCtx.on('webserver/index-inject', table => {
      if (!Array.isArray(table)) return
      if (table.some(row => row && row.__dshTavernAnswerPatch === true)) return
      table.unshift({
        kind: 'script',
        placement: 'head',
        text: chatAnswerBootScript(),
        __dshTavernAnswerPatch: true
      })
    })
  })
}
