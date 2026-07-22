/** Linear resample Int16 PCM between sample rates. */
export function resampleInt16(
  input: Int16Array,
  fromRate: number,
  toRate: number,
): Int16Array {
  if (fromRate === toRate || input.length === 0) {
    return input.slice()
  }
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const output = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = src - i0
    const sample = input[i0] * (1 - t) + input[i1] * t
    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample)))
  }
  return output
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.byteLength)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], true)
  }
  return bytes
}

export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const aligned = bytes.byteOffset % 2 === 0
    ? bytes
    : bytes.slice()
  return new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 2))
}

export function floatToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
