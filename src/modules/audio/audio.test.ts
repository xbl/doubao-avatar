import { describe, expect, it } from 'vitest'
import { FrameQueue } from './frameQueue'
import { resampleInt16 } from './resample'

describe('FrameQueue', () => {
  it('emits fixed-size frames and keeps remainder', () => {
    const q = new FrameQueue(4)
    expect(q.push(new Uint8Array([1, 2, 3]))).toEqual([])
    const frames = q.push(new Uint8Array([4, 5, 6, 7, 8]))
    expect(frames).toHaveLength(2)
    expect(Array.from(frames[0])).toEqual([1, 2, 3, 4])
    expect(Array.from(frames[1])).toEqual([5, 6, 7, 8])
    expect(q.pendingBytes()).toBe(0)
  })

  it('clear drops pending bytes', () => {
    const q = new FrameQueue(8)
    q.push(new Uint8Array([1, 2, 3]))
    q.clear()
    expect(q.pendingBytes()).toBe(0)
  })

  it('drains the remaining bytes as a final partial frame', () => {
    const q = new FrameQueue(8)
    q.push(new Uint8Array([1, 2, 3]))

    expect([...q.drain()!]).toEqual([1, 2, 3])
    expect(q.drain()).toBeNull()
    expect(q.pendingBytes()).toBe(0)
  })
})

describe('resampleInt16', () => {
  it('downsamples 24k-ish length to 16k ratio', () => {
    const input = new Int16Array(240)
    for (let i = 0; i < input.length; i++) input[i] = i
    const out = resampleInt16(input, 24000, 16000)
    expect(out.length).toBe(160)
  })
})
