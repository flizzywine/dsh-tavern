    function ImageEditWorkbench({ workflows = [], config = {}, source, onClose }) {
      const [images, setImages] = React.useState([])
      const [workflowId, setWorkflowId] = React.useState('')
      const [prompt, setPrompt] = React.useState('')
      const [usage, setUsage] = React.useState('plugin')
      const [busy, setBusy] = React.useState(false)
      const [job, setJob] = React.useState(null)
      const [note, setNote] = React.useState('')
      const pending = React.useRef(false)
      const lifetime = React.useRef(null)
      React.useEffect(() => {
        const controller = new AbortController(); lifetime.current = controller
        return () => controller.abort()
      }, [])
      const worldbook = config.promptSystem === 'worldbook'
      const templates = [...(config.promptDefault?.structure ? [{ ...config.promptDefault, id: '__default__' }] : []), ...(config.promptPresets || [])]
        .filter(item => item.enabled !== false && item.structure && item.structure.purpose !== 'generate')
      const imageWorkflows = workflows.filter(item => !item.error && item.enabled !== false && item.referenceCapacity !== 0)
      const available = !worldbook && templates.length ? templates : imageWorkflows
      const chosen = available.find(item => item.id === workflowId) || available.find(item => item.current) || available[0]
      const choosingTemplate = !worldbook && templates.length > 0
      async function putBlob(blob, name) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(blob)
        })
        const result = await jsonFetch(BASE + '/reference-image', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data, mediaType: blob.type, name }), signal: lifetime.current?.signal })
        if (!result.referenceImage) throw new Error(result.error || '图片上传失败')
        return result.referenceImage
      }
      React.useEffect(() => {
        if (!source?.url) return
        let alive = true
        setBusy(true)
        fetch(source.url, { signal: lifetime.current?.signal }).then(response => { if (!response.ok) throw new Error('无法读取原图'); return response.blob() })
          .then(blob => putBlob(blob, source.name || '已有图片')).then(image => { if (alive) setImages([image]) })
          .catch(error => { if (alive) setNote(error.message) }).finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [source?.url])
      async function upload(event) {
        const files = Array.from(event.target.files || []); event.target.value = ''
        if (busy || pending.current) return
        if (files.length + images.length > 16) { setNote('一次最多 16 张图片'); return }
        setBusy(true); setNote('')
        try {
          const added = []
          for (const file of files) added.push(await putBlob(file, file.name))
          setImages(current => [...current, ...added]); setJob(null)
        } catch (error) { setNote(error.message) }
        finally { setBusy(false) }
      }
      async function generate() {
        if (busy || pending.current || !chosen  || !images.length) return
        pending.current = true; setBusy(true); setNote(''); setJob(null)
        try {
          const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
          const result = await jsonFetch(BASE + '/image-edit', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...(choosingTemplate ? { templateId: chosen.id } : { workflowId: chosen.id }), prompt, sourceImages: images, requestId, usage }), signal: lifetime.current?.signal })
          setJob(result.job)
        } catch (error) { setNote(error.message) }
        finally { pending.current = false; setBusy(false) }
      }
      const running = job && ['pending', 'running'].includes(job.state)
      React.useEffect(() => {
        if (!running) return
        const controller = new AbortController()
        const timer = setTimeout(async () => {
          try { const result = await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(job.id), { signal: controller.signal }); setJob(result.job) }
          catch (error) { if (!controller.signal.aborted) { setNote(error.message); setJob(current => ({ ...current })) } }
        }, 1500)
        return () => { clearTimeout(timer); controller.abort() }
      }, [job, running])
      const locked = busy || running
      const resultUrl = job?.state === 'done' ? BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1' : ''
      function move(index, offset) { setImages(current => { const next = current.slice(); [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next }) }
      return h('div', { role: onClose ? 'dialog' : undefined, 'aria-label': '图片编辑', style: onClose ? {
        position: 'fixed', inset: '56px max(16px, 8vw) 24px', zIndex: 2147483250, background: 'var(--dsw-specific-input-major, Canvas)',
        color: 'var(--dsw-alias-label-primary, CanvasText)', border: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', borderRadius: 12, padding: 16, overflow: 'auto', boxShadow: '0 12px 60px #0005'
      } : S.card },
        h('div', { style: S.row }, onClose ? h('button', { type: 'button', style: buttonStyle, onClick: onClose }, '返回画廊') : null, h('strong', null, '图片编辑')),
        h('select', { 'aria-label': choosingTemplate ? '改图模板' : '图片编辑工作流', style: { ...S.input, margin: '10px 0', maxWidth: '100%' }, value: chosen?.id || '', disabled: locked,
          onChange: event => setWorkflowId(event.target.value) }, available.length ? available.map(item => h('option', { key: item.id, value: item.id }, item.name || item.label || item.id)) : h('option', { value: '' }, '先导入图生图工作流')),
        h(PromptUsageField, { label: '图片用途', value: usage, allowAll: false, editable: !locked, onChange: setUsage }),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, images.map((image, index) => h('div', { key: image.id + ':' + index, style: { width: 112 } },
          h('img', { src: BASE + '/reference-image?id=' + image.id, alt: 'image' + (index + 1), style: { width: 112, height: 96, objectFit: 'contain', borderRadius: 8, background: 'color-mix(in srgb, currentColor 5%, transparent)' } }),
          h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px' }, disabled: locked, title: '插入图片引用', onClick: () => setPrompt(current => current + '<image' + (index + 1) + '>') }, 'image' + (index + 1)),
          index ? h('button', { type: 'button', style: buttonStyle, disabled: locked, onClick: () => move(index, -1), 'aria-label': '前移图片 ' + (index + 1) }, '前移') : null,
          h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px' }, disabled: locked, onClick: () => setImages(current => current.filter((_, at) => at !== index)) }, '移除')))),
        h('label', { style: { display: 'block', margin: '10px 0', fontSize: 12 } }, '添加输入图片', h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp', disabled: locked, onChange: upload })),
        h('textarea', { 'aria-label': '图片编辑指令', style: { ...S.input, width: '100%', boxSizing: 'border-box', minHeight: 100 }, value: prompt,
          placeholder: '可直接使用所选模板；也可以写：扩展 <image1> 背景，或让 <image1> 换上 <image2> 的衣服。', disabled: locked, onChange: event => setPrompt(event.target.value) }),
        h('div', { style: { ...S.row, marginTop: 10 } }, h('button', { type: 'button', style: buttonStyle, disabled: locked || !chosen || !images.length, onClick: generate }, locked ? '处理中…' : '生成编辑图片'),
          running ? h('button', { type: 'button', style: buttonStyle, onClick: async () => { await jsonFetch(BASE + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id }) }); setJob(current => ({ ...current, state: 'cancelled' })) } }, '取消任务') : null),
        note || job?.error ? h('p', { role: 'alert', style: STRUCTURE_MUTED }, note || job.error) : null,
        job ? h('p', { role: 'status', style: STRUCTURE_MUTED }, ({ done: '编辑完成', failed: '编辑失败', cancelled: '已取消', pending: '排队中', running: '生成中' })[job.state] || job.state) : null,
        resultUrl ? h('div', null, h('img', { src: resultUrl, alt: '编辑结果', style: { maxWidth: '100%', maxHeight: 350, objectFit: 'contain', marginTop: 10 } }),
          h('button', { type: 'button', style: buttonStyle, onClick: async () => {
            setBusy(true)
            try { const response = await fetch(resultUrl); if (!response.ok) throw new Error('无法读取结果'); const image = await putBlob(await response.blob(), '上次编辑结果'); setImages([image]); setJob(null) }
            catch (error) { setNote(error.message) } finally { setBusy(false) }
          } }, '用结果继续图生图')) : null)
    }

    let showImageEdit = null
    function openImageEditFor(jobId, title, url) {
      if (!jobId && !url) return
      showImageEdit?.({ url: url || BASE + '/jobs?id=' + encodeURIComponent(jobId) + '&image=1', name: title || '已有图片' })
    }
    function ImageOverlayHost() {
      const [source, setSource] = React.useState(null)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      React.useEffect(() => { showImageEdit = setSource; return () => { showImageEdit = null } }, [])
      React.useEffect(() => {
        if (!source) return
        const controller = new AbortController(); setState(null); setError('')
        jsonFetch(BASE + '/state', { signal: controller.signal }).then(setState).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
        return () => controller.abort()
      }, [source])
      return h(React.Fragment, null, h(ImageOverlay), source && state ? h(ImageEditWorkbench, { workflows: state.workflows || [], config: state.config || {}, source, onClose: () => setSource(null) }) : null,
        source && error ? h('div', { role: 'alert', style: { position: 'fixed', zIndex: 2147483250, top: 70, left: '10%', background: 'Canvas', color: 'CanvasText', padding: 16 } }, error,
          h('button', { type: 'button', onClick: () => setSource(null) }, '关闭')) : null)
    }
