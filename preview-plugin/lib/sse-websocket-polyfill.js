export const sseWebSocketPolyfill = String.raw`
(() => {
  class PreviewSseWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
      super()
      this.url = String(url)
      this.readyState = PreviewSseWebSocket.CONNECTING
      this.controller = new AbortController()
      this.connect()
    }

    async connect() {
      const target = new URL(this.url)
      target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'
      try {
        const response = await fetch(target, { signal: this.controller.signal })
        if (!response.ok || response.body === null) throw new Error('SSE transport failed: ' + response.status)
        this.readyState = PreviewSseWebSocket.OPEN
        this.dispatchEvent(new Event('open'))
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = chunk.split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('')
            if (data !== '') this.dispatchEvent(new MessageEvent('message', { data }))
          }
        }
      } catch (error) {
        if (!this.controller.signal.aborted) this.dispatchEvent(new Event('error'))
      } finally {
        if (this.readyState !== PreviewSseWebSocket.CLOSED) {
          this.readyState = PreviewSseWebSocket.CLOSED
          this.dispatchEvent(new CloseEvent('close'))
        }
      }
    }

    close() {
      if (this.readyState === PreviewSseWebSocket.CLOSED) return
      this.readyState = PreviewSseWebSocket.CLOSING
      this.controller.abort()
    }
  }

  window.WebSocket = PreviewSseWebSocket
})()
`
