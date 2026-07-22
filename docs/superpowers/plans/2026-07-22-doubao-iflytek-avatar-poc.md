# Doubao + iFlytek Avatar POC Implementation Plan

> **For agentic workers:** Execute inline in this session (user requested fast implementation). Steps use checkbox syntax for tracking.

**Goal:** Minimal Vue free-talk page where Doubao realtime PCM drives an iFlytek digital human via `audioDriver`, with barge-in queue flush on ASRInfo (450).

**Architecture:** Single Vite + Vue3 + TS SPA. Mic → Doubao realtime dialogue WS (via Vite WS proxy for `X-Api-*` headers) → resample 24k→16k → 1280-byte frames → iFlytek `audioDriverSendData`. Avatar A/V is the only playback path. On server event `450` (ASRInfo), clear frame queue.

**Tech Stack:** Vue 3, Vite 6, TypeScript, `fflate` (gzip), iFlytek `vms-web-sdk` (vendor copy).

## Global Constraints

- No Node app server beyond Vite; Doubao secrets stay in non-`VITE_` `.env` for proxy headers.
- iFlytek keys use `VITE_*` (required by Web SDK in browser).
- Explicit PCM in StartSession; no separate browser playback of Doubao audio.
- No subtitles, history, auto-reconnect, or custom VAD.

## File map

| File | Responsibility |
|------|----------------|
| `vite.config.ts` | `/vmss` + `/doubao-realtime` proxies |
| `src/modules/doubao/protocol.ts` | Binary frame encode/decode |
| `src/modules/doubao/realtimeClient.ts` | WS session + audio events |
| `src/modules/audio/*` | Mic, resample, frame queue |
| `src/modules/iflytek/avatar.ts` | VMS wrapper |
| `src/session/talkSession.ts` | Orchestration + barge-in |
| `src/App.vue` | Start/End UI |

---

### Task 1: Scaffold + proxies + env

- [x] Create Vite Vue-TS app files, `.gitignore`, `.env.example`, `/vmss` + Doubao WS proxy
- [x] Verify `npm install && npm run build` succeeds (avatar SDK may be stubbed)

### Task 2: Audio utilities

- [x] `frameQueue.ts` — accumulate bytes, emit 1280-byte frames, `clear()`
- [x] `resample.ts` — Int16 24k→16k linear
- [x] `micCapture.ts` — getUserMedia → PCM s16le 16k chunks
- [x] Unit-test resample + frameQueue with vitest

### Task 3: Doubao client

- [x] Port binary protocol (events 1/2/100/102/200; parse 352 audio, 450 interrupt)
- [x] `realtimeClient.ts` connect via `/doubao-realtime`, callbacks for pcm / interrupt / error

### Task 4: iFlytek avatar wrapper

- [x] `avatar.ts` start/stop/audioDriverInit/sendFrame; document copying SDK into `src/libs/vms-web-sdk/`
- [x] Stub module if SDK absent so TypeScript builds

### Task 5: talkSession + App UI

- [x] Wire start/stop state machine; on interrupt clear queue
- [x] Minimal App.vue: `#remote_stream`, Start/End, error text

### Task 6: Manual acceptance

- [ ] Fill `.env`, copy SDK, `npm run dev`, verify free talk + barge-in
