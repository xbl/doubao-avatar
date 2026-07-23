import { getDialogConfig, getDoubaoTtsConfig } from '@/config/env'
import {
  EVENT_ASR_INFO,
  EVENT_ASR_ENDED,
  EVENT_ASR_RESPONSE,
  EVENT_CHAT_RESPONSE,
  EVENT_CONNECTION_STARTED,
  EVENT_FINISH_CONNECTION,
  EVENT_FINISH_SESSION,
  EVENT_SESSION_STARTED,
  EVENT_START_CONNECTION,
  EVENT_START_SESSION,
  EVENT_TTS_ENDED,
  EVENT_TTS_RESPONSE,
  EVENT_TTS_SENTENCE_START,
  buildAudioTaskRequest,
  buildFullClientEvent,
  parseServerFrame,
  type ParsedFrame,
} from './protocol'
import { buildStartSessionPayload } from './sessionConfig'

export type RealtimeHandlers = {
  onPcm?: (pcm: Uint8Array) => void
  onTtsStart?: () => void
  onTtsEnd?: () => void
  onInterrupt?: () => void
  onError?: (err: Error) => void
  onStatus?: (msg: string) => void
  onChatText?: (text: string) => void
}

export function extractAsrText(payload: ParsedFrame['payload']): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      if (!value || typeof value !== 'object') continue
      const text = extractAsrText(value as ParsedFrame['payload'])
      if (text) return text
    }
  }
  return ''
}

export class AsrTranscriptBuffer {
  private text = ''

  update(payload: ParsedFrame['payload']): void {
    const text = extractAsrText(payload)
    if (text) this.text = text
  }

  commit(): string {
    const text = this.text
    this.text = ''
    return text
  }

  reset(): void {
    this.text = ''
  }
}

export class DoubaoRealtimeClient {
  private ws: WebSocket | null = null
  private sessionId = crypto.randomUUID().replace(/-/g, '')
  private handlers: RealtimeHandlers = {}
  private closed = false
  private asrTranscript = new AsrTranscriptBuffer()
  private pendingEventWaiters = new Map<number, Array<(frame: ParsedFrame) => void>>()

  async connect(handlers: RealtimeHandlers = {}): Promise<void> {
    this.handlers = handlers
    this.closed = false
    this.sessionId = crypto.randomUUID().replace(/-/g, '')
    this.pendingEventWaiters.clear()

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/doubao-realtime`

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const timer = setTimeout(() => {
        reject(new Error('豆包 WebSocket 连接超时'))
        ws.close()
      }, 15000)

      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('豆包 WebSocket 连接失败（检查 .env 中 DOUBAO_* 与 Vite 代理）'))
      }
    })

    this.ws!.onmessage = (ev) => this.handleMessage(ev.data)
    this.ws!.onclose = () => {
      if (!this.closed) this.handlers.onError?.(new Error('豆包连接已断开'))
    }

    this.handlers.onStatus?.('StartConnection')
    this.send(buildFullClientEvent(EVENT_START_CONNECTION, {}))
    await this.waitForServerEvent(EVENT_CONNECTION_STARTED, 10000)

    const dialog = getDialogConfig()
    const startSession = buildStartSessionPayload(dialog, getDoubaoTtsConfig())
    console.info('[doubao] StartSession', {
      bot_name: dialog.bot_name,
      model: (dialog.extra as { model?: string } | undefined)?.model || '(account default)',
      speaker: startSession.tts && typeof startSession.tts === 'object'
        ? (startSession.tts as { speaker?: string }).speaker
        : undefined,
      system_role_chars: String(dialog.system_role).length,
      has_character_manifest: Boolean(dialog.character_manifest),
    })

    this.handlers.onStatus?.('StartSession')
    this.send(buildFullClientEvent(EVENT_START_SESSION, startSession, this.sessionId))
    const started = await this.waitForServerEvent(EVENT_SESSION_STARTED, 15000)
    if (started.sessionId) this.sessionId = started.sessionId
    this.handlers.onStatus?.('SessionStarted')
  }

  /** Wait until the server emits a specific event id (or reject on timeout/error). */
  private waitForServerEvent(eventId: number, timeoutMs: number): Promise<ParsedFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeEventWaiter(eventId, onFrame)
        reject(new Error(`等待豆包事件 ${eventId} 超时`))
      }, timeoutMs)

      const onFrame = (frame: ParsedFrame) => {
        clearTimeout(timer)
        resolve(frame)
      }

      const list = this.pendingEventWaiters.get(eventId) ?? []
      list.push(onFrame)
      this.pendingEventWaiters.set(eventId, list)
    })
  }

  private removeEventWaiter(eventId: number, waiter: (frame: ParsedFrame) => void) {
    const list = this.pendingEventWaiters.get(eventId)
    if (!list) return
    const next = list.filter((w) => w !== waiter)
    if (next.length) this.pendingEventWaiters.set(eventId, next)
    else this.pendingEventWaiters.delete(eventId)
  }

  private resolveEventWaiters(frame: ParsedFrame) {
    if (frame.event === undefined) return
    const waiters = this.pendingEventWaiters.get(frame.event)
    if (!waiters?.length) return
    this.pendingEventWaiters.delete(frame.event)
    for (const w of waiters) w(frame)
  }

  private handleMessage(data: ArrayBuffer) {
    try {
      const frame = parseServerFrame(data)
      this.resolveEventWaiters(frame)

      if (frame.code !== undefined) {
        const detail =
          typeof frame.payload === 'string'
            ? frame.payload
            : frame.payload
              ? JSON.stringify(frame.payload)
              : ''
        this.handlers.onError?.(
          new Error(`豆包错误 code=${frame.code}${detail ? ` ${detail}` : ''}`),
        )
        return
      }
      if (
        frame.event === EVENT_ASR_INFO ||
        frame.event === EVENT_ASR_RESPONSE ||
        frame.event === EVENT_ASR_ENDED
      ) {
        if (frame.event === EVENT_ASR_INFO) {
          this.asrTranscript.reset()
          this.handlers.onInterrupt?.()
        } else if (frame.event === EVENT_ASR_RESPONSE) {
          this.asrTranscript.update(frame.payload)
        } else {
          const text = this.asrTranscript.commit()
          if (text) console.info('[doubao] user:', text)
        }
        return
      }
      if (frame.event === EVENT_TTS_SENTENCE_START) {
        this.handlers.onTtsStart?.()
        return
      }
      if (frame.event === EVENT_TTS_ENDED) {
        this.handlers.onTtsEnd?.()
        return
      }
      if (frame.event === EVENT_TTS_RESPONSE && frame.payload instanceof Uint8Array) {
        this.handlers.onPcm?.(frame.payload)
        return
      }
      if (frame.event === EVENT_CHAT_RESPONSE) {
        const text =
          typeof frame.payload === 'string'
            ? frame.payload
            : frame.payload && typeof frame.payload === 'object' && 'content' in frame.payload
              ? String((frame.payload as { content: unknown }).content ?? '')
              : ''
        if (text) {
          console.info('[doubao] chat:', text)
          this.handlers.onChatText?.(text)
        }
      }
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e : new Error(String(e)))
    }
  }

  sendAudio(pcm16k: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.send(buildAudioTaskRequest(this.sessionId, pcm16k))
  }

  private send(buf: Uint8Array): void {
    this.ws?.send(buf)
  }

  async close(): Promise<void> {
    this.closed = true
    this.pendingEventWaiters.clear()
    const ws = this.ws
    this.ws = null
    if (!ws) return
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buildFullClientEvent(EVENT_FINISH_SESSION, {}, this.sessionId))
        ws.send(buildFullClientEvent(EVENT_FINISH_CONNECTION, {}))
      }
    } catch {
      /* ignore */
    }
    ws.close()
  }
}
