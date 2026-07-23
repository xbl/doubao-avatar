import { describe, expect, it } from 'vitest'
import { AsrTranscriptBuffer, extractAsrText } from './realtimeClient'

describe('extractAsrText', () => {
  it('extracts user speech text from an ASR payload', () => {
    expect(extractAsrText({ text: '你好，豆包' })).toBe('你好，豆包')
  })

  it('extracts text from the ASR info payload used for barge-in', () => {
    expect(extractAsrText({ text: '请继续说' })).toBe('请继续说')
  })

  it('returns an empty string when the ASR payload has no text', () => {
    expect(extractAsrText({ result: '你好' })).toBe('')
  })

  it('extracts text nested in ASR results', () => {
    expect(extractAsrText({ results: [{ text: '嵌套文本' }] })).toBe('嵌套文本')
  })
})

describe('AsrTranscriptBuffer', () => {
  it('commits only the latest interim text when ASR ends', () => {
    const buffer = new AsrTranscriptBuffer()
    buffer.update({ results: [{ text: 'ok i', is_interim: true }] })
    buffer.update({ results: [{ text: "ok i don't know", is_interim: true }] })

    expect(buffer.commit()).toBe("ok i don't know")
    expect(buffer.commit()).toBe('')
  })
})
