# 豆包实时语音 × 讯飞数字人 POC

按语雀 [虚拟人SDK-Web集成文档](https://www.yuque.com/xnrpt/bbc1du/ht4a2a2vstvb13se) 接入官方 **AvatarPlatform**（`writeAudio` 音频驱动 + `interrupt` 打断）。

在自由通话基础上，可选接入本机 **HSK 知识库检索**，通过豆包官方 **ChatRAGText (502)** 轻量注入词汇材料——**自然闲聊优先**，不强行上课。

## 1. 官方 SDK（已安装）

已从桌面 `avatar-sdk-web_3.2.3.1002.zip` 解压到：

```text
src/libs/avatar-sdk-web/
```

含 `index.js`、XRTC/WebRTC 播放器分包与 `index.d.ts`。

## 2. 配置环境变量

```bash
cp .env.example .env
```

填写：

- 豆包：`DOUBAO_APP_ID` / `DOUBAO_ACCESS_KEY`（建议 `VITE_DOUBAO_MODEL=1.2.1.1`，与 ChatRAGText 对齐）
- 讯飞：`VITE_IFLYTEK_APP_ID` / `API_KEY` / `API_SECRET` / `SCENE_ID` / `AVATAR_ID` / `VCN`
- RAG（可选，有默认值）：见下方 [§5 外部 RAG](#5-外部-rag浅召回--chatragtext)

## 3. 运行

```bash
npm install
npm run dev
```

点 **开始** → 对麦 free talk。打断时豆包 `ASRInfo(450)` → `avatar.interrupt()`。

若要用知识库：先启动本机检索服务（默认 `http://127.0.0.1:8787`），再开通话。

## 4. 架构要点（音视频）

- 豆包下行 PCM（24k）→ 讯飞 `audio_format: 2`（24k），减少重采样
- `writeAudio(buf, status)`：`0` 首帧 / `1` 中间 / `2` 结束
- Avatar 实例放在普通 class 里，**不要**放进 Vue `reactive`（见文档 §7.6）

## 5. 外部 RAG（浅召回 → ChatRAGText）

### 5.1 目标

用户说完一句后，豆包仍以口语聊天为主。若本机词库能检出**明显相关**的材料，则注入短卡片，让回复可以自然带上相关词；弱相关则不注入，走默认闲聊。

音频链路不变：豆包 TTS PCM → 讯飞 `writeAudio` → 数字人。

官方协议：[端到端实时语音 · 外部 RAG](https://docs.volcengine.com/docs/6561/1594356?lang=zh#_4-3-外部rag输入)

### 5.2 流程

```text
麦克风 16k PCM
    │
    ▼
豆包实时 WebSocket
    │  ASRResponse(451) 累积本轮文本
    │  ASREnded(459) ──► ragClient POST /retrieve（超时默认 2000ms）
    │                         │
    │                    强相关？短卡片 1～2 条
    │                      ╱           ╲
    │                    是             否
    │                    │              │
    │                    ▼              ▼
    │           ChatRAGText(502)    不发 502（纯闲聊）
    │                    ╲             ╱
    │                     ▼
    │              TTS PCM 24k → 讯飞数字人
```

编排在 `TalkSession`：`ASREnded` 后立刻检索并条件发送 502；打断（`ASRInfo`）会 abort 检索并用 `turnId` 丢弃过期结果。

### 5.3 「命中」与过滤

- **命中**：`/retrieve` 返回的 hits 里，存在通过分数门槛的条目（不是 ASR 对错，也不要求必须讲中该词）。
- 本机默认 `mode=hybrid`：关键词分 + 向量分融合。响应里常见字段：
  - `score_keyword`：字面/关键词强度
  - `score_vector`：语义相似度（约 0～1）
  - `score`：hybrid 融合分（约 0～1+，本轮候选内归一化后加权，**不宜当绝对阈值硬套大数字**）
- 客户端过滤（`src/modules/rag/ragClient.ts`）：
  - 有 `score_keyword` 时优先：`score_keyword ≥ 15` 才保留
  - 否则要求 `max(score) ≥ 0.85`，且保留 `score ≥ max * 0.5`
  - 最多 `top_k=2` 条；压成短卡片（词 + 拼音 + 截断释义）；第一条带「可自然带入、勿逐条讲解」引导语
  - 无命中 / 超时 / 8787 未启动 → **跳过 502**，通话继续

### 5.4 与 MCP 的关系

`ragClient` **不是** MCP。豆包实时会话**不会**自己去调 MCP Server；外部知识只能由客户端查完后经 **502** 注入。若知识库做成 MCP，也只能在本端先查，再发 502。详见设计文档 §17。

### 5.5 配置

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `VITE_RAG_ENABLED` | `true` | 总开关 |
| `VITE_RAG_BASE_URL` | `http://127.0.0.1:8787` | 本机检索（浏览器直连，需 CORS） |
| `VITE_RAG_TOP_K` | `2` | 浅召回条数 |
| `VITE_RAG_TIMEOUT_MS` | `2000` | 超时则回退闲聊（覆盖 hybrid 冷启动） |

### 5.6 验收时看控制台

- `[rag] retrieve query=… hits=N kept=M took_ms=…` — `kept≥1` 才会发 502
- `[rag] skip: …` — 未注入（弱相关 / 超时 / 关闭等）
- `[doubao] ChatRAGText …` — 已向豆包注入
- `[doubao] tts_type= external_rag` — 本轮 TTS 可能走了外部 RAG 路径（若服务端带回该字段）

### 5.7 关键代码

| 路径 | 职责 |
|------|------|
| `src/modules/rag/ragClient.ts` | 检索、分数过滤、短卡片、`external_rag` 组包 |
| `src/modules/doubao/realtimeClient.ts` | ASR 文本、`sendChatRagText(502)` |
| `src/session/talkSession.ts` | ASR 结束 → 条件 RAG → 打断 abort |

## 6. 设计文档

- 音视频 POC：`docs/superpowers/specs/2026-07-22-doubao-iflytek-avatar-poc-design.md`
- 外部 RAG：`docs/superpowers/specs/2026-07-24-external-rag-design.md`
