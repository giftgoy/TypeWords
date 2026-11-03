import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GUIDE_STEPS,
  createLearningGuideState,
  readLearningGuideState,
  isOfficialDeployment,
  toDisplayWordIndex,
  toStoredWordIndex,
  countPracticeWords,
  getReviewWordLimit,
} from '../app/core/utils/learning-guide.ts'

test('tour has five real stages and closing or reloading never turns an unfinished tour into completed', () => {
  assert.equal(GUIDE_STEPS.length, 5)
  assert.equal(GUIDE_STEPS.at(-1).target, '#word-wrap')
  assert.equal(createLearningGuideState().status, 'idle')
  assert.deepEqual(readLearningGuideState(JSON.stringify({ status: 'active', step: 3, dictId: 'cet4' })), {
    status: 'paused',
    step: 3,
    dictId: 'cet4',
    waiting: false,
  })
  assert.equal(readLearningGuideState(JSON.stringify({ status: 'completed', step: 4 })).status, 'completed')
  assert.equal(readLearningGuideState('1').status, 'idle')
  assert.equal(readLearningGuideState('{broken').status, 'idle')
  assert.equal(readLearningGuideState(JSON.stringify({ status: 'paused', step: 200 })).step, 4)
})

test('displayed learning ordinals are one based while stored dictionary offsets remain zero based', () => {
  assert.equal(toDisplayWordIndex(0), 1)
  assert.equal(toDisplayWordIndex(19), 20)
  assert.equal(toStoredWordIndex(1, 861), 0)
  assert.equal(toStoredWordIndex(861, 861), 860)
  assert.equal(toStoredWordIndex(999, 861), 860)
  assert.equal(toStoredWordIndex(0, 861), 0)
  assert.equal(toStoredWordIndex(1, 0), 0)
})

test('zero-task checks distinguish review-only sessions and tolerate empty tasks', () => {
  assert.equal(countPracticeWords({}), 0)
  assert.equal(countPracticeWords({ new: [], review: [] }), 0)
  assert.equal(countPracticeWords({ new: [1, 2], review: [] }), 2)
  assert.equal(countPracticeWords({ new: [1, 2], review: [] }, true), 0)
  assert.equal(countPracticeWords({ new: [], review: [1] }, true), 1)
})

test('review limits honor zero and targets smaller than the new-word goal', () => {
  assert.equal(getReviewWordLimit(20, 0), 0)
  assert.equal(getReviewWordLimit(20, 0.5), 10)
  assert.equal(getReviewWordLimit(20, 3), 60)
  assert.equal(getReviewWordLimit(20, Number.NaN), 0)
})

test('official-only promotions stay hidden for localhost, LAN and self-hosted domains', () => {
  for (const hostname of ['localhost', '127.0.0.1', '192.168.1.9', 'words.example.com', 'typewords.cc.example.com'])
    assert.equal(isOfficialDeployment(hostname), false)
  assert.equal(isOfficialDeployment('typewords.cc'), true)
  assert.equal(isOfficialDeployment('www.typewords.cc'), true)
})
