import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_RAG_GUIDE,
  filterStrongHits,
  shorten,
  toExternalRagItems,
  toExternalRagPayload,
  type RagHit,
} from './ragClient'

/** Mirrors local hybrid 8787 scale (score ~0–1+, score_keyword for lexical strength). */
const sampleHits: RagHit[] = [
  {
    id: '1',
    score: 1.01,
    score_keyword: 108,
    title: '谢谢',
    text: '【词汇】谢谢（xièxie）。词性：动。释义：表示感谢。例句：谢谢你。'.repeat(3),
    metadata: { pinyin: 'xièxie' },
  },
  {
    id: '2',
    score: 0.5,
    score_keyword: 16,
    title: '不客气',
    text: '【词汇】不客气。例句：不客气。',
    metadata: { pinyin: 'bú kèqi' },
  },
  {
    id: '3',
    score: 0.61,
    score_keyword: 0,
    title: '噪声',
    text: '弱相关条目',
  },
]

describe('shorten', () => {
  it('keeps short text and truncates long text', () => {
    expect(shorten('短', 10)).toBe('短')
    expect(shorten('一二三四五六七八九十十一', 8)).toBe('一二三四五六七…')
  })
})

describe('filterStrongHits', () => {
  it('keeps lexical hits by score_keyword when present', () => {
    const kept = filterStrongHits(sampleHits, 2)
    expect(kept.map((h) => h.title)).toEqual(['谢谢', '不客气'])
  })

  it('drops vector-only noise with low keyword score', () => {
    const kept = filterStrongHits(sampleHits, 3)
    expect(kept.map((h) => h.title)).toEqual(['谢谢', '不客气'])
  })

  it('skips chatter when all keyword scores are weak', () => {
    expect(
      filterStrongHits(
        [
          { id: 'a', score: 0.61, score_keyword: 0, title: '高兴', text: 'x' },
          { id: 'b', score: 0.6, score_keyword: 0, title: '很', text: 'x' },
        ],
        2,
      ),
    ).toEqual([])
  })

  it('falls back to hybrid score floor when keyword is absent', () => {
    expect(
      filterStrongHits(
        [
          { id: 'a', score: 1.01, title: '谢谢', text: 'x' },
          { id: 'b', score: 0.4, title: '弱', text: 'x' },
        ],
        2,
      ).map((h) => h.title),
    ).toEqual(['谢谢'])
  })

  it('skips entire round when max hybrid score is too low (no keyword)', () => {
    expect(filterStrongHits([{ id: 'x', score: 0.3, title: 'x', text: 'x' }], 2)).toEqual([])
  })

  it('returns empty for empty hits', () => {
    expect(filterStrongHits([], 2)).toEqual([])
  })
})

describe('toExternalRagItems / payload', () => {
  it('builds short cards with guide on first item', () => {
    const items = toExternalRagItems(filterStrongHits(sampleHits, 2))
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('谢谢')
    expect(items[0].content.startsWith(EXTERNAL_RAG_GUIDE)).toBe(true)
    expect(items[0].content).toContain('xièxie')
    expect(items[0].content.length).toBeLessThan(200)
    expect(items[1].content.startsWith(EXTERNAL_RAG_GUIDE)).toBe(false)
  })

  it('serializes external_rag as a JSON array string under 4k', () => {
    const payload = toExternalRagPayload(filterStrongHits(sampleHits, 2))
    expect(payload).not.toBeNull()
    const parsed = JSON.parse(payload!)
    expect(Array.isArray(parsed)).toBe(true)
    expect(payload!.length).toBeLessThan(3800)
  })

  it('returns null when there are no cards', () => {
    expect(toExternalRagPayload([])).toBeNull()
  })
})
