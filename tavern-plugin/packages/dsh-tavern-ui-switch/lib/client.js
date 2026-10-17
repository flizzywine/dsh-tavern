/**
 * dsh-tavern-ui-switch client module.
 *
 * A self-contained overlay rendered inside a shadow root, so neither the DSH
 * UI nor the Tavern UI can restyle it and it cannot leak styles back. It is
 * plain DOM: no React, no slot registration, nothing that depends on which UI
 * is currently loading.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tavern-ui-switch',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var ROUTE = '/api/dsh-tavern-ui-switch'
    var MOUNT_KEY = '__dshUiSwitch'

    var CSS = [
      ':host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12.5px;line-height:1.5;-webkit-font-smoothing:antialiased}',
      ':host([data-anchor="bottom-left"]){left:18px;right:auto}',
      ':host([data-anchor="top-right"]){top:18px;bottom:auto}',
      ':host([data-anchor="top-left"]){top:18px;left:18px;bottom:auto;right:auto}',
      '.wrap{position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}',
      '.pill{pointer-events:auto;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;cursor:pointer;border:1px solid var(--line);background:var(--chip);color:var(--fg);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 20px -10px rgba(0,0,0,.45);opacity:.8;transition:opacity .18s ease,transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,background .18s ease;user-select:none;font:inherit;-webkit-tap-highlight-color:transparent}',
      '.pill:hover{opacity:1;transform:translateY(-1px);box-shadow:0 2px 4px rgba(0,0,0,.08),0 14px 28px -12px rgba(0,0,0,.5)}',
      '.pill:active{transform:translateY(0) scale(.98)}',
      '.pill:focus-visible{outline:2px solid var(--focus);outline-offset:3px}',
      '.ico{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:.82}',
      '.label{font-weight:500;letter-spacing:.2px}',
      '.dot{width:6px;height:6px;border-radius:50%;background:var(--dot);box-shadow:0 0 0 3px var(--dot-ring);transition:background .25s ease,box-shadow .25s ease}',
      '.panel{pointer-events:none;position:absolute;right:0;bottom:42px;display:block;width:252px;padding:13px 14px 12px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--fg);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);box-shadow:0 2px 6px rgba(0,0,0,.06),0 24px 54px -20px rgba(0,0,0,.5);transform-origin:100% 100%;transform:translateY(7px) scale(.97);opacity:0;visibility:hidden;transition:opacity .16s ease,transform .2s cubic-bezier(.2,.7,.3,1),visibility .16s}',
      ':host([data-anchor="top-right"]) .panel,:host([data-anchor="top-left"]) .panel{top:42px;bottom:auto;transform-origin:100% 0}',
      ':host([data-anchor="bottom-left"]) .panel,:host([data-anchor="top-left"]) .panel{right:auto;left:0;transform-origin:0 100%}',
      '.panel[data-open="1"]{opacity:1;visibility:visible;transform:none;pointer-events:auto}',
      '.head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:11px}',
      '.head-left{display:flex;align-items:center;gap:6px;min-width:0}',
      '.head-ico{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.5;flex:none}',
      '.title{font-size:12px;font-weight:600;letter-spacing:.3px;white-space:nowrap}',
      '.badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:var(--chip-soft);white-space:nowrap;flex:none}',
      '.badge i{width:5px;height:5px;border-radius:50%;background:var(--dot)}',
      '.desc{font-size:11.5px;color:var(--muted);margin:0 0 11px;letter-spacing:.1px;line-height:1.55}',
      '.primary{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;border-radius:9px;border:1px solid transparent;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;font:inherit;font-size:12.5px;font-weight:600;letter-spacing:.3px;cursor:pointer;box-shadow:0 8px 18px -12px var(--accent-shadow);transition:transform .15s ease,filter .15s ease,box-shadow .15s ease}',
      '.primary .arrow{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.85;transition:transform .18s ease}',
      '.primary:hover{transform:translateY(-1px);filter:brightness(1.05);box-shadow:0 12px 22px -12px var(--accent-shadow)}',
      '.primary:hover .arrow{transform:translateX(2px)}',
      '.primary:active{transform:translateY(0) scale(.995)}',
      '.primary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
      '.primary[disabled]{opacity:.45;cursor:not-allowed;filter:none;transform:none;box-shadow:none}',
      '.primary[disabled] .arrow{display:none}',
      '.ghost{pointer-events:auto;display:flex;align-items:center;justify-content:center;width:100%;height:32px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer;transition:color .15s ease,background .15s ease}',
      '.ghost:hover{color:var(--fg);background:var(--chip-soft)}',
      '.row{display:flex;gap:8px}',
      '.row button{flex:1}',
      '.note{margin:11px 0 0;padding-top:9px;border-top:1px solid var(--line);font-size:10.5px;line-height:1.5;color:var(--muted);opacity:.92;letter-spacing:.1px}',
      '.err{margin:9px 0 0;font-size:10.5px;line-height:1.5;color:#dc5a52}',
      '.busy{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);padding:4px 0}',
      '.spinner{width:13px;height:13px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:spin .8s linear infinite}',
      '@keyframes spin{to{transform:rotate(360deg)}}',
      '.veil{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(12,14,18,.4);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:auto;z-index:2147483647;animation:fade .2s ease}',
      '.veil[data-open="1"]{display:flex}',
      '.veil .box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px 22px;color:var(--fg);box-shadow:0 20px 48px -16px rgba(0,0,0,.55);text-align:center;min-width:200px;animation:pop .22s cubic-bezier(.2,.7,.3,1)}',
      '.veil-hint{margin:9px 0 0;max-width:230px;font-size:11px;line-height:1.5;color:var(--muted)}',
      '.veil[data-dismissible="1"]{cursor:pointer}',
      '@keyframes fade{from{opacity:0}to{opacity:1}}',
      '@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion: reduce){.pill,.panel,.veil,.veil .box,.spinner{transition:none!important;animation:none!important;transform:none!important}}',
    ].join('')

    var themeVars = {
      light: {
        '--fg': '#111827', '--muted': '#6b7280', '--line': 'rgba(17,24,39,.12)',
        '--chip': 'rgba(255,255,255,.78)', '--chip-soft': 'rgba(17,24,39,.05)',
        '--panel': 'rgba(255,255,255,.93)',
        '--accent': '#4f6ef7', '--accent-2': '#7b5cf0', '--accent-shadow': 'rgba(79,110,247,.55)',
        '--focus': 'rgba(79,110,247,.5)',
      },
      dark: {
        '--fg': '#e9ebef', '--muted': '#9aa0a6', '--line': 'rgba(255,255,255,.14)',
        '--chip': 'rgba(34,36,41,.72)', '--chip-soft': 'rgba(255,255,255,.06)',
        '--panel': 'rgba(26,28,32,.95)',
        '--accent': '#617dff', '--accent-2': '#9a6bff', '--accent-shadow': 'rgba(97,125,255,.6)',
        '--focus': 'rgba(97,125,255,.6)',
      },
    }

    function detectTheme() {
      try {
        var node = document.body
        var color = ''
        while (node && !color) {
          color = getComputedStyle(node).backgroundColor
          node = node.parentElement
        }
        var match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color || '')
        if (!match) return 'light'
        var alpha = match[4] === undefined ? 1 : Number(match[4])
        if (alpha === 0) return 'light'
        var luminance = (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255
        return luminance < 0.5 ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    function applyTheme(host) {
      var vars = themeVars[detectTheme()]
      for (var key in vars) host.style.setProperty(key, vars[key])
    }

    function request(method, path, body) {
      var init = { method: method, headers: { 'X-DSH-UI-Switch': '1' }, cache: 'no-store' }
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(ROUTE + path, init).then(function (response) {
        return response.json().catch(function () { return {} }).then(function (data) {
          if (!response.ok || data.ok === false) {
            throw new Error(data && data.error ? data.error : '请求失败（HTTP ' + response.status + '）')
          }
          return data
        })
      })
    }

    var MODE_TEXT = { tavern: '酒馆界面', official: '原版界面', unknown: '未知' }

    function mount() {
      if (window[MOUNT_KEY]) return window[MOUNT_KEY]
      var host = document.createElement('div')
      host.id = 'dsh-tavern-ui-switch-host'
      host.setAttribute('data-anchor', window.__DSH_UI_SWITCH_ANCHOR__ || 'bottom-right')
      var shadow = host.attachShadow({ mode: 'open' })
      var style = document.createElement('style')
      style.textContent = CSS
      shadow.appendChild(style)

      var wrap = document.createElement('div')
      wrap.className = 'wrap'
      var panel = document.createElement('section')
      panel.className = 'panel'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', '切换界面')
      var pill = document.createElement('button')
      pill.className = 'pill'
      pill.type = 'button'
      pill.title = '切换界面：酒馆 / 原版'
      pill.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h11.2l-2.5-2.5M20 15H8.8l2.5 2.5"/></svg><span class="label">界面</span><span class="dot"></span>'
      wrap.appendChild(panel)
      wrap.appendChild(pill)
      shadow.appendChild(wrap)

      var veil = document.createElement('div')
      veil.className = 'veil'
      veil.innerHTML = '<div class="box"><div class="busy"><span class="spinner"></span><span>正在重启 DeepSeek Harness…</span></div><p class="veil-hint"></p></div>'
      var veilTimer = 0
      function openVeil() {
        veil.setAttribute('data-open', '1')
        veil.removeAttribute('data-dismissible')
        veil.querySelector('.veil-hint').textContent = ''
        clearTimeout(veilTimer)
        // The app restarts itself; if that silently fails the overlay must not trap the user.
        veilTimer = setTimeout(function () {
          veil.setAttribute('data-dismissible', '1')
          veil.querySelector('.veil-hint').textContent = '如果应用没有自动重启，请手动打开 DeepSeek Harness。点此关闭。'
        }, 15000)
      }
      veil.addEventListener('click', function () {
        if (veil.getAttribute('data-dismissible') === '1') veil.setAttribute('data-open', '0')
      })
      shadow.appendChild(veil)

      document.body.appendChild(host)
      applyTheme(host)

      var state = { mode: 'unknown', tavernInstalled: false, restart: null, error: '', notice: '', open: false, busy: false, confirm: null }

      function render() {
        var target = state.mode === 'tavern' ? 'official' : 'tavern'
        var targetText = MODE_TEXT[target] || target
        var canTarget = target !== 'tavern' || state.tavernInstalled

        // Mode colours: warm amber for Tavern, indigo for the original UI.
        var tavernMode = state.mode === 'tavern'
        host.style.setProperty('--dot', state.mode === 'unknown' ? '#9aa0a6' : tavernMode ? '#e08b2d' : '#5b79ff')
        host.style.setProperty('--dot-ring', state.mode === 'unknown' ? 'rgba(154,160,166,.18)' : tavernMode ? 'rgba(224,139,45,.16)' : 'rgba(91,121,255,.16)')
        pill.title = '切换界面（当前：' + (MODE_TEXT[state.mode] || '未知') + '）'
        pill.setAttribute('aria-label', pill.title)
        pill.setAttribute('aria-expanded', state.open ? 'true' : 'false')

        var html = ''
        html += '<div class="head"><span class="head-left"><svg class="head-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h11.2l-2.5-2.5M20 15H8.8l2.5 2.5"/></svg><span class="title">切换界面</span></span><span class="badge"><i></i>' + (MODE_TEXT[state.mode] || '未知') + '</span></div>'

        if (state.error) {
          html += '<p class="err">' + escapeHtml(state.error) + '</p>'
        }

        if (state.busy) {
          html += '<div class="busy"><span class="spinner"></span><span>正在处理…</span></div>'
        } else if (state.mode === 'unknown') {
          // Before the first state arrives, do not claim Tavern is missing.
          if (state.error) {
            html += '<button class="ghost" data-act="reload">重试</button>'
          } else {
            html += '<div class="busy"><span class="spinner"></span><span>正在读取界面状态…</span></div>'
          }
        } else if (state.confirm === null) {
          html += '<button class="primary" data-act="switch"' + (canTarget ? '' : ' disabled') + '><span>切换到' + targetText + '</span><svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 7l5 5-5 5"/></svg></button>'
          if (!canTarget) {
            html += '<p class="note">没有安装酒馆，只能使用原版界面。</p>'
          } else if (state.notice) {
            html += '<p class="note">' + escapeHtml(state.notice) + '</p>'
          } else if (state.restart && state.restart.supported) {
            html += '<p class="note">切换会重启应用，进行中的任务会中断。</p>'
          } else if (state.restart) {
            html += '<p class="note">' + escapeHtml(state.restart.hint || '切换后请手动重启。') + '</p>'
          }
        } else {
          var willRestart = state.restart && state.restart.supported
          html += '<p class="desc">确认' + (willRestart ? '切换并重启' : '切换') + '到' + targetText + '？' + (willRestart ? '进行中的任务会中断。' : '') + '</p>'
          html += '<div class="row"><button class="primary" data-act="confirm">确认</button><button class="ghost" data-act="cancel">取消</button></div>'
        }

        panel.innerHTML = html
        panel.setAttribute('data-open', state.open ? '1' : '0')
      }

      function load() {
        return request('GET', '/state').then(function (data) {
          state.mode = data.mode
          state.tavernInstalled = data.tavernInstalled
          state.restart = data.restart
          state.error = data.error || ''
          if (typeof data.anchor === 'string' && data.anchor) host.setAttribute('data-anchor', data.anchor)
          render()
        }).catch(function (error) {
          state.error = '无法读取切换状态：' + error.message
          render()
        })
      }

      function doSwitch() {
        var target = state.mode === 'tavern' ? 'official' : 'tavern'
        state.busy = true
        state.error = ''
        render()
        request('POST', '/switch', { mode: target }).then(function (data) {
          state.mode = data.mode
          state.busy = false
          state.confirm = null
          var restart = data.restart || state.restart
          if (restart && restart.supported) {
            openVeil()
            return request('POST', '/restart').catch(function (error) {
              veil.setAttribute('data-open', '0')
              state.error = '已切换，但自动重启失败：' + error.message + '，请手动打开 DeepSeek Harness。'
              render()
            })
          }
          render()
          state.error = ''
          var hint = (restart && restart.hint) || '请手动重启 DSH 后生效。'
          state.notice = '已切换到' + (MODE_TEXT[data.mode] || data.mode) + '，' + hint
          render()
          return undefined
        }).catch(function (error) {
          veil.setAttribute('data-open', '0')
          state.busy = false
          state.confirm = null
          state.error = error.message
          render()
        })
      }

      pill.addEventListener('click', function () {
        state.open = !state.open
        state.notice = ''
        state.confirm = null
        render()
        if (state.open) load()
      })

      panel.addEventListener('click', function (event) {
        // Clicks land on the button's children (label span, arrow svg), so walk up
        // to the nearest [data-act] instead of reading event.target directly.
        var node = event.target
        while (node && node !== panel && !(node.getAttribute && node.getAttribute('data-act'))) {
          node = node.parentElement || (node.parentNode && node.parentNode.host) || null
        }
        var action = node && node !== panel && node.getAttribute ? node.getAttribute('data-act') : null
        if (action === 'switch') {
          state.confirm = 'yes'
          render()
        } else if (action === 'cancel') {
          state.confirm = null
          render()
        } else if (action === 'confirm') {
          doSwitch()
        } else if (action === 'reload') {
          state.error = ''
          render()
          load()
        }
      })

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && state.open) {
          state.open = false
          state.confirm = null
          render()
        }
      }, true)

      // The UI may re-render or replace body children; keep the host attached.
      var observer = new MutationObserver(function () {
        try {
          if (!document || !document.body) return
          if (!host.isConnected) document.body.appendChild(host)
        } catch {}
      })
      observer.observe(document.body, { childList: true })

      request('POST', '/client-ready', { anchor: host.getAttribute('data-anchor') }).catch(function () {})

      var api = { host: host, state: state, reload: load, open: function () { state.open = true; render(); load() } }
      window[MOUNT_KEY] = api
      return api
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
      })
    }

    function apply(ctx) {
      if (typeof document === 'undefined') return
      // A client module that throws can blank the whole UI; never let that happen.
      var start = function () {
        try { mount() } catch (error) { console.error('[dsh-tavern-ui-switch]', error) }
      }
      if (document.body) start()
      else document.addEventListener('DOMContentLoaded', start, { once: true })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
