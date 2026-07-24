import { expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => {
  const avatarCalls: Array<{ type: string; bytes?: number[] }> = []
  const ragCalls: Array<{ query: string; turnId: number }> = []
  const chatRagPayloads: string[] = []
  let doubaoHandlers: Record<string, (...args: any[]) => void> = {}
  let retrieveImpl: (
    query: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ externalRag: string | null } | null> = async () => null

  return {
    avatarCalls,
    ragCalls,
    chatRagPayloads,
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

      sendChatRagText(externalRag: string, turnId?: number) {
        chatRagPayloads.push(externalRag)
        if (turnId !== undefined) ragCalls.push({ query: externalRag, turnId })
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

      async interrupt() {}

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

it('sends ChatRAGText after ASR ended when retrieve returns payload', async () => {
  doubles.chatRagPayloads.length = 0
  doubles.setRetrieveImpl(async () => ({
    externalRag: JSON.stringify([{ title: '谢谢', content: 'guide' }]),
  }))

  const session = new TalkSession()
  await session.start({} as HTMLElement)
  doubles.getDoubaoHandlers().onAsrEnded('谢谢', 1)

  await vi.waitFor(() => expect(doubles.chatRagPayloads).toHaveLength(1))
  expect(doubles.chatRagPayloads[0]).toContain('谢谢')
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
