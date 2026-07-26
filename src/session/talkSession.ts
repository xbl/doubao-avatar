import { FrameQueue } from '@/modules/audio/frameQueue'
import { MicCapture } from '@/modules/audio/micCapture'
import { DoubaoRealtimeClient } from '@/modules/doubao/realtimeClient'
import { IflytekAvatar } from '@/modules/iflytek/avatar'
import { retrieveForQuery, type RetrieveResult } from '@/modules/rag/ragClient'

export type TalkState = 'idle' | 'starting' | 'talking' | 'stopping' | 'error'

export type TalkSessionCallbacks = {
  onState?: (state: TalkState) => void
  onError?: (message: string) => void
}

type RagJob = {
  turnId: number
  query: string
  controller: AbortController
  promise: Promise<RetrieveResult | null>
}

/**
 * After ASR ends we briefly hold audio, then either:
 * - rag_only: ChatRAGText(502) wins; free-chat PCM/TTS is dropped
 * - pass: no strong RAG hit; normal free chat
 */
type ReplyMode = 'pass' | 'hold' | 'rag_only'

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
  private ragJob: RagJob | null = null
  private replyMode: ReplyMode = 'pass'
  private activeTtsType: string | undefined

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
        onTtsStart: (info) => {
          this.onTtsStart(info)
        },
        onTtsEnd: () => {
          this.enqueueAvatarOperation(() => this.onTtsEnd())
        },
        onInterrupt: () => {
          this.abortRagJob()
          this.replyMode = 'pass'
          this.activeTtsType = undefined
          this.enqueueAvatarOperation(() => this.onInterrupt())
        },
        onAsrUpdate: (text, turnId) => {
          this.startRagJob(text, turnId)
        },
        onAsrEnded: (text, turnId) => {
          void this.onAsrEnded(text, turnId)
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

  private abortRagJob() {
    this.ragJob?.controller.abort()
    this.ragJob = null
  }

  /** Prefetch / refresh retrieve while user is still speaking (ASR updates). */
  private startRagJob(query: string, turnId: number) {
    const q = query.trim()
    if (!q || this.state !== 'talking') return
    if (this.ragJob?.turnId === turnId && this.ragJob.query === q) return

    this.ragJob?.controller.abort()
    const controller = new AbortController()
    const promise = retrieveForQuery(q, { signal: controller.signal })
    this.ragJob = { turnId, query: q, controller, promise }
  }

  private async onAsrEnded(text: string, turnId: number) {
    if (this.state !== 'talking') return

    // Hold avatar audio until we know whether this turn is RAG-only or free chat.
    this.replyMode = 'hold'
    this.activeTtsType = undefined
    this.queue.clear()

    this.startRagJob(text, turnId)
    const job = this.ragJob
    if (!job || job.turnId !== turnId) {
      this.replyMode = 'pass'
      return
    }

    try {
      const result = await job.promise
      if (job.controller.signal.aborted) return
      if (this.state !== 'talking') return
      if (this.ragJob !== job) return

      if (!result?.externalRag) {
        this.replyMode = 'pass'
        console.info('[rag] no strong hit — free chat')
        return
      }

      // Policy: when 502 fires, do not play free-chat content — only external_rag TTS.
      this.replyMode = 'rag_only'
      this.doubao.clientInterrupt()
      this.enqueueAvatarOperation(() => this.onInterrupt())
      this.doubao.sendChatRagText(result.externalRag, turnId)
      console.info('[rag] ChatRAGText only (free chat suppressed)')
    } catch (e) {
      this.replyMode = 'pass'
      console.warn('[rag] unexpected error', e)
    } finally {
      if (this.ragJob === job) this.ragJob = null
    }
  }

  private onTtsStart(info?: { ttsType?: string; text?: string }) {
    this.activeTtsType = info?.ttsType
    if (this.replyMode === 'hold') return
    if (this.replyMode === 'rag_only' && info?.ttsType !== 'external_rag') {
      // Stray free-chat sentence after we chose RAG — cut again, drop audio.
      console.info('[rag] drop free-chat TTS while rag_only')
      this.doubao.clientInterrupt()
      this.enqueueAvatarOperation(() => this.onInterrupt())
    }
  }

  private allowsAvatarAudio(): boolean {
    if (this.replyMode === 'hold') return false
    if (this.replyMode === 'rag_only') return this.activeTtsType === 'external_rag'
    return true
  }

  private async onDoubaoPcm(pcm: Uint8Array) {
    if (this.state !== 'talking' || !this.avatar.isConnected()) return
    if (!this.allowsAvatarAudio()) return
    for (const frame of this.queue.push(pcm)) {
      if (!this.avatar.isConnected()) return
      if (!this.allowsAvatarAudio()) return
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
    if (!this.allowsAvatarAudio()) {
      this.queue.clear()
      if (this.replyMode === 'rag_only' && this.activeTtsType !== 'external_rag') return
      if (this.replyMode === 'hold') return
    }
    if (!this.avatar.isConnected()) return
    const remainder = this.queue.drain()
    if (remainder) await this.avatar.sendPcm(remainder)
    await this.avatar.endAudioStream()
    if (this.replyMode === 'rag_only' && this.activeTtsType === 'external_rag') {
      this.replyMode = 'pass'
      this.activeTtsType = undefined
    }
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
    this.abortRagJob()
    this.replyMode = 'pass'
    this.activeTtsType = undefined
    this.queue.clear()
    this.mic.stop()
    // Stop avatar first so leftover Doubao PCM cannot writeAudio after teardown.
    await this.avatar.stop()
    await this.doubao.close()
    await this.audioPipeline.catch(() => undefined)
    this.wrapper = null
  }
}
