import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_RAG_GUIDE,
  filterStrongHits,
  shorten,
  toExternalRagItems,
  toExternalRagPayload,
  type RagHit,
} from './ragClient'

const sampleHits: RagHit[] = [
  {
    id: '1',
    score: 100,
    title: '谢谢',
    text: '【词汇】谢谢（xièxie）。词性：动。释义：表示感谢。例句：谢谢你。'.repeat(3),
    metadata: { pinyin: 'xièxie' },
  },
  {
    id: '2',
    score: 60,
    title: '不客气',
    text: '【词汇】不客气。例句：不客气。',
    metadata: { pinyin: 'bú kèqi' },
  },
  {
    id: '3',
    score: 10,
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
  it('keeps top hits above relative score threshold', () => {
    const kept = filterStrongHits(sampleHits, 2)
    expect(kept.map((h) => h.title)).toEqual(['谢谢', '不客气'])
  })

  it('drops weak noise below half of max score', () => {
    const kept = filterStrongHits(sampleHits, 3)
    expect(kept.map((h) => h.title)).toEqual(['谢谢', '不客气'])
  })

  it('skips entire round when max score is too low', () => {
    expect(filterStrongHits([{ id: 'x', score: 3, title: 'x', text: 'x' }], 2)).toEqual([])
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
