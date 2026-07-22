/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOUBAO_BOT_NAME: string
  readonly VITE_DOUBAO_SPEAKER: string
  readonly VITE_DOUBAO_SYSTEM_ROLE: string
  readonly VITE_DOUBAO_SPEAKING_STYLE: string
  readonly VITE_DOUBAO_DIALOG_ID: string
  /** O = 1.2.1.1 (system_role); SC = 2.2.0.0 (character_manifest) */
  readonly VITE_DOUBAO_MODEL: string
  /** @deprecated use VITE_DOUBAO_SYSTEM_ROLE */
  readonly VITE_SYSTEM_ROLE: string
  /** @deprecated use VITE_DOUBAO_SPEAKING_STYLE */
  readonly VITE_SPEAKING_STYLE: string
  readonly VITE_IFLYTEK_SERVER_URL: string
  readonly VITE_IFLYTEK_APP_ID: string
  readonly VITE_IFLYTEK_API_KEY: string
  readonly VITE_IFLYTEK_API_SECRET: string
  readonly VITE_IFLYTEK_SCENE_ID: string
  readonly VITE_IFLYTEK_AVATAR_ID: string
  readonly VITE_IFLYTEK_VCN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.txt?raw' {
  const content: string
  export default content
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module '@/libs/avatar-sdk-web/index.js' {
  const AvatarPlatform: new (opts?: Record<string, unknown>) => {
    on: (event: string, handler: (...args: unknown[]) => void) => unknown
    setApiInfo: (info: Record<string, string>) => unknown
    setGlobalParams: (config: Record<string, unknown>) => unknown
    start: (params: { wrapper: HTMLElement }) => Promise<void>
    writeAudio: (buf: ArrayBuffer, status: number, extend?: object) => Promise<string>
    interrupt: () => Promise<void>
    stop: () => void
    destroy: () => void
    player?: { on: Function; resume?: () => void }
    createPlayer?: () => { on: Function; resume?: () => void }
  }
  export const SDKEvents: Record<string, string>
  export const PlayerEvents: Record<string, string>
  export default AvatarPlatform
}
