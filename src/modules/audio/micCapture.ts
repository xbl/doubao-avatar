import { floatToInt16, int16ToBytes, resampleInt16 } from './resample'

export type MicChunkHandler = (pcm16k: Uint8Array) => void

/**
 * Capture microphone as PCM s16le mono 16 kHz.
 * Uses ScriptProcessor for POC simplicity.
 */
export class MicCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private onChunk: MicChunkHandler | null = null

  async start(onChunk: MicChunkHandler): Promise<void> {
    this.onChunk = onChunk
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    this.ctx = new AudioContext()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    // 4096 keeps callback rate reasonable for WS uplink
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (ev) => {
      if (!this.onChunk || !this.ctx) return
      const input = ev.inputBuffer.getChannelData(0)
      const int16 = floatToInt16(input)
      const at16k = resampleInt16(int16, this.ctx.sampleRate, 16000)
      this.onChunk(int16ToBytes(at16k))
    }

    this.source.connect(this.processor)
    // Keep processor alive without audible loopback
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(this.ctx.destination)
  }

  stop(): void {
    this.onChunk = null
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.processor = null
    this.source = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close()
    this.ctx = null
  }
}
