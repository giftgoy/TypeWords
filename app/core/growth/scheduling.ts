import type { TaskWords, Word } from '../types/types.ts'
import { normalizeWordKey } from '../utils/simple-word-filter.ts'

export function applyGrowthDeferrals(
  task: TaskWords,
  words: Word[],
  deferredWords: string[],
  held: Set<string>,
  ignored: Set<string>,
  limit: number
): TaskWords {
  const deferred = new Set(deferredWords)
  const available = (word: Word) => !ignored.has(normalizeWordKey(word.word)) && !held.has(normalizeWordKey(word.word))
  const returning = words.filter(w => deferred.has(normalizeWordKey(w.word)) && available(w))
  const selected = new Set<string>()
  const next = [
    ...returning,
    ...task.new.filter(w => !held.has(normalizeWordKey(w.word)) || !deferred.has(normalizeWordKey(w.word))),
  ]
    .filter(w => {
      const key = normalizeWordKey(w.word)
      if (selected.has(key) || ignored.has(key)) return false
      selected.add(key)
      return true
    })
    .slice(0, Math.max(0, limit))
  const newKeys = new Set(next.map(w => normalizeWordKey(w.word)))
  return { new: next, review: task.review.filter(w => available(w) && !newKeys.has(normalizeWordKey(w.word))) }
}
