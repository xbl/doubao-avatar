import { describe, expect, it } from 'vitest'
import { getDialogConfig, getDoubaoTtsConfig, resolveDoubaoSpeaker } from './env'

describe('resolveDoubaoSpeaker', () => {
  it('expands short aliases to official speaker ids', () => {
    expect(resolveDoubaoSpeaker('vv')).toBe('zh_female_vv_jupiter_bigtts')
    expect(resolveDoubaoSpeaker('zh_female_vv_jupiter_bigtts')).toBe(
      'zh_female_vv_jupiter_bigtts',
    )
  })
})

describe('getDoubaoTtsConfig', () => {
  it('returns pcm_s16le 24k config with a valid speaker id', () => {
    const tts = getDoubaoTtsConfig()
    expect(tts.audio_config).toEqual({
      channel: 1,
      format: 'pcm_s16le',
      sample_rate: 24000,
    })
    expect(tts.speaker.includes('_') || tts.speaker.startsWith('S_')).toBe(true)
  })
})

describe('getDialogConfig', () => {
  it('sets system_role, speaking_style opener rule, and few-shot dialog_context', () => {
    const dialog = getDialogConfig()
    expect(String(dialog.bot_name).length).toBeGreaterThan(0)
    expect(String(dialog.bot_name).length).toBeLessThanOrEqual(20)
    expect(String(dialog.system_role)).toMatch(/开头/)
    expect(String(dialog.speaking_style)).toMatch(/中文/)
    expect(String(dialog.character_manifest)).toContain(String(dialog.system_role))
    expect(dialog.extra).toMatchObject({ strict_audit: false })
    expect(dialog.dialog_context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', text: expect.stringMatching(/^(很棒|哦我知道了)/) }),
      ]),
    )
  })
})
