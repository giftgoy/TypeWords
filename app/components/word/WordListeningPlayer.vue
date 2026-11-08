<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useListeningStore } from '@/core/stores/listening.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { useWordListening } from '@/core/word/useWordListening.ts'
import type { ListeningOrder, ListeningScope } from '@/core/word/listening-queue.ts'

/**
 * 磨耳朵播放器：挂在全局 layout 上，切换页面也不中断。
 * 收起时只是右下角一个耳机按钮；展开后能选范围/顺序、开关释义与例句、调停顿和语速。
 */

const listening = useListeningStore()
const base = useBaseStore()
const player = useWordListening()

onMounted(() => {
  listening.restoreOptions()
  player.rebuildQueue(true, true)
})

const SCOPES: { value: ListeningScope; label: string }[] = [
  { value: 'current', label: '当前词库' },
  { value: 'collect', label: '收藏' },
  { value: 'wrong', label: '错词' },
  { value: 'known', label: '已掌握' },
]
const ORDERS: { value: ListeningOrder; label: string }[] = [
  { value: 'sequence', label: '顺序' },
  { value: 'random', label: '随机' },
]
const PAUSES = [0, 1, 2, 3, 5]
const RATES = [0.6, 0.8, 1, 1.2, 1.5]

const current = computed(() => listening.current)
const stageLabel = computed(
  () => ({ idle: '待开始', word: '读单词', meaning: '读释义', example: '读例句', gap: '停顿' })[listening.stage]
)
/** 范围下拉里带上词数，用户一眼能看出该听哪个 */
const scopeCounts = computed<Record<ListeningScope, number>>(() => ({
  current: base.sdict.words?.length ?? 0,
  collect: base.collectWord.words?.length ?? 0,
  wrong: base.wrong.words?.length ?? 0,
  known: base.known.words?.length ?? 0,
}))
const maskedWord = computed(() => {
  if (!listening.options.blind) return current.value?.word ?? ''
  const length = Math.min(12, Math.max(3, current.value?.word.length ?? 4))
  return '·'.repeat(length)
})

function changeScope(event: Event) {
  listening.setOptions({ scope: (event.target as HTMLSelectElement).value as ListeningScope })
}
function changeOrder(event: Event) {
  listening.setOptions({ order: (event.target as HTMLSelectElement).value as ListeningOrder })
}
function changePause(event: Event) {
  listening.setOptions({ pauseSeconds: Number((event.target as HTMLSelectElement).value) })
}
function changeRate(event: Event) {
  listening.setOptions({ rate: Number((event.target as HTMLSelectElement).value) })
}
</script>

<template>
  <div class="listening" :class="{ 'is-open': listening.expanded, 'is-playing': listening.playing }">
    <!-- 收起态：右下角常驻入口 -->
    <button
      type="button"
      class="listening__fab"
      :aria-label="listening.expanded ? '收起磨耳朵' : '打开磨耳朵'"
      :aria-expanded="listening.expanded"
      @click="listening.toggleExpanded()"
    >
      <IconFluentHeadphones24Regular class="listening__fab-icon" />
      <span v-if="listening.playing" class="listening__dot" aria-hidden="true"></span>
    </button>

    <!-- 播放中且收起时，旁边挂一条当前词，方便确认在听什么 -->
    <div v-if="!listening.expanded && listening.playing && current" class="listening__peek" role="status">
      <b>{{ maskedWord }}</b>
      <span v-if="listening.options.blind" class="listening__peek-tip">盲听中</span>
      <span v-else class="listening__peek-tip">{{ stageLabel }}</span>
    </div>

    <section v-if="listening.expanded" class="listening__panel" aria-label="磨耳朵">
      <header class="listening__head">
        <IconFluentHeadphones24Regular />
        <h2>磨耳朵</h2>
        <button type="button" class="listening__close" aria-label="收起" @click="listening.toggleExpanded(false)">×</button>
      </header>

      <div class="listening__now">
        <div class="listening__word">
          <b>{{ maskedWord || '—' }}</b>
          <span v-if="current?.phonetic && !listening.options.blind" class="listening__phonetic">/{{ current.phonetic }}/</span>
        </div>
        <p v-if="current?.meaning" class="listening__meaning">{{ current.meaning }}</p>
        <p v-if="current?.example && !listening.options.blind" class="listening__example">{{ current.example }}</p>
        <p v-if="listening.message" class="listening__message" role="status">{{ listening.message }}</p>
      </div>

      <div class="listening__transport">
        <button type="button" class="listening__step" aria-label="上一个单词" :disabled="!listening.items.length" @click="player.prev()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7z" /><path d="M19 5.6v12.8a1 1 0 0 1-1.53.85L9 13.7a1 1 0 0 1 0-1.7l8.47-5.55A1 1 0 0 1 19 5.6Z" /></svg>
        </button>
        <button
          type="button"
          class="listening__play"
          :aria-label="listening.playing ? '暂停磨耳朵' : '开始磨耳朵'"
          :aria-pressed="listening.playing"
          @click="player.toggle()"
        >
          <svg v-if="listening.playing" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2a1 1 0 0 0 1.53.85l9.9-6.6a1 1 0 0 0 0-1.7l-9.9-6.6A1 1 0 0 0 8 5.4Z" /></svg>
        </button>
        <button type="button" class="listening__step" aria-label="下一个单词" :disabled="!listening.items.length" @click="player.next()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2z" /><path d="M5 5.6v12.8a1 1 0 0 0 1.53.85L15 13.7a1 1 0 0 0 0-1.7L6.53 6.45A1 1 0 0 0 5 5.6Z" /></svg>
        </button>
        <span class="listening__count">
          {{ listening.items.length ? listening.index + 1 : 0 }} / {{ listening.items.length }}
          <em>{{ stageLabel }}</em>
        </span>
      </div>

      <div class="listening__options">
        <label>
          范围
          <select :value="listening.options.scope" @change="changeScope">
            <option v-for="item in SCOPES" :key="item.value" :value="item.value">
              {{ item.label }}（{{ scopeCounts[item.value] }}）
            </option>
          </select>
        </label>
        <label>
          顺序
          <select :value="listening.options.order" @change="changeOrder">
            <option v-for="item in ORDERS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label>
          停顿
          <select :value="listening.options.pauseSeconds" @change="changePause">
            <option v-for="value in PAUSES" :key="value" :value="value">{{ value }} 秒</option>
          </select>
        </label>
        <label>
          语速
          <select :value="listening.options.rate" @change="changeRate">
            <option v-for="value in RATES" :key="value" :value="value">{{ value }}×</option>
          </select>
        </label>
      </div>

      <div class="listening__switches">
        <label>
          <input
            type="checkbox"
            :checked="listening.options.readMeaning"
            @change="listening.setOptions({ readMeaning: ($event.target as HTMLInputElement).checked })"
          />
          读中文释义
        </label>
        <label>
          <input
            type="checkbox"
            :checked="listening.options.readExample"
            @change="listening.setOptions({ readExample: ($event.target as HTMLInputElement).checked })"
          />
          读例句
        </label>
        <label>
          <input
            type="checkbox"
            :checked="listening.options.blind"
            @change="listening.setOptions({ blind: ($event.target as HTMLInputElement).checked })"
          />
          盲听（不显示拼写）
        </label>
      </div>

      <p class="listening__hint">音量与音色沿用「设置 → 音效设置」里的单词音量；切页面不会中断播放。</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.listening {
  position: fixed;
  right: 18px;
  bottom: 148px;
  z-index: 1003;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;

  &.is-open {
    right: 18px;
    bottom: 24px;
  }
}

.listening__fab {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.9rem;
  height: 2.9rem;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-second);
  color: var(--color-main-text);
  cursor: pointer;
  box-shadow: 0 8px 20px rgb(0 0 0 / 12%);

  &:hover {
    background: var(--color-third);
  }
}

.listening__fab-icon {
  font-size: 1.3rem;
}

.listening__dot {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: #22c55e;
  box-shadow: 0 0 0 0 rgb(34 197 94 / 60%);
  animation: listening-pulse 1.8s infinite;
}

@keyframes listening-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(34 197 94 / 55%);
  }

  70% {
    box-shadow: 0 0 0 6px rgb(34 197 94 / 0%);
  }

  100% {
    box-shadow: 0 0 0 0 rgb(34 197 94 / 0%);
  }
}

.listening__peek {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  max-width: 14rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-card-bg);
  font-size: 0.8rem;
  color: var(--color-main-text);
  box-shadow: 0 6px 16px rgb(0 0 0 / 10%);

  b {
    font-family: var(--word-font-family);
    font-size: 0.86rem;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.listening__peek-tip {
  font-size: 0.7rem;
  color: var(--color-sub-text);
}

.listening__panel {
  width: min(21rem, calc(100vw - 2rem));
  max-height: min(76vh, 34rem);
  overflow-y: auto;
  padding: 0.8rem 0.9rem 0.9rem;
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  box-shadow: 0 18px 44px rgb(0 0 0 / 18%);
  font-family: var(--font-family);
}

.listening__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;

  h2 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-main-text);
  }
}

.listening__close {
  margin-left: auto;
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

.listening__now {
  margin-top: 0.6rem;
  padding: 0.6rem 0.65rem;
  border-radius: 0.6rem;
  background: var(--color-second);
}

.listening__word {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;

  b {
    font-family: var(--word-font-family);
    font-size: 1.15rem;
    color: var(--color-main-text);
  }
}

.listening__phonetic {
  font-size: 0.78rem;
  color: var(--color-sub-text);
}

.listening__meaning {
  margin-top: 0.25rem;
  font-size: 0.86rem;
  line-height: 1.65;
  color: var(--color-main-text);
}

.listening__example {
  margin-top: 0.3rem;
  font-family: var(--en-article-family);
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--color-sub-text);
}

.listening__message {
  margin-top: 0.3rem;
  font-size: 0.78rem;
  color: #b45309;
}

.listening__transport {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.7rem;
}

.listening__step {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-line);
  border-radius: 0.5rem;
  background: var(--color-second);
  color: var(--color-main-text);
  cursor: pointer;

  svg {
    width: 0.95rem;
    height: 0.95rem;
    fill: currentColor;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.listening__play {
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border: 0;
  border-radius: 999px;
  background: var(--color-select-bg);
  color: #fff;
  cursor: pointer;

  svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: currentColor;
  }
}

.listening__count {
  margin-left: auto;
  font-size: 0.76rem;
  color: var(--color-sub-text);
  font-variant-numeric: tabular-nums;

  em {
    margin-left: 0.3rem;
    font-style: normal;
    opacity: 0.85;
  }
}

.listening__options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 0.6rem;
  margin-top: 0.7rem;

  label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--color-sub-text);
  }

  select {
    flex: 1;
    min-width: 0;
    height: 1.7rem;
    padding: 0 0.25rem;
    border: 1px solid var(--color-line);
    border-radius: 0.35rem;
    background: var(--color-card-bg);
    color: var(--color-main-text);
    font-size: 0.76rem;
  }
}

.listening__switches {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.6rem;

  label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--color-main-text);
    cursor: pointer;
  }

  input {
    width: 0.9rem;
    height: 0.9rem;
    accent-color: var(--color-select-bg);
  }
}

.listening__hint {
  margin-top: 0.6rem;
  font-size: 0.7rem;
  line-height: 1.6;
  color: var(--color-sub-text);
}

@media (max-width: 768px) {
  .listening {
    bottom: 132px;
  }

  .listening.is-open {
    bottom: 12px;
  }
}

@media (max-width: 480px) {
  .listening {
    bottom: 244px;
    right: 12px;
  }

  .listening.is-open {
    right: 8px;
    bottom: 8px;
  }
}
</style>
