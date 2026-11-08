<script setup lang="ts">
import type { SpeechEngine, SpeechState } from '@/core/reading/useArticleSpeech'

const props = defineProps<{
  state: SpeechState
  index: number
  total: number
  /** 当前句内的播放进度 0-1 */
  progress: number
  elapsed: number
  duration: number
  rate: number
  loop: boolean
  engine: SpeechEngine
  error?: string
  notice?: string
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'seek', index: number): void
  (e: 'update:rate', rate: number): void
  (e: 'update:loop', loop: boolean): void
  (e: 'update:engine', engine: SpeechEngine): void
}>()

/**
 * 播放条固定在视口底部。
 * 布局里的 .main-content 是 overflow 容器，position: sticky 在里面不生效，
 * 所以这里量正文栏的左右边界，用 fixed + 同步 left/width 让它对齐文章列。
 * 侧边栏宽度、字体加载都会让列位置漂一点，因此用几帧的轮询把位置稳定下来。
 */
const hostRef = ref<HTMLElement | null>(null)
const barRef = ref<HTMLElement | null>(null)
const fixedStyle = ref<Record<string, string>>({})
let observer: ResizeObserver | null = null
let rafId = 0
let stableFrames = 0
let lastSignature = ''

function syncPosition() {
  const host = hostRef.value
  const bar = barRef.value
  if (!host || !bar) return
  if (bar.offsetHeight) host.style.minHeight = `${bar.offsetHeight}px`
  const rect = host.getBoundingClientRect()
  if (!rect.width) return
  if (window.matchMedia('(max-width: 1024px)').matches) {
    fixedStyle.value = { left: '0.75rem', right: '0.75rem', width: 'auto' }
    return
  }
  fixedStyle.value = { left: `${Math.round(rect.left)}px`, right: 'auto', width: `${Math.round(rect.width)}px` }
}

function measureUntilStable() {
  cancelAnimationFrame(rafId)
  stableFrames = 0
  lastSignature = ''
  const step = () => {
    syncPosition()
    const signature = `${fixedStyle.value.left}|${fixedStyle.value.width}`
    stableFrames = signature === lastSignature ? stableFrames + 1 : 0
    lastSignature = signature
    if (stableFrames < 3) rafId = requestAnimationFrame(step)
  }
  rafId = requestAnimationFrame(step)
}

onMounted(() => {
  measureUntilStable()
  observer = new ResizeObserver(() => measureUntilStable())
  if (hostRef.value) observer.observe(hostRef.value)
  window.addEventListener('resize', measureUntilStable)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measureUntilStable)
})

const SPEEDS = [0.6, 0.8, 1, 1.2, 1.5, 2]

const speedOptions = computed(() =>
  SPEEDS.includes(props.rate) ? SPEEDS : [...SPEEDS, props.rate].sort((a, b) => a - b)
)

const isPlaying = computed(() => props.state === 'playing' || props.state === 'loading')
const percent = computed(() => {
  if (!props.total) return 0
  return Math.min(100, ((props.index + props.progress) / props.total) * 100)
})

function clock(seconds: number) {
  const value = Math.max(0, Math.round(seconds || 0))
  const m = Math.floor(value / 60)
  const s = value % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function seekAt(event: MouseEvent) {
  if (!props.total) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
  emit('seek', Math.min(props.total - 1, Math.floor(ratio * props.total)))
}

function changeRate(event: Event) {
  emit('update:rate', Number((event.target as HTMLSelectElement).value))
}

function changeEngine(event: Event) {
  emit('update:engine', (event.target as HTMLSelectElement).value as SpeechEngine)
}
</script>

<template>
  <div ref="hostRef" class="reader-player-host">
    <section ref="barRef" class="reader-player" :style="fixedStyle" aria-label="文章播放组件">
    <div class="reader-player__bar">
      <button
        type="button"
        class="reader-player__play"
        :aria-label="isPlaying ? '暂停朗读' : '开始朗读'"
        :aria-pressed="isPlaying"
        @click="emit('toggle')"
      >
        <svg v-if="isPlaying" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2a1 1 0 0 0 1.53.85l9.9-6.6a1 1 0 0 0 0-1.7l-9.9-6.6A1 1 0 0 0 8 5.4Z" /></svg>
      </button>

      <button type="button" class="rp-btn" :disabled="!total || index === 0" @click="emit('prev')">上一句</button>
      <button type="button" class="rp-btn" :disabled="!total || index >= total - 1" @click="emit('next')">下一句</button>
      <button type="button" class="rp-btn" :class="{ 'is-on': loop }" :aria-pressed="loop" @click="emit('update:loop', !loop)">
        循环本句
      </button>

      <span class="reader-player__count">
        第 {{ total ? index + 1 : 0 }}/{{ total }} 句
        <em>/</em>
        {{ clock(elapsed) }} / {{ clock(duration) }}
      </span>
    </div>

    <div
      class="reader-player__track"
      role="slider"
      tabindex="0"
      aria-label="朗读进度"
      aria-valuemin="0"
      :aria-valuemax="total"
      :aria-valuenow="total ? index + 1 : 0"
      @click="seekAt"
      @keydown.left.prevent="emit('prev')"
      @keydown.right.prevent="emit('next')"
    >
      <div class="reader-player__fill" :style="{ width: percent + '%' }"></div>
      <span class="reader-player__knob" :style="{ left: percent + '%' }"></span>
    </div>

    <div class="reader-player__meta">
      <label>
        语速
        <select :value="rate" aria-label="朗读语速" @change="changeRate">
          <option v-for="speed in speedOptions" :key="speed" :value="speed">{{ speed }}×</option>
        </select>
      </label>
      <label>
        语音
        <select :value="engine" aria-label="语音来源" @change="changeEngine">
          <option value="natural">自然语音</option>
          <option value="browser">浏览器语音</option>
        </select>
      </label>
      <span class="reader-player__hint">{{ state === 'loading' ? '正在准备音频…' : '点正文任意一句，可以从这句开始读' }}</span>
    </div>

    <p v-if="error" class="reader-player__msg is-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="reader-player__msg" role="status">{{ notice }}</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.reader-player-host {
  margin-top: 1.2rem;
}

.reader-player {
  position: fixed;
  bottom: 0.9rem;
  z-index: 30;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  box-shadow: 0 10px 24px rgb(0 0 0 / 8%);
  backdrop-filter: blur(6px);
}

.reader-player__bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.reader-player__play {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  flex: none;
  border: 0;
  border-radius: 999px;
  background: var(--color-select-bg);
  color: #fff;
  cursor: pointer;

  svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: currentColor;
  }

  &:hover {
    filter: brightness(1.08);
  }
}

.rp-btn {
  height: 1.8rem;
  padding: 0 0.55rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-line);
  background: var(--color-second);
  color: var(--color-main-text);
  font-size: 0.74rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  &.is-on {
    border-color: var(--color-select-bg);
    color: var(--color-select-bg);
    background: transparent;
  }
}

.reader-player__count {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--color-sub-text);
  font-variant-numeric: tabular-nums;

  em {
    margin: 0 0.3rem;
    font-style: normal;
    opacity: 0.6;
  }
}

.reader-player__track {
  position: relative;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--color-progress-bar);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }
}

.reader-player__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: var(--color-select-bg);
  transition: width 0.15s linear;
}

.reader-player__knob {
  position: absolute;
  top: 50%;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--color-card-bg);
  border: 2px solid var(--color-select-bg);
  transform: translate(-50%, -50%);
  transition: left 0.15s linear;
}

.reader-player__meta {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
  font-size: 0.72rem;
  color: var(--color-sub-text);

  label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  select {
    height: 1.6rem;
    padding: 0 0.3rem;
    border-radius: 0.4rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    font-size: 0.72rem;
  }
}

.reader-player__hint {
  margin-left: auto;
  opacity: 0.85;
}

.reader-player__msg {
  margin: 0;
  font-size: 0.72rem;
  color: var(--color-sub-text);

  &.is-error {
    color: #ef4444;
  }
}

@media (max-width: 720px) {
  .reader-player__count {
    margin-left: 0;
    width: 100%;
  }

  .reader-player__hint {
    display: none;
  }
}
</style>
