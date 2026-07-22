/** Accumulate PCM bytes and emit fixed-size frames (default 1280 = 40ms @ 16k s16le). */
export class FrameQueue {
  private buffer = new Uint8Array(0)
  private readonly frameSize: number

  constructor(frameSize = 1280) {
    this.frameSize = frameSize
  }

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength === 0) return []
    const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
    merged.set(this.buffer, 0)
    merged.set(chunk, this.buffer.byteLength)
    this.buffer = merged

    const frames: Uint8Array[] = []
    while (this.buffer.byteLength >= this.frameSize) {
      frames.push(this.buffer.slice(0, this.frameSize))
      this.buffer = this.buffer.slice(this.frameSize)
    }
    return frames
  }

  clear(): void {
    this.buffer = new Uint8Array(0)
  }

  drain(): Uint8Array | null {
    if (this.buffer.byteLength === 0) return null
    const remainder = this.buffer
    this.buffer = new Uint8Array(0)
    return remainder
  }

  pendingBytes(): number {
    return this.buffer.byteLength
  }
}
