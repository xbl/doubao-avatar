import { FrameQueue } from '@/modules/audio/frameQueue'
import { MicCapture } from '@/modules/audio/micCapture'
import { DoubaoRealtimeClient } from '@/modules/doubao/realtimeClient'
import { IflytekAvatar } from '@/modules/iflytek/avatar'

export type TalkState = 'idle' | 'starting' | 'talking' | 'stopping' | 'error'

export type TalkSessionCallbacks = {
  onState?: (state: TalkState) => void
  onError?: (message: string) => void
}

/**
 * Orchestrates one free-talk call.
 * Keep this instance outside Vue reactive state (SDK private fields).
 */
export class TalkSession {
  private state: TalkState = 'idle'
  private doubao = new DoubaoRealtimeClient()
  private avatar = new IflytekAvatar()
  private mic = new MicCapture()
  /** Avatar wants 24k when audio_format=2; Doubao outputs 24k PCM — no resample. */
  private queue = new FrameQueue(1920) // 40ms @ 24k s16le = 24000*2*0.04
  private audioPipeline: Promise<void> = Promise.resolve()
  private wrapper: HTMLElement | null = null
  private cb: TalkSessionCallbacks = {}

  constructor(callbacks: TalkSessionCallbacks = {}) {
    this.cb = callbacks
  }

  getState(): TalkState {
    return this.state
  }

  private setState(s: TalkState) {
    this.state = s
    this.cb.onState?.(s)
  }

  async start(wrapper: HTMLElement): Promise<void> {
    if (this.state === 'starting' || this.state === 'talking') return
    this.wrapper = wrapper
    this.setState('starting')
    try {
      this.avatar.setLifecycleHandlers({
        onDisconnected: () => {
          if (this.state === 'talking' || this.state === 'starting') {
            void this.fail('讯飞数字人连接已断开')
          }
        },
      })
      await this.avatar.start(wrapper)
      await this.doubao.connect({
        onPcm: (pcm24k) => {
          this.enqueueAvatarOperation(() => this.onDoubaoPcm(pcm24k))
        },
        onTtsEnd: () => {
          this.enqueueAvatarOperation(() => this.onTtsEnd())
        },
        onInterrupt: () => {
          this.enqueueAvatarOperation(() => this.onInterrupt())
        },
        onError: (err) => {
          this.cb.onError?.(err.message)
          void this.fail(err.message)
        },
      })
      await this.mic.start((pcm16k) => {
        if (this.state === 'talking') this.doubao.sendAudio(pcm16k)
      })
      this.setState('talking')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.cleanup()
      this.setState('error')
      this.cb.onError?.(msg)
    }
  }

  private async onDoubaoPcm(pcm: Uint8Array) {
    if (this.state !== 'talking' || !this.avatar.isConnected()) return
    for (const frame of this.queue.push(pcm)) {
      if (!this.avatar.isConnected()) return
      await this.avatar.sendPcm(frame)
    }
  }

  private enqueueAvatarOperation(operation: () => Promise<void>) {
    const next = this.audioPipeline.then(operation)
    this.audioPipeline = next.catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      if (/InvalidConnect/i.test(message)) {
        console.warn('[session] drop InvalidConnect write')
        return
      }
      this.cb.onError?.(message)
    })
  }

  private async onTtsEnd() {
    if (!this.avatar.isConnected()) return
    const remainder = this.queue.drain()
    if (remainder) await this.avatar.sendPcm(remainder)
    await this.avatar.endAudioStream()
  }

  private async onInterrupt() {
    this.queue.clear()
    if (this.avatar.isConnected()) await this.avatar.interrupt()
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopping') return
    this.setState('stopping')
    await this.cleanup()
    this.setState('idle')
  }

  private async fail(message: string) {
    if (this.state === 'stopping' || this.state === 'idle' || this.state === 'error') return
    await this.cleanup()
    this.setState('error')
    this.cb.onError?.(message)
  }

  private async cleanup() {
    this.queue.clear()
    this.mic.stop()
    // Stop avatar first so leftover Doubao PCM cannot writeAudio after teardown.
    await this.avatar.stop()
    await this.doubao.close()
    await this.audioPipeline.catch(() => undefined)
    this.wrapper = null
  }
}
