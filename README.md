# 豆包实时语音 × 讯飞数字人 POC

按语雀 [虚拟人SDK-Web集成文档](https://www.yuque.com/xnrpt/bbc1du/ht4a2a2vstvb13se) 接入官方 **AvatarPlatform**（`writeAudio` 音频驱动 + `interrupt` 打断）。

在自由通话基础上，接入本机 **HSK 知识库检索**，通过豆包官方 **ChatRAGText (502)** 轻量注入词汇材料。产品原则：**自然闲聊优先**；仅强相关时走 RAG，且 **一旦发 502 就只播 RAG 回复、不播闲聊音频**。

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
- RAG（可选，有默认值）：见 [§5.7 配置](#57-配置)

## 3. 运行

```bash
npm install
npm run dev
```

1. 先启动本机检索服务（默认 `http://127.0.0.1:8787`，`GET /health` 应返回 `ok`）  
2. 打开前端 → 点 **开始** → 对麦 free talk  
3. 用户打断：豆包 `ASRInfo(450)` → 本端 abort 检索 + `avatar.interrupt()`

## 4. 音视频链路（不变）

- 麦克风 → 豆包实时 WS（上行约 16k PCM）  
- 豆包下行 TTS PCM（**24k**）→ 讯飞 `writeAudio`（`audio_format: 2`，24k），少重采样  
- `writeAudio(buf, status)`：`0` 首帧 / `1` 中间 / `2` 结束  
- Avatar 实例放在普通 class 里，**不要**放进 Vue `reactive`（见讯飞文档 §7.6）

---

## 5. 豆包实时语音 + 外部 RAG：当前运作机制

官方协议：[端到端实时语音 · 外部 RAG](https://docs.volcengine.com/docs/6561/1594356?lang=zh#_4-3-外部rag输入)

### 5.1 一句话总结

客户端自己查本机知识库 → 强相关才发 **502 ChatRAGText** → 豆包基于外部知识再生成并 TTS → 数字人播音。  
**豆包不会自己调 MCP / 不会自己查 8787**；也不会把「闲聊生成」和「RAG 生成」自动融成一段。本 POC 用 **预检索 + hold + rag_only** 保证：有 502 时用户只听到 RAG 那一段。

### 5.2 端到端时序

```text
用户说话
  │
  ├─ ASRInfo(450)          新一轮开始：turnId++，打断数字人，abort 旧检索
  ├─ ASRResponse(451)×N    更新本轮文本 → 【预检索】POST /retrieve（文本一变就可能再查）
  └─ ASREnded(459)         用户说完
        │
        ▼
   replyMode = hold        短暂挡住数字人音频（决策窗）
        │
        ▼
   等待本轮检索结果（通常已由预检索完成；超时默认 500ms）
        │
        ├─ kept≥1（强相关）
        │     replyMode = rag_only
        │     ClientInterrupt(515) 打断服务端可能已开跑的闲聊
        │     avatar.interrupt() + 清空本地 PCM 队列
        │     ChatRAGText(502) 注入短卡片
        │     只放行 tts_type=external_rag 的 PCM → 数字人
        │
        └─ 无强相关 / 超时 / 服务挂了
              replyMode = pass
              不发 502 → 正常闲聊 TTS → 数字人
```

### 5.3 预检索（为什么控制台可能出现多次 `[rag] retrieve`）

| 触发点 | 行为 |
|--------|------|
| `ASRResponse(451)` | 文本有更新 → `startRagJob(query)` 预取 |
| `ASREnded(459)` | 用定稿文本确保有一份 job，再 `await` 结果 |

去重规则：**同一 `turnId` + query 字符串完全相同** 才跳过。ASR 中间结果若大小写、标点、空格不同（如 `but is it 米饭` vs `But is it 米饭? `），会看到 **多次 retrieve**（通常各十几～几十 ms），属预期。旧 query 的 in-flight 请求会被 `AbortController` 取消。

预检索的目的：尽量在 `ASREnded` 时结果已就绪，缩短 `hold` 窗，降低「闲聊先开跑、502 后到」的竞态。

### 5.4 回复门控 `replyMode`（有 502 就不用闲聊音频）

| 模式 | 何时 | 数字人听到什么 |
|------|------|----------------|
| `hold` | ASR 刚结束、正在等检索决策 | **不播**（丢弃窗内闲聊 PCM） |
| `rag_only` | 本轮已决定发 502 | **只播** `tts_type=external_rag`；其它 TTS 再 `ClientInterrupt` 并丢弃 |
| `pass` | 无强相关，或 RAG 段播完复位 | 正常闲聊 / 后续轮次 |

说明：

- 服务端仍可能先吐出闲聊文本（控制台仍可能看到 `[doubao] chat:`），但 **不会送给讯飞数字人**。  
- 有强相关时固定：`ClientInterrupt` → `ChatRAGText(502)` → 只播 RAG。  
- 日志：`[rag] ChatRAGText only (free chat suppressed)`。

豆包侧**没有**「把两段回复合并成一句」的官方能力；本方案是客户端策略，不是服务端 merge。

### 5.5 「命中」与浅召回过滤

- **命中**：`/retrieve` 的 hits 里，存在通过分数门槛的条目（不是 ASR 对错，也不要求回复必须覆盖该词）。  
- 本机默认 `mode=hybrid`（关键词 + 向量融合），常见字段：  
  - `score_keyword`：字面/关键词强度  
  - `score_vector`：语义相似度（约 0～1）  
  - `score`：hybrid 融合分（约 0～1+，在本轮候选内归一化后加权，**不能当绝对大阈值硬套**）  

客户端（`ragClient`）规则：

1. 有 `score_keyword` 时优先：`≥ 15` 才保留  
2. 否则：`max(score) ≥ 0.85`，且 `score ≥ max * 0.5`  
3. 最多 `top_k=2`；压成短卡片（词 + 拼音 + ≤120 字释义）；第一条 `content` 前拼接 `EXTERNAL_RAG_GUIDE`  
4. 无命中 / 超时 / 8787 未启动 → **不发 502**，走闲聊，通话不中断  

#### 502 引导语与人设（中英结构）

闲聊轮主要跟人设 `system_role` / `speaking_style` 走；**502 轮更容易跟着中文词卡跑偏**（主体英文变少甚至消失）。因此注入材料时，在第一条卡片前固定带上引导语，**把回复格式再写一遍**：

```text
回复格式必须仍遵守人设：先一句自然中文口头语开头，主体多用英文（夹少量简单中文词），方便英国初学者。可自然带入下列材料，勿逐条讲解、勿变课堂。
```

实现位置：`src/modules/rag/ragClient.ts` → `EXTERNAL_RAG_GUIDE`（拼进 `external_rag` JSON，不是改 StartSession）。

### 5.6 时延预期

| 步骤 | 预期 |
|------|------|
| 预检索（说话过程中） | 与用户说话重叠，不占「说完后的静音」 |
| `hold` 决策窗 | 预取命中时 ≈ 0；热查询通常 **几～几十 ms**；最坏等到 `VITE_RAG_TIMEOUT_MS`（默认 **500**）后放弃 RAG |
| 502 + RAG TTS | 相对纯闲聊通常接近或略增 |

冷启动首查若经常超时，把 `.env` 里 `VITE_RAG_TIMEOUT_MS` 临时调到 `800`～`1000`。

### 5.7 配置

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `VITE_RAG_ENABLED` | `true` | 总开关 |
| `VITE_RAG_BASE_URL` | `http://127.0.0.1:8787` | 本机检索（浏览器直连，需 CORS） |
| `VITE_RAG_TOP_K` | `2` | 浅召回条数 |
| `VITE_RAG_TIMEOUT_MS` | `500` | 检索超时 → 回退闲聊；优先短 hold |

### 5.8 与 MCP 的关系

`ragClient` **不是** MCP。豆包实时会话**不能**原生去调 MCP Server。  
知识库若做成 MCP，也只能由本端（或后端）当 MCP Client 查完，再发 **502**。注入协议不变。

### 5.9 验收日志

| 日志 | 含义 |
|------|------|
| `[rag] retrieve query=… hits=N kept=M took_ms=…` | 检索；`kept≥1` 才会发 502 |
| `[rag] skip: …` / `no strong hit — free chat` | 本轮不注入，闲聊 |
| `[rag] ChatRAGText only (free chat suppressed)` | 已选 RAG-only |
| `[doubao] ClientInterrupt (515)` | 打断服务端闲聊生成 |
| `[doubao] ChatRAGText …` | 502 已发送 |
| `[doubao] tts_type= external_rag` | RAG 路径 TTS（应被数字人播放） |
| `[doubao] chat:` | 模型文本流（rag_only 时闲聊文本可能仍出现，但不驱动数字人） |

### 5.10 关键代码

| 路径 | 职责 |
|------|------|
| `src/session/talkSession.ts` | 预检索、`hold` / `rag_only` / `pass`、502 与打断编排 |
| `src/modules/rag/ragClient.ts` | `/retrieve`、分数过滤、短卡片、`external_rag` 组包 |
| `src/modules/doubao/realtimeClient.ts` | ASR 缓冲、`onAsrUpdate` / `onAsrEnded`、`sendChatRagText(502)`、`ClientInterrupt(515)` |
| `src/modules/doubao/protocol.ts` | 事件号（含 502 / 515） |
| `src/modules/iflytek/avatar.ts` | `writeAudio` / `interrupt` |

---

## 6. 设计文档

- 音视频 POC：`docs/superpowers/specs/2026-07-22-doubao-iflytek-avatar-poc-design.md`
- 外部 RAG（含 MCP 边界）：`docs/superpowers/specs/2026-07-24-external-rag-design.md`
