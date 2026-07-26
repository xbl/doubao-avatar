import { expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => {
  const avatarCalls: Array<{ type: string; bytes?: number[] }> = []
  const chatRagPayloads: string[] = []
  const clientInterrupts: number[] = []
  let doubaoHandlers: Record<string, (...args: any[]) => void> = {}
  let retrieveImpl: (
    query: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ externalRag: string | null } | null> = async () => null

  return {
    avatarCalls,
    chatRagPayloads,
    clientInterrupts,
    getDoubaoHandlers: () => doubaoHandlers,
    setRetrieveImpl: (
      impl: (
        query: string,
        options?: { signal?: AbortSignal },
      ) => Promise<{ externalRag: string | null } | null>,
    ) => {
      retrieveImpl = impl
    },
    retrieveForQuery: (query: string, options?: { signal?: AbortSignal }) =>
      retrieveImpl(query, options),
    DoubaoRealtimeClient: class {
      async connect(handlers: Record<string, (...args: any[]) => void>) {
        doubaoHandlers = handlers
      }

      sendAudio() {}

      clientInterrupt() {
        clientInterrupts.push(1)
      }

      sendChatRagText(externalRag: string) {
        chatRagPayloads.push(externalRag)
      }

      async close() {}
    },
    IflytekAvatar: class {
      setLifecycleHandlers() {}

      isConnected() {
        return true
      }

      async start() {}

      async sendPcm(pcm: Uint8Array) {
        avatarCalls.push({ type: 'pcm', bytes: [...pcm] })
      }

      async endAudioStream() {
        avatarCalls.push({ type: 'end' })
      }

      async interrupt() {
        avatarCalls.push({ type: 'interrupt' })
      }

      async stop() {}
    },
    MicCapture: class {
      async start() {}

      stop() {}
    },
  }
})

vi.mock('@/modules/doubao/realtimeClient', () => ({
  DoubaoRealtimeClient: doubles.DoubaoRealtimeClient,
}))
vi.mock('@/modules/iflytek/avatar', () => ({
  IflytekAvatar: doubles.IflytekAvatar,
}))
vi.mock('@/modules/audio/micCapture', () => ({
  MicCapture: doubles.MicCapture,
}))
vi.mock('@/modules/rag/ragClient', () => ({
  retrieveForQuery: doubles.retrieveForQuery,
}))

import { TalkSession } from './talkSession'

it('sends the queued PCM remainder before ending the avatar stream', async () => {
  doubles.avatarCalls.length = 0
  doubles.setRetrieveImpl(async () => null)

  const session = new TalkSession()
  await session.start({} as HTMLElement)

  doubles.getDoubaoHandlers().onPcm(new Uint8Array([1, 2, 3, 4]))
  doubles.getDoubaoHandlers().onTtsEnd()
  await vi.waitFor(() => expect(doubles.avatarCalls.at(-1)?.type).toBe('end'))

  expect(doubles.avatarCalls).toEqual([
    { type: 'pcm', bytes: [1, 2, 3, 4] },
    { type: 'end' },
  ])
})

it('on RAG hit: interrupt free chat, send 502, drop free PCM, play external_rag only', async () => {
  doubles.chatRagPayloads.length = 0
  doubles.clientInterrupts.length = 0
  doubles.avatarCalls.length = 0
  doubles.setRetrieveImpl(async () => ({
    externalRag: JSON.stringify([{ title: '谢谢', content: 'guide' }]),
  }))

  const session = new TalkSession()
  await session.start({} as HTMLElement)
  const h = doubles.getDoubaoHandlers()

  // Free chat tries to speak while we decide — must not reach avatar.
  void h.onAsrEnded('谢谢', 1)
  h.onTtsStart?.({ ttsType: undefined })
  h.onPcm(new Uint8Array([9, 9]))
  h.onTtsEnd()

  await vi.waitFor(() => expect(doubles.chatRagPayloads).toHaveLength(1))
  expect(doubles.clientInterrupts.length).toBeGreaterThanOrEqual(1)
  expect(doubles.avatarCalls.some((c) => c.type === 'pcm' && c.bytes?.[0] === 9)).toBe(false)

  // Only external_rag audio is forwarded (remainder drained on TTS end).
  doubles.avatarCalls.length = 0
  h.onTtsStart?.({ ttsType: 'external_rag' })
  h.onPcm(new Uint8Array([1, 2, 3, 4]))
  h.onTtsEnd()
  await vi.waitFor(() =>
    expect(doubles.avatarCalls.some((c) => c.type === 'pcm' && c.bytes?.[0] === 1)).toBe(true),
  )
})

it('without RAG hit: free chat PCM still plays', async () => {
  doubles.avatarCalls.length = 0
  doubles.chatRagPayloads.length = 0
  doubles.setRetrieveImpl(async () => null)

  const session = new TalkSession()
  await session.start({} as HTMLElement)
  const h = doubles.getDoubaoHandlers()

  await h.onAsrEnded('随便聊聊', 1)
  await new Promise((r) => setTimeout(r, 10))

  h.onPcm(new Uint8Array([5, 6]))
  h.onTtsEnd()
  await vi.waitFor(() =>
    expect(doubles.avatarCalls.some((c) => c.type === 'pcm')).toBe(true),
  )
  expect(doubles.chatRagPayloads).toHaveLength(0)
})

it('does not send stale ChatRAGText after barge-in abort', async () => {
  doubles.chatRagPayloads.length = 0
  doubles.setRetrieveImpl(async (_query, options) => {
    const aborted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 50)
      options?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve(true)
        },
        { once: true },
      )
    })
    if (aborted) return null
    return { externalRag: JSON.stringify([{ title: 'stale', content: 'x' }]) }
  })

  const session = new TalkSession()
  await session.start({} as HTMLElement)
  doubles.getDoubaoHandlers().onAsrEnded('谢谢', 1)
  doubles.getDoubaoHandlers().onInterrupt()

  await new Promise((r) => setTimeout(r, 80))
  expect(doubles.chatRagPayloads).toHaveLength(0)
})
