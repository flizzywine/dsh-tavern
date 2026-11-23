window.__ModuleLoader__.load({
  id: 'dsh-tavern-adventure-medal',
  factory() {
    const name = 'dsh-tavern-adventure-medal'
    const UNLOCK_EVENT = name + ':unlocked'
    const SETTINGS_BUTTON = '[data-slot="settings.launcher"] button, button[aria-label="设置"], button[aria-label="Settings"]'
    const DISPLAY_MS = 3400
    const ENTER_MS = 290
    const EXIT_MS = 295
    const EASE_OUT = 'cubic-bezier(.23, 1, .32, 1)'
    const EASE_IN_OUT = 'cubic-bezier(.77, 0, .175, 1)'
    const CELEBRATIONS = {
      starter: {
        colors: ['#ffb8cb', '#ff85a5', '#ffd7aa', '#fff2eb'], shapes: ['spark', 'dot'], bursts: [16], spread: .63,
      },
      bronze: {
        colors: ['#ffbc83', '#f9784b', '#ffe5bc', '#ffc35b'], shapes: ['spark', 'dot'], bursts: [22], spread: .72,
      },
      silver: {
        colors: ['#cbdcff', '#8ee5ff', '#edf6ff', '#b7b0ff'], shapes: ['shard', 'spark'], bursts: [32], spread: .95,
      },
      gold: {
        colors: ['#ffe288', '#ffb64b', '#fff5c0', '#f89d62'], shapes: ['ribbon', 'foil', 'spark'], bursts: [30, 18], spread: 1.13,
      },
      rainbow: {
        colors: ['#ff9ecb', '#ffda78', '#a7f4d6', '#8ad8ff', '#b3a1ff', '#fff3d5'],
        shapes: ['ribbon', 'shard', 'spark', 'foil'], bursts: [36, 24], spread: 1.35,
      },
    }
    const styles = `
@import url('/profile-bridge/achievement-art.css');
.adventure-celebration {
  --adventure-trim: #ffd9ae;
  --adventure-aura: radial-gradient(ellipse, #ffae5966, #dc6e3129 50%, transparent 72%);
  position: fixed; inset: 0; z-index: 2100; display: grid; place-items: center;
  box-sizing: border-box; width: auto; height: auto; margin: 0; padding: 0; border: 0;
  background: transparent; overflow: hidden; pointer-events: none;
}
.adventure-celebration::backdrop { background: transparent; pointer-events: none; }
.adventure-celebration-shade {
  position: absolute; inset: 0; background: radial-gradient(ellipse at center, #34233168, #110e1bbb 80%);
}
.adventure-celebration[data-tier="silver"] {
  --adventure-trim: #d9eeff;
  --adventure-aura: radial-gradient(ellipse, #98c9ff70, #768dff29 48%, transparent 71%);
}
.adventure-celebration[data-tier="starter"] {
  --adventure-trim: #ffd1df;
  --adventure-aura: radial-gradient(ellipse, #ffa1c166, #f47b9f29 49%, transparent 72%);
}
.adventure-celebration[data-tier="gold"] {
  --adventure-trim: #ffe298;
  --adventure-aura: radial-gradient(ellipse, #fff1a98c, #fdb4513d 37%, transparent 70%),
    repeating-conic-gradient(from 7deg, #ffd37966 0deg, transparent 7deg 18deg);
}
.adventure-celebration[data-tier="rainbow"] {
  --adventure-trim: #ffe1f6;
  --adventure-aura: conic-gradient(from 35deg, #e294ff76, #95cdff82, #8ff7d37c, #ffe08c7d, #fba4ba83, #e294ff76);
}
.adventure-celebration-aura {
  position: absolute; width: min(760px, 110vw); aspect-ratio: 1; border-radius: 50%;
  background: var(--adventure-aura);
  mask-image: radial-gradient(ellipse, #000 24%, #000b 47%, transparent 72%);
}
.adventure-celebration[data-tier="rainbow"] .adventure-celebration-aura::after {
  content: ''; position: absolute; inset: 5%; border-radius: 50%;
  background: conic-gradient(from 25deg, transparent, #ecb3ffcc, transparent 26%, #a0e5ffd9, transparent 52%, #90f0cbcc, transparent 74%, #ffe29ecc, transparent);
  mask-image: radial-gradient(circle closest-side, transparent 64%, #000 65% 66%, transparent 67% 74%, #000 75% 76%, transparent 77%);
}
.adventure-celebration-card {
  position: relative; z-index: 1; width: min(420px, calc(100vw - 32px), 65dvh);
  aspect-ratio: 3 / 4; pointer-events: none;
}
.adventure-celebration-shine {
  position: absolute; z-index: 2; inset: -8%;
  background: linear-gradient(110deg, transparent 35%, #fff7df22 44%, #fffcf19c 49%, #fff2ca35 53%, transparent 63%);
  mix-blend-mode: screen;
}
.adventure-celebration-confetti { position: absolute; z-index: 2; left: 50%; top: 50%; width: 8px; height: 12px; border-radius: 1px; }
.adventure-celebration-confetti[data-shape="spark"] {
  width: 15px; height: 15px; clip-path: polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%);
}
.adventure-celebration-confetti[data-shape="dot"] { width: 5px; height: 5px; border-radius: 50%; }
.adventure-celebration-confetti[data-shape="shard"] { clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
.adventure-celebration-confetti[data-shape="ribbon"] { width: 5px; height: 22px; border-radius: 60% 35%; }
.adventure-celebration-arrival {
  position: absolute; z-index: 2; width: 26px; height: 26px; margin: -13px; border-radius: 50%;
  border: 2px solid var(--adventure-trim); box-sizing: border-box; box-shadow: 0 0 15px var(--adventure-trim);
}
`

    function mainGameId(sessions) {
      const list = sessions.list.getSnapshot()
      return Object.values(list?.byId || {}).find(row => row?.retainedBy?.mainView > 0)?.id || list?.current || ''
    }

    function settingsBounds(document) {
      for (const button of document.querySelectorAll(SETTINGS_BUTTON)) {
        const rect = button.getBoundingClientRect()
        const { innerWidth, innerHeight } = document.defaultView
        if (rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0
          && rect.top < innerHeight && rect.bottom > 0 && document.defaultView.getComputedStyle(button).visibility === 'visible') return rect
      }
      return null
    }

    function apply(ctx) {
      const { tavernUi: ui, sessions } = ctx
      if (!sessions?.list?.subscribe || typeof ui?.watchState !== 'function' || typeof ui.callHost !== 'function') return
      ctx.effect(() => {
        const document = window.document
        const style = document.createElement('style')
        style.textContent = styles
        document.head.append(style)

        let disposed = false
        let gameId = ''
        let unwatch
        let celebration
        let timer

        function element(tag, part, text, family = 'adventure-celebration') {
          const node = document.createElement(tag)
          node.className = family + (part ? '-' + part : '')
          if (text !== undefined) node.textContent = text
          return node
        }

        function clearCelebration() {
          window.clearTimeout(timer)
          celebration?.remove()
          celebration = undefined
        }

        function scatterConfetti(layer, width, preset, count, delay) {
          const sideRoom = Math.max(12, (layer.clientWidth - width) / 2)
          const reach = Math.min(sideRoom, width * preset.spread)
          for (let i = 0; i < count; i++) {
            const side = i % 2 ? -1 : 1
            const spread = Math.random()
            const start = width * .45
            const distance = start + reach * (.28 + spread * .72)
            const lift = width * (.2 + Math.random() * .66)
            const turn = side * (120 + Math.random() * 340)
            const bit = element('span', 'confetti')
            bit.setAttribute('aria-hidden', 'true')
            bit.dataset.shape = preset.shapes[Math.floor(Math.random() * preset.shapes.length)]
            bit.style.backgroundColor = preset.colors[i % preset.colors.length]
            layer.append(bit)
            const motion = bit.animate([
              { transform: `translate(${side * start}px, ${width * .17}px) rotate(0deg) scale(.6)`, opacity: 0, easing: EASE_OUT },
              { transform: `translate(${side * (start + (distance - start) * .75)}px, ${-lift}px) rotate(${turn * .45}deg) scale(1)`, opacity: 1, offset: .36 },
              { opacity: 1, offset: .68 },
              { transform: `translate(${side * distance}px, ${width * .6 - lift * .3}px) rotate(${turn}deg) scale(.75)`, opacity: 0 },
            ], { duration: 720 + spread * 380, delay: delay + spread * 80, fill: 'both' })
            motion.finished.then(() => bit.remove(), () => {})
          }
        }

        function shineAcrossCard(card) {
          const sheen = element('span', 'shine')
          sheen.setAttribute('aria-hidden', 'true')
          card.append(sheen)
          sheen.animate([
            { transform: 'translateX(-90%)', opacity: 0 },
            { opacity: .85, offset: .35 },
            { opacity: .85, offset: .65 },
            { transform: 'translateX(90%)', opacity: 0 },
          ], { duration: 660, delay: 260, easing: EASE_IN_OUT, fill: 'both' })
            .finished.then(() => sheen.remove(), () => {})
        }

        function flyToSettings(layer, card, shade, aura, reduced) {
          if (celebration !== layer) return
          if (typeof card.animate !== 'function') return clearCelebration()
          const target = reduced ? null : settingsBounds(document)
          const frames = [{ opacity: 1 }, { opacity: 0 }]
          const motions = []
          if (target) {
            const bounds = card.getBoundingClientRect()
            const x = target.left + target.width / 2
            const y = target.top + target.height / 2
            const dx = x - (bounds.left + bounds.width / 2)
            const dy = y - (bounds.top + bounds.height / 2)
            const tilt = Math.sign(dx) * 10
            frames[0].transform = 'translate(0, 0) rotate(0deg) scale(1)'
            frames[1].transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(.12)`
            frames.splice(1, 0, {
              transform: `translate(${dx * .78}px, ${dy * .66}px) rotate(${tilt}deg) scale(.3)`, opacity: 1, offset: .7,
            })
            const arrival = element('span', 'arrival')
            arrival.setAttribute('aria-hidden', 'true')
            arrival.style.left = x + 'px'
            arrival.style.top = y + 'px'
            layer.append(arrival)
            motions.push(arrival.animate([
              { transform: 'scale(.9)', opacity: 0 },
              { transform: 'scale(1)', opacity: 1, offset: .22 },
              { transform: 'scale(2.15)', opacity: 0 },
            ], { duration: 190, delay: EXIT_MS - 70, easing: EASE_OUT, fill: 'both' }))
          }
          for (const backdrop of [shade, aura]) {
            backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: EASE_OUT, fill: 'forwards' })
          }
          motions.push(card.animate(frames, { duration: EXIT_MS, easing: target ? EASE_IN_OUT : EASE_OUT, fill: 'forwards' }))
          Promise.allSettled(motions.map(animation => animation.finished))
            .then(() => { if (celebration === layer) clearCelebration() })
        }

        function show(achievement) {
          clearCelebration()
          const layer = celebration = element('div')
          layer.dataset.tier = achievement.id
          const shade = element('div', 'shade')
          shade.setAttribute('aria-hidden', 'true')
          const aura = element('div', 'aura')
          aura.setAttribute('aria-hidden', 'true')
          const card = element('section', 'card')
          card.classList.add('achievement-art')
          card.dataset.tier = achievement.id
          card.setAttribute('role', 'status')
          card.setAttribute('aria-atomic', 'true')
          const art = (tag, part, content) => element(tag, part, content, 'achievement-art')
          if (achievement.cover) {
            const cover = art('img', 'cover')
            cover.alt = ''
            cover.src = achievement.cover
            cover.addEventListener('error', () => cover.remove(), { once: true })
            card.append(cover)
          }
          const motto = art('span', 'motto', '愿每一次游玩，都有星光作伴')
          motto.setAttribute('aria-hidden', 'true')
          const medal = art('img', 'medal')
          medal.alt = ''
          medal.src = '/profile-bridge/achievement-medal.webp'
          medal.addEventListener('error', () => medal.remove(), { once: true })
          const stars = art('div', 'stars')
          for (let i = 0; i < 6; i++) stars.append(document.createElement('span'))
          stars.setAttribute('aria-hidden', 'true')
          const badge = art('span', 'badge', achievement.rounds)
          badge.setAttribute('aria-hidden', 'true')
          const pills = art('div', 'pills')
          const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : '—'
          const date = ms => typeof ms === 'number' && ms > 0 && ms <= 8.64e15
            ? new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).replaceAll('-', '.') : '—'
          const words = number(achievement.contextChars)
          for (const [icon, label, value] of [
            ['name', '人物卡', achievement.cardName || '—'],
            ['words', '总字数', words === '—' ? words : words + ' 字'],
            ['date', '开始游玩', date(achievement.startedAt)],
          ]) {
            const pill = art('div', 'pill')
            const symbol = art('span', 'icon')
            symbol.dataset.icon = icon
            symbol.setAttribute('aria-hidden', 'true')
            const field = art('span', 'pill-value', value)
            if (icon === 'name') field.title = value
            pill.append(symbol, art('span', 'pill-label', label), field)
            pills.append(pill)
          }
          const sticker = art('div', 'sticker')
          sticker.append(document.createTextNode('游玩满 '), art('b', 'sticker-number', achievement.rounds),
            document.createTextNode(' 轮！'))
          const result = art('div', 'result')
          result.append(sticker, art('strong', 'title', achievement.title))
          const footer = art('div', 'footer', 'DSH Tavern 游玩纪念 · ' + date(achievement.unlockedAt))
          card.append(motto, medal, stars, badge, pills, result, footer)
          layer.append(shade, aura, card)
          if (typeof layer.showPopover === 'function') layer.setAttribute('popover', 'manual')
          document.body.append(layer)
          if (layer.hasAttribute('popover')) layer.showPopover()

          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          if (typeof card.animate === 'function') {
            const enter = [{ opacity: 0 }, { opacity: 1 }]
            if (!reduced) {
              enter[0].transform = 'translateY(15%) rotate(-4deg) scale(.9)'
              enter[0].easing = EASE_OUT
              enter[1].transform = 'translateY(0) rotate(0deg) scale(1)'
              enter.splice(1, 0, { transform: 'translateY(-2%) rotate(1deg) scale(1.045)', opacity: 1, offset: .64 })
              const preset = CELEBRATIONS[achievement.id] ?? CELEBRATIONS.bronze
              const width = card.offsetWidth
              preset.bursts.forEach((count, index) => scatterConfetti(layer, width, preset, count, 70 + index * 240))
              shineAcrossCard(card)
              if (achievement.id === 'rainbow') {
                aura.animate([{ transform: 'rotate(-35deg)' }, { transform: 'rotate(0deg)' }], { duration: 1100, easing: EASE_OUT })
              }
            }
            card.animate(enter, { duration: ENTER_MS, easing: reduced ? EASE_OUT : 'linear' })
            for (const backdrop of [shade, aura]) {
              backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE_OUT })
            }
          }
          timer = window.setTimeout(() => flyToSettings(layer, card, shade, aura, reduced), DISPLAY_MS)
        }

        function followGame() {
          const next = mainGameId(sessions)
          if (next === gameId) return
          gameId = next
          unwatch?.()
          clearCelebration()
          unwatch = next ? ui.watchState(next, 'achievement', payload => {
            if (!payload?.id || disposed || gameId !== next) return
            window.dispatchEvent(new window.Event(UNLOCK_EVENT))
            if (document.visibilityState === 'hidden') return
            void ui.callHost(name + '/claim-achievement', { gameId: next, id: payload.id }).then(achievement => {
              if (!disposed && gameId === next && document.visibilityState !== 'hidden' && achievement) show(achievement)
            }, () => {})
          }) : undefined
        }

        const unsubscribe = sessions.list.subscribe(followGame)
        followGame()
        return () => {
          disposed = true
          unsubscribe()
          unwatch?.()
          clearCelebration()
          style.remove()
        }
      }, 'adventure-medal: achievement celebration')
    }

    return { name, inject: ['tavernUi', 'sessions'], apply }
  },
})
