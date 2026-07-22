import { getIflytekConfig } from '@/config/env'

/** Matches SDK AudioFrameStatus */
export const AudioFrameStatus = {
  start: 0,
  intermediate: 1,
  end: 2,
} as const

export type FrameStatus = (typeof AudioFrameStatus)[keyof typeof AudioFrameStatus]

type AvatarPlatformInstance = {
  on: (event: string, handler: (...args: unknown[]) => void) => AvatarPlatformInstance
  setApiInfo: (info: Record<string, string>) => AvatarPlatformInstance
  setGlobalParams: (config: Record<string, unknown>) => AvatarPlatformInstance
  start: (params: { wrapper: HTMLElement }) => Promise<void>
  writeAudio: (
    buf: ArrayBuffer,
    status: number,
    extend?: { nlp?: boolean },
  ) => Promise<string>
  interrupt: () => Promise<void>
  stop: () => void
  destroy: () => void
  player?: {
    on: (event: string, handler: (...args: unknown[]) => void) => unknown
    resume?: () => void
  }
  createPlayer?: () => {
    on: (event: string, handler: (...args: unknown[]) => void) => unknown
    resume?: () => void
  }
}

type SdkModule = {
  default: new (opts?: Record<string, unknown>) => AvatarPlatformInstance
  SDKEvents: Record<string, string>
  PlayerEvents: Record<string, string>
}

export type AvatarLifecycleHandlers = {
  onDisconnected?: (reason?: unknown) => void
}

async function loadSdk(): Promise<SdkModule> {
  // Official package from Yuque: avatar-sdk-web_3.2.3.1002.zip → extract here
  const mod = (await import('@/libs/avatar-sdk-web/index.js')) as SdkModule
  if (typeof mod?.default !== 'function') {
    throw new Error(
      '讯飞 Avatar SDK 未正确安装：请将 avatar-sdk-web_3.2.3.1002 解压到 src/libs/avatar-sdk-web/',
    )
  }
  return mod
}

/**
 * Keep the platform instance OUT of Vue reactive/ref proxies
 * (SDK private fields break under Proxy — see Yuque §7.6).
 */
export class IflytekAvatar {
  private platform: AvatarPlatformInstance | null = null
  private connected = false
  private stopping = false
  private streamOpen = false
  private pendingPcm: ArrayBuffer | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private playerResumeBound = false
  private lifecycle: AvatarLifecycleHandlers = {}

  setLifecycleHandlers(handlers: AvatarLifecycleHandlers) {
    this.lifecycle = handlers
  }

  isConnected(): boolean {
    return this.connected && !!this.platform && !this.stopping
  }

  async start(wrapper: HTMLElement): Promise<void> {
    const cfg = getIflytekConfig()
    const sdk = await loadSdk()
    const AvatarPlatform = sdk.default
    const { SDKEvents, PlayerEvents } = sdk

    this.stopping = false
    this.connected = false
    const platform = new AvatarPlatform()
    this.platform = platform

    platform
      .on(SDKEvents.connected, () => {
        this.connected = true
        console.log('[iflytek] connected')
      })
      .on(SDKEvents.error, (...args: unknown[]) => {
        console.error('[iflytek] error', ...args)
      })
      .on(SDKEvents.disconnected, (...args: unknown[]) => {
        this.connected = false
        this.streamOpen = false
        this.pendingPcm = null
        if (args[0]) console.error('[iflytek] disconnected', args[0])
        if (!this.stopping) this.lifecycle.onDisconnected?.(args[0])
      })

    const player = platform.player || platform.createPlayer?.()
    if (player && !this.playerResumeBound) {
      player.on(PlayerEvents.playNotAllowed, () => {
        const resume = () => {
          player.resume?.()
          document.removeEventListener('click', resume)
        }
        document.addEventListener('click', resume)
      })
      this.playerResumeBound = true
    }

    platform.setApiInfo({
      serverUrl: cfg.serverUrl,
      appId: cfg.appId,
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      sceneId: cfg.sceneId,
    })

    platform.setGlobalParams({
      stream: {
        protocol: 'xrtc',
      },
      avatar: {
        avatar_id: cfg.avatarId,
        width: 720,
        height: 1280,
        // 2 = 24kHz — matches Doubao realtime PCM output, avoids resample
        audio_format: 2,
      },
      tts: {
        vcn: cfg.vcn,
      },
      avatar_dispatch: {
        interactive_mode: 1, // interrupt mode
      },
    })

    await platform.start({ wrapper })
    // Some SDK builds fire connected during start; if not, mark ready after start resolves.
    if (this.platform === platform) this.connected = true
    this.streamOpen = false
    this.pendingPcm = null
    this.writeChain = Promise.resolve()
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const result = this.writeChain.then(operation)
    this.writeChain = result.catch(() => {
      // Keep the queue usable while returning the original rejection to the caller.
    })
    return result
  }

  private async safeWriteAudio(
    platform: AvatarPlatformInstance,
    frame: ArrayBuffer,
    status: number,
  ): Promise<void> {
    if (!this.isConnected() || this.platform !== platform) return
    try {
      await platform.writeAudio(frame, status, { nlp: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Common after XRTC drop / stop(); further writes only spam InvalidConnect.
      if (/InvalidConnect|not connected|disconnect/i.test(msg)) {
        this.connected = false
        console.warn('[iflytek] writeAudio skipped — connection gone')
        return
      }
      throw e
    }
  }

  /**
   * Stream Doubao PCM into the avatar.
   * One frame is held back so the real final PCM can carry end status.
   */
  sendPcm(pcm: Uint8Array): Promise<void> {
    const platform = this.platform
    if (!platform || !this.isConnected() || pcm.byteLength === 0) return Promise.resolve()
    const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
    return this.enqueueWrite(async () => {
      if (!this.isConnected() || this.platform !== platform) return
      if (!this.pendingPcm) {
        this.pendingPcm = copy
        return
      }

      const frame = this.pendingPcm
      this.pendingPcm = copy
      const status = this.streamOpen
        ? AudioFrameStatus.intermediate
        : AudioFrameStatus.start
      this.streamOpen = true
      await this.safeWriteAudio(platform, frame, status)
    })
  }

  endAudioStream(): Promise<void> {
    const platform = this.platform
    if (!platform || !this.isConnected()) return Promise.resolve()
    return this.enqueueWrite(async () => {
      if (!this.isConnected() || this.platform !== platform || !this.pendingPcm) return
      const finalFrame = this.pendingPcm
      this.pendingPcm = null

      // A normal utterance has multiple frames. For an unusually short one,
      // split its PCM so the protocol still receives both start and end.
      if (!this.streamOpen && finalFrame.byteLength >= 4) {
        const midpoint = Math.floor(finalFrame.byteLength / 4) * 2
        await this.safeWriteAudio(platform, finalFrame.slice(0, midpoint), AudioFrameStatus.start)
        await this.safeWriteAudio(platform, finalFrame.slice(midpoint), AudioFrameStatus.end)
      } else {
        await this.safeWriteAudio(platform, finalFrame, AudioFrameStatus.end)
      }
      this.streamOpen = false
    })
  }

  async interrupt(): Promise<void> {
    const platform = this.platform
    if (!platform || !this.isConnected()) return
    try {
      await this.enqueueWrite(async () => {
        this.pendingPcm = null
        this.streamOpen = false
        if (this.isConnected() && this.platform === platform) await platform.interrupt()
      })
    } catch (e) {
      console.warn('[iflytek] interrupt failed', e)
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.connected = false
    this.streamOpen = false
    this.pendingPcm = null
    const p = this.platform
    this.platform = null
    await this.writeChain.catch(() => undefined)
    try {
      p?.stop()
    } catch {
      /* ignore */
    }
    try {
      p?.destroy()
    } catch {
      /* ignore */
    }
  }
}
