// What a generated picture cost. The price list lives here and nowhere else: change IMAGE_PRICES when OpenAI changes its
// list (page and date below). A picture is priced from the `usage` the Images API returned with it (exact), or, when the
// channel gave none, from its request (an estimate, flagged `estimated: true`).
// Source: https://developers.openai.com/api/docs/pricing#image-generation (standard speed), read 2026-11-11.
export const IMAGE_PRICES = {
  source: 'https://developers.openai.com/api/docs/pricing#image-generation',
  checkedAt: '2026-11-11',
  // USD per 1M tokens, matched by the model name's prefix (after any "provider/" a relay adds); first match wins.
  models: [
    ['gpt-image-2', {textIn: 5, imageIn: 8, imageOut: 30}],
    ['gpt-image-1.5', {textIn: 5, imageIn: 8, imageOut: 32}],
    ['gpt-image-1-mini', {textIn: 2, imageIn: 2.5, imageOut: 8}],
    ['chatgpt-image-latest', {textIn: 5, imageIn: 8, imageOut: 32}],
  ],
}
// Output tokens of one picture by quality and shape [square 1024x1024, portrait 1024x1536, landscape 1536x1024]. gpt-image-2: the
// per-picture output prices of the image generation guide divided by its $30/M; the others: the guide's legacy token table.
const OUTPUT_TOKENS = {
  'gpt-image-2': {low: [200, 167, 167], medium: [1767, 1367, 1367], high: [7033, 5500, 5500]},
  legacy: {low: [272, 408, 400], medium: [1056, 1584, 1568], high: [4160, 6240, 6208]},
}
// Input tokens of one reference picture on the edits endpoint: one 32 px patch each (measured 2026-11-11 on gpt-image-2.5-flare: a
// 1024x1024 reference billed 1024 image tokens; larger pictures are not measured).
const referenceTokens = ([width, height]) => Math.ceil(width / 32) * Math.ceil(height / 32)

const nameOf = model => String(model ?? '').split('/').pop().toLowerCase()
export const imageRates = model => IMAGE_PRICES.models.find(([prefix]) => nameOf(model).startsWith(prefix))?.[1] ?? null
const tokens = value => Number.isFinite(value) && value > 0 ? Math.round(value) : 0
// ~1 token per CJK character, ~4 characters per token for the rest.
const textTokens = text => { const cjk = (String(text).match(/[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g) || []).length; return Math.ceil(cjk + (String(text).length - cjk) / 4) }

/** The request's own usage, shaped like the Images API's `usage`, for a channel that returned none. references: [[width, height], ...]. */
export function estimateUsage(model, {prompt = '', width = 1024, height = 1024, quality = 'auto', references = []} = {}) {
  const shape = width > height * 1.15 ? 2 : height > width * 1.15 ? 1 : 0
  const table = nameOf(model).startsWith('gpt-image-2') ? OUTPUT_TOKENS['gpt-image-2'] : OUTPUT_TOKENS.legacy
  const out = table[['low', 'medium', 'high'].includes(quality) ? quality : 'medium'][shape]
  const text = textTokens(prompt), image = references.reduce((sum, size) => sum + referenceTokens(size), 0)
  return {input_tokens: text + image, output_tokens: out, total_tokens: text + image + out, input_tokens_details: {text_tokens: text, image_tokens: image}}
}

/** {usd, estimated, model, usage}; usd is null when the model has no entry in IMAGE_PRICES. */
export function imageCost({model, usage, request}) {
  const exact = usage && typeof usage === 'object' && tokens(usage.output_tokens) > 0
  const used = exact ? usage : estimateUsage(model, request)
  const rates = imageRates(model)
  const details = used.input_tokens_details || {}
  const imageIn = tokens(details.image_tokens), textIn = details.text_tokens === undefined ? tokens(used.input_tokens) - imageIn : tokens(details.text_tokens)
  const usd = rates ? (textIn * rates.textIn + imageIn * rates.imageIn + tokens(used.output_tokens) * rates.imageOut) / 1e6 : null
  return {usd: usd === null ? null : Math.round(usd * 1e6) / 1e6, estimated: !exact, model: model ?? null, usage: used}
}

const empty = () => ({version: 1, since: null, usd: 0, images: 0, estimated: 0, unpriced: 0, models: {}})
/** The running total, a new object. One picture adds to it and to its model's row. */
export function addCost(total = empty(), cost, at) {
  const key = cost.model ?? 'unknown', row = total.models[key] || {images: 0, estimated: 0, usd: 0}
  const priced = cost.usd ?? 0
  return {...total, since: total.since ?? at, usd: Math.round((total.usd + priced) * 1e6) / 1e6, images: total.images + 1, estimated: total.estimated + (cost.estimated ? 1 : 0), unpriced: total.unpriced + (cost.usd === null ? 1 : 0),
    models: {...total.models, [key]: {images: row.images + 1, estimated: row.estimated + (cost.estimated ? 1 : 0), usd: Math.round((row.usd + priced) * 1e6) / 1e6}}}
}
