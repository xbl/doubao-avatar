export function requireEnv(name: string, value: string | undefined): string {
  const v = (value ?? '').trim()
  if (!v) {
    throw new Error(`缺少环境变量 ${name}，请复制 .env.example 为 .env 并填写`)
  }
  return v
}

export function getIflytekConfig() {
  return {
    serverUrl:
      import.meta.env.VITE_IFLYTEK_SERVER_URL ||
      'wss://avatar.cn-huadong-1.xf-yun.com/v1/interact',
    appId: requireEnv('VITE_IFLYTEK_APP_ID', import.meta.env.VITE_IFLYTEK_APP_ID),
    apiKey: requireEnv('VITE_IFLYTEK_API_KEY', import.meta.env.VITE_IFLYTEK_API_KEY),
    apiSecret: requireEnv('VITE_IFLYTEK_API_SECRET', import.meta.env.VITE_IFLYTEK_API_SECRET),
    sceneId: requireEnv('VITE_IFLYTEK_SCENE_ID', import.meta.env.VITE_IFLYTEK_SCENE_ID),
    avatarId: requireEnv('VITE_IFLYTEK_AVATAR_ID', import.meta.env.VITE_IFLYTEK_AVATAR_ID),
    vcn: requireEnv('VITE_IFLYTEK_VCN', import.meta.env.VITE_IFLYTEK_VCN),
  }
}

import defaultSystemRole from './doubao-system-role.txt?raw'
import defaultSpeakingStyle from './doubao-speaking-style.txt?raw'

const BOT_NAME_MAX = 20

/** Common short aliases → official realtime dialog speaker ids. */
const SPEAKER_ALIASES: Record<string, string> = {
  vv: 'zh_female_vv_jupiter_bigtts',
  zh_female_vv: 'zh_female_vv_jupiter_bigtts',
}

export function resolveDoubaoSpeaker(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return 'zh_female_vv_jupiter_bigtts'
  return SPEAKER_ALIASES[value] || SPEAKER_ALIASES[value.toLowerCase()] || value
}

/**
 * Doubao dialog persona (StartSession.dialog).
 * - O: system_role / speaking_style
 * - SC: character_manifest
 * We send both so either model family can pick it up.
 */
export function getDialogConfig() {
  const botName = (
    import.meta.env.VITE_DOUBAO_BOT_NAME?.trim() ||
    '豆包'
  ).slice(0, BOT_NAME_MAX)

  const systemRole = (
    import.meta.env.VITE_DOUBAO_SYSTEM_ROLE?.trim() ||
    import.meta.env.VITE_SYSTEM_ROLE?.trim() ||
    defaultSystemRole
  ).trim()

  const speakingStyle = (
    import.meta.env.VITE_DOUBAO_SPEAKING_STYLE?.trim() ||
    import.meta.env.VITE_SPEAKING_STYLE?.trim() ||
    defaultSpeakingStyle
  ).trim()

  const dialogId = import.meta.env.VITE_DOUBAO_DIALOG_ID?.trim() || ''
  const model = import.meta.env.VITE_DOUBAO_MODEL?.trim() || ''

  const extra: Record<string, unknown> = { strict_audit: false }
  // Only pin model when explicitly configured — wrong/unauthorized model → 55000001.
  if (model) extra.model = model

  const dialog: Record<string, unknown> = {
    bot_name: botName,
    system_role: systemRole,
    speaking_style: speakingStyle,
    // SC uses character_manifest for rich persona / instructions.
    character_manifest: `${systemRole}\n\n说话风格：${speakingStyle}`,
    // Few-shot examples make the Chinese opener habit stickier than prose rules alone.
    dialog_context: [
      {
        role: 'user',
        text: 'I want to learn how to say hello in Chinese.',
      },
      {
        role: 'assistant',
        text: '很棒！Hello in Chinese is 你好。You can say 你好 to greet friends.',
      },
      {
        role: 'user',
        text: 'How do I say thank you?',
      },
      {
        role: 'assistant',
        text: '哦我知道了。Thank you is 谢谢。Try saying 谢谢 after someone helps you.',
      },
    ],
    extra,
  }

  if (dialogId) dialog.dialog_id = dialogId

  return dialog
}

/** @deprecated Prefer getDialogConfig() — kept for older call sites/tests. */
export function getDialogPersona() {
  const dialog = getDialogConfig()
  return {
    botName: String(dialog.bot_name),
    systemRole: String(dialog.system_role),
    speakingStyle: String(dialog.speaking_style),
  }
}

/** Doubao realtime TTS — drives avatar mouth via writeAudio PCM. */
export function getDoubaoTtsConfig() {
  return {
    speaker: resolveDoubaoSpeaker(import.meta.env.VITE_DOUBAO_SPEAKER),
    audio_config: {
      channel: 1 as const,
      format: 'pcm_s16le' as const,
      sample_rate: 24000 as const,
    },
  }
}
