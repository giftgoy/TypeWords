<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog } from '@/base'
import { useSettingStore } from '@/core/stores/setting'
import { useRuntimeStore } from '@/core/stores/runtime'
import { useBaseStore } from '@/core/stores/base'
import { getReviewWordLimit, toDisplayWordIndex, toStoredWordIndex } from '@/core/utils/learning-guide'
import ChangeLastPracticeIndexDialog from './ChangeLastPracticeIndexDialog.vue'
import SimpleWordFilterControl from './SimpleWordFilterControl.vue'

const settings = useSettingStore()
const runtimeStore = useRuntimeStore()
const store = useBaseStore()
const model = defineModel<boolean>()
const props = defineProps<{
  showLeftOption?: boolean
  startOnConfirm?: boolean
  onConfirm?: () => Promise<void | boolean>
}>()
const emit = defineEmits<{ ok: [] }>()
const show = ref(false)
const daily = ref(20)
const ratio = ref(1)
const startIndex = ref(0)
const validationError = ref('')
const dict = computed(() => runtimeStore.editDict)
const startOrdinal = computed({
  get: () => toDisplayWordIndex(startIndex.value),
  set: value => {
    startIndex.value = toStoredWordIndex(value, dict.value.words.length)
  },
})
const reviewLimit = computed({
  get: () => getReviewWordLimit(Number(daily.value), ratio.value),
  set: value => {
    ratio.value = Math.max(0, Math.min(10, Number(value) / Math.max(1, daily.value)))
  },
})
const remaining = computed(
  () =>
    dict.value.words
      .slice(startIndex.value)
      .filter(word => !store.getIgnoreWordsSet().has(word.word.trim().toLowerCase())).length
)
const days = computed(() => Math.ceil(remaining.value / Math.max(1, Number(daily.value) || 1)))
const finished = computed(() => startIndex.value >= dict.value.words.length)

watch(model, value => {
  if (!value) return
  daily.value = dict.value.perDayStudyNumber || 20
  startIndex.value = Math.max(0, Math.min(dict.value.words.length, dict.value.lastLearnIndex))
  ratio.value = settings.wordReviewRatio
  validationError.value = ''
})
async function save() {
  if (!Number.isFinite(daily.value) || daily.value < 1 || daily.value > 500 || !Number.isFinite(ratio.value)) {
    validationError.value = '每天的新词数量应为 1–500 个。'
    return false
  }
  dict.value.perDayStudyNumber = Math.floor(daily.value)
  dict.value.lastLearnIndex = startIndex.value
  dict.value.complete = startIndex.value >= dict.value.words.length
  settings.wordReviewRatio = ratio.value
  return props.onConfirm?.()
}
</script>

<template>
  <Dialog
    v-model="model"
    title="学习设置"
    padding
    footer
    :confirm-button-text="startOnConfirm ? '保存并开始' : '保存设置'"
    :on-confirm="save"
    @ok="emit('ok')"
  >
    <div class="study-settings" id="mode">
      <p class="study-intro">
        {{ dict.name }} · 共 {{ dict.words.length.toLocaleString() }} 词。先定一个轻松完成的目标。
      </p>
      <div class="study-field">
        <label for="study-daily">每天学习多少新词</label>
        <div>
          <input
            id="study-daily"
            type="number"
            min="1"
            max="500"
            v-model.number="daily"
            aria-label="每天的新词数量"
          /><span> 个新词</span>
        </div>
      </div>
      <div class="study-presets">
        <button
          v-for="count in [5, 10, 20, 50]"
          :key="count"
          type="button"
          :aria-pressed="daily === count"
          @click="daily = count"
        >
          {{ count }} 词 / 天
        </button>
      </div>
      <div class="study-field">
        <label for="study-review">每组最多复习</label>
        <div>
          <input
            id="study-review"
            type="number"
            min="0"
            :max="daily * 10"
            v-model.number="reviewLimit"
            aria-label="每组复习数量上限"
          /><span> 个词</span>
        </div>
      </div>
      <p class="study-help">
        智能复习（FSRS）只安排已学且到期的词，实际可能少于上限。设为 0 可暂不复习；上限随每日新词目标同比调整。
      </p>
      <div class="study-field" v-if="!finished">
        <label for="study-start">从哪个词开始</label>
        <div>
          <span>第 </span
          ><input
            id="study-start"
            type="number"
            min="1"
            :max="dict.words.length"
            v-model.number="startOrdinal"
            aria-label="学习起点（从第1个词算起）"
          /><span> 个词</span>
        </div>
      </div>
      <p v-else class="study-help">
        新词已经学完，接下来复习已学词。<button type="button" class="text-button" @click="startIndex = 0">
          重新从第 1 个词开始
        </button>
      </p>
      <button type="button" class="text-button" @click="show = true">在词典中选择起点</button>
      <div class="study-estimate" role="status">
        {{
          remaining
            ? '剩余可学新词 ' + remaining + ' 个，按当前目标约 ' + days + ' 天学完新词。'
            : '当前起点之后没有可学新词。'
        }}<small>估算已扣除已掌握及被过滤的词；后续复习另行安排。</small>
      </div>
      <SimpleWordFilterControl :words="dict.words" />
      <p v-if="validationError" role="alert">{{ validationError }}</p>
    </div>
  </Dialog>
  <ChangeLastPracticeIndexDialog
    v-model="show"
    @ok="
      value => {
        startIndex = value
        show = false
      }
    "
  />
</template>

<style scoped>
.study-settings {
  width: min(560px, calc(100vw - 80px));
  color: var(--color-main-text);
  font-size: 14px;
}
.study-intro,
.study-help {
  color: var(--color-sub-text);
  line-height: 1.8;
  font-size: 13px;
  margin: 0 0 16px;
}
.study-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin: 20px 0 12px;
}
.study-field label {
  font-weight: 600;
}
.study-field input {
  width: 76px;
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-textarea-bg);
  color: inherit;
  font: inherit;
}
.study-presets {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 22px;
}
.study-presets button {
  border: 1px solid var(--color-line);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 7px 10px;
  cursor: pointer;
}
.study-presets button[aria-pressed='true'] {
  border-color: #9c89e0;
  background: #9c89e022;
}
.text-button {
  border: 0;
  background: transparent;
  color: var(--color-link);
  padding: 2px 0;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.study-estimate {
  margin-top: 18px;
  border: 1px solid var(--color-line);
  padding: 12px;
  border-radius: 8px;
  line-height: 1.8;
  font-size: 13px;
}
.study-estimate small {
  display: block;
  color: var(--color-sub-text);
  font-size: 12px;
}
@media (max-width: 480px) {
  .study-field {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
