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
    │                      POST /retrieve  (timeout ≤300ms)
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

1. `ASRResponse(451)`：`is_interim === false` 时更新 `finalAsrText`；否则保留最新 interim 作兜底  
2. `ASREnded(459)`：**立刻**用当前文本 retrieve；强相关则马上发 502  
3. 无可用文本 → skip RAG  

打断：

- `ASRInfo(450)`：`AbortController` 取消 retrieve；清空本轮缓冲；`avatar.interrupt()`  
- 用 `turnId`（或 `question_id`）丢弃过期 502，防止串轮  

不做「先等闲聊 TTS，再补 502」——发晚了容易冲突或重来，反而增加体感时延。

## 8. Recall policy（浅召回）

自然优先，知识为辅。

| 参数 | 默认 | 说明 |
|------|------|------|
| `top_k` | **2** | 最多 2 条；可降到 1 |
| 分数门槛 | 保留最高分，且明显高于噪声（实现时用相对阈值，如 `score >= maxScore * 0.5`，且 `maxScore` 过低则整轮 skip） | 弱相关不注入 |
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

超时默认 **300ms**：超时立即放弃 RAG，不阻塞闲聊通路。

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
| `VITE_RAG_TIMEOUT_MS` | `300` | 超时则回退闲聊 |
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
| 502 发晚导致重生成/变慢 | ASREnded 后立刻 retrieve+502；timeout 300ms |
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

---

实现时严格按本文：自然优先、浅召回、快超时、有强相关才发 502。
