# Doubao Realtime + iFlytek Digital Human POC — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Stack:** npm · Vite · Vue 3 · TypeScript  
**Goal:** Minimal free-talk demo: Doubao end-to-end realtime voice drives an iFlytek digital human via audio.

## 1. Context & decisions

| Decision | Choice |
|----------|--------|
| Drive mode | **Audio drive** — Doubao S2S PCM → iFlytek `audioDriver` |
| Frontend | Vite + Vue 3 + TypeScript |
| Backend | **None for POC** — browser connects directly to Doubao WS (lowest latency) |
| Success bar | Minimal demo: avatar + start/stop, free talk with lip sync |
| Barge-in | Use Doubao built-in VAD; client flushes iFlytek audio queue on interrupt |
| Credentials | Local `.env` (`VITE_*`); never commit secrets |

**Out of scope:** subtitles, chat history, Node proxy, auto-reconnect, polished UI, custom VAD.

## 2. Architecture

```text
[Mic] --PCM 16k mono--> [Doubao Realtime WS] --PCM--> [resample if needed]
                                                          |
                                                          v
                                            [~40ms frame queue]
                                                          |
                                                          v
                                      [iFlytek VMS audioDriver]
                                                          |
                                                          v
                                [XRTC avatar A/V stream] → user
```

- **Vue page:** avatar mount DOM + Start / End controls; owns session lifecycle UI.
- **DoubaoRealtimeClient:** direct WebSocket to Volcengine realtime dialogue API; uplink mic PCM; downlink reply PCM; surface interrupt/cancel events from Doubao VAD.
- **IflytekAvatar:** `VMS.start` / `audioDriverInit` / send frames / `stop`; Vite proxies `/vmss` for CORS.
- **AudioPipeline:** capture, optional resample (e.g. 24 kHz → 16 kHz), frame queue. **Do not** play Doubao audio in a separate `AudioContext` (avoid double audio / echo). User hears through the digital human stream only.

## 3. Repository layout

```text
doubao-iflytek-avatar-poc/
├── package.json
├── vite.config.ts              # proxy /vmss → iFlytek VMS host
├── .env.example
├── .gitignore
├── index.html
├── public/
└── src/
    ├── main.ts
    ├── App.vue
    ├── env.d.ts
    ├── libs/vms-web-sdk/       # vendor iFlytek Web SDK (provided by user)
    ├── config/env.ts
    ├── modules/
    │   ├── doubao/realtimeClient.ts
    │   ├── iflytek/avatar.ts
    │   └── audio/
    │       ├── micCapture.ts
    │       ├── resample.ts
    │       └── frameQueue.ts
    └── session/talkSession.ts
```

### Module boundaries

| Module | Does | Does not |
|--------|------|----------|
| `realtimeClient` | Doubao protocol + binary frames + interrupt signals | UI, iFlytek |
| `avatar` | VMS lifecycle + audio frames | Doubao |
| `audio/*` | Capture / resample / framing | Hold secrets or business flow |
| `talkSession` | Orchestrate one call | Encode protocol details |
| `App.vue` | Buttons + mount point | WS/SDK internals |

Prefer small local audio helpers over heavy media libraries for this POC.

## 4. Data flow & session state

### Call flow

1. User clicks Start → `talkSession.start()`.
2. `avatar.start()` then `audioDriverInit` (default interrupt-friendly framing, ~40 ms).
3. `realtimeClient.connect()`; `StartSession` **explicitly requests PCM** (avoid default OGG/Opus).
4. Mic → 16 kHz mono s16le → Doubao uplink.
5. Doubao downlink PCM → resample if needed → `frameQueue` → `avatar.sendAudioFrame()`.
6. User clicks End → stop mic, close WS, `avatar.stop()`, return to idle.

### State machine

```text
idle → starting → talking → stopping → idle
         │           │
         └→ error ←──┘  (cleanup, then idle/error; Start retries)
```

**Barge-in (inside `talking`):** Doubao VAD interrupts the model. Client must:

1. Observe Doubao interrupt / cancel / stop-audio style events (per official realtime protocol).
2. Clear `frameQueue` immediately.
3. Rely on iFlytek audio-driver interrupt mode (or equivalent SDK call) so the avatar stops speaking stale PCM.

No separate “interrupted” state for the POC.

### Audio conventions (verify against current docs at implement time)

- Uplink to Doubao: PCM s16le / 16 kHz / mono.
- Downlink: request PCM in session config; if 24 kHz, resample to driver expectation (commonly 16 kHz + fixed `frameSize`, e.g. 1280 bytes ≈ 40 ms @ 16 kHz).
- Enqueue full frames only before `audioDriverSendData`.

## 5. Configuration

`.env.example` placeholders (confirm final header names against current Volcengine docs when implementing):

- Doubao: `VITE_DOUBAO_APP_ID`, `VITE_DOUBAO_ACCESS_KEY`, `VITE_DOUBAO_RESOURCE_ID` (e.g. realtime dialogue resource), `VITE_DOUBAO_APP_KEY` if required by the WS handshake.
- iFlytek: `VITE_IFLYTEK_APP_ID`, `VITE_IFLYTEK_API_KEY`, `VITE_IFLYTEK_API_SECRET`, `VITE_IFLYTEK_AVATAR_ID`.
- Optional: `VITE_DOUBAO_SPEAKER`, `VITE_SYSTEM_ROLE` (one-line persona for free talk).

Doubao interrupt events: map whatever the official realtime protocol emits for VAD barge-in (e.g. reply cancelled / TTS stopped) onto `frameQueue.clear()` + avatar audio interrupt; do not invent a custom VAD.

`.gitignore` must exclude `.env`. Document that this POC is local-only; do not ship secrets in a public build.

## 6. Error handling

- Missing env, avatar start failure, or Doubao WS failure → `error`, short message, allow retry via Start.
- Mid-call disconnect → orderly `stopping` cleanup; **no** auto-reconnect.
- Interrupt flush failures → `console` only; do not tear down the whole call unless necessary.

## 7. Acceptance criteria

1. `npm install && npm run dev` shows avatar area + Start / End.
2. Start: avatar appears; free talk works; lip sync follows Doubao audio.
3. While the model speaks, user barge-in: Doubao stops; avatar stops promptly (queue flushed); conversation continues.
4. End: mic, WS, and avatar fully torn down; Start works again.
5. Secrets never committed to git.

## 8. References

- Volcengine Doubao realtime voice model docs (e.g. product/API pages under docs 6561 / realtime dialogue).
- iFlytek 2D virtual human Web SDK 2.0 (audio drive + `/vmss` proxy).
- User-provided Yuque guide for the specific digital-human package in use.
