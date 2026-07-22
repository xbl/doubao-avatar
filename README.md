# 豆包实时语音 × 讯飞数字人 POC

按语雀 [虚拟人SDK-Web集成文档](https://www.yuque.com/xnrpt/bbc1du/ht4a2a2vstvb13se) 接入官方 **AvatarPlatform**（`writeAudio` 音频驱动 + `interrupt` 打断）。

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

- 豆包：`DOUBAO_APP_ID` / `DOUBAO_ACCESS_KEY`
- 讯飞：`VITE_IFLYTEK_APP_ID` / `API_KEY` / `API_SECRET` / `SCENE_ID` / `AVATAR_ID` / `VCN`

## 3. 运行

```bash
npm install
npm run dev
```

点 **开始** → 对麦 free talk。打断时豆包 `ASRInfo(450)` → `avatar.interrupt()`。

## 架构要点

- 豆包下行 PCM（24k）→ 讯飞 `audio_format: 2`（24k），减少重采样
- `writeAudio(buf, status)`：`0` 首帧 / `1` 中间 / `2` 结束
- Avatar 实例放在普通 class 里，**不要**放进 Vue `reactive`（见文档 §7.6）

设计文档：`docs/superpowers/specs/2026-07-22-doubao-iflytek-avatar-poc-design.md`
