import { getCurrentStudyWord } from '@/core/hooks/dict.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import type { TaskWords, Word } from '@/core/types/types.ts'
import { shuffle } from '@/core/utils'
import { normalizeWordKey } from '@/core/utils/simple-word-filter'
import { dictionaryGrowthId, useGrowthStore } from '@/core/stores/growth'
import { applyGrowthDeferrals } from '@/core/growth/scheduling'

export interface StudyTaskResult {
  taskWords: TaskWords
  dueReviewCount: number
  randomReviewCount: number
}

interface AddRandomReviewOptions {
  words: Word[]
  lastLearnIndex: number
  perDayStudyNumber: number
  wordReviewRatio: number
  ignoreSet: Set<string>
  enabled: boolean
}

export function addRandomReviewWhenNoDue(taskWords: TaskWords, options: AddRandomReviewOptions): StudyTaskResult {
  const dueReviewCount = taskWords.review.length
  if (!options.enabled || dueReviewCount > 0) {
    return { taskWords, dueReviewCount, randomReviewCount: 0 }
  }

  const totalNeed = Math.max(0, Math.floor(options.perDayStudyNumber * options.wordReviewRatio))
  if (!totalNeed) {
    return { taskWords, dueReviewCount, randomReviewCount: 0 }
  }

  const excludedWords = new Set([
    ...options.ignoreSet,
    ...taskWords.new.map(item => normalizeWordKey(item.word)),
    ...taskWords.review.map(item => normalizeWordKey(item.word)),
  ])
  const learnedEnd = Math.min(options.lastLearnIndex, options.words.length)
  const randomReviewWords = shuffle(
    options.words.slice(0, learnedEnd).filter(item => !excludedWords.has(normalizeWordKey(item.word)))
  ).slice(0, totalNeed)

  taskWords.review = taskWords.review.concat(randomReviewWords)
  return {
    taskWords,
    dueReviewCount,
    randomReviewCount: randomReviewWords.length,
  }
}

export function createStudyTask(): StudyTaskResult {
  const store = useBaseStore()
  const settingStore = useSettingStore()
  const growth = useGrowthStore()
  const plan = growth.state.plans[dictionaryGrowthId(store.sdict)]
  const ignored = store.getIgnoreWordsSet()
  const held = growth.heldWords
  // 先入服务器延期队列，再从日常新词中移走；游标跨过它们后仍能找回。
  const task = applyGrowthDeferrals(getCurrentStudyWord(), store.sdict.words, plan?.deferred || [], held, ignored, store.sdict.perDayStudyNumber)
  return addRandomReviewWhenNoDue(task, {
    words: store.sdict.words,
    lastLearnIndex: store.sdict.lastLearnIndex,
    perDayStudyNumber: store.sdict.perDayStudyNumber,
    wordReviewRatio: settingStore.wordReviewRatio,
    ignoreSet: new Set([...ignored, ...held]),
    enabled: settingStore.autoAddRandomReviewWhenNoDue,
  })
}
