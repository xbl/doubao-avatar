import { gzipSync, gunzipSync } from 'fflate'

export const PROTOCOL_VERSION = 0b0001

export const CLIENT_FULL_REQUEST = 0b0001
export const CLIENT_AUDIO_ONLY_REQUEST = 0b0010
export const SERVER_FULL_RESPONSE = 0b1001
export const SERVER_ACK = 0b1011
export const SERVER_ERROR_RESPONSE = 0b1111

export const MSG_WITH_EVENT = 0b0100
export const NEG_SEQUENCE = 0b0010

export const NO_SERIALIZATION = 0b0000
export const JSON_SERIALIZATION = 0b0001
export const NO_COMPRESSION = 0b0000
export const GZIP = 0b0001

/** Client → server event IDs */
export const EVENT_START_CONNECTION = 1
export const EVENT_FINISH_CONNECTION = 2
export const EVENT_START_SESSION = 100
export const EVENT_FINISH_SESSION = 102
export const EVENT_TASK_REQUEST = 200
/** Inject external RAG knowledge after user query (≤4K chars JSON array string). */
export const EVENT_CHAT_RAG_TEXT = 502

/** Server → client event IDs */
export const EVENT_CONNECTION_STARTED = 50
export const EVENT_SESSION_STARTED = 150
export const EVENT_TTS_SENTENCE_START = 350
export const EVENT_TTS_RESPONSE = 352
export const EVENT_TTS_ENDED = 359
/** First ASR word — use as barge-in signal to flush avatar audio */
export const EVENT_ASR_INFO = 450
export const EVENT_ASR_RESPONSE = 451
export const EVENT_ASR_ENDED = 459
export const EVENT_CHAT_RESPONSE = 550
export const EVENT_SESSION_FINISHED = 600

export type ParsedFrame = {
  messageType: number
  event?: number
  sessionId?: string
  code?: number
  payload: Uint8Array | Record<string, unknown> | string | null
}

function generateHeader(
  messageType: number,
  flags = MSG_WITH_EVENT,
  serialMethod = JSON_SERIALIZATION,
  compression = GZIP,
): Uint8Array {
  const header = new Uint8Array(4)
  header[0] = (PROTOCOL_VERSION << 4) | 0b0001
  header[1] = (messageType << 4) | flags
  header[2] = (serialMethod << 4) | compression
  header[3] = 0x00
  return header
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, false)
  return b
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function buildFullClientEvent(
  eventId: number,
  payloadObj: Record<string, unknown> = {},
  sessionId?: string,
): Uint8Array {
  const json = encodeUtf8(JSON.stringify(payloadObj))
  const compressed = gzipSync(json)
  const parts: Uint8Array[] = [
    generateHeader(CLIENT_FULL_REQUEST),
    u32be(eventId),
  ]
  if (sessionId !== undefined) {
    const sid = encodeUtf8(sessionId)
    parts.push(u32be(sid.byteLength), sid)
  }
  parts.push(u32be(compressed.byteLength), compressed)
  return concat(parts)
}

export function buildAudioTaskRequest(sessionId: string, pcm: Uint8Array): Uint8Array {
  const compressed = gzipSync(pcm)
  const sid = encodeUtf8(sessionId)
  return concat([
    generateHeader(CLIENT_AUDIO_ONLY_REQUEST, MSG_WITH_EVENT, NO_SERIALIZATION, GZIP),
    u32be(EVENT_TASK_REQUEST),
    u32be(sid.byteLength),
    sid,
    u32be(compressed.byteLength),
    compressed,
  ])
}

export function parseServerFrame(buf: ArrayBuffer | Uint8Array): ParsedFrame {
  const res = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const headerSize = res[0] & 0x0f
  const messageType = res[1] >> 4
  const flags = res[1] & 0x0f
  const serialization = res[2] >> 4
  const compression = res[2] & 0x0f
  let payload = res.slice(headerSize * 4)

  const result: ParsedFrame = { messageType, payload: null }

  if (messageType === SERVER_ERROR_RESPONSE) {
    result.code = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false)
    const size = new DataView(payload.buffer, payload.byteOffset + 4, 4).getUint32(0, false)
    let msg = payload.slice(8, 8 + size)
    if (compression === GZIP) msg = gunzipSync(msg)
    result.payload = serialization === JSON_SERIALIZATION
      ? JSON.parse(new TextDecoder().decode(msg))
      : new TextDecoder().decode(msg)
    return result
  }

  if (messageType !== SERVER_FULL_RESPONSE && messageType !== SERVER_ACK) {
    return result
  }

  let offset = 0
  if (flags & NEG_SEQUENCE) {
    offset += 4
  }
  if (flags & MSG_WITH_EVENT) {
    result.event = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false)
    offset += 4
  }
  payload = payload.slice(offset)

  const sidLen = new DataView(payload.buffer, payload.byteOffset, 4).getInt32(0, false)
  const sidBytes = payload.slice(4, 4 + sidLen)
  result.sessionId = new TextDecoder().decode(sidBytes)
  payload = payload.slice(4 + sidLen)

  const dataLen = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false)
  let data = payload.slice(4, 4 + dataLen)
  if (compression === GZIP && data.byteLength > 0) {
    try {
      data = gunzipSync(data)
    } catch {
      /* keep raw if not gzip */
    }
  }

  if (serialization === JSON_SERIALIZATION) {
    const text = new TextDecoder().decode(data)
    result.payload = text ? JSON.parse(text) : null
  } else {
    result.payload = data
  }
  return result
}
