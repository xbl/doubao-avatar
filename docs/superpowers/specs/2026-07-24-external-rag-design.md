# 外部 RAG × 豆包实时语音 × 讯飞数字人 — 设计

**Date:** 2026-07-24  
**Status:** Ready for implementation  
**Model:** O `1.2.1.1`（支持 ChatRAGText）  
**Local RAG:** `http://127.0.0.1:8787` · `POST /retrieve`  
**Product principle:** **自然对话优先**；RAG 只做轻量词汇提示，不绑死 HSK 词条讲解。

参考：[端到端实时语音 API · 外部 RAG](https://docs.volcengine.com/docs/6561/1594356?lang=zh#_4-3-外部rag输入)

---

## 1. Goal

用户说完后，豆包仍以自然口语回复为主。若本机词库能检出**明显相关**的材料，则通过 **502 ChatRAGText** 轻量注入，让回复「可以自然带上相关词/知识点」，而不是变成背词典或上课。

音频链路不变：豆包 TTS PCM → 讯飞 `writeAudio` → 数字人。

## 2. Non-goals

- 不强制每轮都教 HSK / 逐条讲解词条
- 不做独立浏览器播放豆包音频
- 不替换讯飞数字人链路
- 首版不做「要不要 RAG」的二次 LLM 判断（用检索分数 + 条数规则）
- 不部署远端 RAG（本机 8787 + 已有 CORS）
- 首版不加 Vite `/rag` 代理（浏览器直连即可）
- 首版不经 MCP 接入知识库；不指望豆包实时会话原生调 MCP Server

## 3. Product intent（对齐共识）

| 期望 | 设计选择 |
|------|----------|
| 回复自然为主 | 浅召回、短卡片、引导语强调「可自然带入、勿逐条讲解」 |
| 与外挂知识相关 | 有强相关命中才发 502，让模型围着这些材料组织口语 |
| 不绑死 HSK1 | 不要求回复必须覆盖命中词；弱相关宁可不发 |
| 时延不明显变长 | 本机检索 ms 级；超时短；ASREnded 后立刻发 502 |

**「命中」定义：** `/retrieve` 返回的 `hits` 里，存在通过分数门槛的条目。  
不是指 ASR 识别对错，也不是「必须讲中这个词」。

## 4. Official contract（豆包 502）

| 项 | 值 |
|----|-----|
| 客户端事件 | `502 ChatRAGText` |
| Payload | `{ "external_rag": "<json数组字符串>" }` |
| 数组元素 | `{ "title": string, "content": string }` |
| 长度上限 | 整体 ≤ **4K 字符** |
| 行为 | 用户 query 后注入外部知识 → 模型总结/口语化 → TTS；`tts_type` 可为 `external_rag` |
| 版本 | O / SC 均支持；本 POC 固定 **O 1.2.1.1** |

`external_rag` 必须是 **字符串**（JSON 数组序列化后的文本），不是原生数组字段。

## 5. Local RAG contract（已探明）

| 项 | 值 |
|----|-----|
| Health | `GET /health` → `{ "ok": true }` |
| Retrieve | `POST /retrieve` |
| Body | `{ "query": string, "top_k"?: number }`（`query` 必填） |
| CORS | `Access-Control-Allow-Origin: *` |
| Hits | `title`, `text`, `chunk_type`, `hsk_level`, `score`, `metadata`… |

## 6. Architecture

```text
[Mic 16k PCM]
    │
    ▼
[Doubao Realtime WS]
    │  ASRResponse(451) 更新本轮文本
    │  ASREnded(459) ──────────────┐
    │                              ▼
    │                      [ragClient] 浅召回
    │                      POST /retrieve  (timeout ≤500ms)
    │                              │
    │                     强相关？短卡片 1～2 条
    │                         ╱         ╲
    │                       是           否
    │                       │            │
    │                       ▼            ▼
    │              ChatRAGText(502)   不发 502
    │              （轻提示）         （默认闲聊）
    │                       ╲         ╱
    │                        ╲       ╱
    │                         ▼
    │              TTS PCM 24k → 数字人 writeAudio
```

## 7. Timing

1. `ASRResponse(451)`：更新本轮文本，并**预取** `/retrieve`（与最终文本相同时复用）  
2. `ASREnded(459)`：等待预取结果；强相关则马上发 502  
3. 无可用文本 → skip RAG  

**双回复问题：** 豆包不会把闲聊 TTS 与 `external_rag` TTS「融成一段」。本 POC 策略是：**一旦本轮要发 502，就不播闲聊**——

1. `ASREnded` 后先 `hold`（丢弃决策窗内的数字人音频）  
2. 有强相关：`ClientInterrupt(515)` + 发 502，`rag_only` 只放行 `tts_type=external_rag` 的 PCM  
3. 无强相关：`pass`，正常闲聊  

打断：

- `ASRInfo(450)`：`AbortController` 取消 retrieve；清空本轮缓冲；`avatar.interrupt()`；回复模式回 `pass`  
- 用 `turnId` 丢弃过期 502，防止串轮  

不做「闲聊播完再补 502」。

## 8. Recall policy（浅召回）

自然优先，知识为辅。

| 参数 | 默认 | 说明 |
|------|------|------|
| `top_k` | **2** | 最多 2 条；可降到 1 |
| 分数门槛 | 本机 hybrid：`score` 约 0–1；有 `score_keyword` 时优先（≥15 才算强相关）；否则要求 `maxScore ≥ 0.85` 且 `score ≥ maxScore * 0.5` | 弱相关 / 纯向量噪声不注入 |
| content | **短卡片**：词名 + 拼音（若有）+ 截断后的一句释义/例句（约 ≤120 字/条） | 禁止整段长释义全文塞入 |
| 引导意图 | 在第一条 `content` 前加一句固定短前缀（见 §9） | 防变课堂播报 |
| 4K 保护 | 序列化后硬上限 ~3800 字符 | 按 score 从高到低丢弃 |

### 决策表

| 条件 | 动作 |
|------|------|
| 强相关 hits ≥ 1 | 发 502（轻提示） |
| 无命中 / 分数过低 / 超时 / 8787 挂了 / ASR 空 | **不发 502**，默认闲聊 |
| 检索成功但卡片为空 | 不发 502 |

## 9. Payload shaping

```ts
const GUIDE =
  '可在回复中自然用到下列材料；保持口语聊天，勿逐条讲解、勿变课堂。\n'

function toCard(hit: RagHit): { title: string; content: string } {
  const pinyin = hit.metadata?.pinyin ? `（${hit.metadata.pinyin}）` : ''
  const body = shorten(hit.text, 120)
  return {
    title: hit.title || 'note',
    content: `${hit.title}${pinyin}。${body}`,
  }
}

// items: 1～2 cards；第一条 content = GUIDE + card.content
// external_rag = JSON.stringify(items)
```

模型侧期望听感：聊天里轻轻带词，而不是「今天学第 N 课」。

## 10. Latency expectation

| 步骤 | 预期 |
|------|------|
| 本机 `/retrieve` | 约 1～10ms（已测 `took_ms` 个位数） |
| 组包 + 发 502 | 可忽略 |
| 豆包 RAG 条件生成 | 相对纯闲聊通常接近或略增 |

结论：按本设计，**体感时延通常不会明显变长**。主要风险是超时设太长或 502 发太晚。

超时默认 **500ms**（热查询通常 ms～几十 ms；冷启动若 >500ms 则本轮 skip RAG 走闲聊，可按需调高 `VITE_RAG_TIMEOUT_MS`）：超时立即放弃 RAG，缩短 hold 窗。

## 11. Module changes

| 文件 | 职责 |
|------|------|
| `src/modules/rag/ragClient.ts` | `retrieve`、分数过滤、短卡片、`toExternalRagPayload` |
| `src/modules/rag/ragClient.test.ts` | 映射 / 截断 / 过滤 / 空结果 |
| `src/modules/doubao/protocol.ts` | `EVENT_CHAT_RAG_TEXT = 502` |
| `src/modules/doubao/realtimeClient.ts` | 解析 451/459；`onAsrEnded(text)`；`sendChatRagText` |
| `src/session/talkSession.ts` | 编排：ASR 结束 → 浅召回 → 条件 502；打断 abort |
| `src/config/env.ts` + `.env.example` | `VITE_RAG_*` |
| `src/env.d.ts` | 类型声明 |

`TalkSession` 仍是唯一编排者。RAG 失败只 `console.warn`，不把通话打成 `error`。

## 12. Config

| Env | Default | 说明 |
|-----|---------|------|
| `VITE_RAG_ENABLED` | `true` | 总开关 |
| `VITE_RAG_BASE_URL` | `http://127.0.0.1:8787` | 本机服务 |
| `VITE_RAG_TOP_K` | `2` | 浅召回条数 |
| `VITE_RAG_TIMEOUT_MS` | `500` | 超时则回退闲聊；优先短 hold，冷启动偶发 skip 可调高 |
| `VITE_DOUBAO_MODEL` | `1.2.1.1` | O 版本 |
| `VITE_DOUBAO_SPEAKER` | O 兼容音色（如 `zh_female_vv_jupiter_bigtts`） | 与 model 匹配 |

## 13. Observability

- `[rag] retrieve query=… hits=N kept=M took_ms=…`
- `[rag] skip: no hits | low score | timeout | empty asr | disabled`
- `[doubao] ChatRAGText items=… chars=… turn=…`
- 若 TTSSentenceStart 带 `tts_type`，打印是否 `external_rag`

## 14. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| 回复变课堂腔 | 短卡片 + GUIDE；top_k≤2 |
| 502 发晚导致重生成/变慢 | ASR 预取 + 短超时 hold（默认 500ms）；有 502 则只播 external_rag |
| 串轮 | turnId + abort |
| 8787 未启动 | skip，通话继续 |
| 时延体感变差 | 先查超时与 502 时机，而不是词库本身 |
| O/音色不匹配 `55000001` | 保持 O + jupiter 类音色 |

## 15. Test plan

1. Unit：短卡片截断、分数过滤、空 hits、4K 截断  
2. Unit：451 final / 459 触发；打断后不发过期 502  
3. Manual：8787 开着聊「谢谢」→ 有 retrieve + 502 → 回复自然且可能带相关词  
4. Manual：弱相关闲聊 → 常 skip 502 → 仍自然闲聊  
5. Manual：关掉 8787 → 无崩溃，纯闲聊  
6. Manual：打断 → 无过期 502；数字人可打断  
7. Manual：体感首包时延与改前对比，应无明显变慢  

## 16. Implementation order

1. 更新/冻结本设计（本文）  
2. `ragClient` + 单测（浅召回与短卡片）  
3. protocol 502 + realtimeClient ASR 回调与 `sendChatRagText`  
4. `talkSession` 编排 + env  
5. 手动验收  

## 17. RAG vs MCP（边界与可选路径）

`ragClient` 与 MCP **没有直接关系**；二者常一起出现在 AI 讨论里，但职责不同。

| | 本项目的 `ragClient` / 外部 RAG | MCP（Model Context Protocol） |
|--|--------------------------------|------------------------------|
| 是什么 | 客户端先检索本机词库，再经豆包 **502 ChatRAGText** 注入材料 | 给 Agent/工具用的标准协议：模型侧按规范调用外部 Server（搜文档、读库、调 API 等） |
| 通信对象 | HTTP `8787/retrieve` + 豆包实时语音 WS | MCP Client ↔ MCP Server（如 Cursor 里的各类 Server） |
| 本 POC | **已采用** | **未采用** |

### 豆包实时 API 能否「通过 MCP 去查」？

按官方 [端到端实时语音 · 外部 RAG](https://docs.volcengine.com/docs/6561/1594356?lang=zh#_4-3-外部rag输入)：**不能。**

实时对话链路里，外部知识的官方入口是：

1. **你的客户端**先查到知识  
2. 用 **502 ChatRAGText** 把 `{ title, content }` 数组字符串发给豆包  
3. 豆包再总结/口语化 → TTS  

也就是：**检索在客户端，注入靠 502**。文档没有「豆包作为 MCP Client 去连知识库 Server」的能力。

### 若知识库做成了 MCP Server，怎么实现同一效果？

| 方案 | 能否实现「自然聊 + 轻量带词」 | 说明 |
|------|------------------------------|------|
| 当前：HTTP `/retrieve` → 502 | ✅ | 本设计已落地 |
| MCP Server → **本端当 MCP Client 查完再发 502** | ✅ | 只换检索协议；**豆包侧仍走 502** |
| 指望豆包实时会话**直接**调 MCP | ❌ | 当前 API 不支持 |

可选流程（仅检索层换皮）：

```text
用户说完
  → 前端/后端（可选：MCP Client）查知识库
  → 仍发 ChatRAGText(502)
  → 豆包口语化 + TTS → 数字人
```

对豆包而言，最终仍是同一份 `external_rag` 字符串。

### 何时值得上 MCP

- 知识库还要给 Cursor / 其他 Agent / 多客户端共用 → 做成 MCP 有价值  
- **只服务本语音 POC** → 继续 HTTP `ragClient` 更简单，时延更好控（浏览器直连 8787；热查询 ms 级，超时默认 500ms）  
- 浏览器里直接挂 MCP（stdio）不现实，通常还要多一层后端当 MCP Client，反而多一跳  

**结论（冻结）：** 知识库将来可做成 MCP，但实现本效果时 MCP 只能替掉检索侧；**注入豆包必须仍走 502**，不能把「实时语音链路通过 MCP 查库」当作官方能力。

---

实现时严格按本文：自然优先、浅召回、快超时、有强相关才发 502。
