<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getPracticeWordCacheLocal } from '@/core/utils/cache'
import { pendingStudyRows } from '@/core/utils/pending-study-statistics'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import { BasePage, Progress } from '@/base'
import { useBaseStore } from '@/core/stores/base.ts'
import { msToHourMinute } from '@/core/utils'

const { t: $t } = useI18n()
const store = useBaseStore()
const pendingStat = ref<any>(null)
onMounted(async () => {
  pendingStat.value = (await getPracticeWordCacheLocal())?.statStoreData
})

type StatRow = {
  startDate: number
  spend: number
  total: number
  new: number
  review: number
  wrong: number
  dictName: string
  pending?: boolean
}

const wordBooks = computed(() => (store.word.bookList || []).filter((book: any) => !book.system && book.length))

const rows = computed<StatRow[]>(() =>
  store.word.bookList
    .flatMap((book: any) =>
      (book.statistics || []).map((stat: any) => ({
        startDate: stat.startDate,
        spend: stat.spend || 0,
        total: stat.total || 0,
        new: stat.new || 0,
        review: stat.review || 0,
        wrong: stat.wrong || 0,
        dictName: book.name || '',
      }))
    )
    .concat(pendingStudyRows(pendingStat.value, store.sdict.name))
    .sort((a, b) => b.startDate - a.startDate)
)

const totalMs = computed(() => rows.value.reduce((sum, row) => sum + row.spend, 0))
const totalWords = computed(() => rows.value.reduce((sum, row) => sum + row.total, 0))
const totalWrong = computed(() => rows.value.reduce((sum, row) => sum + row.wrong, 0))
const studyDayCount = computed(() => new Set(rows.value.map(row => dayjs(row.startDate).format('YYYY-MM-DD'))).size)

const overview = computed(() => [
  { label: $t('total_study_time'), value: totalMs.value ? msToHourMinute(totalMs.value) : '0' },
  { label: $t('total_study_days'), value: String(studyDayCount.value) },
  { label: $t('records_total_words'), value: String(totalWords.value) },
  { label: $t('records_wrong_count'), value: String(totalWrong.value) },
])

const last14Days = computed(() => {
  const spendMap = new Map<string, number>()
  for (const row of rows.value) {
    const key = dayjs(row.startDate).format('YYYY-MM-DD')
    spendMap.set(key, (spendMap.get(key) || 0) + row.spend)
  }
  const days = []
  for (let i = 13; i >= 0; i--) {
    const date = dayjs().subtract(i, 'day')
    const key = date.format('YYYY-MM-DD')
    days.push({
      key,
      label: date.format('MM-DD'),
      weekday: date.format('ddd'),
      minutes: Math.round((spendMap.get(key) || 0) / 60000),
      isToday: i === 0,
    })
  }
  return days
})

const maxMinutes = computed(() => Math.max(1, ...last14Days.value.map(day => day.minutes)))
const hasChartData = computed(() => last14Days.value.some(day => day.minutes > 0))

const dictProgress = computed(() =>
  wordBooks.value.map((book: any) => {
    const total = book.length || 0
    const learned = book.complete ? total : Math.min(book.lastLearnIndex || 0, total)
    return {
      name: book.name || '',
      learned,
      total,
      percent: total ? Math.round((learned / total) * 100) : 0,
      complete: !!book.complete,
    }
  })
)

const recentRows = computed(() => rows.value.slice(0, 20))

function durationText(ms: number) {
  if (!ms) return '-'
  return msToHourMinute(ms)
}
</script>

<template>
  <BasePage>
    <div class="flex flex-col gap-4 pb-8">
      <div class="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 class="text-2xl font-bold m-0">{{ $t('study_record') }}</h1>
          <p class="text-sm color-gray mt-1 mb-0">{{ $t('records_subtitle') }}</p>
        </div>
        <NuxtLink to="/words" class="text-sm color-blue">{{ $t('records_back_to_words') }} →</NuxtLink>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="item in overview" :key="item.label" class="card-white p-4 flex flex-col gap-1">
          <div class="text-2xl font-semibold">{{ item.value }}</div>
          <div class="text-sm color-gray">{{ item.label }}</div>
        </div>
      </div>

      <div class="card-white p-4 md:p-5">
        <div class="flex items-baseline justify-between mb-3">
          <div class="text-lg font-semibold">{{ $t('records_last_14_days') }}</div>
          <div class="text-xs color-gray">{{ $t('records_unit_minutes') }}</div>
        </div>
        <div class="flex items-end gap-2 h-40 relative">
          <div v-if="!hasChartData" class="absolute inset-0 flex items-center justify-center text-sm color-gray">
            {{ $t('records_empty') }}
          </div>
          <div v-for="day in last14Days" :key="day.key" class="flex-1 flex flex-col items-center justify-end gap-1 h-full">
            <div class="text-xs color-gray">{{ day.minutes || '' }}</div>
            <div
              class="w-full rounded-t"
              :class="day.isToday ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-primary,#409eff)] opacity-70'"
              :style="{ height: Math.max(day.minutes ? 6 : 2, (day.minutes / maxMinutes) * 100) + '%' }"
              :title="day.key + ' · ' + day.minutes + ' min'"
            ></div>
            <div class="text-[11px] color-gray whitespace-nowrap">{{ day.label }}</div>
          </div>
        </div>
      </div>

      <div class="card-white p-4 md:p-5">
        <div class="text-lg font-semibold mb-3">{{ $t('records_dict_progress') }}</div>
        <div v-if="dictProgress.length" class="flex flex-col gap-3">
          <div v-for="book in dictProgress" :key="book.name" class="flex flex-col gap-1">
            <div class="flex justify-between text-sm">
              <span class="truncate">{{ book.name }}</span>
              <span class="color-gray shrink-0 ml-3">
                {{ book.learned }} / {{ book.total }}
                <template v-if="book.complete"> · {{ $t('completed_review_stage') }}</template>
              </span>
            </div>
            <Progress :percentage="book.percent" :show-text="false" :stroke-width="8" />
          </div>
        </div>
        <div v-else class="text-sm color-gray">{{ $t('records_empty') }}</div>
      </div>

      <div class="card-white p-4 md:p-5 overflow-x-auto">
        <div class="text-lg font-semibold mb-3">{{ $t('records_recent') }}</div>
        <table v-if="recentRows.length" class="w-full text-sm records-table">
          <thead>
            <tr class="text-left color-gray">
              <th class="py-2 pr-3 font-normal">{{ $t('records_date') }}</th>
              <th class="py-2 pr-3 font-normal">{{ $t('records_dict') }}</th>
              <th class="py-2 pr-3 font-normal text-right">{{ $t('new_words_count') }}</th>
              <th class="py-2 pr-3 font-normal text-right">{{ $t('review') }}</th>
              <th class="py-2 pr-3 font-normal text-right">{{ $t('records_wrong_count') }}</th>
              <th class="py-2 pr-0 font-normal text-right">{{ $t('total_study_time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in recentRows" :key="row.startDate + row.dictName" class="border-t border-solid border-[var(--color-line)]">
              <td class="py-2 pr-3 whitespace-nowrap">{{ dayjs(row.startDate).format('YYYY-MM-DD HH:mm') }}</td>
              <td class="py-2 pr-3 truncate max-w-48">{{ row.dictName }}<span v-if="row.pending"> · 未完成，可继续学习</span></td>
              <td class="py-2 pr-3 text-right">{{ row.pending ? '待结算' : row.new }}</td>
              <td class="py-2 pr-3 text-right">{{ row.pending ? '待结算' : row.review }}</td>
              <td class="py-2 pr-3 text-right">{{ row.wrong }}</td>
              <td class="py-2 pr-0 text-right whitespace-nowrap">{{ durationText(row.spend) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="text-sm color-gray">{{ $t('records_empty') }}</div>
      </div>
    </div>
  </BasePage>
</template>
