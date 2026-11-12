    function useImageDraft(name, initial, revision = '', recover, revisionFollowsSource = false) {
      const key = 'dsh-image-draft-v2:' + name
      const initialText = JSON.stringify(initial)
      const source = React.useRef({ text: initialText, revision })
      const [value, setValue] = React.useState(() => {
        try {
          const cached = JSON.parse(localStorage.getItem(key) || 'null')
          if (cached && Object.hasOwn(cached, 'value')) {
            source.current = { text: cached.base, revision: cached.revision || '' }
            return cached.value
          }
        } catch {}
        return recover ? recover() : initial
      })
      const history = React.useRef([])
      const [undoCount, setUndoCount] = React.useState(0)
      const current = React.useRef(value)
      current.current = value
      // A shared revision may change when a referenced entry is saved while this source stays identical.
      if (revisionFollowsSource && source.current.text === initialText) source.current.revision = revision
      const dirty = JSON.stringify(value) !== source.current.text
      React.useEffect(() => {
        if (JSON.stringify(current.current) === source.current.text || JSON.stringify(current.current) === initialText) {
          source.current = { text: initialText, revision }
          setValue(initial)
        }
      }, [initialText, revision])
      React.useEffect(() => {
        const persist = () => {
          try {
            if (JSON.stringify(current.current) === source.current.text) localStorage.removeItem(key)
            else localStorage.setItem(key, JSON.stringify({ value: current.current, base: source.current.text, revision: source.current.revision }))
          } catch {}
        }
        const timer = setTimeout(persist, 180)
        window.addEventListener('pagehide', persist)
        return () => { clearTimeout(timer); persist(); window.removeEventListener('pagehide', persist) }
      }, [value, key])
      const update = (next, recordUndo = true) => {
        history.current = recordUndo ? [...history.current.slice(-19), current.current] : []
        setUndoCount(history.current.length)
        const updated = typeof next === 'function' ? next(current.current) : next
        current.current = updated
        setValue(updated)
      }
      const reset = (next = initial, nextRevision = revision, retained = next) => {
        source.current = { text: JSON.stringify(next), revision: nextRevision }
        current.current = retained
        history.current = []
        setUndoCount(0)
        setValue(retained)
        try { localStorage.removeItem(key) } catch {}
      }
      return {
        value, update, reset, dirty, revision: source.current.revision,
        conflict: dirty && Boolean(source.current.revision && revision && source.current.revision !== revision),
        canUndo: undoCount > 0,
        undo: () => {
          if (!history.current.length) return
          const next = history.current.pop()
          current.current = next
          setValue(next)
          setUndoCount(history.current.length)
          return next
        },
      }
    }
