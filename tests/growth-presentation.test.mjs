import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatGrowthGap, growthResultText, milestoneFeedback } from '../app/core/growth/presentation.ts'

test('feedback uses measured counts and intervals and separates correction from independent success', () => {
  assert.equal(formatGrowthGap(59999), '不到 1 分钟')
  assert.equal(formatGrowthGap(259260000), '3 天 1 分钟')
  assert.match(growthResultText({ stage: 1, count: 3, passed: false }), /3 个，另外 2 个/)
  assert.match(growthResultText({ stage: 3, count: 5, passed: true, gap: 90060000 }), /1 天 1 小时 1 分钟.*5 个词/)
  assert.match(growthResultText({ mode: 'practice', count: 5 }), /不点亮/)
  assert.match(growthResultText({ stage: 7, passed: false, contaminated: true }), /额外.*提示/)
})

test('milestone feedback keeps actual progress rather than replacing it with the threshold', () => {
  assert.match(milestoneFeedback({ threshold: 30, percent: 34, count: 34, total: 100 }), /34%，34\/100/)
  assert.match(milestoneFeedback({ threshold: 80, percent: 84, count: 21, total: 25 }), /还剩 4 个/)
  assert.doesNotMatch(milestoneFeedback({ threshold: 100, percent: 100, count: 25, total: 25 }), /掌握|不会再忘/)
})
