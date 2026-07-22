export type DoubaoTtsConfig = {
  speaker: string
  audio_config: {
    channel: 1
    format: 'pcm_s16le' | 'pcm'
    sample_rate: 16000 | 24000
  }
}

/** StartSession JSON body for Doubao realtime dialogue. */
export function buildStartSessionPayload(
  dialog: Record<string, unknown>,
  tts: DoubaoTtsConfig,
): Record<string, unknown> {
  return {
    asr: {
      extra: {
        end_smooth_window_ms: 1500,
      },
    },
    tts,
    dialog,
  }
}
