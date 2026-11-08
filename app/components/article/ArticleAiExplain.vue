<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  requestExplanation,
  type ArticleExplanation,
  type ExplainLanguage,
  type ExplainMode,
} from '@/core/reading/explain.ts'

/**
 * AI 讲解面板。
 *
 * - 桌面：钉在问答栏（.read-right）正下方，与问答栏同宽、左对齐，不再压住单词卡；
 * - 窄屏：从底部弹出，最大 76vh。
 * - 加载中显示已用时与分段进度，超过 25 秒提示「换快模型」；
 * - 同一篇的讲解缓存在父组件，关掉再开秒回。
 */

const props = defineProps<{
  /** 唯一标识这次讲解的对象，用来做缓存（article / p-3 …） */
  explainKey: string
  text: string
  mode: ExplainMode
  heading: string
  title?: string
  language?: ExplainLanguage
  /** 复用的缓存（父组件持有，关掉再打开不会重复请求） */
  cache?: Record<string, ArticleExplanation>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'word', word: string): void
  (e: 'explained', key: string, explanation: ArticleExplanation): void
}>()

const loading = ref(false)
const error = ref('')
const explanation = ref<ArticleExplanation | null>(null)
const elapsed = ref(0)
let ticket = 0
let timer: ReturnType<typeof setInterval> | null = null

const modeLabel = computed(() =>
  props.mode === 'article' ? '整篇精读' : props.mode === 'sentence' ? '逐句拆解' : '本段讲解'
)

/** 预期耗时：整篇走「总览 + 分段并行」，比单段慢但远快于一次大请求 */
const estimate = computed(() => (props.mode === 'article' ? 20 : 12))
const stage = computed(() => {
  const ratio = elapsed.value / Math.max(6, estimate.value)
  if (ratio < 0.33) return 1
  if (ratio < 0.75) return 2
  return 3
})

const sentenceLookup = computed(() => {
  const map = new Map<string, ArticleExplanation['sentences'][number]>()
  for (const item of explanation.value?.sentences ?? []) map.set(normalize(item.en), item)
  return map
})

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 该句是否已被讲解覆盖（阅读页据此在正文下方展开讲解） */
function sentenceNote(text: string) {
  return sentenceLookup.value.get(normalize(text)) ?? null
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

async function run(force = false) {
  const cached = !force ? props.cache?.[props.explainKey] : undefined
  if (cached) {
    explanation.value = cached
    error.value = ''
    stopTimer()
    return
  }
  loading.value = true
  error.value = ''
  explanation.value = null
  const startedAt = Date.now()
  elapsed.value = 0
  stopTimer()
  timer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 1000)
  const current = ++ticket
  try {
    const result = await requestExplanation({
      text: props.text,
      mode: props.mode,
      language: props.language ?? 'zh',
      title: props.title,
      session: `reading-explain-${props.explainKey}`,
    })
    if (current !== ticket) return
    explanation.value = result
    emit('explained', props.explainKey, result)
  } catch (cause) {
    if (current !== ticket) return
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (current === ticket) {
      loading.value = false
      stopTimer()
    }
  }
}

watch(
  () => [props.explainKey, props.text, props.mode],
  () => {
    ticket++
    void run()
  },
  { immediate: true }
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stopTimer()
  ticket++
})

defineExpose({ sentenceNote })
</script>

<template>
  <section class="ai-explain" role="region" aria-label="AI 讲解" :aria-busy="loading">
    <header class="ai-explain__head">
      <div class="ai-explain__title">
        <IconFluentSparkle20Regular class="ai-explain__icon" />
        <div class="ai-explain__title-text">
          <p class="ai-explain__kicker">AI 讲解 · {{ modeLabel }}</p>
          <h2>{{ heading }}</h2>
        </div>
      </div>
      <button type="button" class="ai-explain__close" aria-label="关闭 AI 讲解" @click="emit('close')">×</button>
    </header>

    <div class="ai-explain__body">
      <div v-if="loading" class="ai-explain__loading" role="status" aria-live="polite">
        <div class="ai-explain__steps">
          <span :class="{ done: stage > 1, active: stage === 1 }">读原文</span>
          <span :class="{ done: stage > 2, active: stage === 2 }">梳理结构</span>
          <span :class="{ active: stage === 3 }">写讲解</span>
          <em>{{ elapsed }}s</em>
        </div>
        <p v-if="elapsed >= 25" class="ai-explain__slow">
          比预期慢。当前模型响应偏慢，可以到
          <NuxtLink to="/setting?index=4">AI 模型设置</NuxtLink>
          换个更快的模型，或先用段落讲解。
        </p>
        <p class="ai-explain__hintline">逐段讲解通常 10–20 秒；整篇会分段并行讲解，约 15–25 秒。</p>
        <div class="ai-explain__skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>

      <div v-else-if="error" class="ai-explain__error" role="alert">
        <p>{{ error }}</p>
        <div class="ai-explain__actions">
          <button type="button" @click="run(true)">重试</button>
          <NuxtLink to="/setting?index=4">检查 AI 设置</NuxtLink>
        </div>
      </div>

      <template v-else-if="explanation">
        <p v-if="explanation.theme" class="ai-explain__theme">{{ explanation.theme }}</p>

        <section v-if="explanation.summary.length" class="ai-explain__block">
          <h3>要点</h3>
          <ol class="ai-explain__summary">
            <li v-for="(item, i) in explanation.summary" :key="i">{{ item }}</li>
          </ol>
        </section>

        <section v-if="explanation.sentences.length" class="ai-explain__block">
          <h3>逐句</h3>
          <ul class="ai-explain__sentences">
            <li v-for="(item, i) in explanation.sentences" :key="i">
              <p class="en">{{ item.en }}</p>
              <p v-if="item.cn" class="cn">{{ item.cn }}</p>
              <p v-if="item.note" class="note">{{ item.note }}</p>
            </li>
          </ul>
        </section>

        <section v-if="explanation.words.length" class="ai-explain__block">
          <h3>难词 <span class="ai-explain__hint">点词发音</span></h3>
          <ul class="ai-explain__words">
            <li v-for="item in explanation.words" :key="item.word">
              <button type="button" class="word" :title="`朗读 ${item.word}`" @click="emit('word', item.word)">{{ item.word }}</button>
              <span class="meaning">{{ item.meaning }}</span>
              <span v-if="item.usage" class="usage">{{ item.usage }}</span>
            </li>
          </ul>
        </section>

        <section v-if="explanation.highlights.length" class="ai-explain__block">
          <h3>亮点</h3>
          <ul class="ai-explain__highlights">
            <li v-for="(item, i) in explanation.highlights" :key="i">{{ item }}</li>
          </ul>
        </section>
      </template>
    </div>

    <footer class="ai-explain__foot">
      <span>「设置 → AI 模型」里的模型生成，仅供参考</span>
      <button type="button" :disabled="loading" @click="run(true)">重新讲解</button>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.ai-explain {
  /* 挂在问答栏下面：宽度跟问答栏走，不压单词卡 */
  position: absolute;
  top: calc(100% + 0.8rem);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  max-height: min(74vh, 52rem);
  border: 1px solid var(--color-line);
  border-radius: 0.8rem;
  background: var(--color-card-bg);
  box-shadow: 0 14px 38px rgb(0 0 0 / 14%);
  font-family: var(--zh-article-family);
  overflow: hidden;
}

.ai-explain__head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.7rem 0.8rem 0.55rem;
  border-bottom: 1px solid var(--color-line);
}

.ai-explain__title {
  display: flex;
  gap: 0.45rem;
  min-width: 0;
  flex: 1;
}

.ai-explain__title-text {
  min-width: 0;

  h2 {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.45;
    color: var(--color-main-text);
  }
}

.ai-explain__icon {
  flex: none;
  margin-top: 0.12rem;
  font-size: 1rem;
  color: var(--color-select-bg);
}

.ai-explain__kicker {
  margin-bottom: 0.1rem;
  font-size: 0.78rem;
  color: var(--color-sub-text);
}

.ai-explain__close {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--color-sub-text);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: var(--color-second);
    color: var(--color-main-text);
  }
}

.ai-explain__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0.8rem 0.7rem;
  overscroll-behavior: contain;
}

.ai-explain__theme {
  margin-top: 0.7rem;
  padding: 0.6rem 0.65rem;
  border-left: 2px solid var(--color-select-bg);
  border-radius: 0 0.4rem 0.4rem 0;
  background: var(--color-second);
  font-size: 0.92rem;
  line-height: 1.75;
  color: var(--color-main-text);
}

.ai-explain__block {
  margin-top: 0.8rem;

  h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-sub-text);
  }
}

.ai-explain__hint {
  font-weight: 400;
  font-size: 0.74rem;
  opacity: 0.85;
}

.ai-explain__summary {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.9rem;
  line-height: 1.75;
  color: var(--color-main-text);
}

.ai-explain__sentences {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;

  li {
    padding: 0.5rem 0.6rem;
    border-radius: 0.45rem;
    background: var(--color-second);
  }

  .en {
    font-family: var(--en-article-family);
    font-size: 0.94rem;
    line-height: 1.6;
    color: var(--color-main-text);
  }

  .cn {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  .note {
    margin-top: 0.25rem;
    font-size: 0.84rem;
    line-height: 1.7;
    color: var(--color-sub-text);
  }
}

.ai-explain__words {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
    font-size: 0.88rem;
    line-height: 1.65;
  }

  .word {
    padding: 0 0.2rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--color-select-bg);
    font-family: var(--word-font-family);
    font-size: 0.94rem;
    cursor: pointer;

    &:hover {
      background: var(--color-second);
    }
  }

  .meaning {
    color: var(--color-main-text);
  }

  .usage {
    color: var(--color-sub-text);
    font-size: 0.84rem;
  }
}

.ai-explain__highlights {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
  line-height: 1.75;
  color: var(--color-sub-text);
}

/* 加载中 */
.ai-explain__loading {
  padding-top: 0.7rem;
}

.ai-explain__steps {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--color-sub-text);

  span {
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    opacity: 0.6;

    &.active {
      opacity: 1;
      border-color: var(--color-select-bg);
      color: var(--color-select-bg);
    }

    &.done {
      opacity: 1;
      border-color: #86efac;
      color: #15803d;
    }
  }

  em {
    margin-left: auto;
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }
}

.ai-explain__slow {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  line-height: 1.65;
  color: #b45309;

  a {
    text-decoration: underline;
  }
}

.ai-explain__hintline {
  margin-top: 0.45rem;
  font-size: 0.78rem;
  line-height: 1.65;
  color: var(--color-sub-text);
  opacity: 0.9;
}

.ai-explain__skeleton {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;

  span {
    display: block;
    height: 0.6rem;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--color-second), var(--color-third), var(--color-second));
    background-size: 200% 100%;
    animation: ai-explain-shimmer 1.4s infinite linear;

    &:nth-child(2) {
      width: 84%;
    }

    &:nth-child(3) {
      width: 62%;
    }
  }
}

@keyframes ai-explain-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}

.ai-explain__error {
  padding-top: 0.8rem;
  font-size: 0.88rem;
  line-height: 1.7;
  color: #b45309;
}

.ai-explain__actions {
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.84rem;

  button {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--color-line);
    border-radius: 0.35rem;
    background: var(--color-second);
    color: var(--color-main-text);
    cursor: pointer;
  }

  a {
    color: var(--color-link);
    text-decoration: underline;
  }
}

.ai-explain__foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.8rem;
  border-top: 1px solid var(--color-line);
  font-size: 0.74rem;
  color: var(--color-sub-text);

  span {
    flex: 1;
    line-height: 1.55;
  }

  button {
    flex: none;
    padding: 0.28rem 0.6rem;
    border: 1px solid var(--color-line);
    border-radius: 0.35rem;
    background: var(--color-second);
    color: var(--color-main-text);
    font-size: 0.76rem;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

/* 窄屏：底部抽屉 */
@media (max-width: 1100px) {
  .ai-explain {
    position: fixed;
    top: auto;
    left: 0.5rem;
    right: 0.5rem;
    bottom: 0.5rem;
    max-height: 76vh;
    z-index: 50;
  }
}
</style>
