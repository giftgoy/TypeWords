<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GUIDE_STEPS } from '@/core/utils/learning-guide'
import { useBaseStore } from '@/core/stores/base'
import { DICT_LIST } from '@/core/config/env'
import { resourceWrap } from '@/core/utils'

const guide = useLearningGuide()
const route = useRoute()
const router = useRouter()
const store = useBaseStore()
const step = computed(() => GUIDE_STEPS[guide.state.value.step])
const active = computed(() => guide.state.value.status === 'active')
const highlight = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const busy = ref(false)
const error = ref('')
let observer: MutationObserver | undefined
let resizeObserver: ResizeObserver | undefined

function updateTarget() {
  const target = active.value ? document.querySelector(step.value.target) : null
  if (!target || !target.getClientRects().length) {
    highlight.value = null
    return
  }
  const rect = target.getBoundingClientRect()
  highlight.value = { top: rect.top - 5, left: rect.left - 5, width: rect.width + 10, height: rect.height + 10 }
}
async function observeTarget() {
  observer?.disconnect()
  resizeObserver?.disconnect()
  await nextTick()
  updateTarget()
  if (!active.value) return
  observer = new MutationObserver(updateTarget)
  observer.observe(document.body, { childList: true, subtree: true })
  const target = document.querySelector(step.value.target)
  if (target) {
    resizeObserver = new ResizeObserver(updateTarget)
    resizeObserver.observe(target)
  }
}
watch(
  [active, () => guide.state.value.step, () => route.fullPath],
  () => {
    if (!import.meta.client) return
    if (active.value && route.path.startsWith('/practice-words/')) {
      guide.state.value.step = GUIDE_STEPS.length - 1
      guide.state.value.waiting = false
      guide.persist()
    }
    observeTarget()
  },
  { immediate: true, flush: 'post' }
)
async function advance() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const index = guide.state.value.step
    if (index === 0) {
      guide.state.value.step = 1
      await router.push('/dict-list')
    } else if (index === 1) {
      const response = await fetch(resourceWrap(DICT_LIST.WORD.ALL))
      if (!response.ok) throw new Error('目录暂时无法读取，请稍后再试。')
      const catalog = await response.json()
      const resource = catalog.find(item => String(item.id) === String(store.sdict.id)) || catalog[0]
      if (!resource) throw new Error('请先在资源市场添加或选择一本词典。')
      guide.state.value.dictId = String(resource.id)
      guide.state.value.step = 2
      await router.push({ path: '/dict', query: { from: 'list', id: String(resource.id) } })
    } else if (index === 2) {
      guide.state.value.step = 3
      window.dispatchEvent(new CustomEvent('typewords:guide-open-settings'))
    } else if (index === 3) {
      if (!document.querySelector('#mode')) window.dispatchEvent(new CustomEvent('typewords:guide-open-settings'))
      else guide.state.value.waiting = true
    } else guide.finish()
    guide.persist()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '暂时无法继续，请重试。'
  } finally {
    busy.value = false
  }
}
function onEscape(event: KeyboardEvent) {
  if (active.value && event.key === 'Escape') guide.pause()
}
onMounted(() => {
  guide.load()
  window.addEventListener('resize', updateTarget)
  window.addEventListener('scroll', updateTarget, true)
  window.addEventListener('keydown', onEscape)
})
onUnmounted(() => {
  observer?.disconnect()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateTarget)
  window.removeEventListener('scroll', updateTarget, true)
  window.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <Teleport to="body">
    <template v-if="active">
      <div
        v-if="highlight"
        class="guide-highlight"
        :style="{
          top: highlight.top + 'px',
          left: highlight.left + 'px',
          width: highlight.width + 'px',
          height: highlight.height + 'px',
        }"
        aria-hidden="true"
      ></div>
      <aside class="learning-guide-card" aria-label="入门引导" :class="{ waiting: guide.state.value.waiting }">
        <div class="guide-heading">
          <span>入门引导 · {{ guide.state.value.step + 1 }}/{{ GUIDE_STEPS.length }}</span
          ><button type="button" aria-label="关闭引导，稍后可重看" @click="guide.pause">×</button>
        </div>
        <h2>{{ step.title }}</h2>
        <p>{{ guide.state.value.waiting ? '请在学习设置中点击“保存并开始”。进入练习后，引导会继续。' : step.text }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="guide-actions">
          <button type="button" @click="guide.pause">跳过引导</button
          ><button
            v-if="!guide.state.value.waiting"
            type="button"
            class="guide-next"
            :disabled="busy || (!highlight && guide.state.value.step !== 3)"
            @click="advance"
          >
            {{ busy ? '加载中…' : step.action }}
          </button>
        </div>
        <small>关闭或跳过后，可在“帮助”或“设置”中重看。</small>
      </aside>
    </template>
  </Teleport>
</template>

<style scoped>
.guide-highlight {
  position: fixed;
  z-index: 10010;
  pointer-events: none;
  border: 3px solid #a78bfa;
  border-radius: 12px;
  box-shadow: 0 0 0 4px #a78bfa22;
  box-sizing: border-box;
}
.learning-guide-card {
  position: fixed;
  z-index: 10020;
  right: 16px;
  bottom: 20px;
  width: 320px;
  max-width: calc(100vw - 32px);
  padding: 20px;
  box-sizing: border-box;
  border: 1px solid #a78bfa;
  border-radius: 14px;
  background: var(--color-second);
  color: var(--color-main-text);
  box-shadow: 0 8px 32px #0003;
  font-size: 13px;
}
.guide-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-sub-text);
  font-size: 12px;
}
.guide-heading button {
  font-size: 22px;
  padding: 0 3px;
}
.learning-guide-card h2 {
  margin: 9px 0;
  font-size: 18px;
}
.learning-guide-card p {
  line-height: 1.8;
  margin: 10px 0;
}
.learning-guide-card button {
  background: transparent;
  color: inherit;
  border: 0;
  cursor: pointer;
  font: inherit;
}
.guide-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 16px 0 12px;
}
.guide-actions .guide-next {
  border-radius: 7px;
  background: #756ad8;
  color: white;
  padding: 8px 11px;
}
.guide-actions button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.learning-guide-card small {
  color: var(--color-sub-text);
  font-size: 11px;
}
.waiting {
  right: 16px;
  top: 16px;
  bottom: auto;
}
@media (max-width: 768px) {
  .learning-guide-card {
    bottom: 12px;
    right: 12px;
    width: calc(100vw - 24px);
    max-width: 360px;
    padding: 14px;
  }
  .waiting {
    top: 12px;
    bottom: auto;
  }
}
</style>
