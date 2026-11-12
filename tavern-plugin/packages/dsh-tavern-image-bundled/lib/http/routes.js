// HTTP registration only. Business operations stay on the injected engine.
const CONSOLE_ROUTES = [
  ["state","state"],
  ["runtime","runtime"],
  ["plugin-update","plugin-update"],
  ["plugin-update/check","plugin-update-check"],
  ["plugin-update/apply","plugin-update-apply"],
  ["config","config"],
  ["workflow","workflow"],
  ["reload","reload"],
  ["reference-image","reference-image"],
  ["image-edit","image-edit"],
  ["definitions","definitions"],
  ["export-all","export-all"],
  ["import-all","import-all"],
  ["import-characters","import-characters"],
  ["generate","generate"],
  ["history","history"],
  ["gallery-item","gallery-item"],
  ["gallery-delete","gallery-delete"],
  ["character-history","character-history"],
  ["plan","plan"],
  ["plans","plans"],
  ["vision","vision"],
  ["design","design"],
  ["cancel","cancel"],
  ["report","report"],
  ["img","img"],
  ["cards","cards"],
  ["delete-job","delete-job"],
  ["worldbook","worldbook"],
  ["worldbook-import","worldbook-import"],
  ["worldbook-entry","worldbook-entry"],
  ["worldbook-add","worldbook-add"],
  ["worldbook-export","worldbook-export"],
  ["worldbook-upgrade","worldbook-upgrade"],
  ["generate-outfits","generate-outfits"],
  ["generate-outfits-bulk","generate-outfits-bulk"],
  ["generate-characters-minor","generate-characters-minor"],
  ["plugin-download","plugin-download"],
  ["media-action","media-action"],
  ["prompt-preview","prompt-preview"],
  ["prompt-plan","prompt-plan"],
  ["prompt-tryout","prompt-tryout"],
  ["workflow-import","workflow-import"],
  ["workflow-series","workflow-series"],
  ["workflow-bindings","workflow-bindings"],
  ["workflow-test","workflow-test"],
  ["workflow-values","workflow-values"],
  ["workflow-graph","workflow-graph"],
  ["image-channel-test","image-channel-test"],
  ["llm-models","llm-models"],
  ["comfy-test","comfy-test"],
  ["loras-available","loras-available"],
  ["job-detail","job-detail"],
  ["redraw","redraw"],
  ["improve-prompt","improve-prompt"],
]

export function registerImageRoutes(ctx, { ready, logger, base, legacyBase, sendJson, handlers }) {
  const route = (path, handler) => {
    const paths = [path]
    if (path.startsWith(base + '/')) paths.push(legacyBase + path.slice(base.length))
    for (const routePath of paths) {
      const install = () => ctx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: (request, response) => {
          const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
          Promise.resolve(ready().then(engine => handler(request, response, url, engine)))
            .catch(error => {
              logger.error?.(`dsh-tavern-image: ${error?.message ?? error}`)
              if (!response.headersSent) sendJson(response, 500, { ok: false, error: error?.message ?? String(error) })
              else response.end()
            })
        },
      })
      if (typeof ctx.effect === 'function') ctx.effect(install, `dsh-tavern-image: ${routePath}`)
      else install()
    }
  }

  route(base + '/console', handlers.console)
  for (const [path, action] of CONSOLE_ROUTES) route(base + '/' + path, (request, response, url, engine) => engine.handleConsole(action, request, response, url))
  route(base + '/jobs', handlers.jobs)
  route(base + '/attach-turn', handlers.attachTurn)
  route(base + '/draw-turn', handlers.attachTurn)
}
