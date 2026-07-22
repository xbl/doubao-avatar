import { expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => {
  const avatarCalls: Array<{ type: string; bytes?: number[] }> = []
  let doubaoHandlers: Record<string, (...args: any[]) => void> = {}

  return {
    avatarCalls,
    getDoubaoHandlers: () => doubaoHandlers,
    DoubaoRealtimeClient: class {
      async connect(handlers: Record<string, (...args: any[]) => void>) {
        doubaoHandlers = handlers
      }

      sendAudio() {}

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
