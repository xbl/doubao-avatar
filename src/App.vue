<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { TalkSession, type TalkState } from '@/session/talkSession'

const wrapperEl = ref<HTMLElement | null>(null)
const state = ref<TalkState>('idle')
const error = ref('')
/** shallowRef: do not deeply proxy TalkSession / SDK instances */
const session = shallowRef(
  new TalkSession({
    onState: (s) => {
      state.value = s
    },
    onError: (msg) => {
      error.value = msg
    },
  }),
)

const busy = computed(() => state.value === 'starting' || state.value === 'stopping')
const talking = computed(() => state.value === 'talking')

async function onStart() {
  error.value = ''
  if (!wrapperEl.value) {
    error.value = '数字人容器未就绪'
    return
  }
  await session.value.start(wrapperEl.value)
}

async function onEnd() {
  await session.value.stop()
}

onBeforeUnmount(() => {
  void session.value.stop()
})
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>豆包实时语音 × 讯飞数字人</h1>
      <p class="sub">Free talk POC · AvatarPlatform.writeAudio · 豆包 VAD 打断</p>
    </header>

    <section class="stage">
      <div ref="wrapperEl" class="avatar-wrapper" />
    </section>

    <section class="controls">
      <button type="button" :disabled="busy || talking" @click="onStart">开始</button>
      <button type="button" class="secondary" :disabled="busy || state === 'idle'" @click="onEnd">
        结束
      </button>
      <span class="status">状态：{{ state }}</span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.header h1 {
  margin: 0 0 4px;
  font-size: 1.5rem;
  font-weight: 650;
}

.sub {
  margin: 0;
  color: #5b6472;
  font-size: 0.95rem;
}

.stage {
  margin-top: 20px;
  background: #0f172a;
  border-radius: 12px;
  overflow: hidden;
}

.avatar-wrapper {
  width: 100%;
  min-height: 480px;
  height: min(70vh, 720px);
  aspect-ratio: 9 / 16;
  max-height: 720px;
  margin: 0 auto;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

button {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  background: #0f766e;
  color: #fff;
}

button.secondary {
  background: #334155;
}

.status {
  color: #475569;
  font-size: 0.9rem;
}

.error {
  margin-top: 12px;
  color: #b91c1c;
  background: #fef2f2;
  border-radius: 8px;
  padding: 10px 12px;
}
</style>
