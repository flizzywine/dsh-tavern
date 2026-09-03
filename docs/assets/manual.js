(() => {
  const pages = [...document.querySelectorAll('.doc-page')]
  const byId = new Map(pages.map(page => [page.id, page]))
  const sidebar = document.getElementById('sidebar')
  const menu = document.getElementById('menu-toggle')
  const toc = document.getElementById('toc-links')
  const dialog = document.getElementById('search-dialog')
  const search = document.getElementById('doc-search')
  let current = null
  const storage = { get: key => { try { return localStorage.getItem(key) } catch { return null } }, set: (key, value) => { try { localStorage.setItem(key, value) } catch { /* Reading works without storage. */ } } }
  const closeMenu = () => { sidebar.classList.remove('mobile-open'); document.body.classList.remove('menu-open'); menu.setAttribute('aria-expanded', 'false') }
  function route(focus = false) {
    if (location.hash === '#main' && current) { current.querySelector('h1')?.focus({ preventScroll: true }); return }
    const { id, target: hash } = DshManualState.resolveRoute(location.hash, [...byId.keys()])
    const page = byId.get(id) || byId.get('not-found')
    const changed = page !== current
    if (!current || page.dataset.group !== current.dataset.group) for (const group of document.querySelectorAll('.nav-group')) {
      const children = group.querySelector('.nav-children'), button = group.querySelector('.group-toggle')
      children.hidden = group.dataset.group !== page.dataset.group
      button.setAttribute('aria-expanded', String(!children.hidden))
      button.setAttribute('aria-label', `${children.hidden ? '展开' : '折叠'}${group.querySelector('a').textContent}`)
    }
    for (const item of pages) item.hidden = item !== page
    document.documentElement.classList.add('js')
    current = page
    document.title = `${page.dataset.title} · DSH Tavern 文档`
    toc.replaceChildren(...[...page.querySelectorAll('h2')].map(heading => { const a = document.createElement('a'); a.href = `#${heading.id}`; a.textContent = heading.textContent; return a }))
    for (const a of document.querySelectorAll('.sidebar a, .site-header nav a')) {
      const group = a.closest('.nav-group')
      const active = a.getAttribute('href') === `#${page.id}` && (!group || group.dataset.group === page.dataset.group)
      if (active) {
        a.setAttribute('aria-current', 'page')
        const chapter = a.closest('details'); if (chapter) chapter.open = true
        const children = a.closest('.nav-children'); if (children) { children.hidden = false; document.querySelector(`[aria-controls="${children.id}"]`)?.setAttribute('aria-expanded', 'true') }
      } else a.removeAttribute('aria-current')
    }
    closeMenu()
    const target = hash.includes('--') && page.querySelector(`[id="${CSS.escape(hash)}"]`)
    if (target) target.scrollIntoView()
    else if (changed) window.scrollTo(0, 0)
    if (focus && changed) page.querySelector('h1').focus({ preventScroll: true })
  }
  for (const button of document.querySelectorAll('.group-toggle')) button.addEventListener('click', () => { const el = document.getElementById(button.getAttribute('aria-controls')); el.hidden = !el.hidden; button.setAttribute('aria-expanded', String(!el.hidden)); button.setAttribute('aria-label', `${el.hidden ? '展开' : '折叠'}${button.closest('.nav-group').querySelector('a').textContent}`) })
  menu.addEventListener('click', () => { const open = !sidebar.classList.contains('mobile-open'); sidebar.classList.toggle('mobile-open', open); document.body.classList.toggle('menu-open', open); menu.setAttribute('aria-expanded', String(open)) })
  for (const button of document.querySelectorAll('.copy-code')) {
    button.hidden = false
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.closest('.code-block').querySelector('code').textContent)
        button.textContent = '已复制'
      } catch { button.textContent = '请选中文字复制' }
      setTimeout(() => { button.textContent = '复制' }, 2500)
    })
  }
  const themeButton = document.getElementById('theme-toggle')
  const saved = storage.get('dsh-docs-theme')
  const setTheme = theme => { document.documentElement.dataset.theme = theme; themeButton.setAttribute('aria-label', `切换${theme === 'dark' ? '浅色' : '深色'}主题`) }
  setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  themeButton.hidden = false
  themeButton.addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(next); storage.set('dsh-docs-theme', next) })
  const searchable = pages.filter(page => page.id !== 'not-found' && page.id !== 'index').map(page => ({ id: page.id, title: page.dataset.title, text: page.textContent.replace(/\s+/g, ' ').toLowerCase(), group: page.dataset.group }))
  function results() {
    const value = search.value.trim().toLowerCase()
    const matched = DshManualState.searchPages(searchable, value)
    document.getElementById('search-status').textContent = value ? matched.length ? `找到 ${matched.length} 篇相关说明` : '没有找到结果。试试“候选”“预设”或“历史”。' : '输入功能名称、操作或关键词。'
    document.getElementById('search-results').replaceChildren(...matched.map(p => { const li = document.createElement('li'), a = document.createElement('a'), title = document.createElement('span'), desc = document.createElement('small'); a.href = `#${p.id}`; title.textContent = p.title; desc.textContent = byId.get(p.group)?.dataset.title || '功能说明'; a.append(title, desc); a.addEventListener('click', () => { dialog.close(); if (current?.id === p.id) current.querySelector('h1').focus({ preventScroll: true }) }); li.append(a); return li }))
  }
  const openSearch = () => { if (!dialog.open) dialog.showModal(); results(); search.focus() }
  const trigger = document.querySelector('.search-trigger'); trigger.hidden = false; trigger.addEventListener('click', openSearch)
  document.getElementById('search-close').addEventListener('click', () => dialog.close())
  search.addEventListener('input', results)
  search.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector('#search-results a')?.focus() } if (event.key === 'Enter') document.querySelector('#search-results a')?.click() })
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch() }
    if (event.key === 'Escape') closeMenu()
  })
  window.addEventListener('hashchange', () => route(true))
  route()
})()
