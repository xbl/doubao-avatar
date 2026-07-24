export type RagHit = {
  id?: string
  score: number
  title: string
  text: string
  source_id?: string
  chunk_type?: string
  hsk_level?: number
  metadata?: {
    pinyin?: string
    pos?: string
    [key: string]: unknown
  }
}

export type ExternalRagItem = {
  title: string
  content: string
}

export const EXTERNAL_RAG_GUIDE =
  '可在回复中自然用到下列材料；保持口语聊天，勿逐条讲解、勿变课堂。\n'

const CARD_BODY_MAX = 120
const PAYLOAD_CHAR_LIMIT = 3800
/** Absolute floor: max score below this → skip whole turn (noise). */
const MIN_MAX_SCORE = 8
/** Keep hits at least this fraction of the best score. */
const RELATIVE_SCORE_RATIO = 0.5

export type RagConfig = {
  enabled: boolean
  baseUrl: string
  topK: number
  timeoutMs: number
}

export function getRagConfig(): RagConfig {
  const enabledRaw = import.meta.env.VITE_RAG_ENABLED
  const enabled =
    enabledRaw === undefined || enabledRaw === ''
      ? true
      : !['0', 'false', 'off', 'no'].includes(String(enabledRaw).trim().toLowerCase())

  const topK = Number(import.meta.env.VITE_RAG_TOP_K || 2)
  const timeoutMs = Number(import.meta.env.VITE_RAG_TIMEOUT_MS || 300)

  return {
    enabled,
    baseUrl: (import.meta.env.VITE_RAG_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    topK: Number.isFinite(topK) && topK > 0 ? Math.min(Math.floor(topK), 5) : 2,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300,
  }
}

export function shorten(text: string, maxChars: number): string {
  const t = text.trim()
  if (t.length <= maxChars) return t
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`
}

export function filterStrongHits(hits: RagHit[], topK: number): RagHit[] {
  if (!hits.length) return []
  const sorted = [...hits].sort((a, b) => b.score - a.score)
  const maxScore = sorted[0]?.score ?? 0
  if (maxScore < MIN_MAX_SCORE) return []
  const threshold = maxScore * RELATIVE_SCORE_RATIO
  return sorted.filter((h) => h.score >= threshold).slice(0, topK)
}

export function toCard(hit: RagHit): ExternalRagItem {
  const title = (hit.title || hit.source_id || 'note').trim() || 'note'
  const pinyin = hit.metadata?.pinyin ? `（${hit.metadata.pinyin}）` : ''
  const body = shorten(hit.text || '', CARD_BODY_MAX)
  return {
    title,
    content: `${title}${pinyin}。${body}`,
  }
}

export function toExternalRagItems(hits: RagHit[]): ExternalRagItem[] {
  const cards = hits.map(toCard)
  if (!cards.length) return []
  return cards.map((card, index) =>
    index === 0
      ? { ...card, content: `${EXTERNAL_RAG_GUIDE}${card.content}` }
      : card,
  )
}

/** Build Doubao ChatRAGText external_rag string, or null if nothing to send. */
export function toExternalRagPayload(hits: RagHit[]): string | null {
  let items = toExternalRagItems(hits)
  if (!items.length) return null

  while (items.length > 0) {
    const serialized = JSON.stringify(items)
    if (serialized.length <= PAYLOAD_CHAR_LIMIT) return serialized
    items = items.slice(0, -1)
  }
  return null
}

export type RetrieveResult = {
  query: string
  hits: RagHit[]
  kept: RagHit[]
  tookMs: number
  externalRag: string | null
}

/**
 * Shallow retrieve from local RAG. Never throws for network/timeout —
 * callers treat null/empty as "skip 502".
 */
export async function retrieveForQuery(
  query: string,
  options: {
    signal?: AbortSignal
    config?: RagConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<RetrieveResult | null> {
  const q = query.trim()
  const cfg = options.config ?? getRagConfig()
  if (!cfg.enabled) {
    console.info('[rag] skip: disabled')
    return null
  }
  if (!q) {
    console.info('[rag] skip: empty asr')
    return null
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)

  const started = performance.now()
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, top_k: cfg.topK }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[rag] skip: http ${res.status}`)
      return null
    }
    const data = (await res.json()) as { hits?: RagHit[]; took_ms?: number }
    const hits = Array.isArray(data.hits) ? data.hits : []
    const kept = filterStrongHits(hits, cfg.topK)
    const tookMs = Math.round(performance.now() - started)
    const externalRag = toExternalRagPayload(kept)
    console.info(
      `[rag] retrieve query=${JSON.stringify(q)} hits=${hits.length} kept=${kept.length} took_ms=${tookMs}`,
    )
    if (!externalRag) {
      console.info('[rag] skip: no hits | low score')
    }
    return {
      query: q,
      hits,
      kept,
      tookMs,
      externalRag,
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'AbortError') {
      console.info('[rag] skip: timeout')
    } else {
      console.warn('[rag] skip: fetch failed', e)
    }
    return null
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
