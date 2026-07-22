import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const writes: Array<{ bytes: Uint8Array; status: number }> = []
  let activeWrites = 0
  let maxActiveWrites = 0
  let handlers: Record<string, Array<(...args: unknown[]) => void>> = {}

  class AvatarPlatform {
    player = undefined

    on(event: string, handler: (...args: unknown[]) => void) {
      ;(handlers[event] ??= []).push(handler)
      return this
    }

    setApiInfo() {
      return this
    }

    setGlobalParams() {
      return this
    }

    async start() {
      for (const h of handlers.connected ?? []) h()
    }

    async writeAudio(buffer: ArrayBuffer, status: number) {
      activeWrites += 1
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
      writes.push({ bytes: new Uint8Array(buffer.slice(0)), status })
      await new Promise((resolve) => setTimeout(resolve, 0))
      activeWrites -= 1
      return 'sid'
    }

    async interrupt() {}

    stop() {}

    destroy() {}
  }

  return {
    AvatarPlatform,
    writes,
    handlers,
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) h(...args)
    },
    reset() {
      writes.length = 0
      activeWrites = 0
      maxActiveWrites = 0
      handlers = {}
    },
    getMaxActiveWrites() {
      return maxActiveWrites
    },
  }
})

vi.mock('@/config/env', () => ({
  getIflytekConfig: () => ({
    serverUrl: '/vmss',
    appId: 'app',
    apiKey: 'key',
    apiSecret: 'secret',
    sceneId: 'scene',
    avatarId: 'avatar',
    vcn: 'voice',
  }),
}))

vi.mock('@/libs/avatar-sdk-web/index.js', () => ({
  default: sdk.AvatarPlatform,
  SDKEvents: {
    connected: 'connected',
    error: 'error',
    disconnected: 'disconnected',
  },
  PlayerEvents: {
    playNotAllowed: 'not-allowed',
  },
}))

import { AudioFrameStatus, IflytekAvatar } from './avatar'

describe('IflytekAvatar audio streaming', () => {
  beforeEach(() => sdk.reset())

  it('serializes writes and sends the final PCM as a non-empty end frame', async () => {
    const avatar = new IflytekAvatar()
    await avatar.start({} as HTMLElement)

    const operations = [
      avatar.sendPcm(new Uint8Array([1, 2])),
      avatar.sendPcm(new Uint8Array([3, 4])),
      avatar.sendPcm(new Uint8Array([5, 6])),
      avatar.endAudioStream(),
    ]
    await Promise.all(operations)

    expect(sdk.getMaxActiveWrites()).toBe(1)
    expect(sdk.writes.map(({ status }) => status)).toEqual([
      AudioFrameStatus.start,
      AudioFrameStatus.intermediate,
      AudioFrameStatus.end,
    ])
    expect(sdk.writes.map(({ bytes }) => [...bytes])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
    expect(sdk.writes.every(({ bytes }) => bytes.byteLength > 0)).toBe(true)
  })

  it('does not writeAudio after disconnect (avoids InvalidConnect)', async () => {
    const avatar = new IflytekAvatar()
    await avatar.start({} as HTMLElement)

    await avatar.sendPcm(new Uint8Array([1, 2]))
    await avatar.sendPcm(new Uint8Array([3, 4]))
    await vi.waitFor(() => expect(sdk.writes.length).toBe(1))

    sdk.emit('disconnected', new Error('gone'))
    await avatar.sendPcm(new Uint8Array([5, 6]))
    await avatar.endAudioStream()
    await new Promise((r) => setTimeout(r, 10))

    expect(sdk.writes).toHaveLength(1)
  })
})
