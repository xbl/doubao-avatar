import { describe, expect, it } from 'vitest'
import { buildStartSessionPayload } from './sessionConfig'

describe('buildStartSessionPayload', () => {
  it('puts persona under dialog including character_manifest', () => {
    const payload = buildStartSessionPayload({
      bot_name: '小雨',
      system_role: '你是中文老师',
      speaking_style: '亲切',
      character_manifest: '你是中文老师\n说话风格：亲切',
      extra: { strict_audit: false },
    }, {
      speaker: 'zh_female_vv_jupiter_bigtts',
      audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 },
    })

    expect(payload).toEqual({
      asr: {
        extra: { end_smooth_window_ms: 1500 },
      },
      tts: {
        speaker: 'zh_female_vv_jupiter_bigtts',
        audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 },
      },
      dialog: {
        bot_name: '小雨',
        system_role: '你是中文老师',
        speaking_style: '亲切',
        character_manifest: '你是中文老师\n说话风格：亲切',
        extra: { strict_audit: false },
      },
    })
  })
})
