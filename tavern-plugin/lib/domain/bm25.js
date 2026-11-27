// —— bigram 分词（照 ACU collectBm25Tokens/pushCjkTokens）：中文拆单字+双字滑窗，英文/数字保持整词 ——
function pushCjkTokens(tokens, segment) {
  for (const char of segment) tokens.push(char)
  for (let index = 0; index < segment.length - 1; index += 1) tokens.push(segment.slice(index, index + 2))
}

export function tokenizeBigram(text) {
  const normalized = String(text ?? '').toLocaleLowerCase()
  const tokens = []
  const pattern = /[a-z0-9_]+|[\u3400-\u9fff]+/gi
  let match
  while ((match = pattern.exec(normalized)) !== null) {
    const part = match[0]
    if (!part) continue
    if (/^[\u3400-\u9fff]+$/u.test(part)) pushCjkTokens(tokens, part)
    else tokens.push(part)
  }
  return tokens
}

// Compact postings: doc index and capped term frequency share one integer.
const BM25_K1 = 1.5
const BM25_B = 0.75
const BM25_TF_SCALE = 4096

export function buildBm25Index(documents) {
  const index = new Map()
  const docLengths = []
  let totalTokens = 0
  documents.forEach((text, docIdx) => {
    const tokens = tokenizeBigram(text)
    docLengths.push(tokens.length)
    totalTokens += tokens.length
    const tf = new Map()
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1)
    for (const [token, count] of tf) {
      let postings = index.get(token)
      if (!postings) { postings = []; index.set(token, postings) }
      postings.push(docIdx * BM25_TF_SCALE + Math.min(count, BM25_TF_SCALE - 1))
    }
  })
  for (const [token, postings] of index) index.set(token, Int32Array.from(postings))
  return {
    count: documents.length,
    avgdl: documents.length ? totalTokens / documents.length : 0,
    index, docLengths: Int32Array.from(docLengths),
  }
}

export function bm25Scores(queryTokens, corpus, candidates) {
  const scores = new Float64Array(corpus.count)
  for (const token of queryTokens) {
    const postings = corpus.index.get(token)
    if (!postings) continue
    const df = postings.length
    const idf = Math.log(1 + (corpus.count - df + 0.5) / (df + 0.5))
    for (let i = 0; i < postings.length; i++) {
      const packed = postings[i]
      const docIdx = Math.floor(packed / BM25_TF_SCALE)
      if (candidates && !candidates.has(docIdx)) continue
      const tf = packed % BM25_TF_SCALE
      const norm = 1 - BM25_B + BM25_B * (corpus.docLengths[docIdx] / Math.max(1, corpus.avgdl))
      scores[docIdx] += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm))
    }
  }
  return scores
}

export function hasPosting(postings, docIdx) {
  if (!postings) return false
  let lo = 0, hi = postings.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = Math.floor(postings[mid] / BM25_TF_SCALE)
    if (at === docIdx) return true
    if (at < docIdx) lo = mid + 1
    else hi = mid - 1
  }
  return false
}
